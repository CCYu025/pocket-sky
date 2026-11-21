import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createController, DEFAULT_LOCATION, GEO_TIMEOUT_MS, DEFAULT_NOTICE } from "../../js/app/controller.js";
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

async function make(ctx, extra = {}) {
  const api = await realApi();
  const c = createController({
    ...extra,
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

// ---------------------------------------------------------------------------
// Load ordering (forecast renders on its own; air is independent and non-fatal)
// ---------------------------------------------------------------------------
const FKEY = cacheKey("forecast", 24.16, 120.64);
const AKEY = cacheKey("air", 24.16, 120.64);
const denied = async () => { throw new Error("denied"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Controller on the real client with a fetch whose forecast/air responses the test controls. */
async function manual({ geo = denied, seed } = {}) {
  __resetInflight();
  const storage = memStorage();
  const clock = { t: NOW };
  const cache = createCache({ storage, now: () => clock.t });
  seed?.(cache, clock);
  const api = await realApi();
  const pending = { forecast: null, air: null };
  const fetchImpl = (url) => {
    const kind = url.includes("air-quality") ? "air" : "forecast";
    return new Promise((resolve) => {
      pending[kind] = (body, status = 200) => resolve(new Response(JSON.stringify(body), { status }));
    });
  };
  const c = createController({ api, cache, storage, now: () => clock.t, geolocate: geo, fetchImpl });
  const seen = [];
  c.store.subscribe((s) => seen.push({ status: s.status, temp: s.vm?.now?.temp ?? null, aqi: s.vm?.air?.aqi ?? null, loading: s.status === "loading" }));
  return { c, cache, clock, pending, seen, storage };
}

const withTemp = (t) => dayForecast((f) => { f.current.temperature_2m = t; });

test("fast forecast refresh then slow air: the stale cached forecast never overwrites fresh data", async () => {
  const m = await manual({
    seed: (cache, clock) => {
      clock.t = NOW - 3600e3;
      cache.set(FKEY, [withTemp(99)], 15 * 60e3);
      clock.t = NOW;
    },
  });
  const done = m.c.init();
  await sleep(10);
  assert.equal(m.c.store.get().status, "ready", "cached forecast renders without waiting for air");
  assert.equal(m.c.store.get().vm.now.temp, 99);
  m.pending.forecast([withTemp(11)]); // background refresh lands while air is still pending
  await sleep(10);
  assert.equal(m.c.store.get().vm.now.temp, 11);
  m.pending.air(fx("air-taichung.json"));
  await done;
  const s = m.c.store.get();
  assert.equal(s.vm.now.temp, 11, "final state shows the fresh forecast");
  assert.equal(s.vm.air.aqi, 84, "air is applied when it arrives");
  const temps = m.seen.map((x) => x.temp).filter((t) => t !== null);
  assert.deepEqual(temps.slice(temps.indexOf(11)), temps.slice(temps.indexOf(11)).map(() => 11), "no 99 after 11");
});

test("fresh forecast cache with hanging air: ready immediately, air null until it arrives", async () => {
  const m = await manual({ seed: (cache) => cache.set(FKEY, [dayForecast()], 15 * 60e3) });
  const done = m.c.init();
  await sleep(20);
  const s = m.c.store.get();
  assert.equal(s.status, "ready");
  assert.equal(s.vm.air, null);
  m.pending.air(fx("air-taichung.json"));
  await done;
  assert.equal(m.c.store.get().status, "ready");
  assert.equal(m.c.store.get().vm.air.aqi, 84);
});

test("air failure is non-fatal", async () => {
  const m = await manual({ seed: (cache) => cache.set(FKEY, [dayForecast()], 15 * 60e3) });
  const done = m.c.init();
  await sleep(10);
  m.pending.air({ error: true, reason: "boom" }, 500);
  await done;
  const s = m.c.store.get();
  assert.equal(s.status, "ready");
  assert.equal(s.vm.air, null);
});

test("stale banner does not flicker: a failing refresh of the same key never passes through ready", async () => {
  const f = dayForecast();
  const m = await manual({
    seed: (cache, clock) => {
      clock.t = NOW - 30 * 60e3;
      cache.set(FKEY, [f], 15 * 60e3);
      cache.set(AKEY, [fx("air-taichung.json")], 30 * 60e3);
      clock.t = NOW;
    },
  });
  const done = m.c.init();
  await sleep(10);
  m.pending.forecast({ error: true, reason: "x" }, 500); // background refresh fails -> stale
  await done;
  await sleep(20);
  assert.equal(m.c.store.get().status, "stale");

  m.seen.length = 0;
  const again = m.c.refreshIfStale(); // visibility change while the entry is still not fresh
  await sleep(10);
  assert.equal(m.c.store.get().status, "stale", "stays stale while the refresh is in flight");
  m.pending.forecast({ error: true, reason: "x" }, 500);
  await again;
  await sleep(20);
  assert.equal(m.c.store.get().status, "stale");
  assert.ok(!m.seen.some((x) => x.status === "ready"), `statuses: ${m.seen.map((x) => x.status)}`);
});

test("stale clears when the refresh succeeds", async () => {
  const m = await manual({
    seed: (cache, clock) => {
      clock.t = NOW - 30 * 60e3;
      cache.set(FKEY, [dayForecast()], 15 * 60e3);
      cache.set(AKEY, [fx("air-taichung.json")], 30 * 60e3);
      clock.t = NOW;
    },
  });
  const done = m.c.init();
  await sleep(10);
  m.pending.forecast({ error: true, reason: "x" }, 500);
  await done;
  await sleep(20);
  assert.equal(m.c.store.get().status, "stale");
  const again = m.c.refreshIfStale();
  await sleep(10);
  m.pending.forecast(withTemp(12));
  await again;
  await sleep(20);
  assert.equal(m.c.store.get().status, "ready");
  assert.equal(m.c.store.get().vm.now.temp, 12);
});

// ---------------------------------------------------------------------------
// Relocation
// ---------------------------------------------------------------------------
test("locating flag is true while the position is resolved", async () => {
  let release;
  const geo = () => new Promise((r) => { release = r; });
  const m = await manual({ geo });
  const p = m.c.init();
  assert.equal(m.c.store.get().locating, true);
  release({ lat: 24.15, lon: 120.67 });
  await sleep(5);
  assert.equal(m.c.store.get().locating, false);
  m.pending.forecast(dayForecast());
  m.pending.air(fx("air-taichung.json"));
  await p;
  assert.equal(m.c.store.get().status, "ready");

  const again = m.c.selectCurrent("gps");
  assert.equal(m.c.store.get().locating, true);
  release({ lat: 24.15, lon: 120.67 });
  await sleep(5);
  assert.equal(m.c.store.get().locating, false);
  m.pending.forecast?.(dayForecast());
  m.pending.air?.(fx("air-taichung.json"));
  await again;
});

test("overlapping relocations: the last request wins, earlier results are ignored", async () => {
  const ctx = setup();
  const resolvers = [];
  const geo = () => new Promise((r) => resolvers.push(r));
  const c = await make({ ...ctx, geo });
  const first = c.selectCurrent("gps");
  const second = c.selectCurrent("gps");
  assert.equal(resolvers.length, 2);
  resolvers[1]({ lat: 22.0, lon: 121.0 }); // newer request answers first
  await second;
  resolvers[0]({ lat: 25.0, lon: 121.5 }); // older request answers late
  await first;
  const s = c.store.get();
  assert.equal(s.status, "ready");
  assert.equal(s.location.lat, 22.0);
  assert.equal(s.locating, false);
  assert.ok(ctx.calls.every((u) => !/latitude=25\.00/.test(u)), ctx.calls.join("\n"));
});

test("GPS jitter within the same 2-dp cache key does not reload or flash loading", async () => {
  let pos = { lat: 24.15, lon: 120.67 };
  const ctx = setup({ geo: async () => pos });
  const c = await make(ctx);
  await c.init();
  const seen = [];
  c.store.subscribe((s) => seen.push(s.status));
  pos = { lat: 24.1504, lon: 120.6698 };
  await c.selectCurrent("gps");
  assert.ok(!seen.includes("loading"), `statuses: ${seen}`);
  assert.equal(c.store.get().status, "ready");
  assert.ok(c.store.get().vm);
  // a different place still reloads with a loading state
  pos = { lat: 24.2, lon: 120.67 };
  await c.selectCurrent("gps");
  assert.ok(seen.includes("loading"));
});

test("alert continuation: a moved event stays visible without restarting the cooldown; a dismissed one stays dismissed", async () => {
  const rainy = dayForecast((f) => [10, 40, 70, 65].forEach((v, i) => (f.hourly.precipitation_probability[38 + i] = v)));
  const prev = "rainJump:2026-11-21T17:00"; // earlier forecast put the rain an hour later
  const ctx = setup({ forecast: rainy });
  ctx.storage.setItem(ALERTS_KEY, JSON.stringify({ dismissed: {}, lastShown: { rainJump: NOW - 600e3 }, lastShownId: { rainJump: prev } }));
  const c = await make(ctx);
  await c.init();
  assert.equal(c.store.get().alert.id, "rainJump:2026-11-21T16:00");
  assert.equal(c.store.get().alert.continuation, true);
  const stored = JSON.parse(ctx.storage.getItem(ALERTS_KEY));
  assert.equal(stored.lastShownId.rainJump, "rainJump:2026-11-21T16:00");
  assert.equal(stored.lastShown.rainJump, NOW - 600e3);

  __resetInflight();
  const ctx2 = setup({ forecast: rainy });
  ctx2.storage.setItem(ALERTS_KEY, JSON.stringify({ dismissed: { [prev]: true }, lastShown: { rainJump: NOW - 600e3 }, lastShownId: { rainJump: prev } }));
  const c2 = await make(ctx2);
  await c2.init();
  assert.equal(c2.store.get().alert, null);
  const s2 = JSON.parse(ctx2.storage.getItem(ALERTS_KEY));
  assert.equal(s2.dismissed["rainJump:2026-11-21T16:00"], true);
  assert.equal(s2.lastShownId.rainJump, "rainJump:2026-11-21T16:00");
});

// ---------------------------------------------------------------------------
// Overall geolocation timeout
// ---------------------------------------------------------------------------
function fakeTimers() {
  let next = 1;
  const t = new Map();
  return {
    setTimer: (fn, ms) => { const id = next++; t.set(id, { fn, ms }); return id; },
    clearTimer: (id) => void t.delete(id),
    pending: () => [...t.values()],
    fireAll() { for (const [id, e] of [...t]) { t.delete(id); e.fn(); } },
  };
}

test("geolocation: no answer within GEO_TIMEOUT_MS (10 s) falls back to the default place; a late answer is ignored", async () => {
  assert.equal(GEO_TIMEOUT_MS, 10000);
  const timers = fakeTimers();
  let release;
  const ctx = setup({ geo: () => new Promise((r) => { release = r; }) });
  const c = await make(ctx, timers);
  const p = c.init();
  assert.equal(c.store.get().locating, true);
  assert.deepEqual(timers.pending().map((e) => e.ms), [GEO_TIMEOUT_MS]);
  timers.fireAll();
  await p;
  const s = c.store.get();
  assert.equal(s.locating, false);
  assert.equal(s.status, "ready");
  assert.equal(s.location.source, "default");
  assert.equal(s.notice, DEFAULT_NOTICE);
  release({ lat: 22, lon: 121 }); // too late
  await new Promise((r) => setImmediate(r));
  assert.equal(c.store.get().location.source, "default");
  assert.ok(ctx.calls.every((u) => !/latitude=22\.00/.test(u)));
});

test("geolocation: a position that arrives in time clears the timer", async () => {
  const timers = fakeTimers();
  const c = await make(setup(), timers);
  await c.init();
  assert.equal(timers.pending().length, 0);
  assert.equal(c.store.get().location.source, "gps");
});

test("geolocation: after an earlier fix a timeout keeps the previous position instead of jumping to the default", async () => {
  const timers = fakeTimers();
  let hang = false;
  const ctx = setup({ geo: () => (hang ? new Promise(() => {}) : Promise.resolve({ lat: 24.15, lon: 120.67 })) });
  const c = await make(ctx, timers);
  await c.init();
  hang = true;
  const p = c.selectCurrent("gps");
  assert.equal(c.store.get().locating, true);
  timers.fireAll();
  await p;
  const s = c.store.get();
  assert.equal(s.location.source, "gps");
  assert.equal(s.location.lat, 24.15);
  assert.equal(s.notice, "定位逾時，使用上次位置");
  assert.equal(s.locating, false);
});

test("geolocation: a superseded request's timeout is harmless (the latest request wins)", async () => {
  const timers = fakeTimers();
  const ctx = setup({ geo: () => new Promise(() => {}) });
  const c = await make(ctx, timers);
  c.selectCurrent("gps");
  c.selectCurrent("gps");
  timers.fireAll();
  await new Promise((r) => setImmediate(r));
  assert.equal(c.store.get().locating, false);
});
