/* Pocket Sky service worker. Precache list/version come from sw-assets.js (npm run sw). */
importScripts("./sw-assets.js");

const SHELL = `ps-shell-${self.SW_VERSION}`;
const FONTS = "ps-fonts-v1";
const FONT_MAX = 30;
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

self.addEventListener("install", (event) => {
  // No automatic skipWaiting: the page offers the update and posts SKIP_WAITING.
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(self.SW_ASSETS.map((a) => new Request(a, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("ps-shell-") && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("open-meteo.com")) return; // the app's localStorage SWR owns API caching
  if (FONT_HOSTS.has(url.hostname)) return void event.respondWith(fonts(req, event));
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") return void event.respondWith(navigation(req));
  event.respondWith(shellAsset(req));
});

/**
 * App-shell model: the scope root (`./`, `./index.html`, any query) is served cache-first from the CURRENT shell
 * cache, so the HTML always belongs to the same SW_VERSION as the cached CSS/JS (and its CSP). New HTML arrives
 * only through the update flow (waiting worker -> banner -> SKIP_WAITING). Without a cached copy (nothing
 * precached yet) the request goes to the network. Every other navigation in scope is the network's business:
 * its answer (a 404, say) passes through and a network failure stays a failure; nothing is rewritten to the app.
 */
async function navigation(req) {
  const url = new URL(req.url);
  const root = new URL(self.registration.scope);
  if (url.pathname === root.pathname || url.pathname === `${root.pathname}index.html`) {
    const hit = await (await caches.open(SHELL)).match("index.html");
    if (hit) return hit;
  }
  return fetch(req);
}

/** Cache-first from the current shell cache; misses go to the network. */
async function shellAsset(req) {
  const hit = await (await caches.open(SHELL)).match(req, { ignoreSearch: true });
  return hit || fetch(req);
}

/** Stale-while-revalidate in the fonts cache, capped at FONT_MAX entries (oldest evicted). */
async function fonts(req, event) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const refresh = fetch(req)
    .then(async (res) => {
      if (res.ok || res.type === "opaque") {
        await cache.put(req, res.clone());
        const keys = await cache.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - FONT_MAX))) await cache.delete(k);
      }
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(refresh); // keep the worker alive until the background refresh has been stored
    return hit;
  }
  return (await refresh) || Response.error();
}
