const CACHE_NAME = 'player';
const BUILD_ID_ASSET = 'player/build.js';
const BUILD_ID_CACHE_KEY = new URL('player-build-id', self.registration.scope).href;
const ASSETS = [
  '.',
  'favicon.ico',
  'icons/icon512.png',
  'index.html',
  'manifest.json',
  'player.js',
  'player/build.js',
  'player/dom.js',
  'player/library.js',
  'player/log.js',
  'player/metadata.js',
  'player/navigation.js',
  'player/normalization.js',
  'player/opfs-library.js',
  'player/opfs-worker.js',
  'player/playlist-drag.js',
  'player/playback.js',
  'player/shared.js',
  'player/state.js',
  'player/storage.js',
  'player/track-rotation.js',
  'player/ui.js'
];
const ASSET_URLS = new Set(ASSETS.map(asset => (
  new URL(asset, self.registration.scope).href
)));
let cacheUpdatePromise = null;

function parseBuildId(text) {
  return text.match(/playerBuildId = '([^']+)'/)?.[1] ?? null;
}

async function fetchFresh(asset) {
  const url = new URL(asset, self.registration.scope);
  url.searchParams.set('sw-cache', Date.now());

  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Failed to update ${asset}: ${response.status}`);
  }

  return response;
}

async function getCachedBuildId(cache) {
  const response = await cache.match(BUILD_ID_CACHE_KEY);
  return response ? response.text() : null;
}

async function updateCache() {
  const cache = await caches.open(CACHE_NAME);
  const responses = await Promise.all(ASSETS.map(fetchFresh));
  const buildResponse = responses[ASSETS.indexOf(BUILD_ID_ASSET)];
  const buildId = parseBuildId(await buildResponse.clone().text());

  await Promise.all(
    ASSETS.map((asset, index) => (
      cache.put(new URL(asset, self.registration.scope), responses[index].clone())
    ))
  );

  if (buildId) {
    await cache.put(BUILD_ID_CACHE_KEY, new Response(buildId));
  }
}

async function ensureCacheCurrent() {
  if (!cacheUpdatePromise) {
    cacheUpdatePromise = (async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await fetchFresh(BUILD_ID_ASSET);
      const buildId = parseBuildId(await response.text());

      if (buildId && buildId !== await getCachedBuildId(cache)) {
        await updateCache();
        return true;
      }

      return false;
    })()
    .catch(() => false)
    .finally(() => {
        cacheUpdatePromise = null;
      });
  }

  return cacheUpdatePromise;
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
    const isNavigation = e.request.mode === 'navigate';

    if (url.origin !== self.location.origin) {
      return fetch(e.request);
    }

    if (isNavigation) {
      if (await ensureCacheCurrent()) {
        return new Response(
          '<!doctype html><meta charset="utf-8"><script>location.reload()</script>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    }

    if (ASSET_URLS.has(url.href)) {
      const cachedResponse = await caches.match(e.request, { ignoreSearch: true });

      if (cachedResponse) {
        return cachedResponse;
      }
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
