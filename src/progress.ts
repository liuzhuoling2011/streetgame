import { deletePartial, hasCachedAsset, parseContentRange, readCachedAsset, readPartial, writeCachedAsset, writePartial } from './asset-cache';

export interface LoadProgress {
  loaded: number;
  total: number | null;
  fromCache?: boolean;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 10 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

export function abortError(): DOMException {
  return new DOMException('已取消', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function totalFromHeaders(headers: Headers): number | null {
  const encoding = (headers.get('content-encoding') || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') return null;
  const length = headers.get('content-length');
  if (!length) return null;
  const total = Number(length);
  if (!Number.isFinite(total) || total <= 0) return null;
  return total;
}

export async function fetchBytes(
  url: string,
  options: { signal?: AbortSignal; onProgress?: (progress: LoadProgress) => void; resume?: boolean } = {},
): Promise<Uint8Array> {
  const cached = await readCachedAsset(url);
  if (cached) {
    options.onProgress?.({ loaded: cached.byteLength, total: cached.byteLength, fromCache: true });
    return cached;
  }

  const saved = options.resume === false ? null : await readPartial(url);
  const prefix = saved ? new Uint8Array(saved.data) : null;
  const headers = new Headers();
  if (prefix) headers.set('Range', `bytes=${prefix.byteLength}-`);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: options.signal,
      credentials: 'omit',
      mode: 'cors',
      headers,
    });
  } catch (error) {
    if (prefix && options.resume !== false) {
      await deletePartial(url);
      return fetchBytes(url, { ...options, resume: false });
    }
    throw error;
  }

  if (prefix && (response.status === 200 || response.status === 416)) {
    await response.body?.cancel();
    await deletePartial(url);
    return fetchBytes(url, { ...options, resume: false });
  }
  if (prefix && response.status !== 206) {
    await response.body?.cancel();
    throw new Error(`读取失败（${response.status}）`);
  }
  if (!prefix && !response.ok) throw new Error(`读取失败（${response.status}）`);

  const type = response.headers.get('content-type') || '';
  if (type.includes('text/html')) throw new Error('地址返回的是网页，不是 ROM');

  const validator = response.headers.get('etag') || response.headers.get('last-modified') || saved?.etag || '';
  if (prefix && saved?.etag && validator && saved.etag !== validator) {
    await response.body?.cancel();
    await deletePartial(url);
    return fetchBytes(url, { ...options, resume: false });
  }

  const range = parseContentRange(response.headers.get('content-range'));
  const networkTotal = totalFromHeaders(response.headers);
  const total = range?.total ?? (prefix ? saved?.total ?? null : networkTotal);
  if (prefix && range && range.start !== prefix.byteLength) {
    await response.body?.cancel();
    await deletePartial(url);
    return fetchBytes(url, { ...options, resume: false });
  }

  const bytes = await readResponse(response, options.onProgress, options.signal, {
    prefix,
    total,
    onPartial: async (received, data) => {
      await writePartial({
        url,
        etag: validator,
        total,
        received,
        data,
      });
    },
  });
  if (total != null && bytes.byteLength !== total) {
    await writePartial({
      url,
      etag: validator,
      total,
      received: bytes.byteLength,
      data: copyBuffer(bytes),
    });
    throw new Error('下载不完整，下次会接着下');
  }
  await writeCachedAsset(url, bytes, type || 'application/octet-stream');
  return bytes;
}

export async function readBlob(
  blob: Blob,
  onProgress?: (progress: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const total = blob.size > 0 ? blob.size : null;
  const stream = blob.stream();
  return readStream(stream, total, onProgress, signal);
}

export function trackMatchingFetches(
  match: (url: string) => boolean,
  onProgress: (progress: LoadProgress) => void,
  signal?: AbortSignal,
): () => void {
  const original = window.fetch.bind(window);
  const inflight = new Set<AbortController>();
  let restored = false;

  const wrapped: typeof window.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (!match(url)) return original(input, init);
    const local = new AbortController();
    inflight.add(local);
    const stop = () => local.abort();
    signal?.addEventListener('abort', stop);
    init?.signal?.addEventListener('abort', stop);
    try {
      if (signal?.aborted || init?.signal?.aborted) throw abortError();
      const response = await original(input, { ...init, signal: local.signal });
      return trackResponse(response, onProgress);
    } finally {
      signal?.removeEventListener('abort', stop);
      init?.signal?.removeEventListener('abort', stop);
      inflight.delete(local);
    }
  };

  window.fetch = wrapped;

  return () => {
    if (restored) return;
    restored = true;
    window.fetch = original;
    for (const controller of inflight) controller.abort();
  };
}

export async function probeUrl(url: string): Promise<boolean> {
  if (await hasCachedAsset(url)) return true;
  try {
    const head = await fetch(url, { method: 'HEAD', mode: 'cors', credentials: 'omit' });
    const type = head.headers.get('content-type') || '';
    if (type.includes('text/html')) return false;
    if (head.ok) return true;
    if (head.status !== 405 && head.status !== 501) return false;
  } catch {
    // HEAD is optional. A blocked preflight or a host without HEAD falls through to a one-byte GET.
  }
  return probeRange(url);
}

function trackResponse(response: Response, onProgress: (progress: LoadProgress) => void): Response {
  if (!response.body) return response;
  const total = totalFromHeaders(response.headers);
  const fromCache = response.headers.get('x-street-cache') === 'hit';
  let loaded = 0;
  onProgress({ loaded, total, fromCache });
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        onProgress({ loaded, total, fromCache });
        controller.close();
        return;
      }
      loaded += value.byteLength;
      onProgress({ loaded, total, fromCache });
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

interface ReadExtra {
  prefix: Uint8Array | null;
  total: number | null;
  onPartial?: (received: number, data: ArrayBuffer) => Promise<void>;
}

async function readResponse(
  response: Response,
  onProgress?: (progress: LoadProgress) => void,
  signal?: AbortSignal,
  extra?: ReadExtra,
): Promise<Uint8Array> {
  const prefix = extra?.prefix ?? null;
  const total = extra?.total ?? totalFromHeaders(response.headers);
  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    const merged = prefix ? concatChunks([prefix, data], prefix.byteLength + data.byteLength) : data;
    onProgress?.({ loaded: merged.byteLength, total: total ?? (merged.byteLength || null) });
    return merged;
  }
  return readStream(response.body, total, onProgress, signal, prefix, extra?.onPartial);
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  total: number | null,
  onProgress?: (progress: LoadProgress) => void,
  signal?: AbortSignal,
  prefix: Uint8Array | null = null,
  onPartial?: (received: number, data: ArrayBuffer) => Promise<void>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  if (prefix && prefix.byteLength > 0) chunks.push(prefix);
  let loaded = prefix?.byteLength ?? 0;
  let sinceSave = 0;
  const onAbort = () => { void reader.cancel(); };
  signal?.addEventListener('abort', onAbort);
  let finished = false;
  try {
    onProgress?.({ loaded, total });
    while (true) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      sinceSave += value.byteLength;
      onProgress?.({ loaded, total });
      if (onPartial && sinceSave >= 1024 * 1024) {
        sinceSave = 0;
        const snap = concatChunks(chunks, loaded);
        await onPartial(loaded, copyBuffer(snap));
      }
    }
    finished = true;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!finished && onPartial && loaded > (prefix?.byteLength ?? 0)) {
      try {
        const snap = concatChunks(chunks, loaded);
        await onPartial(loaded, copyBuffer(snap));
      } catch {
        /* keep whatever was stored earlier */
      }
    }
  }
  if (signal?.aborted) throw abortError();
  const out = concatChunks(chunks, loaded);
  onProgress?.({ loaded, total: total ?? loaded });
  return out;
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function concatChunks(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function probeRange(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      mode: 'cors',
      credentials: 'omit',
    });
    const type = response.headers.get('content-type') || '';
    await response.body?.cancel();
    if (type.includes('text/html')) return false;
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
