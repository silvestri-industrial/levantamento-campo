// Service worker: sempre busca a versão mais nova na internet (sem cache antigo) e só usa a cópia local se estiver offline.
const C = 'levantamento-v5';
const ARQ = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'nuvem.js', 'jspdf.umd.min.js', 'firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-branco.png', 'fundo-topo.jpg', 'fundo-hero.jpg', 'fundo-app.jpg'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => Promise.all(ARQ.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && c.put(u, r)).catch(() => {})))));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(req.url, { cache: 'no-cache' })
      .then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(req.url, cp)); } return r; })
      .catch(() => caches.match(req.url).then(r => r || caches.match('index.html')))
  );
});
