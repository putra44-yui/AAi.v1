const CACHE_NAME = 'aai-shell-v5';
const PRECACHE_URLS = [
  '/assets/js/app.js',
  '/manifest.webmanifest',
  '/ayaka.gif',
  '/ayaka1.gif',
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
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
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
        .then(response => {
          if (shouldCache(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
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