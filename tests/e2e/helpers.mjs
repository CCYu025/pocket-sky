/**
 * Shared helpers for the Playwright e2e tests (library mode, no @playwright/test).
 */
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const SHOTS = path.join(ROOT, "docs/screenshots/m2");
export const SHOTS_M3 = path.join(ROOT, "docs/screenshots/m3");
export const SHOTS_M4 = path.join(ROOT, "docs/screenshots/m4");

/**
 * Load Playwright: project dependency first, then the preinstalled tools dir.
 * @returns {object} The playwright module.
 */
export function loadPlaywright() {
  const tried = [];
  for (const id of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
    try {
      return require(id);
    } catch (e) {
      tried.push(`${id}: ${e.code ?? e.message}`);
    }
  }
  throw new Error(`Playwright not found (${tried.join("; ")})`);
}

/** Fixed instants (UTC): 14:20 and 20:30 Taipei on 2026-11-21. */
export const DAY_UTC = "2026-11-21T06:20:00Z";
export const NIGHT_UTC = "2026-11-21T12:30:00Z";
/** 22:30 Taipei on 2026-11-21 (exercise window extends to 06:00 tomorrow). */
export const LATE_UTC = "2026-11-21T14:30:00Z";
export const LATE_MS = Date.parse(LATE_UTC);
export const DAY_MS = Date.parse(DAY_UTC);
export const NIGHT_MS = Date.parse(NIGHT_UTC);

const readJson = (f) => JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures", f), "utf8"));
const IDX_14 = 38; // hourly index of 2026-11-21T14:00 in forecast-taichung.json

/**
 * Forecast fixture with an observation at 14:15 (so `current` is not stale at 14:20).
 * @param {(f: object) => void} [mutate] Optional in-place tweak.
 * @returns {object}
 */
export function dayForecast(mutate) {
  const f = readJson("forecast-taichung.json");
  const h = f.hourly;
  f.current = {
    ...f.current,
    time: "2026-11-21T14:15",
    temperature_2m: h.temperature_2m[IDX_14],
    apparent_temperature: h.apparent_temperature[IDX_14],
    relative_humidity_2m: h.relative_humidity_2m[IDX_14],
    weather_code: h.weather_code[IDX_14],
    wind_speed_10m: h.wind_speed_10m[IDX_14],
    wind_direction_10m: 45,
    is_day: 1,
  };
  if (mutate) mutate(f);
  return f;
}

/** @returns {object} Raw captured forecast (observation 20:00, suits the 20:30 night clock). */
export function nightForecast() {
  return readJson("forecast-taichung.json");
}

/** @returns {object} Captured air-quality fixture. */
export function airFixture() {
  return readJson("air-taichung.json");
}

/** Rain jumps from 10% now to 70% at 16:00. */
export function rainyForecast() {
  return dayForecast((f) => {
    const p = f.hourly.precipitation_probability;
    [10, 40, 70, 65].forEach((v, i) => (p[IDX_14 + i] = v));
  });
}

/** Temperature falls 24 -> 18 over three hours (rain stays 0). */
export function coldDropForecast() {
  return dayForecast((f) => {
    [24, 22, 20, 18].forEach((v, i) => (f.hourly.temperature_2m[IDX_14 + i] = v));
  });
}

/**
 * Showers 15:00-17:00 on top of the real fixture, so the exercise bars show all three levels
 * (good before and after, ok at 15:00, bad at 16:00-17:00).
 */
export function showersForecast() {
  return dayForecast((f) => {
    const h = f.hourly;
    [[IDX_14 + 1, 50, 20, 78, 20], [IDX_14 + 2, 95, 12, 95, 45], [IDX_14 + 3, 95, 12, 95, 45]].forEach(([i, p, t, rh, w]) => {
      h.precipitation_probability[i] = p;
      h.temperature_2m[i] = t;
      h.relative_humidity_2m[i] = rh;
      h.wind_speed_10m[i] = w;
    });
  });
}

/** Observation at 22:15 so `current` is fresh at the 22:30 clock. */
export function lateForecast() {
  return dayForecast((f) => {
    f.current.time = "2026-11-21T22:15";
    f.current.is_day = 0;
  });
}

/**
 * Synthetic rainy evening built from the real fixture: 18:00-19:00 rainProb 60 (0.8 mm), colder
 * temperatures there (feels <= 18), so umbrella and jacket trigger on the 08:00 / 18:00 commute.
 */
export function rainyEveningForecast() {
  return dayForecast((f) => {
    const h = f.hourly;
    [42, 43].forEach((i, k) => {
      h.precipitation_probability[i] = 60;
      h.precipitation[i] = 0.8;
      h.weather_code[i] = 95;
      h.temperature_2m[i] = [17, 16][k];
      h.apparent_temperature[i] = [15, 14][k];
      h.wind_speed_10m[i] = 18;
    });
  });
}

/**
 * Forecast for the Sun Moon Lake destination: element 1 of `forecast-multi.json`, with an observation at
 * 14:15 taken from the 14:00 hour (like `dayForecast`), so it is not stale at the 14:20 clock.
 * @param {(f: object) => void} [mutate] Optional in-place tweak.
 * @returns {object}
 */
export function destForecast(mutate) {
  const f = readJson("forecast-multi.json")[1];
  const h = f.hourly;
  f.current = {
    ...f.current,
    time: "2026-11-21T14:15",
    temperature_2m: h.temperature_2m[IDX_14],
    apparent_temperature: h.apparent_temperature[IDX_14],
    relative_humidity_2m: h.relative_humidity_2m[IDX_14],
    weather_code: h.weather_code[IDX_14],
    wind_speed_10m: h.wind_speed_10m[IDX_14],
    wind_direction_10m: 45,
    is_day: 1,
  };
  if (mutate) mutate(f);
  return f;
}

/**
 * Synthetic work-place forecast built from the Taichung fixture: clearly different temperatures
 * (26-27 degrees at 18:00-19:00) and rain 60% at 18:00-19:00, so the BACK leg and the checklist
 * visibly come from this place and not from the current one.
 * @returns {object}
 */
export function workForecast() {
  return dayForecast((f) => {
    const h = f.hourly;
    [42, 43].forEach((i, k) => {
      h.precipitation_probability[i] = 60;
      h.precipitation[i] = 0.8;
      h.weather_code[i] = 61;
      h.temperature_2m[i] = [27, 26][k];
      h.apparent_temperature[i] = [29, 28][k];
      h.wind_speed_10m[i] = 11;
    });
  });
}

/** Saved places used by the M4 tests (ids are the 2-dp `p:lat,lon`). */
export const LAKE = { id: "p:23.87,120.91", name: "日月潭", admin1: "南投縣", country: "臺灣", lat: 23.87, lon: 120.91, elevation: 748, timezone: "Asia/Taipei" };
export const WORK = { id: "p:24.80,120.97", name: "新竹", admin1: "新竹縣", country: "臺灣", lat: 24.8, lon: 120.97, elevation: 31, timezone: "Asia/Taipei" };

/**
 * `forecastBy` for the M4 tests: Sun Moon Lake, the synthetic work place, anything else Taichung.
 * @param {{lake?: object, work?: object}} [o] Overrides.
 * @returns {(lat: number, lon: number) => object}
 */
export function placesForecasts({ lake = destForecast(), work = workForecast() } = {}) {
  return (lat) => (Math.abs(lat - LAKE.lat) < 0.005 ? lake : Math.abs(lat - WORK.lat) < 0.005 ? work : undefined);
}

/**
 * Launch Chromium.
 * @returns {Promise<object>} Browser.
 */
export async function launch() {
  const { chromium } = loadPlaywright();
  return chromium.launch({ args: ["--no-sandbox"] });
}

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/**
 * Create a context + page with API/font interception, console capture and a fixed clock.
 * @param {object} browser
 * @param {string} baseUrl Server URL.
 * @param {object} [o]
 * @param {object} [o.forecast] Forecast body (default dayForecast()).
 * @param {object} [o.air] Air body.
 * @param {(lat: number, lon: number) => (object|undefined)} [o.forecastBy] Per-place forecast body (`undefined` = `o.forecast`).
 * @param {(name: string) => object[]} [o.geocode] Geocoding results (Open-Meteo `results` entries) per query name.
 * @param {string} [o.now] ISO instant for the fixed clock.
 * @param {boolean} [o.granted] Grant geolocation (24.15, 120.67).
 * @param {'reduce'|'no-preference'} [o.reducedMotion]
 * @param {object} [o.storage] localStorage seed (written before the first load).
 * @param {RegExp[]} [o.expectedErrors] Console error texts that are expected in this scenario.
 * @returns {Promise<{ctx, page, requests: string[], geoRequests: string[], failPlaces: Set<string>, errors: string[], mode: {forecast: string, air: string, geo: string}, go: Function, close: Function}>}
 *   `geoRequests` are the geocoding `name` parameters in order; `failPlaces` holds `"lat,lon"` (2 dp) strings whose
 *   forecast/air requests answer 500.
 */
export async function openApp(browser, baseUrl, o = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "zh-TW",
    timezoneId: "America/New_York",
    reducedMotion: o.reducedMotion ?? "no-preference",
    ...(o.granted ? { geolocation: { latitude: 24.15, longitude: 120.67 }, permissions: ["geolocation"] } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  const expected = o.expectedErrors ?? [];
  const record = (text) => {
    if (!expected.some((re) => re.test(text))) errors.push(text);
  };
  page.on("console", (m) => m.type() === "error" && record(`console: ${m.text()}`));
  page.on("pageerror", (e) => record(`pageerror: ${e.message}`));

  const requests = [];
  const geoRequests = [];
  const failPlaces = new Set();
  const mode = { forecast: "ok", air: "ok", geo: "ok" };
  const bodies = { forecast: o.forecast ?? dayForecast(), air: o.air ?? airFixture() };
  const handler = (kind) => async (route) => {
    const url = route.request().url();
    requests.push(url);
    const m = mode[kind];
    if (m === "hang") return; // never resolves
    if (m === "500") return route.fulfill(json({ error: true, reason: "boom" }, 500));
    const q = new URL(url).searchParams;
    const lat = Number(q.get("latitude"));
    const id = `${q.get("latitude")},${q.get("longitude")}`;
    if (failPlaces.has(id)) return route.fulfill(json({ error: true, reason: "boom" }, 500));
    if (kind === "forecast" && o.forecastBy) {
      const by = o.forecastBy(lat, Number(q.get("longitude")));
      if (by) return route.fulfill(json(by));
    }
    return route.fulfill(json(bodies[kind]));
  };
  await ctx.route("**/api.open-meteo.com/**", handler("forecast"));
  await ctx.route("**/air-quality-api.open-meteo.com/**", handler("air"));
  await ctx.route("**/geocoding-api.open-meteo.com/**", async (route) => {
    const name = new URL(route.request().url()).searchParams.get("name");
    geoRequests.push(name);
    if (mode.geo === "hang") return;
    if (mode.geo === "500") return route.fulfill(json({ error: true, reason: "boom" }, 500));
    const results = (o.geocode ? o.geocode(name) : []).map((r, i) => ({ id: i + 1, country_code: "TW", ...r }));
    return route.fulfill(json(results.length ? { results } : { generationtime_ms: 0.5 }));
  });
  const realFonts = process.env.E2E_REAL_FONTS === "1";
  for (const pat of ["**/fonts.googleapis.com/**", "**/fonts.gstatic.com/**"]) {
    await ctx.route(pat, (route) =>
      realFonts ? route.continue() : route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
  }
  await page.clock.setFixedTime(new Date(o.now ?? DAY_UTC));
  if (o.storage) {
    await ctx.addInitScript((seed) => {
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }, o.storage);
  }
  const go = async (hash = "") => {
    await page.goto(baseUrl + hash);
  };
  return { ctx, page, requests, geoRequests, failPlaces, errors, mode, go, close: () => ctx.close() };
}

/**
 * Wait until the Today view has left the loading state.
 * @param {object} page
 */
export async function waitReady(page) {
  await page.waitForFunction(() => document.getElementById("view")?.getAttribute("aria-busy") === "false" && !!document.querySelector(".hero"));
}

/**
 * Wait for the one-shot entry animations to finish and webfonts to settle.
 * @param {object} page
 */
export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})),
    );
  });
}

/**
 * Screenshot to docs/screenshots/m2, **only** when `E2E_SCREENSHOTS=1` (a default run writes no files).
 * Infinite animations are cancelled to their initial state and one-shot ones fast-forwarded,
 * so the output is stable. Regenerate with `E2E_SCREENSHOTS=1 E2E_REAL_FONTS=1 npm run test:e2e`.
 * @param {object} page
 * @param {string} name File name without extension.
 * @param {{fullPage?: boolean, dir?: string}} [o] `fullPage: false` captures only the viewport (above the fold); `dir` defaults to `SHOTS` (m2), M3 passes `SHOTS_M3`.
 * @returns {Promise<string|null>} Path, or null when screenshots are disabled.
 */
export async function shot(page, name, { fullPage = true, dir = SHOTS } = {}) {
  if (process.env.E2E_SCREENSHOTS !== "1") return null;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await settle(page);
  // A sticky nav would be pinned to the first viewport in a full-page capture (covering content,
  // leaving a gap at the real bottom): lay it out in flow for the capture only.
  const setNavPosition = (v) => page.evaluate((pos) => { const n = document.querySelector(".nav"); if (n) n.style.position = pos; }, v);
  if (fullPage) await setNavPosition("static");
  try {
    await page.screenshot({ path: file, animations: "disabled", fullPage });
  } finally {
    if (fullPage) await setNavPosition("");
  }
  return file;
}

/**
 * @param {object} page
 * @returns {Promise<{scrollWidth: number, clientWidth: number}>} Horizontal overflow metrics.
 */
export async function overflow(page) {
  await page.evaluate(() => document.fonts.ready); // real webfonts (E2E_REAL_FONTS=1) can change widths
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

/**
 * Run axe-core in the page.
 * @param {object} page
 * @returns {Promise<Array<{id: string, impact: string, help: string, nodes: number}>>} Violations.
 */
export async function runAxe(page) {
  const src = readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
  await settle(page);
  await page.evaluate(src);
  const res = await page.evaluate(() => globalThis.axe.run(document, { resultTypes: ["violations"] }));
  return res.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
}

/**
 * Record every `data-theme` value on <html> and the theme at the moment <body> is
 * created (i.e. before any app code could render): `window.__themes`, `window.__bodyTheme`.
 * Call before `go()`.
 * @param {object} app Result of `openApp`.
 */
export async function trackTheme(app) {
  await app.ctx.addInitScript(() => {
    window.__themes = [];
    window.__bodyTheme = "unset";
    new MutationObserver(() => {
      const t = document.documentElement?.dataset.theme ?? null;
      if (t === null && !document.body) return; // <html> not themed yet and nothing painted
      if (window.__themes.at(-1) !== t) window.__themes.push(t);
      if (document.body && window.__bodyTheme === "unset") window.__bodyTheme = t;
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-theme"] });
  });
}

/**
 * Move the fixed clock and fire the event the app listens to (`visibilitychange` -> tick + refreshIfStale).
 * @param {object} page
 * @param {number} ms Epoch ms.
 */
export async function advanceTo(page, ms) {
  await page.clock.setFixedTime(new Date(ms));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}
