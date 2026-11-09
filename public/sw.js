/* AAi PWA shell: public static assets only; no private chat/API caching. */
const CACHE_NAME = 'aai-shell-v38';
const PRECACHE_URLS = [
  '/index.html',
  '/login.html',
  '/offline.html',
  '/assets/css/aai-studio.css?v=20261109-mobile-model1',
  '/assets/js/app.js?v=20261109-mobile-model1',
  '/assets/js/pwa.js',
  '/aai-mascot-studio.png',
  '/icons/aai-192.png',
  '/icons/aai-512.png',
  '/icons/aai-maskable-512.png',
  '/manifest.webmanifest'
];

function isGoodResponse(response) {
  return Boolean(response && response.ok && response.type === 'basic');
}

function isPublicAsset(pathname) {
  return pathname.startsWith('/assets/') ||
    pathname.startsWith('/icons/') ||
    ['/manifest.webmanifest', '/aai-mascot-studio.png', '/ayaka.webp'].includes(pathname);
}

async function cacheIfPublic(cache, request, response) {
  if (isGoodResponse(response)) {
    try { await cache.put(request, response.clone()); }
    catch (error) { console.warn('[AAi PWA] Cache write skipped:', error); }
  }
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key =>
      key.startsWith('aai-shell-') && key !== CACHE_NAME
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache conversations, credentials, attachments, or API responses.
  if (url.pathname.startsWith('/api/')) return;

  const isPage = request.mode === 'navigate' ||
    ['/', '/index.html', '/login', '/login.html'].includes(url.pathname);

  if (isPage) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        return await cacheIfPublic(cache, request, response);
      } catch {
        return (await cache.match(request)) ||
          (await cache.match('/index.html')) ||
          (await cache.match('/offline.html')) ||
          Response.error();
      }
    })());
    return;
  }

  if (!isPublicAsset(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      return await cacheIfPublic(cache, request, response);
    } catch {
      return (await cache.match(request)) ||
        new Response('Aset AAi tidak tersedia saat offline.', {status:503});
    }
  })());
});
