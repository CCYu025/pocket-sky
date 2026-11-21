import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import {
  launch, openApp, waitReady, settle, shot, overflow, trackTheme,
  dayForecast, nightForecast, rainyForecast, coldDropForecast, airFixture, DAY_MS, NIGHT_MS, NIGHT_UTC,
} from "./helpers.mjs";
import { toViewModel } from "../../js/domain/derive.js";
import { headline } from "../../js/domain/summary.js";
import { metricItems } from "../../js/ui/views/today.js";

let server;
let browser;
const apps = [];

before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** Open the app and register it for cleanup. */
async function open(opts) {
  const app = await openApp(browser, server.url, opts);
  apps.push(app);
  return app;
}
function noErrors(app) {
  assert.deepEqual(app.errors, [], "no console errors or page errors");
}
async function noOverflow(app) {
  const o = await overflow(app.page);
  assert.ok(o.scrollWidth <= o.clientWidth, `horizontal overflow: ${o.scrollWidth} > ${o.clientWidth}`);
}
const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const metricValues = (page) => page.$$eval(".metric", (els) => els.map((e) => ({
  k: e.querySelector(".k").textContent, v: e.querySelector(".v").textContent, s: e.querySelector(".s").textContent,
})));

test("day: headline, LCD labels, metrics and sun row match the fixture", async () => {
  const forecast = dayForecast();
  const air = airFixture();
  const app = await open({ forecast, air });
  const { page } = app;
  await app.go();
  await waitReady(page);

  const vm = toViewModel({ forecast, air, nowMs: DAY_MS });
  assert.equal(await page.locator("h1").innerText(), headline(vm, null));

  assert.equal(await page.locator('.clock [role="img"]').getAttribute("aria-label"), "時間 14:20");
  assert.equal(await page.locator('.temp [role="img"]').getAttribute("aria-label"), "氣溫 23 度");
  assert.equal(await page.locator(".lcd-top span").first().innerText(), "SA 11-21");
  assert.equal(await page.locator(".lcd-cond").innerText(), vm.now.label);
  assert.equal(await page.locator(".lcd-foot").innerText().then((t) => t.replace(/\s+/g, " ")), "Δ YDAY +5° UPD 14:20");

  const got = await metricValues(page);
  const want = metricItems(vm);
  assert.deepEqual(got, want);
  assert.deepEqual(got.map((m) => m.v), ["0%", "40%", "15", "5", "84"]);
  assert.deepEqual(got.map((m) => m.s), ["未來 3 小時", "舒適", "km/h 東北", "中", "AQI 普通"]);

  assert.equal(await page.locator(".sun-row").innerText().then((t) => t.replace(/\s+/g, " ")), "日出 06:16 還有 2 時 49 分天黑 日落 17:09");
  assert.equal(await page.locator(".daybar").getAttribute("aria-valuenow"), "74");

  // hourly bars: 8, first labelled 現在
  assert.equal(await page.locator(".bar").count(), 8);
  assert.equal(await page.locator(".bar-labels i").first().innerText(), "現在");
  assert.equal(await page.locator(".alert").count(), 0);

  // attribution + landmarks + nav
  assert.equal(await page.locator('a.attribution').getAttribute("href"), "https://open-meteo.com/");
  assert.equal(await page.locator("header, main, nav").count(), 3);
  assert.equal(await page.locator("#nav-today").getAttribute("aria-current"), "page");
  assert.equal(await page.locator("#loc-btn").innerText().then((t) => t.replace(/\s+/g, " ")), "臺中（預設） ▾");
  assert.equal(await theme(page), "day");
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#FFF7D6");
  await noOverflow(app);
  await shot(page, "today-day");
  noErrors(app);
});

/** The three bottom keys are fully inside the first screen (no scrolling). */
async function assertNavInViewport(page, label) {
  const r = await page.evaluate(() => ({
    h: window.innerHeight,
    y: window.scrollY,
    keys: [...document.querySelectorAll(".nav .key")].map((k) => {
      const b = k.getBoundingClientRect();
      return { t: k.textContent.trim(), top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    }),
  }));
  assert.equal(r.y, 0, `${label}: not scrolled`);
  assert.equal(r.keys.length, 3, `${label}: three keys`);
  for (const k of r.keys) {
    assert.ok(k.top >= 0 && k.bottom <= r.h && k.left >= 0 && k.right <= 390, `${label}: ${k.t} inside viewport (${JSON.stringify(k)} of ${r.h})`);
  }
}

test("bottom nav (LIGHT / 今天 / 外出) is inside the 390x844 viewport in every state", async () => {
  const ready = await open({});
  await ready.go();
  await waitReady(ready.page);
  await assertNavInViewport(ready.page, "ready");
  const full = await ready.page.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(full > 844, "page is taller than the viewport, so the nav must be sticky");
  // still pinned after scrolling, and the last content is not covered by it
  await ready.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const nav = await ready.page.locator(".nav").boundingBox();
  const attr = await ready.page.locator("a.attribution").boundingBox();
  assert.ok(nav.y + nav.height <= 844 + 0.5 && attr.y + attr.height <= nav.y + 0.5, `attribution ${JSON.stringify(attr)} above nav ${JSON.stringify(nav)}`);
  noErrors(ready);

  const alert = await open({ forecast: rainyForecast() });
  await alert.go();
  await waitReady(alert.page);
  await assertNavInViewport(alert.page, "alert");
  noErrors(alert);

  const err = await open({ expectedErrors: [/status of 500/] });
  err.mode.forecast = "500";
  await err.go();
  await err.page.locator('[data-action="retry"]').waitFor();
  await assertNavInViewport(err.page, "error");

  const loading = await open({});
  loading.mode.forecast = "hang";
  await loading.go();
  await loading.page.locator(".hero").waitFor();
  await assertNavInViewport(loading.page, "loading");

  const outing = await open({});
  await outing.go("#outing");
  await outing.page.getByText("外出規劃：M3 開發中").waitFor();
  await assertNavInViewport(outing.page, "outing");
  const bg = await outing.page.locator(".nav").evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, "rgb(255, 247, 214)", "nav paints --shell so content never shows through");
  assert.equal(await outing.page.locator(".nav").evaluate((el) => getComputedStyle(el).position), "sticky");
});

test("attribution link is a 44px target; daylight bar fill contrasts with its track in both themes", async () => {
  const app = await open({});
  const { page } = app;
  await app.go();
  await waitReady(page);
  const box = await page.locator("a.attribution").boundingBox();
  assert.ok(box.height >= 44, `attribution height ${box.height}`);
  const lum = (rgb) => {
    const c = rgb.match(/\d+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = async () => {
    const [fill, track] = await page.evaluate(() => [
      getComputedStyle(document.querySelector(".daybar > div")).backgroundColor,
      getComputedStyle(document.querySelector(".daybar")).backgroundColor,
    ]);
    const [hi, lo] = [lum(fill), lum(track)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  };
  assert.ok((await contrast()) >= 3, `day contrast ${await contrast()}`);
  await page.locator('[data-action="light"]').click();
  assert.equal(await theme(page), "night");
  assert.ok((await contrast()) >= 3, `night contrast ${await contrast()}`);
  noErrors(app);
});

test("night: auto theme at 20:30 with countdown to sunrise", async () => {
  const app = await open({ forecast: nightForecast(), now: NIGHT_UTC });
  const { page } = app;
  await app.go();
  await waitReady(page);
  assert.equal(await theme(page), "night");
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#141414");
  assert.equal(await page.locator(".sun-row").innerText().then((t) => t.replace(/\s+/g, " ")), "日出 06:16 距日出 9 時 46 分 日落 17:09");
  assert.equal(await page.locator(".daybar").getAttribute("aria-valuenow"), "100");
  assert.equal(await page.locator('.clock [role="img"]').getAttribute("aria-label"), "時間 20:30");
  assert.equal(await page.locator('.temp [role="img"]').getAttribute("aria-label"), "氣溫 16 度");
  const vm = toViewModel({ forecast: nightForecast(), air: airFixture(), nowMs: NIGHT_MS });
  assert.deepEqual(await metricValues(page), metricItems(vm));
  await noOverflow(app);
  await shot(page, "today-night");
  noErrors(app);
});

test("night: first paint is already night (boot script), also while loading and in the error state", async () => {
  const seed = { "ps:theme-last": "night" };
  // ready: never a day frame
  const ready = await open({ forecast: nightForecast(), now: NIGHT_UTC, storage: seed });
  await trackTheme(ready);
  await ready.go();
  await waitReady(ready.page);
  assert.equal(await ready.page.evaluate(() => window.__bodyTheme), "night", "theme when <body> is created");
  assert.deepEqual(await ready.page.evaluate(() => window.__themes), ["night"], "never flashed day");
  assert.equal(await ready.page.evaluate(() => localStorage.getItem("ps:theme-last")), "night");
  noErrors(ready);

  // loading (no view model yet) keeps the last theme
  const loading = await open({ now: NIGHT_UTC, storage: seed });
  loading.mode.forecast = "hang";
  await trackTheme(loading);
  await loading.go();
  await loading.page.locator(".hero").waitFor();
  assert.equal(await loading.page.locator("main").getAttribute("aria-busy"), "true");
  assert.equal(await theme(loading.page), "night");
  assert.deepEqual(await loading.page.evaluate(() => window.__themes), ["night"]);
  noErrors(loading);

  // error state at night (auto theme, vm is null)
  const err = await open({ now: NIGHT_UTC, storage: seed, expectedErrors: [/status of 500/] });
  err.mode.forecast = "500";
  await trackTheme(err);
  await err.go();
  await err.page.locator('[data-action="retry"]').waitFor();
  assert.equal(await theme(err.page), "night");
  assert.equal(await err.page.locator('meta[name="theme-color"]').getAttribute("content"), "#141414");
  assert.deepEqual(await err.page.evaluate(() => window.__themes), ["night"]);
  assert.deepEqual(err.errors, []);
});

test("theme boot: no stored theme stays day; explicit day beats the last resolved night", async () => {
  const fresh = await open({});
  await trackTheme(fresh);
  await fresh.go();
  await waitReady(fresh.page);
  assert.equal(await theme(fresh.page), "day");
  assert.notEqual(await fresh.page.evaluate(() => window.__bodyTheme), "night");

  const explicit = await open({ storage: { "ps:theme": "day", "ps:theme-last": "night" } });
  await trackTheme(explicit);
  await explicit.go();
  await waitReady(explicit.page);
  assert.deepEqual(await explicit.page.evaluate(() => window.__themes), ["day"]);
  noErrors(fresh);
  noErrors(explicit);
});

test("LIGHT toggles the theme and persists across reload", async () => {
  const app = await open({});
  const { page } = app;
  await app.go();
  await waitReady(page);
  const light = page.locator('[data-action="light"]');
  assert.equal(await theme(page), "day");
  assert.equal(await light.getAttribute("aria-pressed"), "false");
  await light.click();
  assert.equal(await theme(page), "night");
  assert.equal(await light.getAttribute("aria-pressed"), "true");
  assert.equal(await page.evaluate(() => localStorage.getItem("ps:theme")), "night");
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#141414");
  // focus is kept on the key after the re-render
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.action ?? null), "light");
  await page.reload();
  await waitReady(page);
  assert.equal(await theme(page), "night");
  await page.locator('[data-action="light"]').click();
  assert.equal(await theme(page), "day");
  assert.equal(await page.evaluate(() => localStorage.getItem("ps:theme")), "day");
  noErrors(app);
});

test("rain alert: shows, headline follows, dismiss persists across reload", async () => {
  const app = await open({ forecast: rainyForecast() });
  const { page } = app;
  await app.go();
  await waitReady(page);
  const alert = page.locator(".alert");
  assert.equal(await alert.innerText().then((t) => t.replace(/\s+/g, " ")), "16:00 起可能下雨・降雨機率 70% ×");
  assert.equal(await page.locator("h1").innerText(), "16 時起可能下雨，記得帶傘");
  const close = page.locator(".alert-close");
  assert.equal(await close.getAttribute("aria-label"), "關閉提醒");
  const box = await close.boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, `close target ${box.width}x${box.height}`);
  assert.equal(await alert.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(255, 107, 154)");
  await noOverflow(app);
  await shot(page, "today-alert");

  await close.click();
  assert.equal(await page.locator(".alert").count(), 0);
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("ps:alerts")));
  assert.deepEqual(stored.dismissed, { "rainJump:2026-11-21T16:00": true });
  assert.equal(stored.lastShownId.rainJump, "rainJump:2026-11-21T16:00");
  assert.equal(typeof stored.lastShown.rainJump, "number");

  await page.reload();
  await waitReady(page);
  assert.equal(await page.locator(".alert").count(), 0);
  assert.notEqual(await page.locator("h1").innerText(), "16 時起可能下雨，記得帶傘");
  noErrors(app);
});

test("rain alert keeps showing after reload when not dismissed", async () => {
  const app = await open({ forecast: rainyForecast() });
  await app.go();
  await waitReady(app.page);
  await app.page.reload();
  await waitReady(app.page);
  assert.equal(await app.page.locator(".alert").count(), 1);
  noErrors(app);
});

test("cold-drop scenario shows the temperature alert", async () => {
  const app = await open({ forecast: coldDropForecast() });
  const { page } = app;
  await app.go();
  await waitReady(page);
  assert.equal(await page.locator(".alert-text").innerText(), "氣溫將下降 6°・17:00 降至 18°");
  assert.equal(await page.locator("h1").innerText(), "氣溫將下降 6°，加件外套");
  noErrors(app);
});

test("CSP: no violations; bars and daylight fill are sized via CSSOM; ghost segments hidden on the clock only", async () => {
  const app = await open({ forecast: rainyForecast() });
  const { page } = app;
  await app.ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await app.go();
  await waitReady(page);
  await settle(page);

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  assert.ok(!/unsafe-inline/.test(csp), csp);
  assert.deepEqual(await page.evaluate(() => window.__csp), [], "no securitypolicyviolation events");

  // numeric custom properties arrive through el.style.setProperty
  const bars = await page.$$eval(".bar", (els) => els.map((e) => ({ p: e.style.getPropertyValue("--p"), h: e.getBoundingClientRect().height })));
  assert.equal(bars.length, 8);
  assert.equal(bars[2].p, "70");
  assert.ok(Math.abs(bars[2].h - 70 * 0.72) < 0.6, `70% bar height ${bars[2].h}`);
  assert.ok(bars[2].h > bars[0].h, "taller bar for the higher probability");
  const fill = await page.evaluate(() => {
    const f = document.querySelector(".daybar > div");
    const track = document.querySelector(".daybar");
    return { pct: f.style.getPropertyValue("--pct"), ratio: f.getBoundingClientRect().width / track.clientWidth };
  });
  assert.equal(fill.pct, "74");
  assert.ok(Math.abs(fill.ratio - 0.74) < 0.01, `fill ratio ${fill.ratio}`);

  // ghost segments: hidden on the 24px clock, visible on the big temperature
  const display = (sel) => page.locator(`${sel} .seg.off`).first().evaluate((el) => getComputedStyle(el).display);
  assert.equal(await display(".clock"), "none");
  assert.notEqual(await display(".temp"), "none");
  assert.equal(await page.locator(".clock .seg7").evaluate((el) => el.classList.contains("seg7--noghost")), true);
  assert.equal(await page.locator(".temp .seg7").evaluate((el) => el.classList.contains("seg7--noghost")), false);
  noErrors(app);
});

test("hash navigation: #outing placeholder and back to #today", async () => {
  const app = await open({});
  const { page } = app;
  await app.go();
  await waitReady(page);
  await page.locator("#nav-outing").click();
  await page.getByText("外出規劃：M3 開發中").waitFor();
  assert.equal(await page.evaluate(() => location.hash), "#outing");
  assert.equal(await page.locator("#nav-outing").getAttribute("aria-current"), "page");
  assert.equal(await page.locator("#nav-today").getAttribute("aria-current"), null);
  await page.locator("#nav-today").click();
  await page.locator(".hero").waitFor();
  assert.equal(await page.evaluate(() => location.hash), "#today");
  assert.equal(await page.locator("#nav-today").getAttribute("aria-current"), "page");
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#outing");
  await page.getByText("外出規劃：M3 開發中").waitFor();
  // direct load of #outing
  await page.goto(server.url + "#today");
  await page.goto(server.url + "#outing");
  await page.reload();
  await page.getByText("外出規劃：M3 開發中").waitFor();
  noErrors(app);
});

test("stale: failed refresh over an old cache shows the banner", async () => {
  const app = await open({ expectedErrors: [/status of 500/] });
  const { page } = app;
  await app.go();
  await waitReady(page);
  assert.equal(await page.locator(".banner").count(), 0);

  app.mode.forecast = "500";
  await page.clock.setFixedTime(new Date(DAY_MS + 30 * 60e3)); // 14:50, cache (15 min TTL) is stale
  await page.reload();
  await page.locator(".banner").waitFor();
  assert.equal(await page.locator(".banner").innerText(), "資料時間 14:20・無法更新");
  assert.equal(await page.locator(".hero").count(), 1);
  assert.equal(await page.locator('.clock [role="img"]').getAttribute("aria-label"), "時間 14:50");
  await noOverflow(app);
  await shot(page, "today-stale");
  assert.deepEqual(app.errors, []);
});

test("old observation: banner explains forecast values are shown", async () => {
  const forecast = dayForecast((f) => { f.current.time = "2026-11-21T11:00"; });
  const app = await open({ forecast });
  await app.go();
  await waitReady(app.page);
  assert.equal(await app.page.locator(".banner").innerText(), "觀測資料較舊，顯示預報值");
  assert.equal(await app.page.locator(".alert").count(), 0);
  noErrors(app);
});

test("error without data shows 重試; retry recovers", async () => {
  const app = await open({ expectedErrors: [/status of 500/] });
  const { page } = app;
  app.mode.forecast = "500";
  await app.go();
  const retry = page.locator('[data-action="retry"]');
  await retry.waitFor();
  assert.equal(await retry.innerText(), "重試");
  assert.equal(await page.locator("h1").innerText(), "資料暫時無法取得");
  assert.equal(await page.locator(".metric").count(), 0);
  await noOverflow(app);
  await shot(page, "today-error");

  app.mode.forecast = "ok";
  await retry.click();
  await waitReady(page);
  assert.equal(await page.locator('[data-action="retry"]').count(), 0);
  assert.equal(await page.locator('.temp [role="img"]').getAttribute("aria-label"), "氣溫 23 度");
  assert.deepEqual(app.errors, []);
});

test("loading: placeholders render -- while the request is pending", async () => {
  const app = await open({});
  const { page } = app;
  app.mode.forecast = "hang";
  await app.go();
  await page.locator(".hero").waitFor();
  assert.equal(await page.locator("main").getAttribute("aria-busy"), "true");
  assert.equal(await page.locator("h1").innerText(), "載入天氣中…");
  assert.equal(await page.locator('.temp [role="img"]').getAttribute("aria-label"), "氣溫 無資料");
  assert.equal(await page.locator('.clock [role="img"]').getAttribute("aria-label"), "時間 無資料");
  assert.deepEqual((await metricValues(page)).map((m) => m.v), ["--", "--", "--", "--", "--"]);
  assert.equal(await page.locator(".lcd-foot").innerText().then((t) => t.replace(/\s+/g, " ")), "Δ YDAY -- UPD --:--");
  await noOverflow(app);
  await shot(page, "today-loading");
  noErrors(app);
});

test("geolocation granted uses the device position; denied falls back with a notice", async () => {
  const granted = await open({ granted: true });
  await granted.go();
  await waitReady(granted.page);
  assert.equal(await granted.page.locator("#loc-btn").innerText().then((t) => t.replace(/\s+/g, " ")), "目前位置 ▾");
  assert.equal(await granted.page.locator(".notice").count(), 0);
  assert.ok(granted.requests.some((u) => /latitude=24\.15&longitude=120\.67/.test(u)), granted.requests.join("\n"));
  noErrors(granted);

  const denied = await open({});
  await denied.go();
  await waitReady(denied.page);
  assert.equal(await denied.page.locator("#loc-btn").innerText().then((t) => t.replace(/\s+/g, " ")), "臺中（預設） ▾");
  // the notice is not repeated as a visible line; it lives in the button's accessible name
  assert.equal(await denied.page.locator(".notice").count(), 0);
  assert.equal(await denied.page.getByText("使用預設地點：臺中").count(), 0);
  assert.equal(await denied.page.locator("#loc-btn").getAttribute("aria-label"), "臺中（預設），使用預設地點：臺中，重新定位");
  assert.ok(denied.requests.some((u) => /latitude=24\.16&longitude=120\.64/.test(u)));
  noErrors(denied);
});

test("motion: colon blinks normally, reduced motion disables everything; hidden pauses", async () => {
  const app = await open({ forecast: rainyForecast() });
  const { page } = app;
  await app.go();
  await waitReady(page);
  const anim = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(await anim(".clock .seg7-colon"), "blink");
  assert.equal(await anim(".lcd"), "boot");
  assert.equal(await anim(".alert"), "shake");
  assert.equal(await anim(".bar"), "grow");
  // only one infinite animation
  const infinite = await page.evaluate(() => document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations === Infinity).length);
  assert.equal(infinite, 1);
  // hidden -> class on <html> pauses the colon
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("is-hidden")), true);
  assert.equal(await page.locator(".clock .seg7-colon").evaluate((el) => getComputedStyle(el).animationPlayState), "paused");
  noErrors(app);

  const rm = await open({ forecast: rainyForecast(), reducedMotion: "reduce" });
  await rm.go();
  await waitReady(rm.page);
  for (const sel of [".clock .seg7-colon", ".lcd", ".alert", ".bar"]) {
    assert.equal(await rm.page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName), "none", sel);
  }
  assert.equal(await rm.page.evaluate(() => document.getAnimations().length), 0);
  await noOverflow(rm);
  await shot(rm.page, "today-reduced-motion");
  noErrors(rm);
});

test("only transform/opacity are animated or transitioned", async () => {
  const app = await open({ forecast: rainyForecast() });
  const { page } = app;
  await app.go();
  await waitReady(page);

  /** Properties touched by every running animation AND transition (CSSAnimation keyframes, CSSTransition property). */
  const touched = () => page.evaluate(() => {
    const set = new Set();
    const skip = ["offset", "computedOffset", "easing", "composite"];
    for (const a of document.getAnimations()) {
      if (a.constructor.name === "CSSTransition") set.add(a.transitionProperty);
      else for (const kf of a.effect.getKeyframes()) for (const k of Object.keys(kf)) if (!skip.includes(k)) set.add(k);
    }
    return [...set].sort();
  });
  const allowed = new Set(["opacity", "transform"]);
  const bad = (props) => props.filter((p) => !allowed.has(p));

  assert.deepEqual(bad(await touched()), [], "running at load");

  // Provoke transitions: switch theme (colors change) and press a key (transform).
  await page.locator('[data-action="light"]').click();
  assert.deepEqual(bad(await touched()), [], "right after the theme switch");
  const box = await page.locator('[data-action="more"]').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  assert.deepEqual(bad(await touched()), [], "while a key is pressed");
  await page.mouse.up();

  // Static check: no element declares a non-zero transition on anything but transform/opacity.
  const declared = await page.evaluate(() => {
    const out = new Set();
    const secs = (t) => parseFloat(t) * (t.endsWith("ms") ? 0.001 : 1);
    for (const el of document.querySelectorAll("html, body, body *")) {
      const cs = getComputedStyle(el);
      const props = cs.transitionProperty.split(",").map((x) => x.trim());
      const durs = cs.transitionDuration.split(",").map((x) => secs(x.trim()));
      props.forEach((p, i) => { if (durs[i % durs.length] > 0) out.add(p); });
    }
    return [...out].sort();
  });
  assert.deepEqual(bad(declared), [], `declared transitions: ${declared}`);
  await settle(page);
  noErrors(app);
});
