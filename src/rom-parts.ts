import { hasCachedAsset, readCachedAsset, writeCachedAsset } from './asset-cache';
import { abortError, fetchBytes, isAbortError, probeUrl, type LoadProgress } from './progress';

const PART_CONCURRENCY = 4;
const PART_ATTEMPTS = 3;

interface SplitEntry {
  size: number;
  sha256: string;
  parts: string[];
}

interface RomManifest {
  chunkBytes: number;
  files: Record<string, SplitEntry>;
}

interface SplitRom extends SplitEntry {
  chunkBytes: number;
}

interface PartPlan {
  url: string;
  start: number;
  length: number;
}

export interface RomLoadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LoadProgress) => void;
}

const manifestLoads = new Map<string, Promise<RomManifest | null>>();

/**
 * Download a catalog ROM. Split sets are reassembled from manifest parts and
 * cached under the original zip URL. Anything absent from the manifest is the
 * whole zip, which keeps local dev and romBaseUrl working.
 */
export async function fetchGameRom(url: string, options: RomLoadOptions = {}): Promise<Uint8Array> {
  if (options.signal?.aborted) throw abortError();
  const cached = await readCachedAsset(url);
  if (cached) {
    options.onProgress?.({ loaded: cached.byteLength, total: cached.byteLength, fromCache: true });
    return cached;
  }

  const split = await lookupSplit(url);
  if (!split) return fetchBytes(url, options);
  return fetchSplitRom(url, split, options);
}

/** A ROM is available when the merged zip is cached, the manifest lists it, or the whole file answers. */
export async function probeGameRom(url: string): Promise<boolean> {
  if (await hasCachedAsset(url)) return true;
  if (await lookupSplit(url)) return true;
  return probeUrl(url);
}

async function lookupSplit(url: string): Promise<SplitRom | null> {
  const manifest = await loadManifest(manifestUrlFor(url));
  if (!manifest) return null;
  const entry = manifest.files[fileName(url)];
  if (!entry) return null;
  return { ...entry, chunkBytes: manifest.chunkBytes };
}

function loadManifest(url: string): Promise<RomManifest | null> {
  const pending = manifestLoads.get(url);
  if (pending) return pending;
  const next = fetchManifest(url).catch((error: unknown) => {
    manifestLoads.delete(url);
    if (isAbortError(error)) throw error;
    return null;
  });
  manifestLoads.set(url, next);
  return next;
}

async function fetchManifest(url: string): Promise<RomManifest | null> {
  const response = await fetch(url, { credentials: 'omit', mode: 'cors', cache: 'no-cache' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`清单读取失败（${response.status}）`);
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    await response.body?.cancel();
    return null;
  }
  return parseManifest(await response.json());
}

function parseManifest(value: unknown): RomManifest | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as { chunkBytes?: unknown; files?: unknown };
  if (typeof body.chunkBytes !== 'number' || !Number.isInteger(body.chunkBytes) || body.chunkBytes <= 0) return null;
  if (!body.files || typeof body.files !== 'object') return null;
  const files: Record<string, SplitEntry> = {};
  for (const [name, raw] of Object.entries(body.files)) {
    const entry = parseEntry(raw);
    if (entry) files[name] = entry;
  }
  return { chunkBytes: body.chunkBytes, files };
}

function parseEntry(raw: unknown): SplitEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { size?: unknown; sha256?: unknown; parts?: unknown };
  if (typeof body.size !== 'number' || !Number.isInteger(body.size) || body.size <= 0) return null;
  if (typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(body.sha256)) return null;
  if (!Array.isArray(body.parts) || body.parts.length === 0) return null;
  const parts: string[] = [];
  for (const part of body.parts) {
    if (typeof part !== 'string' || !isSafePart(part)) return null;
    parts.push(part);
  }
  return { size: body.size, sha256: body.sha256.toLowerCase(), parts };
}

function isSafePart(part: string): boolean {
  if (!part || part.includes('..') || part.includes('\\') || part.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(part)) return false;
  return part.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

async function fetchSplitRom(url: string, entry: SplitRom, options: RomLoadOptions): Promise<Uint8Array> {
  const plans = planParts(url, entry);
  const out = new Uint8Array(entry.size);
  const loaded = plans.map(() => 0);
  const report = () => {
    let sum = 0;
    for (const count of loaded) sum += count;
    options.onProgress?.({ loaded: sum, total: entry.size });
  };
  report();

  const local = new AbortController();
  const unlink = linkAbort(options.signal, local);
  try {
    if (local.signal.aborted) throw abortError();
    await runPool(plans.length, PART_CONCURRENCY, async (index) => {
      const plan = plans[index];
      const bytes = await fetchPart(plan.url, local.signal, (count) => {
        loaded[index] = count;
        report();
      });
      if (bytes.byteLength !== plan.length) throw new Error('ROM 分片大小对不上');
      out.set(bytes, plan.start);
      loaded[index] = plan.length;
      report();
    }, local);
    if (local.signal.aborted) throw abortError();
    const digest = await sha256Hex(out);
    if (digest !== entry.sha256) throw new Error('ROM 校验失败');
    await writeCachedAsset(url, out, 'application/zip');
    options.onProgress?.({ loaded: out.byteLength, total: entry.size });
    return out;
  } finally {
    unlink();
    local.abort();
  }
}

function planParts(romUrl: string, entry: SplitRom): PartPlan[] {
  const plans: PartPlan[] = [];
  let cursor = 0;
  for (let index = 0; index < entry.parts.length; index += 1) {
    const length = index === entry.parts.length - 1 ? entry.size - cursor : entry.chunkBytes;
    if (length <= 0 || (index < entry.parts.length - 1 && length !== entry.chunkBytes)) {
      throw new Error('ROM 清单对不上');
    }
    plans.push({
      url: resolvePart(romUrl, entry.parts[index]),
      start: cursor,
      length,
    });
    cursor += length;
  }
  if (cursor !== entry.size) throw new Error('ROM 清单对不上');
  return plans;
}

async function runPool(
  count: number,
  limit: number,
  task: (index: number) => Promise<void>,
  local: AbortController,
): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (!failure && !local.signal.aborted) {
      const index = next;
      next += 1;
      if (index >= count) return;
      try {
        await task(index);
      } catch (error) {
        if (!failure) failure = error;
        local.abort();
        throw error;
      }
    }
  };
  await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(limit, count)) }, () => worker()));
  if (isAbortError(failure) || (local.signal.aborted && !failure)) throw abortError();
  if (failure) throw failure;
}

async function fetchPart(url: string, signal: AbortSignal, onLoaded: (loaded: number) => void): Promise<Uint8Array> {
  let last: unknown = null;
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw abortError();
    try {
      return await fetchPartOnce(url, signal, onLoaded);
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw abortError();
      last = error;
      onLoaded(0);
      if (attempt < PART_ATTEMPTS) await wait(200 * attempt, signal);
    }
  }
  if (last instanceof Error) throw last;
  throw new Error('分片下载失败');
}

async function fetchPartOnce(url: string, signal: AbortSignal, onLoaded: (loaded: number) => void): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal,
    credentials: 'omit',
    mode: 'cors',
    cache: 'no-store',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`分片读取失败（${response.status}）`);
  }
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    await response.body?.cancel();
    throw new Error('分片地址返回的是网页，不是 ROM');
  }
  return readBody(response, signal, onLoaded);
}

async function readBody(response: Response, signal: AbortSignal, onLoaded: (loaded: number) => void): Promise<Uint8Array> {
  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    onLoaded(data.byteLength);
    return data;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const onAbort = () => { void reader.cancel(); };
  signal.addEventListener('abort', onAbort);
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onLoaded(loaded);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  if (signal.aborted) throw abortError();
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', exactBuffer(bytes));
  const view = new Uint8Array(digest);
  let hex = '';
  for (const byte of view) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function linkAbort(signal: AbortSignal | undefined, child: AbortController): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    child.abort();
    return () => {};
  }
  const onAbort = () => child.abort();
  signal.addEventListener('abort', onAbort);
  return () => signal.removeEventListener('abort', onAbort);
}

function manifestUrlFor(romUrl: string): string {
  const url = new URL(romUrl, window.location.href);
  const slash = url.pathname.lastIndexOf('/');
  url.pathname = `${url.pathname.slice(0, slash + 1)}manifest.json`;
  url.search = '';
  url.hash = '';
  return url.href;
}

function resolvePart(romUrl: string, part: string): string {
  const url = new URL(romUrl, window.location.href);
  const slash = url.pathname.lastIndexOf('/');
  const dir = url.pathname.slice(0, slash + 1);
  const segments = part.replace(/^\/+/, '').split('/');
  url.pathname = dir + segments.map((segment) => encodeURIComponent(segment)).join('/');
  url.search = '';
  url.hash = '';
  return url.href;
}

function fileName(romUrl: string): string {
  const pathname = new URL(romUrl, window.location.href).pathname;
  const base = pathname.slice(pathname.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}
