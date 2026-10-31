const CACHE_NAME = 'aai-shell-v9';
const PRECACHE_URLS = [
  '/index.html',
  '/login.html',
  '/assets/js/app.js',
  '/assets/css/aai-crystal.css',
  '/aai-mascot.jpg',
  '/manifest.webmanifest',
  '/ayaka.webp',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

function isDocumentRequest(request, url) {
  return request.mode === 'navigate' || [
    '/',
    '/index.html',
    '/login',
    '/login.html'
  ].includes(url.pathname);
}

function shouldCache(response) {
  return response && response.status === 200 && response.type === 'basic';
}

function offlineResponse() {
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (isDocumentRequest(req, url)) {
    event.respondWith(
      fetch(req)
        .then(async response => {
          if (shouldCache(response)) {
            const copy = response.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(req, copy);
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          if (url.pathname === '/login') {
            return (await caches.match('/login.html')) || offlineResponse();
          }
          if (url.pathname === '/') {
            return (await caches.match('/index.html')) || offlineResponse();
          }
          return (await caches.match('/')) || offlineResponse();
        })
    );
    return;
  }

  // Deploying new code must not leave PWA users running an old app.js from
  // cache. Prefer the network for frontend code and use cache only offline.
  if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith((async () => {
      try {
        const response = await fetch(req);
        if (shouldCache(response)) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(req, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(req)) || offlineResponse();
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req)
        .then(response => {
          if (shouldCache(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => cached || offlineResponse());

      return cached || networkFetch;
    })
  );
});
