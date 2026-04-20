const CACHE_NAME = 'player-v12';
const ASSETS = [
  '/',
  '/index.html',
  '/player.js',
  '/player/dom.js',
  '/player/library.js',
  '/player/metadata.js',
  '/player/navigation.js',
  '/player/normalization.js',
  '/player/opfs-library.js',
  '/player/opfs-worker.js',
  '/player/playback.js',
  '/player/shared.js',
  '/player/state.js',
  '/player/storage.js',
  '/player/track-rotation.js',
  '/player/ui.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith((async () => {
    const url = new URL(e.request.url);
    const client = e.clientId ? await self.clients.get(e.clientId) : null;
    const clientUrl = client ? new URL(client.url) : null;
    const isRefreshRequest =
      url.searchParams.has('v') || Boolean(clientUrl?.searchParams.has('v'));
    const isSameOriginAsset =
      e.request.method === 'GET' && url.origin === self.location.origin;

    if (isRefreshRequest) {
      return fetch(e.request);
    }

    if (isSameOriginAsset) {
      try {
        const networkResponse = await fetch(e.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(e.request, networkResponse.clone());
        return networkResponse;
      } catch (error) {
        const cachedResponse = await caches.match(e.request);

        if (cachedResponse) {
          return cachedResponse;
        }

        throw error;
      }
    }

    const cachedResponse = await caches.match(e.request);

    if (cachedResponse) {
      return cachedResponse;
    }

    return fetch(e.request);
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'CLEAR_CACHE') {
    e.waitUntil(
      caches.keys().then(keys => 
        Promise.all(keys.map(key => caches.delete(key)))
      ).then(() => self.skipWaiting())
    );
  }
});
