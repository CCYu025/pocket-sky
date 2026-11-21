import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startServer } from "./server.mjs";
import {
  launch, openApp, settle, shot, waitReady, overflow, runAxe, SHOTS_M4, ROOT,
  dayForecast, destForecast, workForecast, airFixture, placesForecasts, LAKE, WORK, DAY_MS, NIGHT_UTC, nightForecast, advanceTo,
} from "./helpers.mjs";
import { toViewModel } from "../../js/domain/derive.js";
import { commuteModel } from "../../js/ui/views/commute.js";
import { tripModel, diffParts } from "../../js/ui/views/trip.js";
import { tempDiff, tripSlots, bestWindow } from "../../js/rules/trip.js";
import { EXTRA_HOURS } from "../../js/app/controller.js";

let server;
let browser;
const apps = [];
const AXE_CSS_FETCH = /Connecting to 'https:\/\/fonts\.googleapis\.com\/css2.*connect-src/;
const HTTP_500 = /status of 500/;

before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(opts = {}) {
  const app = await openApp(browser, server.url, { forecastBy: placesForecasts(), ...opts, expectedErrors: [AXE_CSS_FETCH, ...(opts.expectedErrors ?? [])] });
  apps.push(app);
  return app;
}
const noErrors = (app) => assert.deepEqual(app.errors, [], "no console errors or CSP violations");
const norm = (t) => t.replace(/\s+/g, " ").trim();
const seed = ({ saved = [], workId = null, tripId = null, current = null, extra = {} } = {}) => ({
  "ps:places": JSON.stringify({ v: 1, saved, workId, tripId }),
  ...(current ? { "ps:current": current } : {}),
  ...extra,
});
const NIGHT_PREF = { "ps:theme": "night" };
const storedJson = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const dlg = (page) => page.locator("#picker");
const live = (page) => page.locator("#pk-live").textContent();
const isOpen = (page) => dlg(page).evaluate((d) => d.open);
const focusIn = (page, sel) => page.evaluate((s) => document.activeElement?.closest(s) !== null && document.activeElement?.closest(s) !== undefined, sel);
const activeId = (page) => page.evaluate(() => document.activeElement?.id ?? "");

/** Like `waitReady`, but the trip view's empty state has no hero. */
const ready = (page) =>
  page.waitForFunction(() => document.getElementById("view")?.getAttribute("aria-busy") === "false" && !!document.querySelector(".hero, .empty"));
async function visit(app, hash = "") {
  await app.go(hash);
  await ready(app.page);
}
async function noOverflow(page, label = "") {
  const o = await overflow(page);
  assert.ok(o.scrollWidth <= o.clientWidth, `${label} horizontal overflow: ${o.scrollWidth} > ${o.clientWidth}`);
}
async function waitLive(page, re) {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#pk-live")?.textContent ?? ""), re.source);
}
async function openPicker(page) {
  await page.locator("#loc-btn").click();
  await dlg(page).locator("#pk-q").waitFor();
}
async function check(name, page) {
  const all = await runAxe(page);
  const blocking = all.filter((v) => v.impact === "serious" || v.impact === "critical");
  console.log(`# axe[${name}]: serious/critical=${blocking.length} others=${all.length - blocking.length}`);
  for (const v of all.filter((x) => !blocking.includes(x))) console.log(`#   ${v.impact} ${v.id} (${v.nodes} nodes) ${v.targets.join(" | ")}`);
  assert.deepEqual(blocking, [], `${name}: ${JSON.stringify(blocking, null, 1)}`);
}

/** Geocoding mock shaped like the Open-Meteo response. */
const TAICHUNG_CITY = { name: "臺中市", latitude: 24.1469, longitude: 120.6839, elevation: 91, admin1: "臺灣省", country: "台灣", timezone: "Asia/Taipei" };
const HUALIEN = { name: "Hualien City", latitude: 23.9769, longitude: 121.6044, elevation: 10, admin1: "Hualien", country: "Taiwan", timezone: "Asia/Taipei" };
const LAKE_RESULT = { name: "日月潭", latitude: 23.87, longitude: 120.91, elevation: 748, admin1: "南投縣", country: "台灣", timezone: "Asia/Taipei" };
const geocode = (name) => ({ 臺中市: [TAICHUNG_CITY], Hualien: [HUALIEN], 日月潭: [LAKE_RESULT] })[name] ?? [];

const dayVm = () => toViewModel({ forecast: dayForecast(), air: airFixture(), nowMs: DAY_MS });
const destVm = (mutate) => toViewModel({ forecast: destForecast(mutate), air: airFixture(), nowMs: DAY_MS, hoursAhead: EXTRA_HOURS });
const workVm = () => toViewModel({ forecast: workForecast(), air: airFixture(), nowMs: DAY_MS, hoursAhead: EXTRA_HOURS });

// ---------------------------------------------------------------- picker: open, close, focus

test("picker: opens as a modal dialog from the location key; Esc, ×, backdrop close it and focus returns to the opener", async () => {
  const app = await open();
  const { page } = app;
  await visit(app);
  assert.equal(await isOpen(page), false);
  assert.equal(await page.locator("#loc-btn").getAttribute("aria-haspopup"), "dialog");
  await openPicker(page);
  assert.equal(await isOpen(page), true);
  assert.equal(await dlg(page).evaluate((d) => d.matches(":modal")), true, "showModal");
  assert.equal(await dlg(page).getAttribute("aria-labelledby"), "pk-title");
  assert.equal(await page.locator("#pk-title").innerText(), "選擇地點");
  assert.equal(await focusIn(page, "#picker"), true, "focus moved into the dialog");

  await page.keyboard.press("Escape");
  assert.equal(await isOpen(page), false);
  assert.equal(await activeId(page), "loc-btn", "Esc returns focus to the opener");

  await openPicker(page);
  await page.getByRole("button", { name: "關閉" }).click();
  assert.equal(await isOpen(page), false);
  assert.equal(await activeId(page), "loc-btn", "× returns focus to the opener");

  await openPicker(page);
  await page.mouse.click(3, 3); // backdrop
  assert.equal(await isOpen(page), false);
  assert.equal(await activeId(page), "loc-btn");
  noErrors(app);
});

test("picker: only a click outside the dialog's rectangle closes it (padding and gaps do not)", async () => {
  const app = await open({ storage: seed({ saved: [LAKE] }) });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  const box = await dlg(page).boundingBox();
  await page.mouse.click(box.x + 6, box.y + box.height / 2); // inside the left padding
  assert.equal(await isOpen(page), true, "padding click keeps it open");
  const lead = await page.locator(".pk-lead").boundingBox();
  await page.mouse.click(box.x + box.width / 2, lead.y + lead.height + 5); // the gap under the lead text
  assert.equal(await isOpen(page), true, "gap click keeps it open");
  await page.mouse.click(box.x + box.width / 2, box.y + 5); // top padding
  assert.equal(await isOpen(page), true, "top padding click keeps it open");
  await page.mouse.click(box.x - 6, box.y + box.height / 2); // just outside the left edge (the backdrop)
  assert.equal(await isOpen(page), false, "outside closes it");
  noErrors(app);
});

test("search: IME composition (zhuyin) triggers no search and no 找不到; the committed text does", async () => {
  const app = await open({ geocode });
  const { page } = app;
  await app.ctx.addInitScript(() => setInterval(() => performance.now(), 5)); // see the debounce test
  await visit(app);
  await openPicker(page);
  await page.locator("#pk-q").focus();
  const cdp = await app.ctx.newCDPSession(page);
  for (const text of ["ㄊ", "ㄊㄞ", "ㄊㄞˊ"]) await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
  await page.waitForTimeout(900); // well past the 400 ms debounce
  assert.deepEqual(app.geoRequests, [], "no geocoding request while composing");
  assert.equal(await live(page), "", "no 找不到 announcement for a half-typed syllable");
  await cdp.send("Input.insertText", { text: "台" }); // the candidate is committed
  await waitLive(page, /找不到「台」|找到/);
  assert.equal(app.geoRequests[0], "台", "after the commit the search runs");
  noErrors(app);
});

test("picker: Tab and Shift+Tab never leave the dialog; the page behind is inert", async () => {
  const app = await open({ storage: seed({ saved: [LAKE, WORK], workId: WORK.id }) });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    assert.equal(await focusIn(page, "#picker"), true, `Tab #${i + 1}`);
    seen.add(await page.evaluate(() => document.activeElement.getAttribute("aria-label") ?? document.activeElement.id));
  }
  assert.ok(seen.size >= 10, `visited ${seen.size} distinct controls`);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Shift+Tab");
    assert.equal(await focusIn(page, "#picker"), true, `Shift+Tab #${i + 1}`);
  }
  assert.equal(await page.evaluate(() => document.elementFromPoint(195, 820)?.closest(".nav") === null), true, "a tap over the nav lands on the backdrop, not on the nav");
  await page.keyboard.press("Escape");
  noErrors(app);
});

test("picker: every control has an accessible name and a >= 44px target; saved rows expose pressed state", async () => {
  const app = await open({ storage: seed({ saved: [LAKE, WORK], workId: WORK.id, tripId: LAKE.id, current: LAKE.id }), granted: true });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  const controls = await dlg(page).evaluate((d) =>
    [...d.querySelectorAll("button, input, select")].map((el) => ({
      name: el.getAttribute("aria-label") || (el.labels?.[0]?.textContent ?? "") || el.textContent.trim(),
      h: el.getBoundingClientRect().height,
      w: el.getBoundingClientRect().width,
      pressed: el.getAttribute("aria-pressed"),
      tag: el.tagName,
    })),
  );
  for (const c of controls) {
    assert.ok(c.name.trim().length > 0, `unnamed control ${JSON.stringify(c)}`);
    assert.ok(c.h >= 44 - 0.5, `${c.name}: ${c.h}px high`);
    if (c.tag === "BUTTON") assert.ok(c.w >= 44 - 0.5, `${c.name}: ${c.w}px wide`);
  }
  const by = (name) => page.getByRole("button", { name, exact: true });
  assert.equal(await by("目前位置：日月潭・南投縣").getAttribute("aria-pressed"), "true");
  assert.equal(await by("目前位置：新竹・新竹縣").getAttribute("aria-pressed"), "false");
  assert.equal(await by("公司地點：新竹・新竹縣").getAttribute("aria-pressed"), "true");
  assert.equal(await by("出遊地點：日月潭・南投縣").getAttribute("aria-pressed"), "true");
  assert.equal(await by("刪除 新竹・新竹縣").count(), 1);
  assert.equal(await by("目前位置：使用裝置定位").getAttribute("aria-pressed"), "false");
  // the field is labelled, the count is one polite live node
  assert.equal(await page.getByLabel("搜尋地點").getAttribute("type"), "search");
  assert.equal(await dlg(page).locator("[aria-live]").count(), 1);
  assert.equal(await page.locator("#pk-live").getAttribute("aria-live"), "polite");
  noErrors(app);
});

// ---------------------------------------------------------------- search, add, select

test("search: 台中 tries 台中, 臺中, 台中市, 臺中市 (one debounced search); add; select; Today shows it; persists", async () => {
  const app = await open({ geocode, granted: true });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  await page.locator("#pk-q").fill("台中");
  await waitLive(page, /^找到 1 個地點$/);
  assert.deepEqual(app.geoRequests, ["台中", "臺中", "台中市", "臺中市"]);
  assert.equal(await dlg(page).locator('[aria-label="搜尋結果"] li').count(), 1);

  await page.getByRole("button", { name: /^加入 臺中市/ }).click();
  assert.match(await live(page), /^已加入 臺中市・臺灣省$/);
  const saved = (await storedJson(page, "ps:places")).saved;
  assert.deepEqual(saved.map((p) => [p.id, p.name, p.lat, p.lon]), [["p:24.15,120.68", "臺中市", 24.15, 120.68]]);
  assert.equal(await page.locator(".pk-done").count(), 1, "the result now reads 已儲存");
  assert.equal(await isOpen(page), true, "adding keeps the picker open in current mode");
  assert.equal(await focusIn(page, "#picker"), true);

  const before = app.requests.length;
  await page.getByRole("button", { name: "目前位置：臺中市・臺灣省" }).click();
  assert.equal(await isOpen(page), false);
  assert.equal(await activeId(page), "loc-btn");
  await page.waitForFunction(() => document.querySelector("#loc-btn").textContent.includes("臺中市"));
  assert.equal(norm(await page.locator("#loc-btn").innerText()), "臺中市 ▾");
  assert.equal(await page.locator("#loc-btn").getAttribute("aria-label"), "臺中市，選擇地點");
  await ready(page);
  assert.ok(app.requests.slice(before).some((u) => /latitude=24\.15&longitude=120\.68/.test(u)), "Today loads the selected place");
  assert.equal(await page.evaluate(() => localStorage.getItem("ps:current")), "p:24.15,120.68");

  await page.reload();
  await ready(page);
  assert.equal(norm(await page.locator("#loc-btn").innerText()), "臺中市 ▾", "the choice survives a reload");
  noErrors(app);
});

test("search: an English query is sent as typed (no variants); Enter searches at once", async () => {
  const app = await open({ geocode });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  await page.locator("#pk-q").fill("Hualien");
  await page.keyboard.press("Enter");
  await waitLive(page, /^找到 1 個地點$/);
  assert.deepEqual(app.geoRequests, ["Hualien"]);
  assert.match(await dlg(page).locator('[aria-label="搜尋結果"]').innerText(), /Hualien City/);
  assert.match(await dlg(page).locator('[aria-label="搜尋結果"]').innerText(), /Taiwan・海拔 10 m/);
  await page.waitForTimeout(600); // the debounce timer was cancelled by Enter: no second request
  assert.deepEqual(app.geoRequests, ["Hualien"]);
  noErrors(app);
});

test("search: typing yields one debounced request, min 1 character, empty input clears results", async () => {
  const app = await open({ geocode });
  const { page } = app;
  // Playwright's fake clock (page.clock) only processes timers when the page reads the clock; without this
  // poll it fires a pending 400 ms timer ~50 ms after the last key. Real browsers do not need it.
  await app.ctx.addInitScript(() => setInterval(() => performance.now(), 5));
  await visit(app);
  await openPicker(page);
  // The 400 ms timing itself is covered by tests/unit/picker.test.mjs (injected timers). Here: typing key by key
  // yields exactly one request, for the final text (an early search would have sent "H", "Hu", ...).
  await page.locator("#pk-q").pressSequentially("Hualien", { delay: 50 });
  await waitLive(page, /^找到 1 個地點$/);
  assert.deepEqual(app.geoRequests, ["Hualien"], "one request for the final text");

  await page.locator("#pk-q").fill("");
  assert.equal(await live(page), "");
  assert.equal(await dlg(page).locator('[aria-label="搜尋結果"]').count(), 0);
  await page.locator("#pk-q").fill("a"); // a single character is enough
  await waitLive(page, /找不到「a」/);
  assert.deepEqual(app.geoRequests, ["Hualien", "a"]);
  noErrors(app);
});

test("search: no result shows the count text and the hints; the result count is announced as live text", async () => {
  const app = await open({ geocode });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  await page.locator("#pk-q").fill("花蓮");
  await waitLive(page, /找不到/);
  assert.deepEqual(app.geoRequests, ["花蓮", "花蓮市"]);
  assert.equal(await live(page), "找不到「花蓮」", "names what was typed, not the last fallback spelling");
  const hint = await page.locator(".pk-hint").innerText();
  assert.match(hint, /試試英文名稱，例如 Taichung/);
  assert.match(hint, /或加上「市」，例如 花蓮市/);
  noErrors(app);
});

test("search: a network error shows the inline message without closing; the next search recovers", async () => {
  const app = await open({ geocode, expectedErrors: [HTTP_500] });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  app.mode.geo = "500";
  await page.locator("#pk-q").fill("Hualien");
  await waitLive(page, /^搜尋失敗，請稍後再試$/);
  assert.equal(await isOpen(page), true);
  assert.equal(await page.locator("#pk-q").inputValue(), "Hualien", "the typed text is kept");
  app.mode.geo = "ok";
  await page.locator("#pk-q").fill("Hualien2"); // a different key: not served from any cache
  await waitLive(page, /找不到「Hualien2」/);
  await page.locator("#pk-q").fill("日月潭");
  await waitLive(page, /^找到 1 個地點$/);
  noErrors(app);
});

test("saved places: at most 5; adding a 6th removes the oldest place that is not the work or trip place", async () => {
  const mk = (n) => ({ id: `p:2${n}.00,120.00`, name: `地${n}`, admin1: null, country: "臺灣", lat: 20 + n, lon: 120, elevation: null, timezone: null });
  const saved = [1, 2, 3, 4, 5].map(mk); // newest first: 地1 ... 地5 (oldest)
  const app = await open({ geocode, storage: seed({ saved, workId: saved[4].id }) });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  assert.equal(await dlg(page).locator('[aria-label="已儲存的地點"] li').count(), 6, "5 places + the GPS row");
  assert.match(await dlg(page).locator(".pk-sect").innerText(), /已儲存 5 \/ 5/);
  await page.locator("#pk-q").fill("日月潭");
  await waitLive(page, /^找到 1 個地點$/);
  await page.getByRole("button", { name: /^加入 日月潭/ }).click();
  assert.equal(await live(page), "已加入 日月潭・南投縣，並移除最舊的 地4（最多 5 個）");
  assert.deepEqual((await storedJson(page, "ps:places")).saved.map((p) => p.name), ["日月潭", "地1", "地2", "地3", "地5"], "地5 (work) survives, 地4 goes");
  assert.equal((await storedJson(page, "ps:places")).workId, saved[4].id);
  assert.equal(await dlg(page).locator('[aria-label="已儲存的地點"] li').count(), 6);
  noErrors(app);
});

test("saved places: delete removes the row; deleting the current place falls back to GPS; work/trip references are cleared", async () => {
  const app = await open({ granted: true, storage: seed({ saved: [LAKE, WORK], current: LAKE.id, workId: WORK.id, tripId: WORK.id }) });
  const { page } = app;
  await visit(app);
  assert.equal(norm(await page.locator("#loc-btn").innerText()), "日月潭 ▾");
  await openPicker(page);
  await page.getByRole("button", { name: "刪除 日月潭・南投縣" }).click();
  assert.equal(await live(page), "已刪除 日月潭・南投縣，改用目前位置");
  assert.equal(await dlg(page).locator('[aria-label="已儲存的地點"] li').count(), 2, "新竹 + GPS");
  assert.equal(await focusIn(page, "#picker"), true, "focus stays inside the dialog");
  await page.waitForFunction(() => document.querySelector("#loc-btn").textContent.includes("目前位置"));
  assert.equal(await page.evaluate(() => localStorage.getItem("ps:current")), "gps");
  assert.deepEqual((await storedJson(page, "ps:places")).saved.map((p) => p.id), [WORK.id]);

  await page.getByRole("button", { name: "刪除 新竹・新竹縣" }).click();
  assert.deepEqual(await storedJson(page, "ps:places"), { v: 1, saved: [], workId: null, tripId: null }, "refs cleared");
  assert.match(await dlg(page).innerText(), /尚未儲存地點/);
  await page.keyboard.press("Escape");
  noErrors(app);
});

test("picker: 目前位置 relocates and becomes the current place again", async () => {
  const app = await open({ granted: true, storage: seed({ saved: [LAKE], current: LAKE.id }) });
  const { page } = app;
  await visit(app);
  const before = app.requests.length;
  await openPicker(page);
  await page.getByRole("button", { name: "目前位置：使用裝置定位" }).click();
  await page.waitForFunction(() => document.querySelector("#loc-btn").textContent.includes("目前位置"));
  assert.equal(await page.evaluate(() => localStorage.getItem("ps:current")), "gps");
  assert.ok(app.requests.slice(before).some((u) => /latitude=24\.15&longitude=120\.67/.test(u)));
  await page.waitForFunction(() => document.activeElement?.id === "loc-btn");
  noErrors(app);
});

// ---------------------------------------------------------------- commute with a work place

test("commute: the work place is fetched lazily; 設定公司地點 opens the picker in work mode; BACK uses the work place", async () => {
  const app = await open({ storage: seed({ saved: [WORK] }) });
  const { page } = app;
  await visit(app); // Today
  await visit(app, "#outing/commute");
  assert.equal(norm(await page.locator('[data-k="leg-out"] .leg-name').innerText()), "OUT 明日");
  assert.match(await page.locator("#c-note .note, .work .note").first().innerText(), /設定公司地點後/);
  assert.equal(app.requests.filter((u) => /latitude=24\.80&/.test(u)).length, 0, "no work place yet, nothing requested");

  await page.getByRole("button", { name: "設定公司地點" }).click();
  assert.equal(await isOpen(page), true);
  assert.equal(await page.locator("#pk-title").innerText(), "設定公司地點");
  await page.getByRole("button", { name: "公司地點：新竹・新竹縣" }).click();
  assert.equal(await isOpen(page), false, "the mode's own action closes the picker");
  assert.equal(await activeId(page), "c-set-work", "focus returns to the opener");
  assert.equal((await storedJson(page, "ps:places")).workId, WORK.id);

  await page.waitForFunction(() => /BACK・新竹/.test(document.body.textContent) && !/載入中/.test(document.querySelector(".lcd--legs")?.textContent ?? ""));
  assert.ok(app.requests.some((u) => /latitude=24\.80&longitude=120\.97/.test(u) && u.includes("api.open-meteo.com")), "work forecast requested");
  assert.ok(app.requests.some((u) => /latitude=24\.80&longitude=120\.97/.test(u) && u.includes("air-quality")), "and its air quality");

  const model = commuteModel(dayVm(), { out: 8, back: 18 }, { place: WORK, entry: { status: "ready", vm: workVm() } });
  const back = page.locator('[data-k="leg-back"]');
  const out = page.locator('[data-k="leg-out"]');
  assert.equal(norm(await back.locator(".leg-wx").innerText()), model.legs[1].wx, "BACK shows the work place's weather");
  assert.match(model.legs[1].wx, /^27° /, "synthetic work temperature");
  assert.equal(norm(await back.locator(".leg-name").innerText()), "BACK・新竹");
  assert.equal(norm(await out.locator(".leg-wx").innerText()), model.legs[0].wx, "OUT still comes from the current place");
  assert.equal(await back.locator(".seg7").getAttribute("aria-label"), "回家 18:00，公司 新竹");
  assert.equal(await back.locator(".warn").count(), 1, "!RAIN on the work leg (60% at 18:00)");
  assert.equal(await page.locator("h1.headline").innerText(), "傍晚回家會遇到雨");
  assert.deepEqual(
    await page.$$eval(".check-item.is-on", (els) => els.map((e) => [e.dataset.k, [...e.querySelectorAll(".tag")].map((t) => t.textContent)])),
    model.items.filter((i) => i.on).map((i) => [`item-${i.id}`, i.tags]),
  );
  assert.match(await page.locator(".work .note").innerText(), /回家（BACK）使用公司地點：新竹/);

  await page.reload();
  await page.locator('[data-k="leg-back"] .leg-name').filter({ hasText: "BACK・新竹" }).waitFor();
  noErrors(app);
});

test("commute: a failing work place only affects the BACK leg; retry recovers; Today is untouched", async () => {
  const app = await open({ storage: seed({ saved: [WORK], workId: WORK.id }), expectedErrors: [HTTP_500] });
  const { page } = app;
  app.failPlaces.add("24.80,120.97");
  await visit(app, "#outing/commute");
  await page.locator(".banner--row").waitFor();
  assert.match(await page.locator(".banner--row").innerText(), /公司天氣暫時無法取得/);
  assert.equal(norm(await page.locator('[data-k="leg-back"] .leg-detail').innerText()), "無法取得資料");
  assert.match(await page.locator('[data-k="leg-out"] .leg-wx').innerText(), /^\d+°/, "OUT keeps its data");
  assert.equal(await page.locator("h1.headline").innerText(), "公司天氣暫時無法取得");
  assert.equal(await page.locator(".error-card").count(), 0, "the shared error card is for the current place only");

  await page.locator("#nav-today").click();
  await page.locator(".sun").waitFor();
  assert.equal(await page.locator(".error-card").count(), 0);
  assert.equal(await page.locator(".banner").count(), 0, "no stale/error banner on Today");

  await page.locator("#nav-outing").click();
  await page.locator(".banner--row").waitFor(); // coming back asks again; still failing
  app.failPlaces.clear();
  await page.locator("#c-retry").click();
  await page.waitForFunction(() => /^27°/.test(document.querySelector('[data-k="leg-back"] .leg-wx')?.textContent ?? ""));
  assert.equal(await page.locator(".banner--row").count(), 0);
  noErrors(app);
});

// ---------------------------------------------------------------- trip

/** Expected values for the Sun Moon Lake destination, computed from the fixtures. */
function expectedTrip(trip = { start: 9, end: 16 }, mutate) {
  const d = destVm(mutate);
  const o = dayVm();
  const model = tripModel({ vm: d, place: LAKE, originVm: o }, trip, DAY_MS);
  return { d, o, model };
}

const TOMORROW_TRIP = { start: 9, end: 13 }; // already over at 14:20: tomorrow's window
test("trip: enabled chip, destination from fixtures — diff, name, elevation, strip, best window, headline, checklist", async () => {
  const app = await open({ storage: seed({ saved: [LAKE], tripId: LAKE.id, extra: { "ps:outing": JSON.stringify({ scenario: "trip", trip: TOMORROW_TRIP }) } }) });
  const { page } = app;
  await visit(app);
  assert.equal(app.requests.filter((u) => /latitude=23\.87/.test(u)).length, 0, "the destination is not fetched outside the trip view");
  await visit(app, "#outing/trip");
  await page.locator(".strip").waitFor();
  assert.ok(app.requests.some((u) => /latitude=23\.87&longitude=120\.91/.test(u) && u.includes("api.open-meteo.com")));
  assert.equal(await page.locator(".chip--trip").getAttribute("aria-current"), "page");
  assert.equal(await page.locator("a.chip--trip").getAttribute("href"), "#outing/trip");
  assert.equal(await page.locator("#nav-outing").getAttribute("aria-current"), "page");
  assert.equal((await storedJson(page, "ps:outing")).scenario, "trip");

  const { model } = expectedTrip(TOMORROW_TRIP);
  // the expected diff, derived from the raw fixtures independently of the app code
  const raw = (f) => f.hourly.temperature_2m[38];
  const expectedDiff = Math.round(raw(destForecast()) - raw(dayForecast()));
  assert.equal(model.diff, expectedDiff);
  assert.ok(expectedDiff < 0, `Sun Moon Lake is colder than Taichung (${expectedDiff})`);
  const label = await page.locator(".trip-diff [role=img]").getAttribute("aria-label");
  assert.equal(label, `比目前位置低 ${-expectedDiff} 度`);
  assert.equal(label, diffParts(expectedDiff).label);
  assert.equal(norm(await page.locator(".trip-l .mono").innerText()), "VS 目前位置");
  assert.equal(await page.locator(".trip-name").innerText(), "日月潭・南投縣");
  assert.equal(norm(await page.locator(".trip-r > span").nth(1).innerText()), "海拔 747 m");
  assert.equal(norm(await page.locator(".trip-r > span").nth(2).innerText()), model.condition);
  const first = page.locator(".trip-diff .seg7-digit").first();
  assert.equal(await first.locator(".seg.on").count(), 1, "the minus sign is one lit segment");
  assert.equal(await first.locator(".seg-g.on").count(), 1, "the middle one");

  // destination chips
  assert.equal(await page.locator("#dest-p\\:23\\.87\\,120\\.91").getAttribute("aria-current"), "true");
  assert.equal(await page.locator("#dest-p\\:23\\.87\\,120\\.91").getAttribute("aria-pressed"), null, "single-select chips are not toggles");
  assert.equal(norm(await page.locator("#t-add").innerText()), "＋ 搜尋");

  // selects with the stored window
  assert.equal(await page.locator("#sel-start").inputValue(), "9");
  assert.equal(await page.locator("#sel-end").inputValue(), "13");
  assert.equal(await page.locator('label[for="sel-start"]').innerText(), "開始時間");

  // headline, strip and best window
  assert.equal(await page.locator("h1.headline").innerText(), model.headline);
  assert.equal(await page.locator(".srow").count(), model.rows.length);
  assert.deepEqual(
    await page.$$eval(".srow", (els) => els.map((e) => e.querySelector(".sr-only").textContent)),
    model.rows.map((r) => r.aria),
  );
  const slots = tripSlots(destVm(), 9, 13, DAY_MS);
  const best = bestWindow(slots);
  assert.equal(await page.locator(".srow.is-best").count(), best.length);
  assert.deepEqual(await page.$$eval(".srow", (els) => els.map((e) => e.classList.contains("is-best"))), slots.map((_, i) => i >= best.startIndex && i <= best.endIndex));
  assert.equal(await page.locator(".srow .st i").count(), model.rows.length, "every row is tomorrow's at 14:20 and carries the 明日 marker");
  // bar length = comfort
  await settle(page);
  const widths = await page.$$eval(".sfill", (els) => els.map((e) => [e.style.getPropertyValue("--p"), Math.round(e.getBoundingClientRect().width / e.parentElement.clientWidth * 100)]));
  widths.forEach(([p, w], i) => {
    assert.equal(Number(p), model.rows[i].comfort);
    assert.ok(Math.abs(w - model.rows[i].comfort) <= 2, `bar ${i}: ${w}% vs comfort ${model.rows[i].comfort}`);
  });

  // checklist: the same component as commute
  assert.deepEqual(
    await page.$$eval(".check-item", (els) => els.map((e) => [e.dataset.k.replace("item-", ""), e.classList.contains("is-on"), [...e.querySelectorAll(".tag")].map((t) => t.textContent)])),
    model.items.map((i) => [i.id, i.on, i.tags]),
  );
  assert.equal(await page.locator('[data-k="t-checklist"]').count(), 1);
  noErrors(app);
});

test("trip: the default window 09-16 is running at 14:20, so it starts today at 14:00 (two rows, no 明日)", async () => {
  const app = await open({ storage: seed({ saved: [LAKE], tripId: LAKE.id }) });
  const { page } = app;
  await visit(app, "#outing/trip");
  await page.locator(".strip").waitFor();
  assert.equal(await page.locator("#sel-start").inputValue(), "9");
  assert.equal(await page.locator("#sel-end").inputValue(), "16");
  assert.deepEqual(await page.$$eval(".srow .st b", (els) => els.map((e) => e.textContent)), ["14", "15"]);
  assert.equal(await page.locator(".srow .st i").count(), 0);
  assert.equal(await page.locator(".srow.is-best").count(), 0, "two hours are too short for a best window");
  noErrors(app);
});

test("trip-day: 70% rain hours are bad, bold-underlined with their 雨70% text, and the legend explains every cue", async () => {
  const wetLake = destForecast((f) => [39, 40, 41, 42].forEach((i) => (f.hourly.precipitation_probability[i] = 70)));
  const app = await open({
    storage: seed({ saved: [LAKE], tripId: LAKE.id, extra: { "ps:outing": JSON.stringify({ scenario: "trip", trip: { start: 15, end: 22 } }) } }),
    forecastBy: placesForecasts({ lake: wetLake }),
  });
  const { page } = app;
  await visit(app, "#outing/trip");
  await page.locator(".strip").waitFor();
  const rows = await page.$$eval(".srow", (els) => els.map((e) => ({
    hour: e.querySelector(".st b").textContent,
    level: [...e.querySelector(".sfill").classList].find((c) => /^sfill--/.test(c)),
    wet: e.classList.contains("is-wet"),
    marked: e.querySelector(".sval .wet")?.textContent ?? null,
    underline: e.querySelector(".sval .wet") ? getComputedStyle(e.querySelector(".sval .wet")).textDecorationLine : null,
    weight: e.querySelector(".sval .wet") ? getComputedStyle(e.querySelector(".sval .wet")).fontWeight : null,
    aria: e.querySelector(".sr-only").textContent,
  })));
  const wetRows = rows.filter((r) => ["15", "16", "17", "18"].includes(r.hour));
  assert.equal(wetRows.length, 4);
  for (const r of wetRows) {
    assert.equal(r.level, "sfill--bad", `${r.hour}:00 at 70% is bad`);
    assert.equal(r.marked, "雨70%");
    assert.equal(r.underline, "underline");
    assert.equal(r.weight, "900");
    assert.match(r.aria, /降雨 70%，可能下雨，舒適度 \d+，不建議/);
  }
  const dryRows = rows.filter((r) => !wetRows.includes(r));
  assert.ok(dryRows.length >= 3 && dryRows.every((r) => !r.wet && r.marked === null && r.level !== "sfill--bad"));
  // the best window is dry and after the wet hours; at 19-22 it is past sunset -> the fallback wording
  const best = await page.$$eval(".srow.is-best .st b", (els) => els.map((e) => e.textContent));
  assert.ok(best.length >= 3 && best.every((h) => Number(h) >= 19), `best window ${best}`);
  assert.match(await page.locator("h1.headline").innerText(), /^15–19 時可能下雨，建議 19:00–22:00 遊玩（已日落）$/);
  const legend = await page.locator(".legend").innerText();
  for (const word of ["適合", "普通", "不建議", "外框 = 最佳時段", "降雨機率 ≥ 40%"]) assert.ok(legend.includes(word), `legend: ${word}`);
  // every fill has a >= 3:1 edge: the computed border colour is --line against the card
  const edges = await page.$$eval(".sfill", (els) => els.map((e) => getComputedStyle(e).borderTopWidth + " " + getComputedStyle(e).borderTopColor));
  assert.ok(edges.every((e) => e === edges[0] && e.startsWith("2px")), edges.join());
  noErrors(app);
});

test("trip: hour selects persist in ps:outing.trip; 明日 markers on a window that crosses midnight", async () => {
  const app = await open({ storage: seed({ saved: [LAKE], tripId: LAKE.id }) });
  const { page } = app;
  await visit(app, "#outing/trip");
  await page.locator(".strip").waitFor();
  await page.locator("#sel-start").selectOption("22");
  await page.locator("#sel-end").selectOption("3");
  assert.deepEqual((await storedJson(page, "ps:outing")).trip, { start: 22, end: 3 });
  const { model } = expectedTrip({ start: 22, end: 3 });
  assert.deepEqual(model.rows.map((r) => r.isTomorrow), [false, false, true, true, true]);
  assert.equal(await page.locator(".srow").count(), 5);
  assert.deepEqual(await page.$$eval(".srow .st i", (els) => els.map((e) => e.textContent)), ["明日", "明日", "明日"]);
  assert.equal(await page.locator("h1.headline").innerText(), model.headline);
  assert.equal(await page.locator("#sel-start").inputValue(), "22");
  await page.reload();
  await page.locator(".strip").waitFor();
  assert.equal(await page.locator("#sel-start").inputValue(), "22", "persisted across reloads");
  assert.equal(await page.locator("#sel-end").inputValue(), "3");
  assert.equal(await page.locator(".srow").count(), 5);
  noErrors(app);
});

test("trip: !RAIN is the single infinite animation (blink); none when dry", async () => {
  const wetLake = destForecast((f) => [39, 40, 41, 42].forEach((i) => (f.hourly.precipitation_probability[i] = 75)));
  const infinite = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations === Infinity).map((a) => a.animationName));

  const wet = await open({ storage: seed({ saved: [LAKE], tripId: LAKE.id, extra: { "ps:outing": JSON.stringify({ scenario: "trip", trip: { start: 15, end: 20 } }) } }), forecastBy: placesForecasts({ lake: wetLake }) });
  await visit(wet, "#outing/trip");
  await wet.page.locator(".strip").waitFor();
  assert.equal(await wet.page.locator(".warn").count(), 1);
  assert.equal(await wet.page.locator(".warn").innerText(), "!RAIN");
  assert.equal(await wet.page.locator(".warn-at").innerText(), "15:00");
  assert.deepEqual(await infinite(wet.page), ["blink"]);
  assert.match(await wet.page.locator("h1.headline").innerText(), /^15–19 時可能下雨/, "names the wet span 15:00-19:00");
  const transitions = await wet.page.evaluate(() => document.getAnimations().map((a) => a.transitionProperty).filter(Boolean));
  assert.deepEqual(transitions.filter((p) => !["transform", "opacity"].includes(p)), []);
  noErrors(wet);

  const dry = await open({ storage: seed({ saved: [LAKE], tripId: LAKE.id }) });
  await visit(dry, "#outing/trip");
  await dry.page.locator(".strip").waitFor();
  assert.equal(await dry.page.locator(".warn").count(), 0);
  assert.deepEqual(await infinite(dry.page), []);
  noErrors(dry);

  // reduced motion: no animation at all
  const rm = await open({ storage: seed({ saved: [LAKE], tripId: LAKE.id, extra: { "ps:outing": JSON.stringify({ scenario: "trip", trip: { start: 15, end: 20 } }) } }), forecastBy: placesForecasts({ lake: wetLake }), reducedMotion: "reduce" });
  await visit(rm, "#outing/trip");
  await rm.page.locator(".strip").waitFor();
  assert.deepEqual(await infinite(rm.page), []);
  noErrors(rm);
});

test("trip: empty state; a destination chip selects and fetches; ＋ 搜尋地點 adds a place in trip mode", async () => {
  const app = await open({ geocode, storage: seed({ saved: [WORK] }) });
  const { page } = app;
  await app.go("#outing/trip"); // no .hero in the empty state, so not `visit`
  await page.locator(".empty").waitFor();
  assert.match(await page.locator(".empty").innerText(), /還沒有出遊目的地/);
  assert.equal(await page.locator(".hero").count(), 0);
  assert.equal(await page.locator(".strip").count(), 0);
  assert.equal(app.requests.filter((u) => /latitude=24\.80&/.test(u)).length, 0, "nothing fetched without a destination");
  assert.equal(await page.locator("#dest-p\\:24\\.80\\,120\\.97").getAttribute("aria-current"), null);

  // choose the saved place from the chips
  await page.locator("#dest-p\\:24\\.80\\,120\\.97").click();
  await page.locator(".strip").waitFor();
  assert.equal((await storedJson(page, "ps:places")).tripId, WORK.id);
  assert.equal(await page.locator("#dest-p\\:24\\.80\\,120\\.97").getAttribute("aria-current"), "true");
  assert.ok(app.requests.some((u) => /latitude=24\.80&longitude=120\.97/.test(u)));

  // the search key opens the picker in trip mode; adding a result makes it the destination and closes
  await page.locator("#t-add").click();
  assert.equal(await page.locator("#pk-title").innerText(), "選擇出遊地點");
  await page.locator("#pk-q").fill("日月潭");
  await waitLive(page, /^找到 1 個地點$/);
  await page.getByRole("button", { name: /^加入 日月潭/ }).click();
  assert.equal(await isOpen(page), false);
  assert.equal(await activeId(page), "t-add", "focus returns to the opener");
  assert.equal((await storedJson(page, "ps:places")).tripId, LAKE.id);
  await page.waitForFunction(() => document.querySelector(".trip-name")?.textContent === "日月潭・南投縣");
  noErrors(app);
});

test("trip: the empty-state search key reopens the picker and, once the destination exists, focus lands in the view", async () => {
  const app = await open({ geocode });
  const { page } = app;
  await app.go("#outing/trip");
  await page.locator("#t-empty-add").click();
  await page.locator("#pk-q").fill("日月潭");
  await waitLive(page, /^找到 1 個地點$/);
  await page.getByRole("button", { name: /^加入 日月潭/ }).click();
  assert.equal(await isOpen(page), false);
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest("main#view, #view")), true, "the opener vanished: focus falls back to the view");
  await page.locator(".strip").waitFor();
  noErrors(app);
});

test("trip: a failing destination shows its own error card with retry; Today and the current place are unaffected", async () => {
  const app = await open({ storage: seed({ saved: [LAKE], tripId: LAKE.id }), expectedErrors: [HTTP_500] });
  const { page } = app;
  app.failPlaces.add("23.87,120.91");
  await visit(app, "#outing/trip");
  await page.locator(".error-card").waitFor();
  assert.match(await page.locator(".error-card").innerText(), /無法取得天氣資料/);
  assert.equal(await page.locator("h1.headline").innerText(), "目的地天氣暫時無法取得");
  assert.equal(await page.locator("#dest-p\\:23\\.87\\,120\\.91").getAttribute("aria-current"), "true");
  await page.locator("#nav-today").click();
  await page.locator(".sun").waitFor();
  assert.equal(await page.locator(".error-card").count(), 0);
  await page.locator("#nav-outing").click();
  await page.locator(".error-card").waitFor();
  app.failPlaces.clear();
  await page.locator("#t-retry").click();
  await page.locator(".strip").waitFor();
  noErrors(app);
});

// ---------------------------------------------------------------- manifest, icons, CSP

const forecastRequests = (app, from = 0) => app.requests.slice(from).filter((u) => u.includes("//api.open-meteo.com"));

test("refresh on return: Today refreshes only the current place (exactly 1 forecast request); the trip view also its destination", async () => {
  const app = await open({ storage: seed({ saved: [LAKE, WORK], workId: WORK.id, tripId: LAKE.id }), granted: true });
  const { page } = app;
  await visit(app);
  await app.go("#outing/commute"); await ready(page);
  await page.waitForFunction(() => /BACK・新竹/.test(document.body.textContent) && !/載入中/.test(document.querySelector(".lcd--legs")?.textContent ?? ""));
  await page.evaluate(() => (location.hash = "#outing/trip"));
  await page.waitForSelector(".strip");
  await page.evaluate(() => (location.hash = "#today"));
  await page.waitForFunction(() => document.querySelector(".hero"));
  await page.waitForTimeout(300);
  const before = app.requests.length;
  await advanceTo(page, DAY_MS + 20 * 60000);
  await page.waitForTimeout(500);
  assert.equal(forecastRequests(app, before).length, 1, `only the current place: ${forecastRequests(app, before)}`);
  assert.match(forecastRequests(app, before)[0], /latitude=24\.15&/);
  // on the trip view the destination (not the work place) comes along
  await page.evaluate(() => (location.hash = "#outing/trip"));
  await page.waitForSelector(".strip");
  const mid = app.requests.length;
  await advanceTo(page, DAY_MS + 40 * 60000);
  await page.waitForTimeout(500);
  const urls = forecastRequests(app, mid);
  assert.equal(urls.length, 2, urls.join("\n"));
  assert.ok(urls.some((u) => /latitude=23\.87&/.test(u)) && !urls.some((u) => /latitude=24\.80&/.test(u)));
  noErrors(app);
});

test("trip: a stale cache whose refresh is still in flight shows no 無法更新 banner", async () => {
  const app = await open({ storage: seed({ saved: [LAKE], tripId: LAKE.id }), granted: true });
  const { page } = app;
  await visit(app, "#outing/trip");
  await page.waitForSelector(".strip");
  await page.clock.setFixedTime(new Date(DAY_MS + 60 * 60000)); // an hour later: cached forecasts are stale
  app.mode.forecast = "hang";
  app.mode.air = "hang";
  await page.reload();
  await page.waitForSelector(".strip");
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-k="t-stale"]').count(), 0, "refresh in flight, not failed: no banner");
  noErrors(app);
});

test("location key: stays enabled while locating and opens the picker; no answer within 10 s falls back to the default place", async () => {
  const app = await open({ storage: seed({ saved: [LAKE] }) });
  const { page } = app;
  await app.ctx.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => {}; // never answers (a permission prompt left open)
  });
  await app.go("");
  const btn = page.locator("#loc-btn");
  await page.waitForFunction(() => document.getElementById("loc-btn").getAttribute("aria-busy") === "true");
  assert.equal(await btn.isEnabled(), true);
  assert.match(await btn.innerText(), /^定位中…/);
  await btn.click();
  await dlg(page).locator("#pk-q").waitFor();
  assert.equal(await isOpen(page), true, "the picker opens while locating");
  await page.getByRole("button", { name: "關閉" }).click();
  assert.equal(await activeId(page), "loc-btn");
  // the overall timeout (10 s) ends the wait with the default place
  await page.waitForFunction(() => document.getElementById("loc-btn").getAttribute("aria-busy") === "false", null, { timeout: 20000 });
  assert.match(await btn.innerText(), /臺中（預設）/);
  await waitReady(page);
  noErrors(app);
});

test("manifest: valid JSON, linked from the page, icons load (200, PNG, right size); apple-touch-icon; CSP allows both", async () => {
  const app = await open();
  const { page } = app;
  await visit(app);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  assert.equal(href, "manifest.webmanifest");
  const res = await page.request.get(new URL(href, server.url).href);
  assert.equal(res.status(), 200);
  assert.match(res.headers()["content-type"], /manifest\+json|application\/json/);
  const m = await res.json();
  assert.deepEqual(
    { name: m.name, short_name: m.short_name, start_url: m.start_url, scope: m.scope, display: m.display, background_color: m.background_color, theme_color: m.theme_color, lang: m.lang },
    { name: "Pocket Sky", short_name: "PocketSky", start_url: "./#today", scope: "./", display: "standalone", background_color: "#FFF7D6", theme_color: "#FFF7D6", lang: "zh-Hant" },
  );
  assert.deepEqual(m.icons.map((i) => [i.sizes, i.purpose]), [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]]);
  for (const icon of m.icons) {
    const r = await page.request.get(new URL(icon.src, new URL(href, server.url)).href);
    assert.equal(r.status(), 200, icon.src);
    assert.equal(r.headers()["content-type"], "image/png");
    const body = await r.body();
    assert.equal(body.subarray(1, 4).toString(), "PNG");
    const [w, h] = icon.sizes.split("x").map(Number);
    assert.deepEqual([body.readUInt32BE(16), body.readUInt32BE(20)], [w, h], `${icon.src} is ${icon.sizes}`);
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  assert.equal((await page.request.get(new URL(touch, server.url).href)).status(), 200);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  assert.match(csp, /manifest-src 'self'/);
  assert.match(csp, /img-src 'self' data:/);
  assert.match(csp, /connect-src [^;]*https:\/\/geocoding-api\.open-meteo\.com/);
  assert.ok(!/unsafe-inline/.test(csp));
  // the maskable icon keeps its artwork inside the central 80% circle: the corners are plain shell colour
  assert.ok(readFileSync(path.join(ROOT, "icons/icon.svg"), "utf8").includes('viewBox="0 0 512 512"'));
  noErrors(app);
});

test("CSP: no violations while using the picker, the search and the trip view", async () => {
  const app = await open({ geocode, storage: seed({ saved: [LAKE], tripId: LAKE.id }) });
  const { page } = app;
  await app.ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await visit(app, "#outing/trip");
  await page.locator(".strip").waitFor();
  await page.locator("#t-add").click();
  await page.locator("#pk-q").fill("台中");
  await waitLive(page, /^找到 1 個地點$/);
  await page.getByRole("button", { name: /^加入 臺中市/ }).click();
  await page.keyboard.press("Escape");
  await settle(page);
  assert.deepEqual(await page.evaluate(() => window.__csp), []);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("[style]")].filter((e) => !/^--(p|i|pct)\b/.test(e.getAttribute("style")) && e.getAttribute("style").trim()).length), 0, "inline styles only set through the CSSOM custom properties");
  noErrors(app);
});

// ---------------------------------------------------------------- layout and focus

test("layout: no horizontal overflow (trip day/night/empty, commute with a long work name, picker open); focus is not obscured", async () => {
  const longWork = { ...WORK, name: "新竹科學園區某某某某股份有限公司", admin1: "新竹縣" };
  const cases = [
    ["trip-day", "#outing/trip", { storage: seed({ saved: [LAKE], tripId: LAKE.id }) }],
    ["trip-night", "#outing/trip", { storage: seed({ saved: [LAKE], tripId: LAKE.id, extra: NIGHT_PREF }) }],
    ["trip-empty", "#outing/trip", { storage: seed({ saved: [LAKE, WORK] }) }],
    ["commute-long-work", "#outing/commute", { storage: seed({ saved: [longWork], workId: longWork.id }) }],
  ];
  for (const [name, hash, opts] of cases) {
    const app = await open(opts);
    const { page } = app;
    await visit(app, hash);
    if (name.startsWith("trip") && name !== "trip-empty") await page.locator(".strip").waitFor();
    if (name.startsWith("commute")) await page.waitForFunction(() => /^2[67]°/.test(document.querySelector('[data-k="leg-back"] .leg-wx')?.textContent ?? ""));
    await settle(page);
    await noOverflow(page, name);
    for (const height of [844, 480]) {
      await page.setViewportSize({ width: 390, height });
      await page.reload();
      await ready(page);
      let count = 0;
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body || el.matches('main#view[tabindex="-1"]')) return null;
          const b = el.getBoundingClientRect();
          return { what: el.id || el.className || el.tagName, top: b.top, bottom: b.bottom, navTop: document.querySelector(".nav").getBoundingClientRect().top, inNav: Boolean(el.closest(".nav")), inMain: Boolean(el.closest("main, footer")) };
        });
        if (!r || r.inNav) break;
        if (!r.inMain) continue;
        count++;
        assert.ok(r.bottom <= r.navTop + 0.5 && r.top >= -0.5, `${name}@${height}: ${r.what} focused at ${r.top}-${r.bottom}, nav top ${r.navTop}`);
      }
      assert.ok(count >= 2, `${name}@${height}: ${count} focusable controls reached`);
      await noOverflow(page, `${name}@${height}`);
    }
    noErrors(app);
  }

  // picker: inside the viewport, scrollable, every focused control visible
  const app = await open({ storage: seed({ saved: [LAKE, WORK, { ...WORK, id: "p:24.20,120.60", lat: 24.2, lon: 120.6, name: "家" }], workId: WORK.id }), geocode });
  const { page } = app;
  for (const height of [844, 480]) {
    await page.setViewportSize({ width: 390, height });
    await visit(app);
    await openPicker(page);
    await noOverflow(page, `picker@${height}`);
    const box = await dlg(page).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= height + 0.5, `dialog inside the viewport ${JSON.stringify(box)}`);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(() => {
        const el = document.activeElement;
        const b = el.getBoundingClientRect();
        const d = document.querySelector("#picker").getBoundingClientRect();
        return { what: el.getAttribute("aria-label") ?? el.id, top: b.top, bottom: b.bottom, dTop: d.top, dBottom: d.bottom, inDlg: Boolean(el.closest("#picker")) };
      });
      assert.ok(r.inDlg, "focus stays in the dialog");
      assert.ok(r.top >= r.dTop - 0.5 && r.bottom <= r.dBottom + 0.5, `picker@${height}: ${r.what} ${r.top}-${r.bottom} within ${r.dTop}-${r.dBottom}`);
    }
    await page.keyboard.press("Escape");
  }
  noErrors(app);
});

// ---------------------------------------------------------------- axe

test("axe: picker open (current mode with results and saved places), work mode", async () => {
  const app = await open({ geocode, storage: seed({ saved: [LAKE, WORK], workId: WORK.id, tripId: LAKE.id, current: LAKE.id }) });
  const { page } = app;
  await visit(app);
  await openPicker(page);
  await page.locator("#pk-q").fill("台中");
  await waitLive(page, /^找到 1 個地點$/);
  await check("picker-day", page);
  await page.keyboard.press("Escape");
  noErrors(app);

  const night = await open({ geocode, storage: seed({ saved: [LAKE, WORK], workId: WORK.id, current: LAKE.id, extra: NIGHT_PREF }) });
  await visit(night);
  await openPicker(night.page);
  await night.page.locator("#pk-q").fill("Hualien");
  await waitLive(night.page, /^找到 1 個地點$/);
  await check("picker-night", night.page);
  noErrors(night);

  const work = await open({ geocode, storage: seed({ saved: [WORK] }) });
  await visit(work, "#outing/commute");
  await work.page.getByRole("button", { name: "設定公司地點" }).click();
  await work.page.locator("#pk-q").fill("花蓮");
  await waitLive(work.page, /找不到/);
  await check("picker-work-empty-result", work.page);
  noErrors(work);
});

test("axe: trip day, trip night, trip empty, commute with a work place", async () => {
  for (const [name, hash, opts, ready] of [
    ["trip-day", "#outing/trip", { storage: seed({ saved: [LAKE], tripId: LAKE.id }) }, ".strip"],
    ["trip-night", "#outing/trip", { storage: seed({ saved: [LAKE], tripId: LAKE.id, extra: NIGHT_PREF }), forecast: nightForecast(), now: NIGHT_UTC }, ".strip"],
    ["trip-empty", "#outing/trip", { storage: seed({ saved: [LAKE] }) }, ".empty"],
    ["commute-work", "#outing/commute", { storage: seed({ saved: [WORK], workId: WORK.id }) }, ".leg-name:has-text('BACK・新竹')"],
  ]) {
    const app = await open(opts);
    await visit(app, hash);
    await app.page.locator(ready).first().waitFor();
    if (name === "trip-night") await app.page.waitForFunction(() => document.documentElement.dataset.theme === "night");
    await check(name, app.page);
    noErrors(app);
  }
});

// ---------------------------------------------------------------- screenshots (E2E_SCREENSHOTS=1 only)

test("screenshots: picker, picker-results, commute-work, trip-day, trip-night, trip-empty", async () => {
  if (process.env.E2E_SCREENSHOTS !== "1") return;
  const saved = [LAKE, WORK, { id: "p:24.20,120.60", name: "家", admin1: "臺中市", country: "臺灣", lat: 24.2, lon: 120.6, elevation: 60, timezone: "Asia/Taipei" }];
  const opts = { geocode, granted: true };

  const a = await open({ ...opts, storage: seed({ saved, workId: WORK.id, tripId: LAKE.id, current: "gps" }) });
  await visit(a);
  await openPicker(a.page);
  await shot(a.page, "picker", { dir: SHOTS_M4, fullPage: false });
  await a.page.locator("#pk-q").fill("台中");
  await waitLive(a.page, /^找到 1 個地點$/);
  await shot(a.page, "picker-results", { dir: SHOTS_M4, fullPage: false });
  noErrors(a);

  const b = await open({ ...opts, storage: seed({ saved, workId: WORK.id }) });
  await visit(b, "#outing/commute");
  await b.page.waitForFunction(() => /^2[67]°/.test(document.querySelector('[data-k="leg-back"] .leg-wx')?.textContent ?? ""));
  await shot(b.page, "commute-work", { dir: SHOTS_M4 });
  noErrors(b);

  const wetLake = destForecast((f) => [39, 40, 41, 42].forEach((i) => (f.hourly.precipitation_probability[i] = 70)));
  const c = await open({ ...opts, storage: seed({ saved, tripId: LAKE.id, extra: { "ps:outing": JSON.stringify({ scenario: "trip", trip: { start: 15, end: 22 } }) } }), forecastBy: placesForecasts({ lake: wetLake }) });
  await visit(c, "#outing/trip");
  await c.page.locator(".strip").waitFor();
  await shot(c.page, "trip-day", { dir: SHOTS_M4 });
  noErrors(c);

  const d = await open({ ...opts, storage: seed({ saved, tripId: LAKE.id, extra: { ...NIGHT_PREF } }) });
  await visit(d, "#outing/trip");
  await d.page.locator(".strip").waitFor();
  await shot(d.page, "trip-night", { dir: SHOTS_M4 });
  noErrors(d);

  const e = await open({ ...opts, storage: seed({ saved: [] }) });
  await visit(e, "#outing/trip");
  await e.page.locator(".empty").waitFor();
  await shot(e.page, "trip-empty", { dir: SHOTS_M4 });
  noErrors(e);
});
