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
 * @param {string} [o.now] ISO instant for the fixed clock.
 * @param {boolean} [o.granted] Grant geolocation (24.15, 120.67).
 * @param {'reduce'|'no-preference'} [o.reducedMotion]
 * @param {object} [o.storage] localStorage seed (written before the first load).
 * @param {RegExp[]} [o.expectedErrors] Console error texts that are expected in this scenario.
 * @returns {Promise<{ctx, page, requests: string[], errors: string[], mode: {forecast: string, air: string}, go: Function, close: Function}>}
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
  const mode = { forecast: "ok", air: "ok" };
  const bodies = { forecast: o.forecast ?? dayForecast(), air: o.air ?? airFixture() };
  const handler = (kind) => async (route) => {
    requests.push(route.request().url());
    const m = mode[kind];
    if (m === "hang") return; // never resolves
    if (m === "500") return route.fulfill(json({ error: true, reason: "boom" }, 500));
    return route.fulfill(json(bodies[kind]));
  };
  await ctx.route("**/api.open-meteo.com/**", handler("forecast"));
  await ctx.route("**/air-quality-api.open-meteo.com/**", handler("air"));
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
  return { ctx, page, requests, errors, mode, go, close: () => ctx.close() };
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
 * @param {{fullPage?: boolean}} [o] `fullPage: false` captures only the viewport (above the fold).
 * @returns {Promise<string|null>} Path, or null when screenshots are disabled.
 */
export async function shot(page, name, { fullPage = true } = {}) {
  if (process.env.E2E_SCREENSHOTS !== "1") return null;
  mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await settle(page);
  await page.screenshot({ path: file, animations: "disabled", fullPage });
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
