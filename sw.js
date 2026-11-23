const C = 'levantamento-v2';
const ARQ = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-branco.png', 'fundo-topo.jpg', 'fundo-hero.jpg'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(ARQ))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));
