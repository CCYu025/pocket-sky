import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createController, placeKey, MAX_EXTRA_PLACES } from "../../js/app/controller.js";
import { createCache, cacheKey } from "../../js/cache.js";
import { getForecast, getAirQuality, __resetInflight } from "../../js/api/openmeteo.js";
import { addPlace, emptyPlaces, writePlaces, readCurrent, CURRENT_KEY, PLACES_KEY } from "../../js/app/places-state.js";

const fx = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-21T06:20:00Z"); // 14:20 Taipei
const multi = fx("forecast-multi.json");
const IDX_14 = 38;

/** Forecast for a place: the captured fixture with a distinct temperature and a fresh observation. */
function forecastWith(base, temp) {
  const f = structuredClone(base);
  f.current = { ...f.current, time: "2026-11-21T14:15", temperature_2m: temp, is_day: 1 };
  f.hourly.temperature_2m[IDX_14] = temp;
  return f;
}
const TAICHUNG = { lat: 24.15, lon: 120.67 }; // GPS
const WORK = { name: "公司", admin1: "臺中市", country: "臺灣", lat: 24.16, lon: 120.64, elevation: 83, timezone: "Asia/Taipei" };
const LAKE = { name: "日月潭", admin1: "南投縣", country: "臺灣", lat: 23.87, lon: 120.91, elevation: 748, timezone: "Asia/Taipei" };
const HOME = { name: "家", admin1: "彰化縣", country: "臺灣", lat: 24.08, lon: 120.54, elevation: 10, timezone: "Asia/Taipei" };
const FOURTH = { name: "墾丁", admin1: "屏東縣", country: "臺灣", lat: 21.95, lon: 120.78, elevation: 5, timezone: "Asia/Taipei" };
const TEMPS = { "24.15,120.67": 20, "24.16,120.64": 25, "23.87,120.91": 14, "24.08,120.54": 22, "21.95,120.78": 28 };

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

function setup({ geo = async () => TAICHUNG } = {}) {
  __resetInflight();
  const storage = memStorage();
  const clock = { t: NOW };
  const cache = createCache({ storage, now: () => clock.t });
  const calls = [];
  const fail = new Set(); // "lat,lon" strings that answer 500
  const air = fx("air-taichung.json");
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const id = `${u.searchParams.get("latitude")},${u.searchParams.get("longitude")}`;
    if (fail.has(id)) return new Response(JSON.stringify({ error: true, reason: "boom" }), { status: 500 });
    if (u.hostname.startsWith("air-quality")) return new Response(JSON.stringify(air), { status: 200 });
    const base = u.searchParams.get("latitude") === "23.87" ? multi[1] : multi[0];
    return new Response(JSON.stringify(forecastWith(base, TEMPS[id] ?? 19)), { status: 200 });
  };
  return { storage, clock, cache, calls, fail, fetchImpl, geo };
}

/** Controller; `spy` receives `{ kind, locs, deps }` of every API call. */
function make(ctx, spy) {
  return createController({
    api: {
      getForecast: (locs, deps) => (spy?.({ kind: "forecast", locs, deps }), getForecast(locs, deps)),
      getAirQuality: (locs, deps) => (spy?.({ kind: "air", locs, deps }), getAirQuality(locs, deps)),
    },
    cache: ctx.cache,
    storage: ctx.storage,
    now: () => ctx.clock.t,
    geolocate: ctx.geo,
    fetchImpl: ctx.fetchImpl,
  });
}

function savePlaces(storage, ...places) {
  let st = emptyPlaces();
  for (const p of places) st = addPlace(st, p).state;
  writePlaces(storage, st);
  return st.saved;
}
const forecastCalls = (ctx) => ctx.calls.filter((u) => u.includes("//api.open-meteo.com"));
const airCalls = (ctx) => ctx.calls.filter((u) => u.includes("air-quality-api"));

beforeEach(() => __resetInflight());

test("ensurePlace is lazy: nothing but the current place is requested until it is called", async () => {
  const ctx = setup();
  const c = make(ctx);
  await c.init();
  assert.equal(forecastCalls(ctx).length, 1);
  assert.equal(airCalls(ctx).length, 1);
  assert.deepEqual(c.store.get().places, {});
});

test("ensurePlace fetches one single-location forecast + air request with its own cache keys", async () => {
  const ctx = setup();
  const c = make(ctx);
  await c.init();
  const key = placeKey(LAKE);
  assert.equal(key, "om:v1:forecast:23.87,120.91");
  const done = c.ensurePlace(LAKE);
  assert.equal(c.store.get().places[key].status, "loading");
  assert.equal(c.store.get().places[key].vm, null);
  await done;
  const e = c.store.get().places[key];
  assert.equal(e.status, "ready");
  assert.equal(e.vm.now.temp, 14);
  assert.equal(e.vm.location.elevation, 747);
  assert.equal(e.fetchedAt, NOW);
  const lakeF = forecastCalls(ctx).filter((u) => u.includes("latitude=23.87"));
  const lakeA = airCalls(ctx).filter((u) => u.includes("latitude=23.87"));
  assert.equal(lakeF.length, 1);
  assert.equal(lakeA.length, 1);
  assert.match(lakeF[0], /latitude=23\.87&longitude=120\.91/, "a single location, not a comma-joined list");
  assert.ok(ctx.cache.get(key), "forecast cached under the place's own key");
  assert.ok(ctx.cache.get(cacheKey("air", 23.87, 120.91)), "air cached under its own key");
  // the current place is untouched
  assert.equal(c.store.get().vm.now.temp, 20);
  assert.equal(c.store.get().status, "ready");
});

test("ensurePlace is idempotent: shares an in-flight load, skips a fresh place, reloads a stale one", async () => {
  const ctx = setup();
  const c = make(ctx);
  await c.init();
  const before = forecastCalls(ctx).length;
  const a = c.ensurePlace(WORK);
  const b = c.ensurePlace(WORK);
  assert.equal(a, b, "same promise while loading");
  await a;
  assert.equal(forecastCalls(ctx).length, before + 1);
  await c.ensurePlace(WORK);
  assert.equal(forecastCalls(ctx).length, before + 1, "fresh: no request");
  ctx.clock.t = NOW + 20 * 60e3; // beyond the 15 min TTL
  await c.ensurePlace(WORK);
  assert.equal(forecastCalls(ctx).length, before + 2, "stale: refreshed");
});

test("onUpdate is routed to the entry whose cache key matches", async () => {
  const ctx = setup();
  const seen = [];
  const c = make(ctx, (x) => seen.push(x));
  await c.init();
  await c.ensurePlace(WORK);
  await c.ensurePlace(LAKE);
  const wk = placeKey(WORK);
  const lk = placeKey(LAKE);
  const depsOf = (p) => seen.find((x) => x.kind === "forecast" && x.locs[0].lat === p.lat).deps;
  const hot = forecastWith(multi[0], 40);
  const currentBefore = c.store.get().vm.now.temp;
  // a refresh for the work key lands: only the work entry changes
  depsOf(WORK).onUpdate([hot], { key: wk });
  assert.equal(c.store.get().places[wk].vm.now.temp, 40);
  assert.equal(c.store.get().places[lk].vm.now.temp, 14);
  assert.equal(c.store.get().vm.now.temp, currentBefore);
  // an update carrying another place's key is ignored
  depsOf(LAKE).onUpdate([forecastWith(multi[0], 99)], { key: wk });
  assert.equal(c.store.get().places[lk].vm.now.temp, 14);
  assert.equal(c.store.get().places[wk].vm.now.temp, 40);
});

test("a failing work/trip place is isolated: the current place stays ready, then a retry recovers", async () => {
  const ctx = setup();
  const c = make(ctx);
  await c.init();
  const vmBefore = c.store.get().vm;
  ctx.fail.add("23.87,120.91");
  await c.ensurePlace(LAKE);
  const k = placeKey(LAKE);
  assert.equal(c.store.get().places[k].status, "error");
  assert.equal(c.store.get().places[k].vm, null);
  assert.ok(c.store.get().places[k].error);
  assert.equal(c.store.get().status, "ready");
  assert.equal(c.store.get().error, null);
  assert.equal(c.store.get().vm, vmBefore, "the current view model object is untouched");
  ctx.fail.clear();
  await c.ensurePlace(LAKE);
  assert.equal(c.store.get().places[k].status, "ready");
});

test("a place with data goes stale (keeps its vm) when a refresh fails; the current place is unaffected", async () => {
  const ctx = setup();
  const c = make(ctx);
  await c.init();
  await c.ensurePlace(WORK);
  const k = placeKey(WORK);
  ctx.clock.t = NOW + 30 * 3600e3; // older than maxStale: the network is awaited, then the old value is used
  ctx.fail.add("24.16,120.64");
  await c.ensurePlace(WORK);
  assert.equal(c.store.get().places[k].status, "stale");
  assert.ok(c.store.get().places[k].vm, "the old data stays visible");
  assert.equal(c.store.get().places[k].fetchedAt, NOW);
  assert.equal(c.store.get().status, "ready");
});

test("a failing current place does not break loaded extra places", async () => {
  const ctx = setup();
  const c = make(ctx);
  await c.init();
  await c.ensurePlace(LAKE);
  ctx.fail.add("24.15,120.67");
  ctx.clock.t = NOW + 30 * 3600e3;
  await c.refresh();
  assert.equal(c.store.get().status, "stale");
  assert.equal(c.store.get().places[placeKey(LAKE)].status, "ready");
});

test("at most MAX_EXTRA_PLACES are kept; eviction spares `keep` and drops the oldest other", async () => {
  const ctx = setup();
  const c = make(ctx);
  await c.init();
  assert.equal(MAX_EXTRA_PLACES, 2);
  await c.ensurePlace(WORK);
  await c.ensurePlace(LAKE);
  await c.ensurePlace(HOME, { keep: [placeKey(WORK), placeKey(HOME)] });
  const keys = Object.keys(c.store.get().places);
  assert.deepEqual(keys.sort(), [placeKey(HOME), placeKey(WORK)].sort());
  await c.ensurePlace(FOURTH); // no keep: the least recently ensured (WORK) goes
  assert.deepEqual(Object.keys(c.store.get().places).sort(), [placeKey(HOME), placeKey(FOURTH)].sort());
});

test("selectCurrent(place): Today loads that place, persists ps:current, no GPS request", async () => {
  let geoCalls = 0;
  const ctx = setup({ geo: async () => (geoCalls++, TAICHUNG) });
  savePlaces(ctx.storage, LAKE);
  const c = make(ctx);
  await c.init();
  assert.equal(geoCalls, 1);
  const id = "p:23.87,120.91";
  await c.selectCurrent(id);
  const s = c.store.get();
  assert.equal(s.current, id);
  assert.equal(s.status, "ready");
  assert.equal(s.vm.now.temp, 14);
  assert.deepEqual([s.location.name, s.location.source, s.location.id], ["日月潭", "place", id]);
  assert.equal(s.notice, null);
  assert.equal(s.locating, false);
  assert.equal(readCurrent(ctx.storage), id);
  assert.equal(geoCalls, 1);
  assert.match(forecastCalls(ctx).at(-1), /latitude=23\.87&longitude=120\.91/);
});

test("selectCurrent('gps') or an unknown id relocates and stores 'gps'", async () => {
  let geoCalls = 0;
  const ctx = setup({ geo: async () => (geoCalls++, TAICHUNG) });
  savePlaces(ctx.storage, LAKE);
  const c = make(ctx);
  await c.init();
  await c.selectCurrent("p:23.87,120.91");
  await c.selectCurrent("gps");
  assert.equal(c.store.get().current, "gps");
  assert.equal(c.store.get().location.source, "gps");
  assert.equal(c.store.get().vm.now.temp, 20);
  assert.equal(readCurrent(ctx.storage), "gps");
  assert.equal(geoCalls, 2);
  await c.selectCurrent("p:9.99,9.99");
  assert.equal(c.store.get().current, "gps");
  assert.equal(geoCalls, 3);
});

test("init restores ps:current without asking for the position; a vanished place falls back to GPS", async () => {
  let geoCalls = 0;
  const ctx = setup({ geo: async () => (geoCalls++, TAICHUNG) });
  savePlaces(ctx.storage, LAKE);
  ctx.storage.setItem(CURRENT_KEY, "p:23.87,120.91");
  const c = make(ctx);
  await c.init();
  assert.equal(geoCalls, 0);
  assert.equal(c.store.get().vm.now.temp, 14);
  assert.equal(c.store.get().location.name, "日月潭");

  const ctx2 = setup({ geo: async () => (geoCalls++, TAICHUNG) });
  ctx2.storage.setItem(CURRENT_KEY, "p:23.87,120.91"); // no such saved place
  const c2 = make(ctx2);
  await c2.init();
  assert.equal(geoCalls, 1);
  assert.equal(c2.store.get().current, "gps");
  assert.equal(readCurrent(ctx2.storage), "gps");
  assert.ok(ctx2.storage.getItem(PLACES_KEY) === null);
});

test("selecting a place while GPS is still resolving: the place wins", async () => {
  let release;
  const ctx = setup({ geo: () => new Promise((r) => (release = () => r(TAICHUNG))) });
  savePlaces(ctx.storage, LAKE);
  const c = make(ctx);
  const init = c.init();
  await Promise.resolve();
  await c.selectCurrent("p:23.87,120.91");
  release();
  await init;
  assert.equal(c.store.get().current, "p:23.87,120.91");
  assert.equal(c.store.get().location.name, "日月潭");
  assert.equal(c.store.get().locating, false);
});

test("tick rebuilds extra places when the minute changes; refreshIfStale reloads stale ones", async () => {
  const ctx = setup();
  const c = make(ctx);
  await c.init();
  await c.ensurePlace(WORK);
  const k = placeKey(WORK);
  const m0 = c.store.get().places[k].vm.now.minuteKey;
  ctx.clock.t = NOW + 60e3;
  c.tick();
  assert.notEqual(c.store.get().places[k].vm.now.minuteKey, m0);
  const before = forecastCalls(ctx).length;
  ctx.clock.t = NOW + 20 * 60e3;
  await c.refreshIfStale();
  assert.equal(forecastCalls(ctx).length, before + 2, "current and work place both reloaded");
});
