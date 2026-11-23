/* POCKETROLL service worker — offline-capable PWA shell.
   Code/assets are NETWORK-FIRST with cache fallback: deployed code is never stale,
   offline still works (install pre-caches the shell). Icons stay cache-first.
   Test pages and query-param URLs bypass the SW entirely.
   CACHE is bumped on every deploy; app.js compares it with its own BUILD and shows a
   RELOAD notice when the shipped build is older than this cache name. */
const CACHE = 'pocketroll-v14'; // app.js compares BUILD with this; bump the two together when shipping a release users should reload for
const SHELL = ['./', 'index.html', 'app.js',
  'storage/database.js', 'storage/current-roll.js', 'storage/archive.js', 'storage/backup.js',
  'film/roll-manager.js', 'film/development.js',
  'camera/camera-manager.js', 'camera/capture.js',
  'manifest.webmanifest', 'icon.png', 'assets/cameras.json', 'assets/films.json', 'assets/samples/street.jpg', 'assets/fonts/roboto-condensed-700.woff2', 'assets/fonts/ibm-plex-mono-400.woff2'];
const CODE = [/\/app\.js$/, /\/sounds\.js$/, /\/(storage|film|camera)\/[a-z-]+\.js$/, /\/assets\/.*\.json$/, /\/index\.html$/, /\/sounds\.html$/, /\/$/];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* Only ok responses are cached (a 404 or a redirect must not become the offline answer),
   and a cache write that fails — quota, opaque response, browser refusing it — never breaks
   the request the user is waiting for. */
async function respondNetworkFirst(req){
  try {
    const res = await fetch(req);
    if (res.ok) { try { await caches.open(CACHE).put(req, res.clone()); } catch {} }
    return res;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.pathname.includes('/test/') || u.search) return; // dev bypass
  if (CODE.test(u.pathname)) { e.respondWith(respondNetworkFirst(e.request)); return; }
  e.respondWith(
    caches.match(e.request).then(hit => hit || respondNetworkFirst(e.request))
  );
});
