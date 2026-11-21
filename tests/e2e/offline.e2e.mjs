/**
 * Offline-first display and checklist layout (M5). Service workers are not involved: the shell is served by the
 * test server, so "offline" is simulated for the API hosts only: a context route that aborts (and counts) every
 * Open-Meteo request, plus a `navigator.onLine` override backed by sessionStorage (it survives reloads).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import { launch, openApp, waitReady, settle, overflow, DAY_MS, dayForecast, rainyEveningForecast, placesForecasts, LAKE } from "./helpers.mjs";

let server;
let browser;
before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const AXE_CSS_FETCH = /Connecting to 'https:\/\/fonts\.googleapis\.com\/css2.*connect-src/;
const noErrors = (app) => assert.deepEqual(app.errors, [], "no console errors or page errors");
const API = /open-meteo\.com/;
const H = 3600 * 1000;

/** Open an app whose `navigator.onLine` can be switched (init script, before the first load). */
async function open(opts = {}) {
  const app = await openApp(browser, server.url, { ...opts, expectedErrors: [AXE_CSS_FETCH, ...(opts.expectedErrors ?? [])] });
  await app.ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get() {
        try {
          return sessionStorage.getItem("__offline") !== "1";
        } catch {
          return true;
        }
      },
    });
  });
  return app;
}

/** Switch the simulated network: API requests are aborted and counted while offline. */
async function setNetwork(app, online, { fire = true } = {}) {
  app.blocked ??= [];
  if (!online && !app.blockRoute) {
    app.blockRoute = (route) => {
      app.blocked.push(route.request().url());
      return route.abort("internetdisconnected");
    };
    await app.ctx.route(API, app.blockRoute);
  }
  if (online && app.blockRoute) {
    await app.ctx.unroute(API, app.blockRoute);
    app.blockRoute = null;
  }
  await app.page.evaluate(([on, f]) => {
    sessionStorage.setItem("__offline", on ? "0" : "1");
    if (f) window.dispatchEvent(new Event(on ? "online" : "offline"));
  }, [online, fire]);
}

const banner = (page) => page.locator('.banner[data-k="stale"]');
const apiCount = (app, re) => app.requests.filter((u) => re.test(u)).length;

test("cached -> offline -> reload: cached data and the offline banner, no API request", async () => {
  const app = await open();
  const { page } = app;
  await app.go();
  await waitReady(page);
  const temp = await page.locator(".temp [role=img]").getAttribute("aria-label");
  await setNetwork(app, false, { fire: false });
  const before = app.requests.length;
  await page.reload();
  await waitReady(page);
  assert.equal(await banner(page).innerText(), "離線中・顯示 14:20 的資料");
  assert.equal(await page.locator(".temp [role=img]").getAttribute("aria-label"), temp, "the cached temperature is shown");
  assert.equal(app.requests.length, before, "no request reached the API");
  assert.equal(app.blocked.length, 0, "the app did not even try");
  noErrors(app);
});

test("offline with data older than 24 h: shown at once with the offline banner", async () => {
  const app = await open();
  const { page } = app;
  await app.go();
  await waitReady(page);
  await setNetwork(app, false, { fire: false });
  await page.clock.setFixedTime(new Date(DAY_MS + 40 * H));
  await page.reload();
  await waitReady(page);
  assert.equal(await banner(page).innerText(), "離線中・顯示 14:20 的資料");
  assert.equal(app.blocked.length, 0);
  noErrors(app);
});

test("offline without a cache: the offline message, no request, no retry key", async () => {
  const app = await open();
  const { page } = app;
  await page.addInitScript(() => sessionStorage.setItem("__offline", "1"));
  await app.ctx.route(API, (route) => (app.blocked.push(route.request().url()), route.abort("internetdisconnected")));
  app.blocked = [];
  await app.go();
  await page.locator(".error-card").waitFor();
  assert.equal(await page.locator(".error-card p").innerText(), "離線中，沒有可顯示的資料");
  assert.equal(await page.locator('[data-action="retry"]').count(), 0);
  assert.equal(app.blocked.length + app.requests.length, 0, "no request while offline");
  noErrors(app);
});

test("the online event refreshes exactly once (forecast + air) and clears the banner", async () => {
  const app = await open();
  const { page } = app;
  await app.go();
  await waitReady(page);
  await setNetwork(app, false, { fire: false });
  await page.clock.setFixedTime(new Date(DAY_MS + 2 * H)); // the cache is stale now
  await page.reload();
  await waitReady(page);
  assert.match(await banner(page).innerText(), /^離線中/);
  const marks = { f: apiCount(app, /\/\/api\.open-meteo/), a: apiCount(app, /air-quality/) };
  await setNetwork(app, true);
  await page.waitForFunction(() => !document.querySelector('.banner[data-k="stale"]'));
  assert.equal(apiCount(app, /\/\/api\.open-meteo/) - marks.f, 1, "one forecast request");
  assert.equal(apiCount(app, /air-quality/) - marks.a, 1, "one air request");
  await page.waitForTimeout(300);
  assert.equal(apiCount(app, /\/\/api\.open-meteo/) - marks.f, 1, "and no second one");
  noErrors(app);
});

test("the offline event switches the banner on without a request; online switches it off again", async () => {
  const app = await open();
  const { page } = app;
  await app.go();
  await waitReady(page);
  const n = app.requests.length;
  await setNetwork(app, false);
  await banner(page).waitFor();
  assert.equal(await banner(page).innerText(), "離線中・顯示 14:20 的資料");
  await setNetwork(app, true);
  await page.waitForFunction(() => !document.querySelector('.banner[data-k="stale"]'));
  assert.equal(app.requests.length, n, "the cache is still fresh: coming back online needs no request");
  noErrors(app);
});

test("a cache older than 24 h is shown at once with `更新中…`, then replaced when the refresh lands", async () => {
  const app = await open();
  const { page } = app;
  await app.go();
  await waitReady(page);
  let release;
  const gate = new Promise((r) => (release = r));
  await app.ctx.route(API, async (route) => {
    await gate;
    return route.fallback();
  });
  await page.clock.setFixedTime(new Date(DAY_MS + 25 * H));
  await page.reload();
  await waitReady(page);
  assert.equal(await banner(page).innerText(), "資料時間 11/21 14:20・更新中…");
  assert.ok(await page.locator(".temp [role=img]").count(), "data is on screen while the request is pending");
  release();
  await page.waitForFunction(() => !document.querySelector('.banner[data-k="stale"]'));
  noErrors(app);
});

test("a cache older than 24 h whose refresh fails ends in `無法更新`", async () => {
  const app = await open({ expectedErrors: [/status of 500/] });
  const { page } = app;
  await app.go();
  await waitReady(page);
  app.mode.forecast = "500";
  await page.clock.setFixedTime(new Date(DAY_MS + 25 * H));
  await page.reload();
  await page.waitForFunction(() => /無法更新/.test(document.querySelector('.banner[data-k="stale"]')?.textContent ?? ""));
  assert.equal(await banner(page).innerText(), "資料時間 11/21 14:20・無法更新");
  assert.ok(await page.locator(".temp [role=img]").count());
  noErrors(app);
});

test("commute: cached work place is shown offline too", async () => {
  const WORK = { id: "p:24.80,120.97", name: "新竹", admin1: "新竹縣", country: "臺灣", lat: 24.8, lon: 120.97, elevation: 31, timezone: "Asia/Taipei" };
  const storage = { "ps:places": JSON.stringify({ v: 1, saved: [WORK], workId: WORK.id, tripId: null }), "ps:current": "gps" };
  const app = await open({ storage, forecastBy: placesForecasts() });
  const { page } = app;
  await app.go("#outing/commute");
  await page.locator(".leg-name:has-text('BACK・新竹')").waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-k="leg-back"] .leg-wx').length > 0);
  await setNetwork(app, false, { fire: false });
  const n = app.requests.length;
  await page.reload();
  await page.locator(".leg-name:has-text('BACK・新竹')").waitFor();
  assert.equal(await banner(page).innerText(), "離線中・顯示 14:20 的資料");
  assert.equal(await page.locator('[data-k="c-work-err"]').count(), 0);
  assert.equal(app.requests.length, n);
  noErrors(app);
});

test("picker: offline search says 離線中，無法搜尋 and sends no geocoding request", async () => {
  const app = await open({ geocode: () => [] });
  const { page } = app;
  await app.go();
  await waitReady(page);
  await setNetwork(app, false);
  await page.locator("#loc-btn").click();
  await page.locator("#pk-q").fill("Hualien");
  await page.locator("#pk-q").press("Enter");
  await page.waitForFunction(() => document.getElementById("pk-live")?.textContent === "離線中，無法搜尋");
  assert.deepEqual(app.geoRequests, []);
  assert.equal(app.blocked.length, 0);
  noErrors(app);
});

// ---------------------------------------------------------------- checklist layout

/** Rows with their reason and tag boxes. */
const layout = (page) =>
  page.$$eval(".check-item", (els) =>
    els.map((el) => {
      const why = el.querySelector(".check-why");
      const tags = el.querySelector(".tags");
      const lh = parseFloat(getComputedStyle(why).lineHeight) || parseFloat(getComputedStyle(why).fontSize) * 1.3;
      const w = why.getBoundingClientRect();
      const t = tags && tags.children.length ? tags.getBoundingClientRect() : null;
      return {
        id: el.dataset.k,
        lines: Math.round(w.height / lh),
        whyBottom: w.bottom,
        tagsTop: t ? t.top : null,
        tagCount: tags ? tags.children.length : 0,
        right: Math.max(...[...el.querySelectorAll(".tag")].map((x) => x.getBoundingClientRect().right), 0),
        height: el.getBoundingClientRect().height,
      };
    }),
  );

function assertChecklist(rows, label) {
  assert.ok(rows.length >= 4, `${label}: rows`);
  let withTags = 0;
  for (const r of rows) {
    assert.ok(r.lines <= 2, `${label} ${r.id}: reason uses ${r.lines} lines`);
    assert.ok(r.height >= 56 - 1, `${label} ${r.id}: row height ${r.height}`);
    if (r.tagCount) {
      withTags++;
      assert.ok(r.tagsTop >= r.whyBottom - 1, `${label} ${r.id}: tags (${r.tagsTop}) start below the reason (${r.whyBottom})`);
      assert.ok(r.right <= 390, `${label} ${r.id}: tags inside the viewport (${r.right})`);
    }
  }
  assert.ok(withTags >= 1, `${label}: the fixture has tagged rows`);
}

test("commute checklist at 390 px: reasons stay within 2 lines and the tags sit below them", async () => {
  const app = await open({ forecast: rainyEveningForecast() });
  await app.go("#outing/commute");
  await app.page.locator(".check-item").first().waitFor();
  await settle(app.page);
  assertChecklist(await layout(app.page), "commute");
  const o = await overflow(app.page);
  assert.ok(o.scrollWidth <= o.clientWidth);
  noErrors(app);
});

test("trip checklist at 390 px: reasons stay within 2 lines and the tags sit below them", async () => {
  const storage = { "ps:places": JSON.stringify({ v: 1, saved: [LAKE], workId: null, tripId: LAKE.id }), "ps:current": "gps", "ps:outing": JSON.stringify({ scenario: "trip", trip: { start: 15, end: 22 } }) };
  const wet = dayForecast((f) => [39, 40, 41, 42].forEach((i) => (f.hourly.precipitation_probability[i] = 70)));
  const app = await open({ storage, forecastBy: placesForecasts({ lake: wet }) });
  await app.go("#outing/trip");
  await app.page.locator(".check-item").first().waitFor();
  await settle(app.page);
  assertChecklist(await layout(app.page), "trip");
  noErrors(app);
});

test("wider screens keep the tags in a right column", async () => {
  const app = await open({ forecast: rainyEveningForecast() });
  await app.page.setViewportSize({ width: 600, height: 844 });
  await app.go("#outing/commute");
  await app.page.locator(".check-item").first().waitFor();
  const rows = await app.page.$$eval(".check-item", (els) =>
    els.filter((el) => el.querySelector(".tag")).map((el) => ({ tags: el.querySelector(".tags").getBoundingClientRect(), why: el.querySelector(".check-why").getBoundingClientRect() })),
  );
  assert.ok(rows.length);
  for (const r of rows) assert.ok(r.tags.top < r.why.bottom, "tags are beside the text, not below it");
  noErrors(app);
});
