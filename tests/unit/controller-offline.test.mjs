import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createController, placeKey, OFFLINE_ERROR } from "../../js/app/controller.js";
import { createCache, cacheKey } from "../../js/cache.js";
import { getForecast, getAirQuality, __resetInflight } from "../../js/api/openmeteo.js";
import { dataBannerText, OFFLINE_EMPTY_TEXT } from "../../js/ui/format.js";
import { errorText } from "../../js/ui/views/today.js";
import { createAnnouncer } from "../../js/ui/announce.js";
import { todayHtml } from "../../js/ui/views/today.js";

const fx = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-21T06:20:00Z"); // 14:20 Taipei
const H = 3600 * 1000;
const GPS = { lat: 24.15, lon: 120.67 };
const WORK = { id: "p:24.80,120.97", name: "新竹", lat: 24.8, lon: 120.97 };

function dayForecast() {
  const f = fx("forecast-taichung.json");
  f.current = { ...f.current, time: "2026-11-21T14:15", is_day: 1 };
  return f;
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

/** Shared storage + cache + clock; every `make()` is a fresh controller (a page reload) over them. */
function setup() {
  __resetInflight();
  const storage = memStorage();
  const clock = { t: NOW };
  const cache = createCache({ storage, now: () => clock.t });
  const calls = [];
  const net = { fail: false, hold: null, online: true };
  const air = fx("air-taichung.json");
  const forecast = dayForecast();
  const fetchImpl = async (url) => {
    calls.push(url);
    if (net.hold) await net.hold;
    if (net.fail) return new Response(JSON.stringify({ error: true, reason: "boom" }), { status: 500 });
    return new Response(JSON.stringify(url.includes("air-quality") ? air : forecast), { status: 200 });
  };
  const make = (extra = {}) =>
    createController({
      api: { getForecast, getAirQuality },
      cache, storage, now: () => clock.t, geolocate: async () => GPS, fetchImpl,
      onLine: () => net.online, ...extra,
    });
  const kinds = () => ({ forecast: calls.filter((u) => !u.includes("air-quality")).length, air: calls.filter((u) => u.includes("air-quality")).length });
  return { storage, clock, cache, calls, net, make, kinds, fetchImpl };
}
const tick = () => new Promise((r) => setImmediate(r));
const gate = () => {
  let release;
  const p = new Promise((r) => (release = r));
  return { p, release };
};

beforeEach(() => __resetInflight());

// ---- api: preferCached ----

test("api preferCached: an entry older than maxStaleMs is returned at once and refreshed in the background", async () => {
  const s = setup();
  s.cache.set(cacheKey("forecast", 24.15, 120.67), [{ marker: "old" }], 15 * 60 * 1000);
  s.clock.t = NOW + 30 * H;
  const g = gate();
  s.net.hold = g.p;
  const updates = [];
  const deps = { cache: s.cache, now: () => s.clock.t, fetchImpl: s.fetchImpl, onUpdate: (v) => updates.push(v) };
  const got = await getForecast([GPS], { ...deps, preferCached: true });
  assert.equal(got[0].marker, "old", "no wait for the network");
  assert.equal(s.calls.length, 1, "a refresh was started");
  g.release();
  await tick(); await tick();
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0].current.time, "2026-11-21T14:15");
});

test("api without preferCached keeps the contract: an over-age entry waits for the network", async () => {
  const s = setup();
  s.cache.set(cacheKey("forecast", 24.15, 120.67), [{ marker: "old" }], 15 * 60 * 1000);
  s.clock.t = NOW + 30 * H;
  const got = await getForecast([GPS], { cache: s.cache, now: () => s.clock.t, fetchImpl: s.fetchImpl});
  assert.equal(got[0].marker, undefined);
  assert.equal(got[0].current.time, "2026-11-21T14:15");
});

// ---- controller: entries older than maxStaleMs ----

async function seeded(s) {
  const c = s.make();
  await c.init();
  s.calls.length = 0;
}

test("> 24 h cache: rendered at once as stale + refreshing (`更新中…`), then ready when the refresh lands", async () => {
  const s = setup();
  await seeded(s);
  s.clock.t = NOW + 25 * H;
  const g = gate();
  s.net.hold = g.p;
  const c = s.make();
  const seen = [];
  c.store.subscribe((st) => seen.push(`${st.status}${st.refreshing ? "+r" : ""}`));
  await c.init();
  const st = c.store.get();
  assert.equal(st.status, "stale");
  assert.equal(st.refreshing, true);
  assert.ok(st.vm, "data is on screen without waiting for the network");
  assert.equal(st.fetchedAt, NOW);
  assert.ok(!seen.includes("loading+r"));
  assert.equal(dataBannerText({ fetchedAt: st.fetchedAt, vm: st.vm, refreshing: true }), "資料時間 11/21 14:20・更新中…");
  assert.match(todayHtml(st), /資料時間 11\/21 14:20・更新中…/);
  g.release();
  await tick(); await tick(); await tick();
  const done = c.store.get();
  assert.equal(done.status, "ready");
  assert.equal(done.refreshing, false);
  assert.doesNotMatch(todayHtml(done), /class="banner" data-k="stale"/);
  assert.deepEqual(s.kinds(), { forecast: 1, air: 1 });
});

test("> 24 h cache + failed refresh: banner turns into `無法更新`, the data stays", async () => {
  const s = setup();
  await seeded(s);
  s.clock.t = NOW + 25 * H;
  s.net.fail = true;
  const c = s.make();
  await c.init();
  await tick(); await tick(); await tick();
  const st = c.store.get();
  assert.equal(st.status, "stale");
  assert.equal(st.refreshing, false);
  assert.ok(st.vm);
  assert.match(todayHtml(st), /資料時間 11\/21 14:20・無法更新/);
});

test("a stale entry younger than 24 h keeps the old behaviour: ready while it refreshes (no banner)", async () => {
  const s = setup();
  await seeded(s);
  s.clock.t = NOW + 2 * H;
  const g = gate();
  s.net.hold = g.p;
  const c = s.make();
  await c.init();
  assert.equal(c.store.get().status, "ready");
  assert.equal(c.store.get().refreshing, false);
  g.release();
  await tick(); await tick(); await tick();
  assert.equal(c.store.get().status, "ready");
});

test("an extra place older than 24 h is also shown at once (stale + refreshing)", async () => {
  const s = setup();
  const c0 = s.make();
  await c0.init();
  await c0.ensurePlace(WORK);
  s.calls.length = 0;
  s.clock.t = NOW + 26 * H;
  const g = gate();
  s.net.hold = g.p;
  const c = s.make();
  await c.init();
  await c.ensurePlace(WORK);
  const e = c.store.get().places[placeKey(WORK)];
  assert.equal(e.status, "stale");
  assert.equal(e.refreshing, true);
  assert.ok(e.vm);
  g.release();
  await tick(); await tick(); await tick(); await tick();
  const after = c.store.get().places[placeKey(WORK)];
  assert.equal(after.status, "ready");
  assert.equal(after.refreshing, false);
});

// ---- offline ----

test("offline with a cache: no request at all, data shown as stale + offline (any age)", async () => {
  const s = setup();
  await seeded(s);
  s.clock.t = NOW + 40 * H; // far beyond maxStaleMs
  s.net.online = false;
  const c = s.make();
  await c.init();
  const st = c.store.get();
  assert.equal(s.calls.length, 0, "no requests while offline");
  assert.equal(st.status, "stale");
  assert.equal(st.offline, true);
  assert.equal(st.refreshing, false);
  assert.ok(st.vm.air, "cached air is used too");
  assert.equal(dataBannerText({ fetchedAt: st.fetchedAt, vm: st.vm, offline: true }), "離線中・顯示 11/21 14:20 的資料", "40 h old: the date joins the stamp");
  assert.match(todayHtml(st), /離線中・顯示 11\/21 14:20 的資料/);
});

test("offline without a cache: error state with the offline message, no request, no retry key", async () => {
  const s = setup();
  s.net.online = false;
  const c = s.make();
  await c.init();
  const st = c.store.get();
  assert.equal(s.calls.length, 0);
  assert.equal(st.status, "error");
  assert.equal(st.error, OFFLINE_ERROR);
  assert.equal(st.offline, true);
  assert.equal(errorText(st.error), "離線中，沒有可顯示的資料");
  assert.equal(OFFLINE_EMPTY_TEXT, "離線中，沒有可顯示的資料");
  const html = todayHtml(st);
  assert.match(html, /離線中，沒有可顯示的資料/);
  assert.doesNotMatch(html, /data-action="retry"/);
});

test("the announcer says the offline message once when entering the offline error", () => {
  const a = createAnnouncer();
  assert.equal(a.next({ status: "error", error: OFFLINE_ERROR, vm: null }), "離線中，沒有可顯示的資料");
  assert.equal(a.next({ status: "error", error: OFFLINE_ERROR, vm: null }), null);
});

test("`online` after an offline start: exactly one forecast and one air request, then ready", async () => {
  const s = setup();
  await seeded(s);
  s.clock.t = NOW + 3 * H;
  s.net.online = false;
  const c = s.make();
  await c.init();
  assert.equal(s.calls.length, 0);
  s.net.online = true;
  await c.goOnline();
  assert.equal(c.store.get().status, "stale", "still the old data while the refresh is in flight");
  assert.equal(c.store.get().refreshing, true);
  await tick(); await tick(); await tick();
  assert.deepEqual(s.kinds(), { forecast: 1, air: 1 });
  const st = c.store.get();
  assert.equal(st.offline, false);
  assert.equal(st.status, "ready");
  assert.equal(st.fetchedAt, NOW + 3 * H);
});

test("`online` with no cache at all recovers from the offline error", async () => {
  const s = setup();
  s.net.online = false;
  const c = s.make();
  await c.init();
  s.net.online = true;
  await c.goOnline();
  assert.equal(c.store.get().status, "ready");
  assert.equal(c.store.get().error, null);
  assert.deepEqual(s.kinds(), { forecast: 1, air: 1 });
});

test("`offline` event flags the state without a request and keeps the data on screen", async () => {
  const s = setup();
  const c = s.make();
  await c.init();
  s.calls.length = 0;
  s.net.online = false;
  c.goOffline();
  const st = c.store.get();
  assert.equal(st.offline, true);
  assert.equal(st.status, "ready");
  assert.match(todayHtml(st), /離線中・顯示 14:20 的資料/);
  await c.refreshIfStale();
  await c.refresh();
  assert.equal(s.calls.length, 0, "refresh while offline reads the cache only");
  assert.equal(c.store.get().status, "stale");
});

test("offline: extra places show cached data, or the offline error when nothing is cached; online refreshes the wanted one", async () => {
  const s = setup();
  const c0 = s.make();
  await c0.init();
  await c0.ensurePlace(WORK);
  const LAKE = { id: "p:23.87,120.91", name: "日月潭", lat: 23.87, lon: 120.91 };
  s.clock.t = NOW + 3 * H;
  s.calls.length = 0;
  s.net.online = false;
  const c = s.make();
  await c.init();
  await c.ensurePlace(WORK);
  await c.ensurePlace(LAKE);
  assert.equal(s.calls.length, 0);
  const w = c.store.get().places[placeKey(WORK)];
  assert.equal(w.status, "stale");
  assert.ok(w.vm);
  const l = c.store.get().places[placeKey(LAKE)];
  assert.equal(l.status, "error");
  assert.equal(l.error, OFFLINE_ERROR);
  s.net.online = true;
  await c.goOnline({ wanted: [placeKey(WORK)], active: [placeKey(WORK), placeKey(LAKE)] });
  await tick(); await tick(); await tick(); await tick();
  assert.equal(c.store.get().places[placeKey(WORK)].status, "ready");
  assert.deepEqual(s.kinds(), { forecast: 2, air: 2 }, "current place + the wanted work place, once each");
});

test("offline `refreshIfStale` keeps ready data ready (no stale transition, no announcement, no request)", async () => {
  const s = setup();
  const c = s.make();
  await c.init();
  await c.ensurePlace(WORK);
  const a = createAnnouncer();
  a.next(c.store.get());
  s.clock.t = NOW + 20 * 60 * 1000; // the cache entries are no longer fresh
  s.calls.length = 0;
  s.net.online = false;
  c.goOffline();
  await c.refreshIfStale({ wanted: [placeKey(WORK)] });
  const st = c.store.get();
  assert.equal(s.calls.length, 0);
  assert.equal(st.offline, true);
  assert.equal(st.status, "ready", "still ready, only the offline banner shows");
  assert.equal(st.places[placeKey(WORK)].status, "ready");
  assert.equal(a.next(st), null, "nothing to announce");
});

test("a no-cache request in flight when the device goes offline ends in the offline message, not the generic error", async () => {
  const s = setup();
  const g = gate();
  s.net.hold = g.p;
  const c = s.make();
  const init = c.init();
  await tick(); await tick();
  assert.equal(c.store.get().status, "loading");
  s.net.online = false; // the connection drops while the request is pending
  c.goOffline();
  s.net.fail = true;
  g.release();
  await init;
  await tick(); await tick();
  const st = c.store.get();
  assert.equal(st.status, "error");
  assert.equal(st.error, OFFLINE_ERROR);
  assert.equal(errorText(st.error), OFFLINE_EMPTY_TEXT);
  assert.equal(st.offline, true);
});

test("the same for an extra place whose first request fails while offline", async () => {
  const s = setup();
  const c = s.make();
  await c.init();
  const g = gate();
  s.net.hold = g.p;
  const p = c.ensurePlace(WORK);
  await tick(); await tick();
  s.net.online = false;
  c.goOffline();
  s.net.fail = true;
  g.release();
  await p;
  await tick(); await tick();
  const e = c.store.get().places[placeKey(WORK)];
  assert.equal(e.status, "error");
  assert.equal(e.error, OFFLINE_ERROR);
});
