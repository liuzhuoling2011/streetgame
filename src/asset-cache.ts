/** Cache names shared with the generated service worker. ROM bytes survive shell updates. */
export const MEDIA_CACHE = 'streetgame-media';

const PARTIAL_DB = 'streetgame-partials';
const PARTIAL_STORE = 'files';
const RESUME_MIN = 64 * 1024;

export interface PartialAsset {
  url: string;
  etag: string;
  total: number | null;
  received: number;
  data: ArrayBuffer;
}

export interface ContentRange {
  start: number;
  end: number;
  total: number | null;
}

export function parseContentRange(header: string | null): ContentRange | null {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  if (total != null && (!Number.isFinite(total) || total < end + 1)) return null;
  return { start, end, total };
}

export async function hasCachedAsset(url: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(url, { ignoreVary: true });
    if (!hit?.ok) return false;
    const length = Number(hit.headers.get('content-length'));
    if (Number.isFinite(length) && length > 0) return true;
    await hit.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

export async function readCachedAsset(url: string): Promise<Uint8Array | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(url, { ignoreVary: true });
    if (!hit || !hit.ok) return null;
    const data = new Uint8Array(await hit.arrayBuffer());
    return data.byteLength > 0 ? data : null;
  } catch {
    return null;
  }
}

export async function writeCachedAsset(url: string, bytes: Uint8Array, contentType: string): Promise<void> {
  if (typeof caches === 'undefined' || bytes.byteLength === 0) return;
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const copy = new Uint8Array(bytes);
    await cache.put(url, new Response(copy, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': String(copy.byteLength),
        'X-Street-Cache': 'hit',
      },
    }));
    await deletePartial(url);
  } catch {
    /* private mode */
  }
}

export async function readPartial(url: string): Promise<PartialAsset | null> {
  try {
    const db = await openPartialDb();
    const record = await requestToPromise(db.transaction(PARTIAL_STORE, 'readonly').objectStore(PARTIAL_STORE).get(url));
    db.close();
    if (!record || typeof record !== 'object') return null;
    const partial = record as PartialAsset;
    if (!(partial.data instanceof ArrayBuffer) || partial.received < RESUME_MIN) return null;
    if (partial.received !== partial.data.byteLength) return null;
    return partial;
  } catch {
    return null;
  }
}

export async function writePartial(record: PartialAsset): Promise<void> {
  if (record.received < 4096 || record.data.byteLength !== record.received) return;
  try {
    const db = await openPartialDb();
    await requestToPromise(db.transaction(PARTIAL_STORE, 'readwrite').objectStore(PARTIAL_STORE).put(record));
    db.close();
  } catch {
    /* the next attempt starts over */
  }
}

export async function deletePartial(url: string): Promise<void> {
  try {
    const db = await openPartialDb();
    await requestToPromise(db.transaction(PARTIAL_STORE, 'readwrite').objectStore(PARTIAL_STORE).delete(url));
    db.close();
  } catch {
    /* already gone */
  }
}

function openPartialDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PARTIAL_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PARTIAL_STORE)) db.createObjectStore(PARTIAL_STORE, { keyPath: 'url' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB'));
  });
}

function requestToPromise(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB'));
  });
}
