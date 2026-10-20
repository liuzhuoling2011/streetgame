export interface LoadProgress {
  loaded: number;
  total: number | null;
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
  options: { signal?: AbortSignal; onProgress?: (progress: LoadProgress) => void } = {},
): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: options.signal,
    credentials: 'omit',
    mode: 'cors',
  });
  if (!response.ok) throw new Error(`读取失败（${response.status}）`);
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/html')) throw new Error('地址返回的是网页，不是 ROM');
  return readResponse(response, options.onProgress, options.signal);
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
  let loaded = 0;
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        onProgress({ loaded, total });
        controller.close();
        return;
      }
      loaded += value.byteLength;
      onProgress({ loaded, total });
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

async function readResponse(
  response: Response,
  onProgress?: (progress: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: data.byteLength, total: data.byteLength || null });
    return data;
  }
  return readStream(response.body, totalFromHeaders(response.headers), onProgress, signal);
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  total: number | null,
  onProgress?: (progress: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const onAbort = () => { void reader.cancel(); };
  signal?.addEventListener('abort', onAbort);
  try {
    while (true) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) throw abortError();
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.({ loaded, total });
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
