import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startServer } from "./server.mjs";
import { launch, openApp, waitReady, runAxe, ROOT } from "./helpers.mjs";

const overrides = {};
let server;
let browser;
before(async () => {
  server = await startServer({ overrides });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

// axe fetches cross-origin stylesheets itself; the strict connect-src blocks that (see a11y.e2e.mjs).
const AXE_CSS_FETCH = /Connecting to 'https:\/\/fonts\.googleapis\.com\/css2.*connect-src/;

/** App with service workers allowed. */
const open = (o = {}) => openApp(browser, server.url, { serviceWorkers: "allow", expectedErrors: [AXE_CSS_FETCH], ...o });

/** Wait until the page is controlled by an activated worker. */
const controlled = (page) => page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });

/** Install the worker, then reload so the page is controlled. */
async function install(app) {
  await app.go();
  await waitReady(app.page);
  await app.page.evaluate(() => navigator.serviceWorker.ready);
  await app.page.reload();
  await waitReady(app.page);
  await controlled(app.page);
}

const swVersion = (src) => /SW_VERSION = "([0-9a-f]+)"/.exec(src)[1];

test("installs, precaches the shell and controls the page after reload", async () => {
  const app = await open();
  try {
    await install(app);
    const info = await app.page.evaluate(async () => {
      const names = await caches.keys();
      const shell = names.find((n) => n.startsWith("ps-shell-"));
      const keys = shell ? (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname) : [];
      return { names, keys, scope: (await navigator.serviceWorker.getRegistration()).scope };
    });
    const assets = new Function("self", `${readFileSync(path.join(ROOT, "sw-assets.js"), "utf8")}; return self;`)({});
    assert.equal(info.scope, server.url);
    assert.deepEqual(info.names.filter((n) => n.startsWith("ps-shell-")), [`ps-shell-${assets.SW_VERSION}`]);
    assert.deepEqual(info.keys.map((k) => k.slice(1)).sort(), assets.SW_ASSETS);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("offline reload renders the shell and cached Today data; navigation fallback works", async () => {
  const app = await open();
  try {
    await install(app); // primes the app's localStorage cache with the fixture forecast
    const online = await app.page.locator(".hero").innerText();
    await app.ctx.setOffline(true);
    const before = app.requests.length;
    await app.page.reload();
    await waitReady(app.page);
    assert.equal(await app.page.locator(".hero").innerText(), online);
    assert.equal(app.requests.length, before, "no API request while cached data is fresh");
    // a navigation to an unknown same-origin path falls back to the cached index.html
    await app.page.goto(`${server.url}some/deep/link/`);
    assert.equal(await app.page.title(), "Pocket Sky");
    assert.ok(await app.page.locator("#nav-outing").count());
    assert.deepEqual(app.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
  } finally {
    await app.close();
  }
});

test("update flow: waiting worker -> banner -> click -> one reload under the new worker", async () => {
  const app = await open();
  try {
    await install(app);
    const oldVer = await app.page.evaluate(async () => (await caches.keys()).find((n) => n.startsWith("ps-shell-")));
    const src = readFileSync(path.join(ROOT, "sw-assets.js"), "utf8");
    overrides["/sw-assets.js"] = src.replace(swVersion(src), "e2eupdate001");
    await app.page.evaluate(() => (window.__navs = (window.__navs ?? 0) + 1));
    await app.page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    const banner = app.page.locator("#update-banner");
    await banner.waitFor({ timeout: 15000 });
    assert.match(await banner.innerText(), /有新版本/);
    const box = await banner.getByRole("button", { name: "重新整理" }).boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44, JSON.stringify(box));
    const navBox = await app.page.locator(".nav").boundingBox();
    assert.ok((await banner.boundingBox()).y + (await banner.boundingBox()).height <= navBox.y + 1, "banner sits above the nav");

    const blocking = (await runAxe(app.page)).filter((v) => v.impact === "serious" || v.impact === "critical");
    assert.deepEqual(blocking, []);

    let loads = 0;
    app.page.on("framenavigated", (f) => f === app.page.mainFrame() && loads++);
    await banner.getByRole("button", { name: "重新整理" }).click();
    await app.page.waitForFunction(() => !window.__navs, null, { timeout: 15000 }); // fresh document after the reload
    await waitReady(app.page);
    await controlled(app.page);
    await app.page.waitForTimeout(500);
    assert.equal(loads, 1, "reloaded exactly once");
    assert.equal(await app.page.locator("#update-banner").count(), 0);
    const names = await app.page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("ps-shell-")));
    assert.deepEqual(names, ["ps-shell-e2eupdate001"], `old cache ${oldVer} removed`);
    assert.deepEqual(app.errors, []);
  } finally {
    delete overrides["/sw-assets.js"];
    await app.close();
  }
});

test("?nosw skips registration", async () => {
  const app = await open();
  try {
    await app.page.goto(`${server.url}?nosw`);
    await waitReady(app.page);
    await app.page.waitForTimeout(300);
    assert.equal(await app.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  } finally {
    await app.close();
  }
});
