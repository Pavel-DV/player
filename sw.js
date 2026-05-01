const BUILD_ID = '127';
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

async function fetchFresh(asset) {
  const url = new URL(asset, self.location.origin);
  url.searchParams.set('sw-cache', Date.now());

  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Failed to update ${asset}: ${response.status}`);
  }

  return response;
}

async function updateCache() {
  const cache = await caches.open(CACHE_NAME);
  const responses = await Promise.all(ASSETS.map(fetchFresh));

  await Promise.all(
    ASSETS.map((asset, index) => cache.put(asset, responses[index].clone()))
  );
}

self.addEventListener('install', e => {
  e.waitUntil(updateCache());
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
      const networkResponse = await fetch(e.request, { cache: 'no-store' });

      if (!networkResponse.ok) {
        throw new Error(`Failed to fetch ${url.pathname}: ${networkResponse.status}`);
      }

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

self.addEventListener('message', e => {
  if (e.data !== 'UPDATE_CACHE') {
    return;
  }

  e.waitUntil((async () => {
    try {
      await updateCache();
      e.ports[0]?.postMessage({ ok: true });
    } catch (error) {
      e.ports[0]?.postMessage({ ok: false, error: error.message });
      throw error;
    }
  })());
});
