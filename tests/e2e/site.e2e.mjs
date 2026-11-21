/**
 * The assembled `_site/` (what GitHub Pages serves) loads and installs the service worker.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startServer } from "./server.mjs";
import { launch, openApp, waitReady, ROOT } from "./helpers.mjs";
import { buildSite } from "../../scripts/build-site.mjs";

let server;
let browser;
let files;
before(async () => {
  files = buildSite(path.join(ROOT, "_site"));
  server = await startServer({ root: path.join(ROOT, "_site") });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test("_site loads, shows data and the service worker precaches the whole shell", async () => {
  const app = await openApp(browser, server.url, { serviceWorkers: "allow" });
  try {
    await app.go();
    await waitReady(app.page);
    assert.match(await app.page.locator(".temp [aria-label]").first().getAttribute("aria-label"), /度/);
    await app.page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await app.page.evaluate(async () => {
      const name = (await caches.keys()).find((n) => n.startsWith("ps-shell-"));
      return name ? (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname.slice(1)) : [];
    });
    const shell = files.filter((f) => f !== "sw.js" && f !== "sw-assets.js" && f !== "robots.txt");
    for (const f of shell) assert.ok(cached.includes(f), `not precached: ${f}`);
    assert.equal((await app.ctx.request.get(`${server.url}manifest.webmanifest`)).status(), 200);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
