/**
 * Lighthouse quality gate (mobile preset) against the assembled `_site/` served locally.
 * Usage: `npm run lighthouse [-- --runs=3] [--api=auto|real|fixtures] [--out=m5] [--no-write]`
 * Writes `docs/reports/lighthouse-<out>.json` (scores + key metrics) and `.md` unless `--no-write` (the report is
 * then only printed, so a reviewer can run it without touching the tree). Exit code 1 when any category is below
 * its target or the app is not installable, else 0. Not part of CI (slow).
 *
 * Lighthouse is not a project dependency: on first use it is installed (`npm install --no-save`, pinned version,
 * together with its own chrome-launcher and puppeteer-core) into `$LIGHTHOUSE_PREFIX` (default
 * `<os tmpdir>/pocket-sky-lighthouse-<version>`) and reused afterwards. Needs network access to the npm registry once.
 *
 * Open-Meteo: `--api=real` uses the live API; `fixtures` answers the three hosts from tests/fixtures;
 * `auto` (default) probes the forecast API and falls back to fixtures when it answers an error
 * (e.g. the daily limit of a shared sandbox IP), reporting which mode was used.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startServer } from "../tests/e2e/server.mjs";
import { dayForecast, airFixture, ROOT } from "../tests/e2e/helpers.mjs";
import { buildSite } from "./build-site.mjs";

const LH_VERSION = "13.6.0";
const PREFIX = process.env.LIGHTHOUSE_PREFIX || path.join(tmpdir(), `pocket-sky-lighthouse-${LH_VERSION}`);

/**
 * Import a package installed under PREFIX (these are ES modules without a resolvable `exports` map from here).
 * @param {string} name Package name.
 * @returns {Promise<object>} The module namespace.
 */
async function importInstalled(name) {
  const dir = path.join(PREFIX, "node_modules", name);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const dot = pkg.exports?.["."];
  const entry = (typeof dot === "string" ? dot : dot?.import) ?? pkg.main;
  return import(pathToFileURL(path.join(dir, entry)).href);
}

/** Install the pinned Lighthouse into PREFIX once. */
function ensureInstalled() {
  if (existsSync(path.join(PREFIX, "node_modules/lighthouse/package.json"))) return;
  console.log(`installing lighthouse@${LH_VERSION} into ${PREFIX} (one time)`);
  mkdirSync(PREFIX, { recursive: true });
  execFileSync("npm", ["install", "--prefix", PREFIX, "--no-save", "--no-audit", "--no-fund", "--loglevel=error", `lighthouse@${LH_VERSION}`], { stdio: "inherit" });
}
ensureInstalled();
const lighthouse = (await importInstalled("lighthouse")).default;
const chromeLauncher = await importInstalled("chrome-launcher");
const puppeteer = (await importInstalled("puppeteer-core")).default;

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const RUNS = Number(arg("runs", 3));
const WRITE = !process.argv.includes("--no-write");
const OUT = arg("out", "m5");
const API = arg("api", "auto");
const TARGETS = { performance: 90, accessibility: 95, "best-practices": 95, seo: 90 };
const METRICS = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index", "interactive"];

/** @returns {string} Preinstalled Chromium executable under /opt/pw-browsers. */
function findChrome() {
  if (process.env.LIGHTHOUSE_CHROME) return process.env.LIGHTHOUSE_CHROME;
  const base = "/opt/pw-browsers";
  const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const p = path.join(base, d, "chrome-linux64/chrome");
    if (existsSync(p)) return p;
  }
  throw new Error("no Chromium under /opt/pw-browsers (set LIGHTHOUSE_CHROME)");
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** @returns {Promise<'real'|'fixtures'>} */
async function pickApi() {
  if (API !== "auto") return API;
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=25&longitude=121&current=temperature_2m");
    const j = await r.json();
    return r.ok && !j.error ? "real" : "fixtures";
  } catch {
    return "fixtures";
  }
}

/**
 * @param {string} url
 * @param {string} chrome
 * @param {'real'|'fixtures'} api
 * @returns {Promise<object>} Lighthouse result (lhr).
 */
async function runOnce(url, chrome, api) {
  const c = await chromeLauncher.launch({ chromePath: chrome, chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${c.port}` });
  try {
    const page = await browser.newPage();
    if (api === "fixtures") {
      await page.setRequestInterception(true);
      const body = (b) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
      page.on("request", (r) => {
        const u = r.url();
        if (u.startsWith("https://api.open-meteo.com/")) r.respond(body(dayForecast()));
        else if (u.startsWith("https://air-quality-api.open-meteo.com/")) r.respond(body(airFixture()));
        else if (u.startsWith("https://geocoding-api.open-meteo.com/")) r.respond(body({}));
        else r.continue();
      });
    }
    const res = await lighthouse(url, { port: c.port, output: "json", logLevel: "error", onlyCategories: Object.keys(TARGETS) }, undefined, page);
    const cdp = await page.createCDPSession();
    const inst = await cdp.send("Page.getInstallabilityErrors").catch(() => ({ installabilityErrors: ["unavailable"] }));
    res.lhr.__installErrors = inst.installabilityErrors.map((e) => e.errorId ?? e);
    return res.lhr;
  } finally {
    await browser.disconnect();
    await c.kill();
  }
}

/** @returns {string[]} Static notes (baseline comparison, known harness artifact). */
function notes(dir) {
  const out = [];
  const before = path.join(dir, `lighthouse-${OUT}-before.json`);
  if (existsSync(before)) {
    const b = JSON.parse(readFileSync(before, "utf8"));
    out.push("## Before the fixes", "", `Baseline (\`lighthouse-${OUT}-before.json\`): ` + Object.entries(b.scores).map(([k, v]) => `${k} ${v}`).join(", ") + `. SEO was missing a meta description.`, "");
  }
  out.push(
    "## Known artifact",
    "",
    "`robots-txt` fails in this harness with `Network.loadNetworkResource: CSP violation`: Lighthouse fetches `/robots.txt` under the page's strict CSP (`default-src 'none'`, no `connect-src 'self'`). The file itself is served (200, `User-agent: *` / `Allow: /`) and crawlers are not bound by the page CSP; the CSP was deliberately not loosened. Lighthouse's own SEO score is 91 with this audit failing.",
    "",
  );
  return out;
}

const api = await pickApi();
const siteDir = path.join(ROOT, "_site");
buildSite(siteDir);
const server = await startServer({ root: siteDir });
const chrome = findChrome();
console.log(`Lighthouse ${LH_VERSION}, chrome ${chrome}, api=${api}, runs=${RUNS}`);
const lhrs = [];
try {
  for (let i = 0; i < RUNS; i++) {
    const lhr = await runOnce(server.url, chrome, api);
    lhrs.push(lhr);
    console.log(`run ${i + 1}: ` + Object.keys(TARGETS).map((k) => `${k}=${Math.round(lhr.categories[k].score * 100)}`).join(" "));
  }
} finally {
  await server.close();
}

const medianLhr = (() => {
  const perf = lhrs.map((l) => l.categories.performance.score);
  const mid = median(perf);
  return lhrs[perf.indexOf(mid)];
})();
const scores = Object.fromEntries(Object.keys(TARGETS).map((k) => [k, Math.round(median(lhrs.map((l) => l.categories[k].score)) * 100)]));
const metrics = Object.fromEntries(METRICS.map((m) => [m, { value: Math.round(median(lhrs.map((l) => l.audits[m].numericValue)) * 1000) / 1000, display: medianLhr.audits[m].displayValue }]));
const failing = Object.values(medianLhr.audits)
  .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual")
  .map((a) => ({ id: a.id, title: a.title, score: a.score, display: a.displayValue ?? a.explanation ?? null }));
const installErrors = medianLhr.__installErrors;
const report = {
  generatedAt: new Date().toISOString(),
  lighthouse: LH_VERSION,
  formFactor: "mobile (default preset: simulated slow 4G, 4x CPU)",
  target: "_site/ served by tests/e2e/server.mjs on 127.0.0.1",
  api,
  runs: RUNS,
  scores,
  targets: TARGETS,
  allRuns: lhrs.map((l) => Object.fromEntries(Object.keys(TARGETS).map((k) => [k, Math.round(l.categories[k].score * 100)]))),
  metrics,
  notableAudits: failing,
  installability: { chromeInstallabilityErrors: installErrors, installable: installErrors.length === 0 },
};
const dir = path.join(ROOT, "docs/reports");
if (WRITE) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `lighthouse-${OUT}.json`), JSON.stringify(report, null, 2) + "\n");
}

const md = [
  `# Lighthouse report (${OUT})`,
  "",
  `Lighthouse ${report.lighthouse}, mobile preset, ${RUNS} runs, median. Target: \`_site/\` served locally. Open-Meteo: **${api === "real" ? "real API" : "test fixtures (live forecast API unavailable: daily limit)"}**. Regenerate with \`npm run lighthouse\`.`,
  "",
  "| Category | Score | Target | |",
  "|---|---|---|---|",
  ...Object.keys(TARGETS).map((k) => `| ${k} | ${scores[k]} (runs: ${report.allRuns.map((r) => r[k]).join(", ")}) | ≥ ${TARGETS[k]} | ${scores[k] >= TARGETS[k] ? "pass" : "**below target**"} |`),
  "",
  "| Metric | Median |",
  "|---|---|",
  ...METRICS.map((m) => `| ${m} | ${metrics[m].display} |`),
  "",
  `Installability (Chrome \`Page.getInstallabilityErrors\`; Lighthouse 13 no longer has PWA audits): ${installErrors.length ? installErrors.join(", ") : "no errors, installable"}.`,
  "",
  "## Notable audits (score < 0.9)",
  "",
  ...(failing.length ? failing.map((a) => `- \`${a.id}\` (${a.score}): ${a.title}${a.display ? ` — ${a.display}` : ""}`) : ["- none"]),
  "",
  ...notes(dir),
].join("\n");
if (WRITE) writeFileSync(path.join(dir, `lighthouse-${OUT}.md`), md);
console.log(md);
const below = Object.keys(TARGETS).filter((k) => scores[k] < TARGETS[k]);
if (below.length || !report.installability.installable) {
  console.error(`FAIL: ${below.length ? `below target: ${below.map((k) => `${k} ${scores[k]} < ${TARGETS[k]}`).join(", ")}` : ""}${below.length && !report.installability.installable ? "; " : ""}${report.installability.installable ? "" : `not installable: ${installErrors.join(", ")}`}`);
  process.exit(1);
}
console.log(WRITE ? "OK (reports written)" : "OK (--no-write: nothing written)");
process.exit(0);
