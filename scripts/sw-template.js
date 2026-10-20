/* Street Game service worker.
   GitHub Pages sends Cache-Control: max-age=600 and does not honor a _headers file.
   Hashed app files live in the shell cache. The emulator build lives in its own
   cache so a new WASM drops the old one without making players re-download ROMs.
   ROM and BIOS bytes live in streetgame-media, the same cache the page writes. */
const SHELL = 'streetgame-shell-__SHELL__';
const EMU = 'streetgame-emu-__EMU__';
const MEDIA = 'streetgame-media';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key.startsWith('streetgame-shell-') && key !== SHELL) return caches.delete(key);
      if (key.startsWith('streetgame-emu-') && key !== EMU) return caches.delete(key);
      return Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (!path.startsWith('/streetgame/')) return;

  if (isMediaPath(path)) {
    event.respondWith(cacheFirst(event, MEDIA, request));
    return;
  }
  if (path.includes('/emulator/')) {
    event.respondWith(cacheFirst(event, EMU, request));
    return;
  }
  if (request.mode === 'navigate' || isShellDocument(path)) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(event, SHELL, request));
});

function isMediaPath(path) {
  return path.includes('/roms/') || path.includes('/bios/');
}

function isShellDocument(path) {
  return path.endsWith('/games.json')
    || path.endsWith('/config.json')
    || path.endsWith('/index.html')
    || path === '/streetgame'
    || path === '/streetgame/';
}

async function cacheFirst(event, name, request) {
  const cache = await caches.open(name);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return tagged(hit);
  const response = await fetch(request);
  if (response && response.ok && response.status === 200) {
    const copy = response.clone();
    event.waitUntil(cache.put(request, copy).catch(() => {}));
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const copy = response.clone();
      await cache.put(request, copy).catch(() => {});
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/streetgame/index.html', { ignoreVary: true })
        || await cache.match('/streetgame/', { ignoreVary: true });
      if (shell) return shell;
    }
    throw error;
  }
}

function tagged(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Street-Cache', 'hit');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
