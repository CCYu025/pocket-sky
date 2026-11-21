import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import { launch, openApp, waitReady, runAxe, rainyForecast, nightForecast, NIGHT_UTC } from "./helpers.mjs";

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

/** Assert zero serious/critical axe violations; print the rest. */
async function check(name, page) {
  const all = await runAxe(page);
  const blocking = all.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = all.filter((v) => !blocking.includes(v));
  console.log(`# axe[${name}]: serious/critical=${blocking.length} minor/moderate=${minor.length}`);
  for (const v of minor) console.log(`#   ${v.impact} ${v.id} (${v.nodes} nodes) ${v.targets.join(" | ")}`);
  assert.deepEqual(blocking, [], `${name}: ${JSON.stringify(blocking, null, 1)}`);
}

async function scenario(name, opts, prep) {
  const app = await openApp(browser, server.url, opts);
  try {
    if (prep) await prep(app);
    else {
      await app.go();
      await waitReady(app.page);
    }
    await check(name, app.page);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test("axe: day", () => scenario("day", {}));
test("axe: night", () => scenario("night", { forecast: nightForecast(), now: NIGHT_UTC }));
test("axe: alert", () => scenario("alert", { forecast: rainyForecast() }));
test("axe: error", () =>
  scenario("error", { expectedErrors: [/status of 500/] }, async (app) => {
    app.mode.forecast = "500";
    await app.go();
    await app.page.locator('[data-action="retry"]').waitFor();
  }));
test("axe: loading", () =>
  scenario("loading", {}, async (app) => {
    app.mode.forecast = "hang";
    await app.go();
    await app.page.locator(".hero").waitFor();
  }));
test("axe: outing placeholder", () =>
  scenario("outing", {}, async (app) => {
    await app.go("#outing");
    await app.page.getByText("外出規劃：M3 開發中").waitFor();
  }));
