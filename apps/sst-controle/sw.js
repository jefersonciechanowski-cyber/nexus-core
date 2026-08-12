const CACHE_NAME = 'nexus-sst-pwa-v2';
const APP_SCOPE = '/apps/sst-controle/';
const SHELL = [
  `${APP_SCOPE}login.html`,
  `${APP_SCOPE}manifest.webmanifest`,
  `${APP_SCOPE}icon-192.png`,
  `${APP_SCOPE}icon-512.png`,
  `${APP_SCOPE}pwa-install.js`,
  `${APP_SCOPE}logo-nexus-core.png`
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_SCOPE)) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone()).catch(() => undefined);
      }
      return fresh;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const login = await caches.match(`${APP_SCOPE}login.html`);
        if (login) return login;
      }
      throw error;
    }
  })());
});
