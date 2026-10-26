/* Service worker: makes solo play work fully offline once the game has loaded.
 *
 * - The build injects the list of every built file (PRECACHE) and a content hash (VERSION),
 *   so each deploy gets its own cache and old caches are deleted on activate.
 * - Page loads are network-first (you always get the newest deploy when online, falling back to
 *   the cached copy after 3 s or when offline).
 * - Every other same-origin file is cache-first (built asset names are content-hashed).
 * - Co-op (M6) talks to the server over WebSocket, which service workers never intercept.
 */
const VERSION = '__VERSION__';
const PRECACHE = '__PRECACHE__';
const CACHE = 'fta-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => (Array.isArray(PRECACHE) ? cache.addAll(PRECACHE) : undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fta-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match('./index.html', { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || caches.match(request, { ignoreSearch: true, ignoreVary: true }));
    const timer = setTimeout(() => {
      fallback().then((hit) => {
        if (hit && !settled) {
          settled = true;
          resolve(hit);
        }
      });
    }, 3000);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
        }
        if (!settled) {
          settled = true;
          resolve(res);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        fallback().then((hit) => {
          if (!settled) {
            settled = true;
            resolve(hit || Response.error());
          }
        });
      });
  });
}

function cacheFirst(request) {
  return caches.match(request, { ignoreVary: true }).then(
    (hit) =>
      hit ||
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => Response.error()),
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
});
