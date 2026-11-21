import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import {
  launch, openApp, waitReady, settle, shot, overflow,
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
  assert.deepEqual(stored.dismissed, { "rainJump:2026-11-21": true });
  assert.equal(stored.lastShownId.rainJump, "rainJump:2026-11-21");
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
  await page.locator(".metric").first().waitFor();
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
  assert.equal(await denied.page.locator(".notice").innerText(), "使用預設地點：臺中");
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

test("only transform/opacity are animated", async () => {
  const app = await open({ forecast: rainyForecast() });
  await app.go();
  await waitReady(app.page);
  const props = await app.page.evaluate(() => {
    const set = new Set();
    for (const a of document.getAnimations()) {
      if (a.constructor.name !== "CSSAnimation") continue;
      for (const kf of a.effect.getKeyframes()) for (const k of Object.keys(kf)) set.add(k);
    }
    return [...set].filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k)).sort();
  });
  assert.deepEqual(props, ["opacity", "transform"]);
  await settle(app.page);
});
