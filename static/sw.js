/* Fidelia — Service Worker (PWA offline shell) */
const CACHE = 'fidelia-v1';
const SHELL = [
  '/static/admin.js', '/static/customer.js', '/static/qrcode.min.js',
  '/static/icon-192.png', '/static/icon-512.png', '/static/icon-maskable.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;                 // nunca cachear POST/PUT/DELETE
  if (url.pathname.startsWith('/api/')) return;           // la API siempre va a la red

  // Navegaciones: red primero, con respaldo en caché (offline)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Estáticos: caché primero
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => cached))
  );
});
