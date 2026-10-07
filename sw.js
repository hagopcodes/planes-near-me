const CACHE = 'planeradar-shell-v1';
const APP_SHELL = ['', 'index.html', 'styles.css', 'app.js', 'wmm.js', 'manifest.webmanifest'];

function appUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL.map(appUrl))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => caches.match(appUrl('index.html')));
    })
  );
});
