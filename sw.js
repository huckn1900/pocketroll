/* POCKETROLL service worker — offline-capable PWA shell.
   Code/assets are NETWORK-FIRST with cache fallback: deployed code is never stale,
   offline still works (install pre-caches the shell). Icons stay cache-first.
   Test pages and query-param URLs bypass the SW entirely. */
const CACHE = 'pocketroll-v6';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon.png', 'assets/cameras.json', 'assets/films.json', 'assets/fonts/roboto-condensed-700.woff2', 'assets/fonts/ibm-plex-mono-400.woff2'];
const CODE = [/\/app\.js$/, /\/sounds\.js$/, /\/assets\/.*\.json$/, /\/index\.html$/, /\/sounds\.html$/, /\/$/];

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
  if (CODE.test(u.pathname)) {
    e.respondWith(
      fetch(e.request).then(res => { caches.open(CACHE).put(e.request, res.clone()); return res; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { caches.open(CACHE).put(e.request, res); return res; })
    )
  );
});
