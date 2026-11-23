#!/usr/bin/env node
/**
 * Capture the six app screenshots for the promo (390x844 CSS px, deviceScaleFactor 3 -> 1170 px wide) from the real
 * app served locally with mocked Open-Meteo responses (see fixtures.mjs) and a fixed clock.
 *
 *   node capture-shots.mjs [--out shots] [--only today,trip] [--dsf 3]
 *
 * Output (promo/shots/):  today night commute exercise trip picker .png  (final states, used by the engine)
 *                               commute-before exercise-before trip-before picker-after .png (the state before/after the tap)
 *                               regions.json + regions.js  (element rectangles in "shot units" = CSS px x 2, i.e. the
 *                               780 px wide coordinate space the engine works in; images are scaled DSF/2 on load).
 * The app is only read (served from the repo root, the parent of promo/); nothing in the repo is written.
 * Requires the preinstalled Playwright (no install). Fonts: the real Google fonts (needs network); set OFFLINE_FONTS=1 to stub.
 */
import { createRequire } from "node:module";
import http from "node:http";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(HERE, arg("out", "shots"));
const DSF = Number(arg("dsf", 3));
const ONLY = arg("only", "") ? arg("only").split(",") : null;
const U = 2; // shot units per CSS px (the engine's 780 px coordinate space)
const { chromium } = require("playwright");

/* ------------------------------------------------------------------ static server (repo root, read only) */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
async function startServer(root) {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root + path.sep) || rel.startsWith("/node_modules/.")) throw new Error("outside");
      if (!(await stat(file)).isFile()) throw new Error("nf");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

/* ------------------------------------------------------------------ app context */
const json = (b) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const PLACES = { v: 1, saved: [F.PLACE.LAKE, F.PLACE.WORK, F.PLACE.TAIPEI], workId: F.PLACE.WORK.id, tripId: F.PLACE.LAKE.id };
const seed = (extra = {}) => ({ "ps:places": JSON.stringify(PLACES), ...extra });

async function openApp(browser, base, { phase = "day", now = F.DAY_UTC, storage = seed() } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DSF, serviceWorkers: "block", locale: "zh-TW", timezoneId: "America/New_York", reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ctx.route("**/api.open-meteo.com/**", (r) => {
    const lat = Number(new URL(r.request().url()).searchParams.get("latitude"));
    r.fulfill(json(Math.abs(lat - F.PLACE.LAKE.lat) < 0.005 ? F.lake(phase) : Math.abs(lat - F.PLACE.WORK.lat) < 0.005 ? F.work(phase) : F.taichung(phase)));
  });
  await ctx.route("**/air-quality-api.open-meteo.com/**", (r) => r.fulfill(json(F.air(phase))));
  await ctx.route("**/geocoding-api.open-meteo.com/**", (r) => {
    const res = F.geocode(new URL(r.request().url()).searchParams.get("name")).map((x, i) => ({ id: i + 1, ...x }));
    r.fulfill(json(res.length ? { results: res } : { generationtime_ms: 0.5 }));
  });
  for (const pat of ["**/fonts.googleapis.com/**", "**/fonts.gstatic.com/**"]) {
    await ctx.route(pat, (r) => (process.env.OFFLINE_FONTS === "1" ? r.fulfill({ status: 200, contentType: "text/css", body: "" }) : r.continue()));
  }
  await page.clock.setFixedTime(new Date(now));
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, storage);
  const go = async (hash = "") => {
    await page.goto(base + hash);
    await page.waitForFunction(() => document.getElementById("view")?.getAttribute("aria-busy") === "false" && !!document.querySelector(".hero"));
    await settle(page);
  };
  return { ctx, page, errors, go };
}

/** webfonts loaded + one-shot animations finished (same idea as the e2e `settle`). */
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('900 20px "Noto Sans TC"', "今天通勤運動出遊地點搜尋台中加入已儲存");
    await document.fonts.load('500 20px "Noto Sans TC"', "今天通勤運動出遊地點搜尋台中加入已儲存");
    await document.fonts.load('20px "Share Tech Mono"', "POCKET SKY 0123456789");
    await Promise.all(document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
  });
  await page.waitForTimeout(250);
}

async function shot(page, name, fullPage = true) {
  await settle(page);
  const nav = (v) => page.evaluate((p) => { const n = document.querySelector(".nav"); if (n) n.style.position = p; }, v);
  if (fullPage) await nav("static");
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, animations: "disabled", fullPage });
  if (fullPage) await nav("");
  console.log("  wrote", path.relative(HERE, file));
}

/** Pin the bottom nav in the flow (so its rectangle is its full-page position). */
const staticNav = (page) => page.evaluate(() => { const n = document.querySelector(".nav"); if (n) n.style.position = "static"; });

/** Rectangle(s) of a selector in shot units: [x, y, w, h] (page coordinates, so valid for full-page captures). */
async function rect(page, sel, i = 0) {
  return page.evaluate(([s, k, u]) => {
    const el = document.querySelectorAll(s)[k];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Math.round((r.left + scrollX) * u), Math.round((r.top + scrollY) * u), Math.round(r.width * u), Math.round(r.height * u)];
  }, [sel, i, U]);
}
/** Union rectangle of several selectors. */
async function rectU(page, sels) {
  const rs = [];
  for (const s of sels) { const r = await rect(page, s); if (r) rs.push(r); }
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1])), x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}
const pageSize = (page, fullPage = true) => page.evaluate(([f, u]) => ({ w: 390 * u, h: Math.round((f ? document.documentElement.scrollHeight : innerHeight) * u) }), [fullPage, U]);

/* ------------------------------------------------------------------ scenes */
const regions = {};
const want = (n) => !ONLY || ONLY.includes(n);
const OUTING = (o) => ({ "ps:outing": JSON.stringify(o) });

async function main() {
  await mkdir(OUT, { recursive: true });
  const srv = await startServer(F.REPO);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const base = srv.url;
  try {
    /* today (14:20) */
    if (want("today")) {
      const a = await openApp(browser, base);
      await a.go("");
      await shot(a.page, "today");
      await staticNav(a.page);
      regions.today = {
        size: await pageSize(a.page),
        headline: await rect(a.page, ".headline"), alert: await rect(a.page, ".alert, [data-k=alert]"),
        lcd: await rect(a.page, ".lcd"), temp: await rect(a.page, ".lcd .temp .seg7"), clock: await rect(a.page, ".lcd .clock .seg7"),
        light: await rect(a.page, '[data-action="light"]'),
      };
      if (a.errors.length) console.log("  page errors:", a.errors);
      await a.ctx.close();
    }
    /* night: 20:30, the user had day mode on and presses LIGHT */
    if (want("night")) {
      const a = await openApp(browser, base, { phase: "night", now: F.NIGHT_UTC, storage: seed({ "ps:theme": "day", "ps:theme-last": "day" }) });
      await a.go("");
      await a.page.click('[data-action="light"]');
      await a.page.waitForFunction(() => document.documentElement.dataset.theme === "night");
      // The rain alert strip of the 14:20 Today is gone by 20:30; keep its space so both Today shots share one layout
      // (the light-toggle cross-fade then fades the alert out instead of jumping the whole page).
      await a.page.evaluate((h) => { const sp = document.createElement("div"); sp.style.height = h + "px"; sp.setAttribute("aria-hidden", "true"); document.querySelector(".hero").before(sp); }, 58);
      await shot(a.page, "night");
      await staticNav(a.page);
      regions.night = { size: await pageSize(a.page), lcd: await rect(a.page, ".lcd"), temp: await rect(a.page, ".lcd .temp .seg7"), clock: await rect(a.page, ".lcd .clock .seg7"), light: await rect(a.page, '[data-action="light"]') };
      await a.ctx.close();
    }
    /* commute: before = back at 20:00 (no rain), after = back at 18:00 (umbrella on) */
    if (want("commute")) {
      const a = await openApp(browser, base, { storage: seed(OUTING({ scenario: "commute", commute: { out: 8, back: 20 } })) });
      await a.go("#outing/commute");
      await shot(a.page, "commute-before");
      regions["commute-before"] = { size: await pageSize(a.page), umbrella: await rect(a.page, '[data-k="item-umbrella"]'), checklist: await rect(a.page, ".checklist") };
      await a.page.selectOption("#sel-back", "18");
      await a.page.waitForFunction(() => document.querySelector('[data-k="item-umbrella"]')?.classList.contains("is-on"));
      await settle(a.page);
      await shot(a.page, "commute");
      regions.commute = {
        size: await pageSize(a.page), hero: await rect(a.page, ".hero"), fields: await rect(a.page, '[data-k="c-fields"]'), selBack: await rect(a.page, "#sel-back"), headline: await rect(a.page, '[data-k="c-headline"]'),
        checklist: await rect(a.page, ".checklist"), umbrella: await rect(a.page, '[data-k="item-umbrella"]'), jacket: await rect(a.page, '[data-k="item-jacket"]'), leg: await rect(a.page, '[data-k="leg-back"]'), legDigits: await rect(a.page, '[data-k="leg-back"] .seg7'),
      };
      if (a.errors.length) console.log("  page errors:", a.errors);
      await a.ctx.close();
    }
    /* exercise: before = 17:00 picked (bad), after = 14:00 (best, 93) */
    if (want("exercise")) {
      const a = await openApp(browser, base, { storage: seed(OUTING({ scenario: "exercise" })) });
      await a.go("#outing/exercise");
      await a.page.click('.xbar[data-hk$="T17:00"]');
      await a.page.waitForTimeout(400);
      await shot(a.page, "exercise-before");
      await a.page.click('.xbar[data-hk$="T14:00"]');
      await a.page.waitForTimeout(400);
      await shot(a.page, "exercise");
      regions.exercise = {
        size: await pageSize(a.page), hero: await rect(a.page, ".hero"), digits: await rect(a.page, ".x-digits"), time: await rect(a.page, ".x-time"), score: await rect(a.page, ".x-score"), timeDigits: await rect(a.page, ".x-time .seg7"), scoreDigits: await rect(a.page, ".x-score .seg7"),
        bars: await rect(a.page, ".xbars"), bar14: await rect(a.page, '.xbar[data-hk$="T14:00"]'), bar17: await rect(a.page, '.xbar[data-hk$="T17:00"]'), picker: await rect(a.page, '[data-k="x-picker"]'),
        verdict: await rect(a.page, ".verdict"), advice: await rect(a.page, ".advice"),
        label: await a.page.locator('.x-time [role="img"]').getAttribute("aria-label"), scoreLabel: await a.page.locator('.x-score [role="img"]').getAttribute("aria-label"),
      };
      if (a.errors.length) console.log("  page errors:", a.errors);
      await a.ctx.close();
    }
    /* trip: before = 新竹 chosen, after = 日月潭 (-5 vs now) */
    if (want("trip")) {
      const tripSeed = { ...seed(OUTING({ scenario: "trip", trip: { start: 14, end: 21 } })) };
      tripSeed["ps:places"] = JSON.stringify({ ...PLACES, tripId: F.PLACE.WORK.id });
      const a = await openApp(browser, base, { storage: tripSeed });
      await a.go("#outing/trip");
      await shot(a.page, "trip-before");
      regions["trip-before"] = { size: await pageSize(a.page), diff: await rect(a.page, ".trip-diff"), lcd: await rect(a.page, ".lcd--trip"), dests: await rect(a.page, ".dests") };
      await a.page.click(`#dest-${F.PLACE.LAKE.id.replace(/([:,.])/g, "\\$1")}`);
      await a.page.waitForFunction(() => /日月潭/.test(document.querySelector(".trip-name")?.textContent ?? ""));
      await settle(a.page);
      await shot(a.page, "trip");
      regions.trip = {
        size: await pageSize(a.page), dests: await rect(a.page, ".dests"), destLake: await rect(a.page, ".dests .dest", 0), destWork: await rect(a.page, ".dests .dest", 1), destAdd: await rect(a.page, ".dest--add"),
        lcd: await rect(a.page, ".lcd--trip"), diff: await rect(a.page, ".trip-diff"), diffDigits: await rectU(a.page, [".trip-diff .sign", ".trip-diff .seg7"]), tripR: await rect(a.page, ".trip-r"), fields: await rect(a.page, '[data-k="t-fields"]'),
        headline: await rect(a.page, '[data-k="t-headline"]'), strip: await rect(a.page, '[data-k="t-strip"]'), checklist: await rect(a.page, ".checklist"),
        diffLabel: await a.page.locator(".trip-diff [role=img]").getAttribute("aria-label"),
      };
      if (a.errors.length) console.log("  page errors:", a.errors);
      await a.ctx.close();
    }
    /* picker: dialog open, "台中" typed, result shown (viewport capture, like the old shot); after = 加入 pressed */
    if (want("picker")) {
      const a = await openApp(browser, base);
      await a.go("");
      await a.page.locator("#loc-btn").click();
      await a.page.locator("#pk-q").waitFor();
      await a.page.locator("#pk-q").pressSequentially("台中", { delay: 120 });
      await a.page.waitForSelector(".pk-row--r");
      await a.page.waitForTimeout(600);
      await shot(a.page, "picker", false);
      regions.picker = {
        size: await pageSize(a.page, false), dialog: await rect(a.page, "#picker"), input: await rect(a.page, "#pk-q"), results: await rect(a.page, '[data-k="pk-results"]'), addBtn: await rect(a.page, ".pk-row--r .pk-btn"),
        resultRow: await rect(a.page, ".pk-row--r"), count: await rect(a.page, '[data-k="pk-sect"]'), countSpan: await rect(a.page, '[data-k="pk-sect"] span'), saved: await rect(a.page, '[data-k="pk-saved"]'), live: await rect(a.page, "#pk-live"),
      };
      await a.page.locator(".pk-row--r .pk-btn").first().click();
      await a.page.waitForTimeout(700);
      await shot(a.page, "picker-after", false);
      regions["picker-after"] = {
        size: await pageSize(a.page, false), done: await rect(a.page, ".pk-done"), resultRow: await rect(a.page, ".pk-row--r"), count: await rect(a.page, '[data-k="pk-sect"]'), saved: await rect(a.page, '[data-k="pk-saved"]'),
        countSpan: await rect(a.page, '[data-k="pk-sect"] span'), countText: await a.page.locator('[data-k="pk-sect"] span').textContent(),
      };
      if (a.errors.length) console.log("  page errors:", a.errors);
      await a.ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  if (!ONLY) {
    const meta = { dsf: DSF, shotUnit: "css px x 2 (780 px wide space)", day: "2026-11-21 Taichung", clock: "14:20 Taipei (night shot 20:30)", regions };
    await writeFile(path.join(OUT, "regions.json"), JSON.stringify(meta, null, 1));
    await writeFile(path.join(OUT, "regions.js"), "/* generated by capture-shots.mjs - element rectangles in shot units (780 px wide) */\nwindow.PromoShots = " + JSON.stringify(meta, null, 1) + ";\n");
    console.log("  wrote shots/regions.json + regions.js");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
