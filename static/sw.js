/* Fidelia — Service Worker v2
   Reglas: la API NUNCA se cachea (en ninguna ruta, incluido /r/<slug>/api/…).
   Todo lo demás va a la RED PRIMERO y solo usa la caché si no hay conexión.
   Así las actualizaciones llegan siempre y los datos jamás se quedan congelados. */
const CACHE = 'fidelia-v2';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;               // nunca tocar POST/PUT/DELETE
  if (url.pathname.includes('/api/')) return;           // la API SIEMPRE va a la red (cualquier ruta)
  if (url.pathname.endsWith('.webmanifest')) return;    // manifiestos dinámicos: siempre red

  // Red primero; caché solo como respaldo sin conexión
  e.respondWith(
    fetch(e.request).then(r => {
      if (r && r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
