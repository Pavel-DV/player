const CACHE_NAME = 'player';
const BUILD_ID_ASSET = 'player/build.js';
const BUILD_ID_CACHE_KEY = new URL('player-build-id', self.registration.scope).href;
const SKIP_UPDATE_CHECK_KEY = new URL('player-skip-update-check', self.registration.scope).href;
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

async function shouldSkipUpdateCheck() {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(SKIP_UPDATE_CHECK_KEY);

  if (!response) {
    return false;
  }

  await cache.delete(SKIP_UPDATE_CHECK_KEY);
  return true;
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

  return buildId;
}

async function checkForUpdate() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetchFresh(BUILD_ID_ASSET);
  const buildId = parseBuildId(await response.text());
  const cachedBuildId = await getCachedBuildId(cache);

  return buildId && buildId !== cachedBuildId ? buildId : null;
}

async function applyUpdate() {
  if (!cacheUpdatePromise) {
    cacheUpdatePromise = (async () => {
      const buildId = await updateCache();

      if (buildId) {
        const cache = await caches.open(CACHE_NAME);

        await cache.put(SKIP_UPDATE_CHECK_KEY, new Response('1'));
      }

      return buildId;
    })()
    .catch(() => null)
    .finally(() => {
        cacheUpdatePromise = null;
      });
  }

  return cacheUpdatePromise;
}

async function ensureCacheCurrent() {
  const buildId = await checkForUpdate().catch(() => null);
  return buildId ? applyUpdate() : null;
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
      if (!await shouldSkipUpdateCheck() && await checkForUpdate().catch(() => null)) {
        return new Response(
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#000;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont;display:flex;align-items:center;justify-content:center;height:100vh"><script>
            const channel = new MessageChannel();
            channel.port1.onmessage = e => {
              if (!e.data?.ok) return;
              document.body.innerHTML = '<div style="text-align:center;padding:20px"><div id=updateMessage style="font-size:22px;font-weight:700;margin-bottom:20px"></div><button id=updateOk style="padding:0;font-size:20px;width:52px;height:52px;background:#333;color:#e0e0e0;border:none;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;line-height:1">OK</button></div>';
              document.getElementById('updateMessage').textContent = 'New update: "' + e.data.buildId + '"!';
              document.getElementById('updateOk').onclick = () => location.reload();
            };
            navigator.serviceWorker.controller.postMessage('APPLY_UPDATE', [channel.port2]);
          </script>`,
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
  if (e.data !== 'UPDATE_CACHE' && e.data !== 'APPLY_UPDATE') {
    return;
  }

  e.waitUntil((async () => {
    try {
      const buildId = e.data === 'APPLY_UPDATE'
        ? await applyUpdate()
        : await ensureCacheCurrent();
      e.ports[0]?.postMessage({ ok: true, buildId });
    } catch (error) {
      e.ports[0]?.postMessage({ ok: false, error: error.message });
      throw error;
    }
  })());
});
