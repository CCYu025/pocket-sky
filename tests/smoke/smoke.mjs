/**
 * Post-deploy smoke test against a live URL with the REAL Open-Meteo API.
 * `SMOKE_FIXTURES=1` answers the Open-Meteo calls from the test fixtures instead (only to validate this script when the real API is unreachable or rate limited).
 * Usage: `npm run smoke -- [url]` (default: the public Pages URL). Not part of `npm test` / e2e.
 */
import { loadPlaywright, dayForecast, airFixture, DAY_UTC } from "../e2e/helpers.mjs";

const url = process.argv[2] || "https://ccyu025.github.io/pocket-sky/";
const base = url.endsWith("/") ? url : `${url}/`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    geolocation: { latitude: 25.033, longitude: 121.565 },
    permissions: ["geolocation"],
    serviceWorkers: "allow",
  });
  ctx.setDefaultTimeout(20000); // every wait fails fast and is reported as FAIL instead of hanging the run
  ctx.setDefaultNavigationTimeout(30000);
  const page = await ctx.newPage();
  if (process.env.SMOKE_FIXTURES === "1") {
    await page.clock.setFixedTime(new Date(DAY_UTC));
    const body = (b) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    await ctx.route("**/api.open-meteo.com/**", (r) => r.fulfill(body(dayForecast())));
    await ctx.route("**/air-quality-api.open-meteo.com/**", (r) => r.fulfill(body(airFixture())));
  }
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  const res = await page.goto(base, { waitUntil: "load" });
  check("page loads", res?.ok() === true, `${res?.status()} ${base}`);
  check("title", (await page.title()) === "Pocket Sky", await page.title());

  let label = "";
  try {
    await page.waitForFunction(() => /度/.test(document.querySelector(".temp [aria-label]")?.getAttribute("aria-label") ?? ""), null, { timeout: 30000 });
    label = await page.locator(".temp [aria-label]").first().getAttribute("aria-label");
  } catch {
    label = (await page.locator(".temp [aria-label]").first().getAttribute("aria-label").catch(() => "")) ?? "";
  }
  check("Today shows a temperature", label.includes("度"), label);

  const sw = await page
    .evaluate(async () => {
      // `ready` never settles when registration failed or was blocked: race it against a timer
      const timeout = new Promise((resolve) => setTimeout(() => resolve("serviceWorker.ready did not settle within 15 s"), 15000));
      return Promise.race([navigator.serviceWorker.ready.then((reg) => reg.scope), timeout]);
    })
    .catch((e) => String(e));
  check("service worker registers", sw.startsWith(base), sw);

  const mHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  const mUrl = new URL(mHref, base).href;
  // The app's CSP connect-src forbids fetching its own manifest, so fetch from a second page parked on the
  // manifest URL (same origin, no CSP). Goes through the browser network stack, not Node's.
  const mPage = await ctx.newPage();
  await mPage.goto(mUrl);
  const mRes = await mPage.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, json: await r.json().catch(() => null) };
  }, mUrl);
  await mPage.close();
  const mJson = mRes.status >= 200 && mRes.status < 300 ? mRes.json : null;
  check("manifest fetches", Boolean(mJson?.name), `${mRes.status} ${mJson?.name ?? ""}`);

  check("no console errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("smoke run", false, e.message);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nsmoke OK");
process.exit(failed ? 1 : 0);
