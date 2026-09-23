// Tom works offline: everything renders on the device, so once the app's own
// files are cached there's nothing left to fetch.
//
// Deploys stamp every module URL with ?v=<commit> (scripts/stamp.mjs), so a
// stamped file never changes and is served cache-first. The page itself (and
// anything unstamped, like a local `tom compose`) is network-first, falling
// back to the cache offline. Installing crawls the page's imports so the whole
// app, workers included, is cached on the first visit.
const CACHE = 'tom-v1';
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const REFS = [
  /\s(?:src|href)="((?!https?:|\/\/|#|data:)[^"#]+)"/g, // index.html
  /(?:\bfrom\s*|\bimport\s*\(\s*|new URL\(\s*)['"](\.{1,2}\/[^'"#]+)['"]/g, // modules and workers
];

async function crawl(cache) {
  const seen = new Set(), queue = [new URL('./', self.registration.scope).href];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) continue;
    await cache.put(url, res.clone());
    if (!/\.(m?js|html)(\?|$)|\/(\?|$)/.test(url)) continue;
    const text = await res.text();
    for (const re of REFS) for (const m of text.matchAll(re)) {
      const next = new URL(m[1], url);
      if (next.origin === location.origin && !seen.has(next.href)) queue.push(next.href);
    }
  }
  return seen;
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(crawl).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** After a new page is fetched, drop stamped files from other deploys. */
async function prune(html) {
  const v = (html.match(/app\.js\?v=([\w-]+)/) || [])[1];
  if (!v) return;
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) {
    const got = new URL(req.url).searchParams.get('v');
    if (got && got !== v) await cache.delete(req);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONTS.test(req.url)) { e.respondWith(cacheFirst(req)); return; }
  if (url.origin !== location.origin) return;
  if (url.searchParams.has('v') && req.mode !== 'navigate') { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(req, e));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req, e) {
  const nav = req.mode === 'navigate';
  const key = nav ? new URL('./', self.registration.scope).href : req; // every navigation is the one page
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(key, res.clone());
      if (nav) e.waitUntil(res.clone().text().then(prune));
    }
    return res;
  } catch (err) {
    const hit = await caches.match(key, { ignoreSearch: nav });
    if (hit) return hit;
    throw err;
  }
}
