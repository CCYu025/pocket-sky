import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import {
  launch, openApp, waitReady, settle, shot, overflow, runAxe, advanceTo, SHOTS_M3,
  dayForecast, nightForecast, showersForecast, rainyEveningForecast, lateForecast, airFixture, DAY_MS, LATE_MS, LATE_UTC, NIGHT_UTC,
} from "./helpers.mjs";
import { toViewModel } from "../../js/domain/derive.js";
import { commuteModel } from "../../js/ui/views/commute.js";
import { exerciseModel, slotLabel } from "../../js/ui/views/exercise.js";

let server;
let browser;
const apps = [];
const AXE_CSS_FETCH = /Connecting to 'https:\/\/fonts\.googleapis\.com\/css2.*connect-src/;

before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(opts = {}) {
  const app = await openApp(browser, server.url, { ...opts, expectedErrors: [AXE_CSS_FETCH, ...(opts.expectedErrors ?? [])] });
  apps.push(app);
  return app;
}
const noErrors = (app) => assert.deepEqual(app.errors, [], "no console errors or page errors");
const vmOf = (forecast, nowMs) => toViewModel({ forecast, air: airFixture(), nowMs });
const norm = (t) => t.replace(/\s+/g, " ").trim();
const NIGHT_PREF = { "ps:theme": "night" };

async function noOverflow(page, label = "") {
  const o = await overflow(page);
  assert.ok(o.scrollWidth <= o.clientWidth, `${label} horizontal overflow: ${o.scrollWidth} > ${o.clientWidth}`);
}
/** Open a scenario and wait until it has data. */
async function visit(app, hash) {
  await app.go(hash);
  await waitReady(app.page);
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ps:outing")));
const live = (page) => page.locator("#live").textContent();

/** Snapshot of the exercise bars. */
const barState = (page) => page.$$eval(".xbar", (els) => els.map((e) => ({ id: e.id, hk: e.dataset.hk, label: e.getAttribute("aria-label"), pressed: e.getAttribute("aria-pressed") })));
const pressedIndex = async (page) => (await barState(page)).findIndex((b) => b.pressed === "true");
const lcd = async (page) => ({
  time: await page.locator('.x-time [role="img"]').getAttribute("aria-label"),
  score: await page.locator('.x-score [role="img"]').getAttribute("aria-label"),
  verdict: await page.locator(".verdict").innerText(),
  advice: await page.locator(".advice").innerText(),
});
const metricsOf = (page) => page.$$eval(".metric", (els) => els.map((e) => ({ k: e.querySelector(".k").textContent, v: e.querySelector(".v").textContent })));
/** Checklist rows: id, on, label, why, tags. */
const checklist = (page) =>
  page.$$eval(".check-item", (els) =>
    els.map((e) => ({
      id: e.dataset.k.replace("item-", ""),
      on: e.classList.contains("is-on"),
      label: e.querySelector(".check-name").childNodes[0].textContent,
      why: e.querySelector(".check-why").textContent,
      tags: [...e.querySelectorAll(".tag")].map((t) => t.textContent),
    })),
  );

// ---------------------------------------------------------------- routing

test("routes: #outing opens the last scenario; chips are links, 出遊 is disabled; persisted in ps:outing", async () => {
  const app = await open();
  const { page } = app;
  await visit(app, "#outing");
  // default: commute
  assert.equal(await page.locator(".chips").getAttribute("aria-label"), "情境");
  assert.deepEqual(await page.$$eval(".chips a", (a) => a.map((x) => [x.getAttribute("href"), x.textContent])), [["#outing/commute", "通勤"], ["#outing/exercise", "運動"]]);
  assert.equal(await page.locator(".chip--commute").getAttribute("aria-current"), "page");
  assert.equal(await page.locator(".chip--exercise").getAttribute("aria-current"), null);
  assert.equal(await page.locator("#nav-outing").getAttribute("aria-current"), "page");
  await page.locator(".lcd--legs").waitFor();

  const trip = page.locator(".chip--trip");
  assert.equal(await trip.evaluate((el) => el.tagName), "SPAN", "non-interactive element");
  assert.equal(await trip.getAttribute("aria-disabled"), "true");
  assert.equal(await trip.getAttribute("href"), null);
  assert.equal(await trip.getAttribute("tabindex"), null);
  assert.equal(norm(await trip.innerText()), "出遊 v2");
  await trip.click({ force: true }); // aria-disabled: Playwright's actionability check would wait forever
  assert.equal(await page.evaluate(() => location.hash), "#outing");

  await page.locator(".chip--exercise").click();
  assert.equal(await page.evaluate(() => location.hash), "#outing/exercise");
  await page.locator("#x-range").waitFor();
  assert.equal(await page.locator(".chip--exercise").getAttribute("aria-current"), "page");
  assert.equal(await page.locator(".chip--commute").getAttribute("aria-current"), null);
  assert.equal(await page.locator("#nav-outing").getAttribute("aria-current"), "page", "外出 stays current for every scenario");
  assert.deepEqual(await stored(page), { scenario: "exercise", commute: { out: 8, back: 18 } });

  // bottom key 外出 reopens the last scenario
  await page.locator("#nav-today").click();
  await page.locator(".sun").waitFor();
  assert.equal(await page.locator(".chips").count(), 0);
  await page.locator("#nav-outing").click();
  assert.equal(await page.evaluate(() => location.hash), "#outing");
  await page.locator("#x-range").waitFor();
  assert.equal(await page.locator("#nav-outing").getAttribute("aria-current"), "page");

  // direct hashes; an unknown scenario falls back to the last one
  await page.goto(`${server.url}#outing/commute`);
  await page.locator(".lcd--legs").waitFor();
  assert.equal((await stored(page)).scenario, "commute");
  await page.goto(`${server.url}#outing/exercise`);
  await page.locator("#x-range").waitFor();
  await page.goto(`${server.url}#outing/nonsense`);
  await page.locator("#x-range").waitFor();
  assert.equal(await page.locator(".chip--exercise").getAttribute("aria-current"), "page");

  // back/forward between scenarios
  await page.locator(".chip--commute").click();
  await page.locator(".lcd--legs").waitFor();
  await page.goBack(); // #outing/nonsense: falls back to the last used scenario (commute)
  await page.locator(".lcd--legs").waitFor();
  await page.goBack(); // #outing/exercise
  await page.locator("#x-range").waitFor();
  assert.equal((await stored(page)).scenario, "exercise");

  // everything above reused the Today data: one forecast + one air request
  assert.equal(app.requests.length, 2, app.requests.join("\n"));
  noErrors(app);

  // a fresh load of plain #outing reopens the persisted scenario
  await page.goto(`${server.url}#today`);
  await page.reload();
  await page.goto(`${server.url}#outing`);
  await page.locator("#x-range").waitFor();
  noErrors(app);
});

test("invalid ps:outing falls back to the defaults", async () => {
  const app = await open({ storage: { "ps:outing": '{"scenario":"trip","commute":{"out":99,"back":"x"}}' } });
  await visit(app, "#outing");
  assert.equal(await app.page.locator("#sel-out").inputValue(), "8");
  assert.equal(await app.page.locator("#sel-back").inputValue(), "18");
  assert.equal(await app.page.locator(".chip--commute").getAttribute("aria-current"), "page");
  noErrors(app);
});

// ---------------------------------------------------------------- commute

test("commute: rainy evening drives !RAIN on BACK, umbrella + jacket, leg attribution and headline", async () => {
  const forecast = rainyEveningForecast();
  const app = await open({ forecast });
  const { page } = app;
  await visit(app, "#outing/commute");
  const model = commuteModel(vmOf(forecast, DAY_MS), { out: 8, back: 18 });

  assert.equal(await page.locator("h1").innerText(), "傍晚回家會遇到雨");
  assert.equal(model.headline, "傍晚回家會遇到雨");
  assert.equal(norm(await page.locator(".note").innerText()), "出門與回家使用目前位置（M4 可設定公司地點）");
  assert.equal(await page.locator('[data-k="leg-out"] [role="img"]').first().getAttribute("aria-label"), "明日 出門 08:00");
  assert.equal(await page.locator('[data-k="leg-back"] .leg-time [role="img"]').getAttribute("aria-label"), "回家 18:00");
  assert.equal(norm(await page.locator('[data-k="leg-out"] .leg-top').innerText()), "OUT 明日");
  assert.equal(norm(await page.locator('[data-k="leg-back"] .leg-top').innerText()), "BACK !RAIN");
  assert.equal(await page.locator('[data-k="leg-out"] .warn').count(), 0);
  assert.equal(await page.locator('[data-k="leg-back"] .warn').count(), 1);
  assert.equal(await page.locator('[data-k="leg-back"] .leg-detail').innerText(), "雨 60%・風 18 km/h");
  assert.equal(await page.locator('[data-k="leg-back"] .leg-wx').innerText(), model.legs[1].wx);
  assert.match(model.legs[1].wx, /^17° /);

  const items = await checklist(page);
  assert.deepEqual(items.slice(0, 3).map((i) => [i.label, i.on]), [["雨傘", true], ["外套", true], ["防曬", false]]);
  assert.equal(items[3].label, "口罩");
  assert.deepEqual(items.map((i) => ({ on: i.on, why: i.why, tags: i.tags })), model.items.map((i) => ({ on: i.on, why: i.why, tags: i.tags })));
  assert.equal(items[0].why, "18:00 降雨機率 60%（≥ 40% 建議）");
  assert.deepEqual(items[0].tags, ["回家 18:00"], "umbrella: only the BACK leg");
  assert.deepEqual(items[1].tags, ["出門 08:00", "回家 18:00"], "jacket: both legs are cold");
  assert.equal(items[2].why, "通勤時段紫外線低");
  assert.deepEqual(items[2].tags, []);
  // accessible state text for each row
  assert.equal(await page.locator(".check-item").first().locator(".sr-only").textContent(), "，建議攜帶");
  assert.equal(await page.locator(".check-item").nth(2).locator(".sr-only").textContent(), "，不需要");

  // selectors: native <select> with visible labels, >= 44px
  for (const [id, label, value] of [["sel-out", "出門時間", "8"], ["sel-back", "回家時間", "18"]]) {
    assert.equal(await page.locator(`label[for="${id}"]`).innerText(), label);
    assert.equal(await page.locator(`#${id}`).inputValue(), value);
    assert.equal(await page.locator(`#${id} option`).count(), 24);
    assert.ok((await page.locator(`#${id}`).boundingBox()).height >= 44);
  }
  assert.equal(await page.locator("#sel-out option").first().innerText(), "00:00");

  await noOverflow(page, "commute rain");
  await shot(page, "commute-rain", { dir: SHOTS_M3 });
  await shot(page, "commute-viewport", { dir: SHOTS_M3, fullPage: false });
  noErrors(app);
});

test("commute: day fixture renders, screenshot", async () => {
  const forecast = dayForecast();
  const app = await open({ forecast });
  await visit(app, "#outing/commute");
  const model = commuteModel(vmOf(forecast, DAY_MS), { out: 8, back: 18 });
  assert.equal(await app.page.locator("h1").innerText(), model.headline);
  assert.equal(await app.page.locator(".warn").count(), 0, "no !RAIN on a dry day");
  assert.equal((await checklist(app.page)).find((i) => i.id === "umbrella").on, false);
  await noOverflow(app.page, "commute day");
  await shot(app.page, "commute-day", { dir: SHOTS_M3 });
  noErrors(app);
});

test("commute: selectors change the legs and the checklist; persisted; in place", async () => {
  const app = await open({ forecast: rainyEveningForecast() });
  const { page } = app;
  await visit(app, "#outing/commute");
  await page.evaluate(() => {
    window.__hero = document.querySelector(".hero");
    window.__list = document.querySelector(".checklist");
  });

  await page.focus("#sel-back");
  await page.selectOption("#sel-back", "21");
  assert.equal(await page.locator('[data-k="leg-back"] .leg-time [role="img"]').getAttribute("aria-label"), "回家 21:00");
  assert.equal(await page.locator(".warn").count(), 0, "21:00-22:00 is dry");
  assert.equal((await checklist(page))[0].on, false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "sel-back", "focus stays on the select");
  assert.equal(await page.evaluate(() => window.__hero === document.querySelector(".hero") && window.__list === document.querySelector(".checklist")), true, "reconciled in place");
  assert.deepEqual(await stored(page), { scenario: "commute", commute: { out: 8, back: 21 } });

  await page.selectOption("#sel-back", "18");
  await page.selectOption("#sel-out", "12"); // tomorrow noon: warm
  assert.equal(norm(await page.locator('[data-k="leg-out"] .leg-top').innerText()), "OUT 明日");
  const items = await checklist(page);
  assert.deepEqual(items[0].tags, ["回家 18:00"]);
  assert.deepEqual(items[1].tags, ["回家 18:00"], "jacket attributed to the BACK leg only");
  assert.equal(await page.locator("h1").innerText(), "傍晚回家會遇到雨");

  await page.selectOption("#sel-out", "14"); // the current hour is today's
  assert.equal(norm(await page.locator('[data-k="leg-out"] .leg-top').innerText()), "OUT");
  assert.equal(await page.locator('[data-k="leg-out"] .leg-time [role="img"]').getAttribute("aria-label"), "出門 14:00");

  // both legs wet: 18 out, 18 back share the same hours -> both tags and the "both" headline
  await page.selectOption("#sel-out", "18");
  assert.equal(await page.locator("h1").innerText(), "來回都可能下雨");
  assert.deepEqual((await checklist(page))[0].tags, ["出門 18:00", "回家 18:00"]);
  assert.equal(await page.locator(".warn").count(), 2);

  await page.reload();
  await waitReady(page);
  assert.equal(await page.locator("#sel-out").inputValue(), "18");
  assert.equal(await page.locator("#sel-back").inputValue(), "18");
  noErrors(app);
});

// ---------------------------------------------------------------- exercise

test("exercise: default selects the best slot; bars, LCD, metrics, slider and best key", async () => {
  const forecast = showersForecast(); // good, ok and bad bars
  const app = await open({ forecast });
  const { page } = app;
  await visit(app, "#outing/exercise");
  const model = exerciseModel(vmOf(forecast, DAY_MS), DAY_MS, null);
  assert.equal(model.slots.length, 12, "14:00 .. 01:00 tomorrow (next 12 hours)");

  const bars = await barState(page);
  assert.equal(bars.length, 12);
  for (const [i, s] of model.slots.entries()) {
    assert.equal(bars[i].label, slotLabel(s));
    assert.match(bars[i].label, /^(明日 )?\d{2}:00，評分 \d+，(適合|普通|不建議)$/);
  }
  assert.equal(bars.filter((b) => b.pressed === "true").length, 1);
  assert.equal(bars[await pressedIndex(page)].hk, model.best.hourKey, "default = best slot");
  assert.equal(await page.locator("button.xbar").count(), 12, "bars are <button>s");

  const hh = String(model.best.hour).padStart(2, "0");
  assert.deepEqual(await lcd(page), { time: `時間 ${hh}:00`, score: `評分 ${model.best.score}`, verdict: model.verdict, advice: model.advice });
  assert.equal(await page.locator(".best").innerText(), `最佳 ${hh}:00`);
  assert.deepEqual(await metricsOf(page), model.metrics);
  assert.equal((await metricsOf(page)).length, 6);
  assert.equal(norm(await page.locator(".picker .note").innerText()), "現在 14:20・從 14:00 起算・未來 12 小時");

  // slider: visible label, one step per slot
  assert.match(await page.locator('label[for="x-range"]').innerText(), /^滑桿選時間・\d{2}:00$/);
  assert.equal(await page.locator("#x-range").getAttribute("max"), "11");
  assert.equal(await page.locator("#x-range").inputValue(), String(model.index));
  assert.equal(await page.locator("#x-range").getAttribute("aria-valuetext"), slotLabel(model.best));
  assert.ok((await page.locator("#x-range").boundingBox()).height >= 44);
  // bar tap area >= 44 px tall
  assert.ok((await page.locator(".xbar").first().boundingBox()).height >= 44);
  assert.ok((await page.locator(".xbar").first().boundingBox()).width >= 24);

  // level colours: good bars are --ink, bad bars use --alert, the rest are neutral
  assert.deepEqual([...new Set(model.slots.map((s) => s.level))].sort(), ["bad", "good", "ok"], "fixture shows all three levels");
  const fills = await page.$$eval(".xbar", (els) => els.map((e) => [e.className, getComputedStyle(e.querySelector(".xfill")).backgroundColor]));
  for (const [cls, bg] of fills) {
    if (cls.includes("xbar--good")) assert.equal(bg, "rgb(0, 0, 0)");
    if (cls.includes("xbar--bad")) assert.equal(bg, "rgb(255, 107, 154)");
  }
  // sizing goes through the CSSOM (CSP): --p is the score
  assert.deepEqual(
    await page.$$eval(".xfill", (els) => els.map((e) => e.style.getPropertyValue("--p"))),
    model.slots.map((s) => String(s.score)),
  );

  await noOverflow(page, "exercise day");
  await shot(page, "exercise-day", { dir: SHOTS_M3 });
  await shot(page, "exercise-viewport", { dir: SHOTS_M3, fullPage: false });

  // ---- tapping a bar updates the LCD and metrics in place
  await page.evaluate(() => {
    window.__lcd = document.querySelector(".lcd");
    window.__bar = document.querySelector(".xbar");
    window.__metric = document.querySelector(".metric");
  });
  const other = model.slots.findIndex((s) => s !== model.best);
  await page.locator(".xbar").nth(other).click();
  const picked = model.slots[other];
  assert.equal(await pressedIndex(page), other);
  assert.equal((await lcd(page)).time, `時間 ${String(picked.hour).padStart(2, "0")}:00`);
  assert.equal((await lcd(page)).score, `評分 ${picked.score}`);
  assert.deepEqual(await metricsOf(page), exerciseModel(vmOf(forecast, DAY_MS), DAY_MS, picked.hourKey).metrics);
  assert.equal(await page.locator("#x-range").inputValue(), String(other), "slider follows the bar");
  assert.equal(await page.evaluate(() => window.__lcd === document.querySelector(".lcd") && window.__bar === document.querySelector(".xbar") && window.__metric === document.querySelector(".metric")), true, "no full re-render");
  assert.match(await page.locator(".x-time").getAttribute("class"), /flip-a/, "digit flip on the first change");
  assert.match(await page.locator(".x-score").getAttribute("class"), /flip-a/);
  const flip = await page.evaluate(() => document.getAnimations().map((a) => a.animationName).filter((n) => /^flip/.test(n)));
  assert.deepEqual(flip, ["flipA", "flipA"]);

  // ---- slider
  await page.locator("#x-range").fill("7");
  assert.equal(await pressedIndex(page), 7);
  assert.equal((await lcd(page)).time, `時間 ${String(model.slots[7].hour).padStart(2, "0")}:00`);
  assert.match(await page.locator(".x-time").getAttribute("class"), /flip-b/, "alternating class restarts the flip");
  assert.equal(await page.locator('label[for="x-range"]').innerText(), `滑桿選時間・${String(model.slots[7].hour).padStart(2, "0")}:00`);

  // slider property must follow a later bar tap even after the user dragged it
  await page.locator(".xbar").nth(1).click();
  assert.equal(await page.locator("#x-range").evaluate((el) => el.value), "1");

  // ---- best key
  await page.locator(".best").click();
  assert.equal(await pressedIndex(page), model.index);
  assert.equal((await lcd(page)).score, `評分 ${model.best.score}`);
  assert.equal(await page.locator("#x-range").evaluate((el) => el.value), String(model.index));
  noErrors(app);
});

test("exercise: keyboard Left/Right (and Home/End) move the selection and focus", async () => {
  const app = await open({ forecast: dayForecast() });
  const { page } = app;
  await visit(app, "#outing/exercise");
  const active = () => page.evaluate(() => document.activeElement.id);
  const ids = (await barState(page)).map((b) => b.id);

  await page.locator(".xbar").nth(3).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await pressedIndex(page), 4);
  assert.equal(await active(), ids[4], "focus follows the selection");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await pressedIndex(page), 2);
  assert.equal(await active(), ids[2]);
  await page.keyboard.press("Home");
  assert.equal(await pressedIndex(page), 0);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await pressedIndex(page), 0, "clamped at the start");
  await page.keyboard.press("End");
  assert.equal(await pressedIndex(page), ids.length - 1);
  await page.keyboard.press("ArrowRight");
  assert.equal(await pressedIndex(page), ids.length - 1, "clamped at the end");
  assert.equal(await active(), ids.at(-1));
  assert.equal((await lcd(page)).time, "時間 明日 01:00");
  // Tab still leaves the bars normally
  await page.keyboard.press("Tab");
  assert.notEqual(await active(), ids.at(-1));
  noErrors(app);
});

test("exercise at 22:30: the next 12 hours run to 09:00 tomorrow with 明日 markers", async () => {
  const forecast = lateForecast();
  const app = await open({ forecast, now: LATE_UTC });
  const { page } = app;
  await visit(app, "#outing/exercise");
  const model = exerciseModel(vmOf(forecast, LATE_MS), LATE_MS, null);
  assert.equal(model.slots.length, 12, "22:00 .. 09:00 tomorrow");
  const bars = await barState(page);
  assert.equal(bars.length, 12);
  assert.deepEqual(bars.map((b) => b.label), model.slots.map(slotLabel));
  assert.equal(bars[0].label.startsWith("22:00，"), true);
  assert.equal(bars[2].label.startsWith("明日 00:00，"), true);
  assert.equal(bars.at(-1).label.startsWith("明日 09:00，"), true);
  assert.equal(await page.locator(".xt i").count(), 10);
  assert.equal(await page.locator(".xt i").first().innerText(), "明日");
  assert.deepEqual(await page.$$eval(".xt b", (b) => b.map((x) => x.textContent)), ["22", "23", "00", "01", "02", "03", "04", "05", "06", "07", "08", "09"]);
  assert.equal(await page.locator("#x-range").getAttribute("max"), "11");
  assert.equal(norm(await page.locator(".picker .note").innerText()), "現在 22:30・從 22:00 起算・未來 12 小時");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "night", "auto theme after sunset");
  // selecting a tomorrow slot shows the marker in the LCD
  await page.locator(".xbar").nth(4).click();
  assert.equal((await lcd(page)).time, "時間 明日 02:00");
  assert.match(await page.locator(".lcd-top").innerText(), /TIME 明日/);
  await page.locator(".best").click();
  assert.equal(bars[await pressedIndex(page)].hk, model.best.hourKey);
  await noOverflow(page, "exercise late");
  await shot(page, "exercise-late", { dir: SHOTS_M3 });
  noErrors(app);
});

test("exercise: night theme screenshot", async () => {
  const app = await open({ forecast: dayForecast(), storage: NIGHT_PREF });
  await visit(app, "#outing/exercise");
  assert.equal(await app.page.evaluate(() => document.documentElement.dataset.theme), "night");
  await noOverflow(app.page, "exercise night");
  await shot(app.page, "exercise-night", { dir: SHOTS_M3 });
  noErrors(app);
});

// ---------------------------------------------------------------- live region

test("live region: scenario change and the picked hour are announced, debounced 500 ms; load and refresh are silent", async () => {
  const app = await open({ forecast: dayForecast() });
  const { page } = app;
  await visit(app, "#outing/commute");
  await page.waitForTimeout(700);
  assert.equal(await live(page), "", "silent on load");
  await page.evaluate(() => {
    window.__writes = [];
    new MutationObserver(() => window.__writes.push(document.getElementById("live").textContent)).observe(document.getElementById("live"), { childList: true, characterData: true, subtree: true });
  });

  await page.locator(".chip--exercise").click();
  assert.equal(await live(page), "", "not immediately");
  await page.waitForFunction(() => document.getElementById("live").textContent === "外出：運動");

  // three quick picks: only the last one is spoken, after the quiet period
  const slots = await barState(page);
  const t0 = Date.now();
  await page.evaluate(() => {
    const bars = document.querySelectorAll(".xbar");
    window.__writes.length = 0;
    bars[1].click();
    bars[2].click();
    bars[3].click();
  });
  assert.notEqual(await live(page), slots[3].label);
  await page.waitForFunction((label) => document.getElementById("live").textContent === label, slots[3].label);
  const waited = Date.now() - t0;
  assert.ok(waited >= 400, `debounced (${waited} ms)`);
  assert.deepEqual(await page.evaluate(() => window.__writes), [slots[3].label], "only the final pick is written");

  // a refresh/tick with the same selection is silent
  await advanceTo(page, DAY_MS + 60e3);
  await page.waitForTimeout(700);
  assert.equal(await live(page), slots[3].label);

  await page.locator(".chip--commute").click();
  await page.waitForFunction(() => document.getElementById("live").textContent === "外出：通勤");
  noErrors(app);
});

// ---------------------------------------------------------------- states

test("loading, stale and error states", async () => {
  // loading
  const loading = await open();
  loading.mode.forecast = "hang";
  await loading.go("#outing/commute");
  await loading.page.locator(".lcd--legs").waitFor();
  assert.equal(await loading.page.locator("main").getAttribute("aria-busy"), "true");
  assert.equal(await loading.page.locator("h1").innerText(), "載入天氣中…");
  assert.equal(await loading.page.locator('[data-k="leg-out"] .leg-time [role="img"]').getAttribute("aria-label"), "出門 無資料");
  assert.equal(await loading.page.locator(".warn").count(), 0);
  assert.deepEqual((await checklist(loading.page)).map((i) => i.why), ["載入中", "載入中", "載入中", "載入中"]);
  assert.equal(await loading.page.locator(".chips a").count(), 2);
  assert.equal(await loading.page.locator("select").count(), 2);
  await noOverflow(loading.page, "commute loading");
  await loading.page.goto(`${server.url}#outing/exercise`);
  await loading.page.locator("#x-range, .picker").first().waitFor();
  assert.equal((await lcd(loading.page)).time, "時間 無資料");
  assert.equal(await loading.page.locator(".xbar").count(), 0);
  assert.equal(await loading.page.locator(".picker .notice").innerText(), "載入中…");
  assert.deepEqual((await metricsOf(loading.page)).map((m) => m.v), ["--", "--", "--", "--", "--", "--"]);
  assert.equal(await loading.page.locator(".best").isDisabled(), true);
  await noOverflow(loading.page, "exercise loading");
  noErrors(loading);

  // stale: failed refresh over an old cache
  const stale = await open({ expectedErrors: [/status of 500/] });
  await visit(stale, "#outing/commute");
  assert.equal(await stale.page.locator(".banner").count(), 0);
  stale.mode.forecast = "500";
  await stale.page.clock.setFixedTime(new Date(DAY_MS + 30 * 60e3));
  await stale.page.reload();
  await stale.page.locator(".banner").waitFor();
  assert.equal(await stale.page.locator(".banner").innerText(), "資料時間 14:20・無法更新");
  assert.equal(await stale.page.locator(".check-item").count(), 4, "stale data is still shown");
  noErrors(stale);

  // error without data, then retry
  const err = await open({ expectedErrors: [/status of 500/] });
  err.mode.forecast = "500";
  await err.go("#outing/commute");
  const retry = err.page.locator('[data-action="retry"]');
  await retry.waitFor();
  assert.equal(await err.page.locator(".chips a").count(), 2, "chips stay available");
  assert.equal(await err.page.locator("h1").innerText(), "資料暫時無法取得");
  assert.equal(await err.page.locator(".checklist").count(), 0);
  await noOverflow(err.page, "commute error");
  err.mode.forecast = "ok";
  await retry.click();
  await waitReady(err.page);
  assert.equal(await err.page.locator('[data-action="retry"]').count(), 0);
  assert.equal(await err.page.locator(".check-item").count(), 4);
  await err.page.goto(`${server.url}#outing/exercise`);
  await err.page.locator(".xbar").first().waitFor();
  noErrors(err);
});

// ---------------------------------------------------------------- layout

test("no horizontal overflow at 390px; focus is never hidden behind the sticky nav (tall and short viewports)", async () => {
  const cases = [
    ["commute-rain", "#outing/commute", { forecast: rainyEveningForecast() }, 4],
    ["commute-night", "#outing/commute", { forecast: rainyEveningForecast(), storage: NIGHT_PREF }, 4],
    ["exercise-day", "#outing/exercise", { forecast: dayForecast() }, 14],
    ["exercise-late", "#outing/exercise", { forecast: lateForecast(), now: LATE_UTC }, 13],
  ];
  for (const [name, hash, opts, min] of cases) {
    const app = await open(opts);
    const { page } = app;
    await visit(app, hash);
    await settle(page);
    await noOverflow(page, name);
    assert.equal(await page.locator(".nav").evaluate((el) => getComputedStyle(el).position), "sticky");

    for (const height of [844, 480]) {
      await page.setViewportSize({ width: 390, height });
      await page.reload(); // resets the sequential-focus starting point to the top of the page
      await waitReady(page);
      let count = 0;
      let scrolled = 0;
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const b = el.getBoundingClientRect();
          return { what: el.id || el.className || el.tagName, top: b.top, bottom: b.bottom, navTop: document.querySelector(".nav").getBoundingClientRect().top, inNav: Boolean(el.closest(".nav")), inMain: Boolean(el.closest("main")), y: window.scrollY };
        });
        if (!r || r.inNav) break;
        if (!r.inMain) continue;
        count += 1;
        scrolled = Math.max(scrolled, r.y);
        assert.ok(r.bottom <= r.navTop + 0.5 && r.top >= -0.5, `${name}@${height}: ${r.what} focused at ${r.top}-${r.bottom}, nav top ${r.navTop}`);
      }
      assert.ok(count >= min, `${name}@${height}: tabbed through ${count} controls in <main>`);
      if (height === 480) assert.ok(scrolled > 0, `${name}@480: the page scrolled to reach focus`);
      await noOverflow(page, `${name}@${height}`);
    }
    noErrors(app);
  }
});

// ---------------------------------------------------------------- motion & CSP

test("motion: one infinite animation on commute (!RAIN), none on exercise; transform/opacity only; one-shots do not replay", async () => {
  const app = await open({ forecast: rainyEveningForecast() });
  const { page } = app;
  await app.ctx.addInitScript(() => {
    window.__starts = {};
    window.__csp = [];
    document.addEventListener("animationstart", (e) => (window.__starts[e.animationName] = (window.__starts[e.animationName] ?? 0) + 1), true);
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await visit(app, "#outing/commute");
  await settle(page);
  const names = () => page.evaluate(() => document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations === Infinity).map((a) => a.animationName));
  assert.deepEqual(await names(), ["blink"], "only the !RAIN blink");
  assert.equal(await page.locator(".warn").evaluate((el) => getComputedStyle(el).animationName), "blink");
  const anim = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(await anim(".lcd"), "boot");
  assert.equal(await anim(".check-item"), "pop");
  const first = await page.evaluate(() => ({ ...window.__starts }));
  assert.equal(first.boot, 1);
  assert.equal(first.pop, 4);
  assert.equal(await page.locator(".check-item").nth(3).evaluate((el) => el.style.getPropertyValue("--i")), "3", "stagger index via CSSOM");

  // changing a selector (keeping !RAIN on) or a refresh replays nothing
  await page.selectOption("#sel-back", "19"); // 19:00-20:00 is still wet: the same !RAIN node stays
  await page.selectOption("#sel-back", "18");
  await advanceTo(page, DAY_MS + 60e3);
  await settle(page);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__starts })), first);

  // hidden page pauses the blink
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.locator(".warn").evaluate((el) => getComputedStyle(el).animationPlayState), "paused");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // exercise: no infinite animation; bars grow once; the flip is one-shot
  await page.locator(".chip--exercise").click();
  await page.locator(".xbar").first().waitFor();
  assert.deepEqual(await names(), []);
  assert.equal(await anim(".xfill"), "grow");
  await settle(page);
  const grown = await page.evaluate(() => ({ ...window.__starts }));
  assert.equal(grown.grow, 12);
  await page.locator(".xbar").nth(5).click();
  await settle(page);
  const after = await page.evaluate(() => ({ ...window.__starts }));
  assert.equal(after.flipA, 2, "time and score flip once");
  assert.equal(after.grow, grown.grow, "bars do not grow again on selection");
  assert.equal(after.boot, grown.boot);

  // only transform/opacity are animated or transitioned (flip included)
  const touched = () => page.evaluate(() => {
    const set = new Set();
    const skip = ["offset", "computedOffset", "easing", "composite"];
    for (const a of document.getAnimations()) {
      if (a.constructor.name === "CSSTransition") set.add(a.transitionProperty);
      else for (const kf of a.effect.getKeyframes()) for (const k of Object.keys(kf)) if (!skip.includes(k)) set.add(k);
    }
    return [...set].sort();
  });
  await page.locator(".xbar").nth(6).click();
  assert.deepEqual((await touched()).filter((p) => !["opacity", "transform"].includes(p)), []);
  await page.locator('[data-action="light"]').click();
  assert.deepEqual((await touched()).filter((p) => !["opacity", "transform"].includes(p)), []);

  assert.deepEqual(await page.evaluate(() => window.__csp), [], "no CSP violations");
  noErrors(app);
});

test("reduced motion: nothing animates on either scenario", async () => {
  const app = await open({ forecast: rainyEveningForecast(), reducedMotion: "reduce" });
  const { page } = app;
  await visit(app, "#outing/commute");
  assert.equal(await page.locator(".warn").count(), 1);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  for (const sel of [".warn", ".lcd", ".check-item"]) assert.equal(await page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName), "none", sel);
  await page.locator(".chip--exercise").click();
  await page.locator(".xbar").nth(2).click();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  for (const sel of [".xfill", ".x-time"]) assert.equal(await page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName), "none", sel);
  noErrors(app);
});

// ---------------------------------------------------------------- a11y

async function axeCheck(name, app) {
  const all = await runAxe(app.page);
  const blocking = all.filter((v) => v.impact === "serious" || v.impact === "critical");
  console.log(`# axe[${name}]: serious/critical=${blocking.length} minor/moderate=${all.length - blocking.length}`);
  for (const v of all.filter((x) => !blocking.includes(x))) console.log(`#   ${v.impact} ${v.id} (${v.nodes} nodes) ${v.targets.join(" | ")}`);
  assert.deepEqual(blocking, [], `${name}: ${JSON.stringify(blocking, null, 1)}`);
  noErrors(app);
}

for (const [name, hash, opts] of [
  ["commute day", "#outing/commute", { forecast: rainyEveningForecast() }],
  ["commute night", "#outing/commute", { forecast: nightForecast(), now: NIGHT_UTC, storage: NIGHT_PREF }],
  ["exercise day", "#outing/exercise", { forecast: dayForecast() }],
  ["exercise night", "#outing/exercise", { forecast: dayForecast(), storage: NIGHT_PREF }],
  ["exercise late", "#outing/exercise", { forecast: lateForecast(), now: LATE_UTC }],
]) {
  test(`axe: ${name}`, async () => {
    const app = await open(opts);
    await visit(app, hash);
    if (hash.endsWith("exercise")) await app.page.locator(".xbar").nth(2).click(); // selected state too
    await axeCheck(name, app);
  });
}
