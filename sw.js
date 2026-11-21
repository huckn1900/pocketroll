/* POCKETROLL service worker — offline-capable PWA shell.
   Cache-first for the app shell; test/ pages and query-param URLs bypass the cache
   so dev iteration (e.g. ?autoshot=1 screenshots) always gets fresh code. */
const CACHE = 'pocketroll-v3';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon.png', 'assets/cameras.json', 'assets/films.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.pathname.includes('/test/') || u.search) return; // dev bypass
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { caches.open(CACHE).put(e.request, res); return res; })
    )
  );
});
