import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createController, DEFAULT_LOCATION } from "../../js/app/controller.js";
import { createCache, cacheKey } from "../../js/cache.js";
import { ApiError, __resetInflight } from "../../js/api/openmeteo.js";
import { ALERTS_KEY } from "../../js/app/alert-state.js";

const fx = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-21T06:20:00Z"); // 14:20 Taipei

function dayForecast(mutate) {
  const f = fx("forecast-taichung.json");
  f.current = { ...f.current, time: "2026-11-21T14:15", is_day: 1 };
  if (mutate) mutate(f);
  return f;
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

/** Fake API honouring the real cache contract by delegating to the real client with a fake fetch. */
async function realApi() {
  return import("../../js/api/openmeteo.js");
}

function setup({ forecast = dayForecast(), air = fx("air-taichung.json"), geo = async () => ({ lat: 24.15, lon: 120.67 }), fail = false } = {}) {
  __resetInflight();
  const storage = memStorage();
  const clock = { t: NOW };
  const cache = createCache({ storage, now: () => clock.t });
  const calls = [];
  const state = { fail };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (state.fail) return new Response(JSON.stringify({ error: true, reason: "boom" }), { status: 500 });
    const body = url.includes("air-quality") ? air : forecast;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { storage, clock, cache, calls, state, fetchImpl, geo };
}

async function make(ctx) {
  const api = await realApi();
  const c = createController({
    api: { getForecast: api.getForecast, getAirQuality: api.getAirQuality },
    cache: ctx.cache,
    storage: ctx.storage,
    now: () => ctx.clock.t,
    geolocate: ctx.geo,
    fetchImpl: ctx.fetchImpl,
  });
  return c;
}

beforeEach(() => __resetInflight());

test("fresh load: loading then ready with GPS location", async () => {
  const ctx = setup();
  const c = await make(ctx);
  const seen = [];
  c.store.subscribe((s) => seen.push(s.status));
  await c.init();
  const s = c.store.get();
  assert.equal(seen[0], "loading");
  assert.equal(s.status, "ready");
  assert.equal(s.location.name, "目前位置");
  assert.equal(s.location.source, "gps");
  assert.equal(s.notice, null);
  assert.equal(s.vm.now.minuteKey, "2026-11-21T14:20");
  assert.equal(s.vm.air.aqi, 84);
  assert.equal(s.fetchedAt, NOW);
  assert.equal(s.alert, null);
  assert.match(ctx.calls[0], /latitude=24\.15&longitude=120\.67/);
});

test("geolocation denied falls back to default Taichung with a notice", async () => {
  const ctx = setup({ geo: async () => { throw Object.assign(new Error("denied"), { code: 1 }); } });
  const c = await make(ctx);
  await c.init();
  const s = c.store.get();
  assert.equal(s.status, "ready");
  assert.equal(s.location.name, "臺中（預設）");
  assert.equal(s.location.source, "default");
  assert.equal(s.notice, "使用預設地點：臺中");
  assert.equal(s.location.lat, DEFAULT_LOCATION.lat);
  assert.match(ctx.calls[0], /latitude=24\.16&longitude=120\.64/);
});

test("API error with cached data (stale, over-age) -> stale state keeps data and old fetch time", async () => {
  const ctx = setup();
  const c = await make(ctx);
  await c.init();
  ctx.clock.t = NOW + 30 * 3600e3; // older than maxStale (24 h): network awaited, then fallback
  ctx.state.fail = true;
  await c.refresh();
  const s = c.store.get();
  assert.equal(s.status, "stale");
  assert.ok(s.vm);
  assert.equal(s.fetchedAt, NOW);
});

test("API error during background refresh of a stale-but-young entry -> stale", async () => {
  const ctx = setup();
  const c = await make(ctx);
  await c.init();
  ctx.clock.t = NOW + 20 * 60e3; // > 15 min TTL, < 24 h
  ctx.state.fail = true;
  await c.refresh();
  // cached value is returned immediately; the failed background refresh then flags stale
  await new Promise((r) => setTimeout(r, 20));
  const s = c.store.get();
  assert.equal(s.status, "stale");
  assert.equal(s.fetchedAt, NOW);
});

test("API error without data -> error state with no vm", async () => {
  const ctx = setup({ fail: true });
  const c = await make(ctx);
  await c.init();
  const s = c.store.get();
  assert.equal(s.status, "error");
  assert.equal(s.vm, null);
  assert.ok(s.error instanceof ApiError);
});

test("retry after error recovers to ready", async () => {
  const ctx = setup({ fail: true });
  const c = await make(ctx);
  await c.init();
  assert.equal(c.store.get().status, "error");
  ctx.state.fail = false;
  await c.refresh();
  assert.equal(c.store.get().status, "ready");
  assert.equal(c.store.get().error, null);
});

test("onUpdate for a different location key is ignored; matching key updates", async () => {
  const ctx = setup();
  const seenDeps = [];
  const realApiMod = await realApi();
  const c = createController({
    api: {
      getForecast: (locs, deps) => { seenDeps.push(deps); return realApiMod.getForecast(locs, deps); },
      getAirQuality: realApiMod.getAirQuality,
    },
    cache: ctx.cache, storage: ctx.storage, now: () => ctx.clock.t, geolocate: ctx.geo, fetchImpl: ctx.fetchImpl,
  });
  await c.init();
  const before = c.store.get();
  const other = dayForecast((f) => { f.current.temperature_2m = 40; f.current.time = "2026-11-21T14:15"; });
  seenDeps[0].onUpdate([other], { key: cacheKey("forecast", 10, 10) });
  assert.equal(c.store.get(), before, "state object unchanged");
  assert.notEqual(c.store.get().vm.now.temp, 40);

  const own = dayForecast((f) => { f.current.temperature_2m = 40; });
  seenDeps[0].onUpdate([own], { key: cacheKey("forecast", 24.15, 120.67) });
  assert.equal(c.store.get().vm.now.temp, 40);
  assert.equal(c.store.get().status, "ready");
});

test("rainy forecast yields an alert; dismiss persists to ps:alerts and survives a new controller", async () => {
  const rainy = dayForecast((f) => [10, 40, 70, 65].forEach((v, i) => (f.hourly.precipitation_probability[38 + i] = v)));
  const ctx = setup({ forecast: rainy });
  const c = await make(ctx);
  await c.init();
  const alert = c.store.get().alert;
  assert.equal(alert.kind, "rainJump");
  assert.equal(alert.id, "rainJump:2026-11-21T16:00");
  const stored = JSON.parse(ctx.storage.getItem(ALERTS_KEY));
  assert.equal(stored.lastShownId.rainJump, "rainJump:2026-11-21T16:00");
  assert.equal(stored.lastShown.rainJump, NOW);

  // re-render of the same alert keeps showing it and does not restart the cooldown
  ctx.clock.t = NOW + 5 * 60e3;
  await c.refresh();
  assert.equal(c.store.get().alert?.id, "rainJump:2026-11-21T16:00");
  assert.equal(JSON.parse(ctx.storage.getItem(ALERTS_KEY)).lastShown.rainJump, NOW);

  c.dismissAlert();
  assert.equal(c.store.get().alert, null);
  assert.deepEqual(JSON.parse(ctx.storage.getItem(ALERTS_KEY)).dismissed, { "rainJump:2026-11-21T16:00": true });

  __resetInflight();
  const c2 = await make(ctx);
  await c2.init();
  assert.equal(c2.store.get().alert, null);
});

test("alert state: older days and old-format ids are pruned/ignored", async () => {
  const rainy = dayForecast((f) => [10, 40, 70, 65].forEach((v, i) => (f.hourly.precipitation_probability[38 + i] = v)));
  const ctx = setup({ forecast: rainy });
  ctx.storage.setItem(ALERTS_KEY, JSON.stringify({
    dismissed: {
      "rainJump:2026-11-20T16:00": true, // yesterday's event: pruned
      "rainJump:2026-11-21": true, // old per-day id format: unknown, pruned (does not hide today's event)
      "tempDrop:2026-11-21T17:00": true, // today's event: kept
    },
    lastShown: { tempDrop: NOW - 1000 },
    lastShownId: { rainJump: "rainJump:2026-11-21", tempDrop: "tempDrop:2026-11-21T17:00" },
  }));
  const c = await make(ctx);
  await c.init();
  assert.equal(c.store.get().alert.id, "rainJump:2026-11-21T16:00");
  const stored = JSON.parse(ctx.storage.getItem(ALERTS_KEY));
  assert.deepEqual(stored.dismissed, { "tempDrop:2026-11-21T17:00": true });
  assert.equal(stored.lastShownId.rainJump, "rainJump:2026-11-21T16:00");
});

test("tick advances the clock without network; refreshIfStale skips a fresh cache", async () => {
  const ctx = setup();
  const c = await make(ctx);
  await c.init();
  const n = ctx.calls.length;
  ctx.clock.t = NOW + 5 * 60e3;
  c.tick();
  assert.equal(c.store.get().vm.now.minuteKey, "2026-11-21T14:25");
  await c.refreshIfStale();
  assert.equal(ctx.calls.length, n);
  ctx.clock.t = NOW + 20 * 60e3;
  await c.refreshIfStale();
  assert.ok(ctx.calls.length > n);
});

