/**
 * Deploy simulation: `_site/` is built into a temp dir, served under the `/pocket-sky/` sub-path with
 * `Cache-Control: max-age=600` (what GitHub Pages sends), and then "redeployed" in place (index.html, a JS file,
 * sw-assets.js and the stamped sw.js change) while a browser holds the first version.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "./server.mjs";
import { launch, openApp, waitReady } from "./helpers.mjs";
import { buildSite, stampSw } from "../../scripts/build-site.mjs";
import { collect, render } from "../../scripts/gen-sw-assets.mjs";

let dir;
let server;
let browser;
const AXE_CSS_FETCH = /Connecting to 'https:\/\/fonts\.googleapis\.com\/css2.*connect-src/;

/** Mark index.html and js/main.js with a deploy label, then refresh sw-assets.js and the sw.js stamp like the build does. */
function deploy(label) {
  const edit = (f, fn) => writeFileSync(path.join(dir, f), fn(readFileSync(path.join(dir, f), "utf8")));
  edit("index.html", (s) => s.replace(/<meta name="deploy" content="[^"]*">\s*/, "").replace("<head>", `<head><meta name="deploy" content="${label}">`));
  edit("js/main.js", (s) => `${s.replace(/\nwindow\.__deploy = "[^"]*";\n?$/, "")}\nwindow.__deploy = "${label}";\n`);
  writeFileSync(path.join(dir, "sw-assets.js"), render(dir));
  edit("sw.js", (s) => stampSw(s, collect(dir).version));
}

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ps-deploy-"));
  buildSite(dir);
  deploy("v1");
  server = await startServer({ root: dir, prefix: "/pocket-sky", cacheControl: "max-age=600" });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const open = () => openApp(browser, server.url, { serviceWorkers: "allow", expectedErrors: [AXE_CSS_FETCH] });
const controlled = (page) => page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
/** What the document and its scripts say they are. */
const versions = (page) => page.evaluate(() => ({ html: document.querySelector('meta[name="deploy"]')?.content, js: window.__deploy }));

test("a deploy under max-age=600: the update is found, a reload keeps v1 HTML+JS, the key switches to v2 HTML+JS", async () => {
  deploy("v1");
  const app = await open();
  try {
    await app.go();
    await waitReady(app.page);
    await app.page.evaluate(() => navigator.serviceWorker.ready);
    await app.page.reload();
    await waitReady(app.page);
    await controlled(app.page);
    assert.deepEqual(await versions(app.page), { html: "v1", js: "v1" });

    deploy("v2"); // the site changes on the server; the browser still has v1 and the HTTP cache says fresh for 10 minutes
    const found = await app.page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update(); // updateViaCache: 'none' makes this reach the network despite max-age
      return Boolean(reg.installing || reg.waiting);
    });
    assert.ok(found, "reg.update() found the new sw.js although every response is cacheable for 10 minutes");
    const banner = app.page.locator("#update-banner");
    await banner.waitFor({ timeout: 15000 });

    // a reload before the key: still the v1 document with the v1 scripts (navigation is served from the v1 shell cache)
    await app.page.reload();
    await waitReady(app.page);
    assert.deepEqual(await versions(app.page), { html: "v1", js: "v1" }, "HTML and JS stay a consistent v1 pair");
    await banner.waitFor({ timeout: 15000 });
    assert.match(await (await app.ctx.request.get(`${server.url}index.html`, { headers: { "cache-control": "no-cache" } })).text(), /content="v2"/, "the server really has v2");

    await app.page.evaluate(() => (window.__marker = 1));
    await banner.getByRole("button", { name: "重新整理" }).click();
    await app.page.waitForFunction(() => !window.__marker, null, { timeout: 15000 });
    await waitReady(app.page);
    await controlled(app.page);
    assert.deepEqual(await versions(app.page), { html: "v2", js: "v2" }, "after the key: v2 HTML and v2 JS");
    assert.equal(await app.page.locator("#update-banner").count(), 0);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("offline: the scope root renders the app from the shell cache; nested paths are not rewritten to it", async () => {
  deploy("v1");
  const app = await open();
  try {
    await app.go();
    await waitReady(app.page);
    await app.page.evaluate(() => navigator.serviceWorker.ready);
    await app.page.reload();
    await waitReady(app.page);
    await controlled(app.page);
    const temp = await app.page.locator(".temp [aria-label]").first().getAttribute("aria-label");
    await app.ctx.setOffline(true);
    for (const url of [server.url, `${server.url}index.html`, `${server.url}?x=1#outing`]) {
      await app.page.goto(url);
      await waitReady(app.page);
      assert.equal(await app.page.title(), "Pocket Sky", url);
      assert.deepEqual(await versions(app.page), { html: "v1", js: "v1" }, url);
    }
    await app.page.goto(server.url);
    await waitReady(app.page);
    assert.equal(await app.page.locator(".temp [aria-label]").first().getAttribute("aria-label"), temp, "cached data on screen");
    assert.deepEqual(app.errors, [], "no console errors, no failed resources while offline at the scope root");

    // a nested deep link has no offline answer: the navigation fails instead of showing the app under a wrong URL
    await assert.rejects(app.page.goto(`${server.url}some/deep/link/`), /net::ERR/);
    await assert.rejects(app.page.goto(`${server.url}nope.html`), /net::ERR/);
    await app.ctx.setOffline(false);
    // online: the network's own answer (a 404) passes through, with no cached app in its place
    const res = await app.page.goto(`${server.url}nope.html`);
    assert.equal(res.status(), 404);
    assert.notEqual(await app.page.title(), "Pocket Sky");
    const deep = await app.page.goto(`${server.url}some/deep/link/`);
    assert.equal(deep.status(), 404);
  } finally {
    await app.close();
  }
});
