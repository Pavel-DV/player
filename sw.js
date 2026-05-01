const BUILD_ID = '126';
const CACHE_NAME = `player-v${BUILD_ID}`;
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
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(asset => cache.add(new Request(asset, { cache: 'reload' }))))
    )
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
  if (e.request.method !== 'GET') {
    return;
  }

  e.respondWith((async () => {
    const url = new URL(e.request.url);

    if (url.origin !== self.location.origin) {
      return fetch(e.request);
    }

    try {
      const networkResponse = await fetch(new Request(e.request, { cache: 'reload' }));
      const cache = await caches.open(CACHE_NAME);
      await cache.put(e.request, networkResponse.clone());
      return networkResponse;
    } catch (error) {
      const cachedResponse = await caches.match(e.request, { ignoreSearch: true });

      if (cachedResponse) {
        return cachedResponse;
      }

      throw error;
    }
  })());
});
