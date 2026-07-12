/* Fidelia — Service Worker v3 (SIN CACHÉ)
   Lección aprendida: cachear archivos causaba que el panel cargara versiones viejas.
   Este SW NO cachea NADA. Existe solo para permitir instalar la app en el móvil.
   Todo (páginas, JS, CSS, API) va SIEMPRE a la red. Las actualizaciones llegan al instante. */
const VERSION = 'fidelia-v3-nocache';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Borrar TODAS las cachés de versiones anteriores (v1, v2…) que congelaban el JS
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// No interceptamos fetch: el navegador va directo a la red siempre.
// (Sin handler 'fetch', el SW sigue habilitando la instalación PWA pero no cachea.)
