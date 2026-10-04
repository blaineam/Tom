// tom.wemiller.com now only redirects to wemiller.com/tools/tom/. Browsers that installed
// Tom's offline service worker here fetch this file on their next visit; it clears the
// old offline copy and unregisters itself, so the redirect page is always what loads.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
