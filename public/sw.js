/* Service worker stub (M1). It does NOT cache or intercept requests yet, so a new deploy is
 * always what the phone sees. Real offline caching arrives in M3 (see docs/milestones.md). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
