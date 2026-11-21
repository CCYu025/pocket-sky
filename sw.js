/* Pocket Sky service worker. Precache list/version come from sw-assets.js (npm run sw). */
importScripts("./sw-assets.js");

const SHELL = `ps-shell-${self.SW_VERSION}`;
const FONTS = "ps-fonts-v1";
const FONT_MAX = 30;
const NAV_TIMEOUT_MS = 3000;
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
  if (FONT_HOSTS.has(url.hostname)) return void event.respondWith(fonts(req));
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") return void event.respondWith(navigation(req));
  event.respondWith(shellAsset(req));
});

/** Network-first with a 3 s timeout, falling back to the cached index.html. */
async function navigation(req) {
  const cache = await caches.open(SHELL);
  const fallback = () => cache.match("index.html").then((r) => r || Response.error());
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), NAV_TIMEOUT_MS))]);
    return res.ok ? res : (await fallback()) || res;
  } catch {
    return fallback();
  }
}

/** Cache-first from the current shell cache; misses go to the network. */
async function shellAsset(req) {
  const hit = await (await caches.open(SHELL)).match(req, { ignoreSearch: true });
  return hit || fetch(req);
}

/** Stale-while-revalidate in the fonts cache, capped at FONT_MAX entries (oldest evicted). */
async function fonts(req) {
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
  if (hit) return hit;
  return (await refresh) || Response.error();
}
