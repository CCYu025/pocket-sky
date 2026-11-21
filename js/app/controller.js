/**
 * Load/refresh logic for the Today screen. All side effects (network, cache,
 * storage, geolocation, clock) are injected so it can be unit-tested.
 * @module app/controller
 */
import { createStore } from "../store.js";
import { cacheKey } from "../cache.js";
import { toViewModel } from "../domain/derive.js";
import { evaluateAlertsDetailed, pickAlert } from "../rules/alerts.js";
import { readAlertState, recordShown, recordDismissed, recordInheritedDismissal } from "./alert-state.js";
import { readPlaces, readCurrent, writeCurrent } from "./places-state.js";

/** Fallback location (Taichung). */
export const DEFAULT_LOCATION = Object.freeze({ lat: 24.16, lon: 120.64 });
export const GPS_NAME = "目前位置";
export const DEFAULT_NAME = "臺中（預設）";
export const DEFAULT_NOTICE = "使用預設地點：臺中";

/**
 * @typedef {object} TodayState
 * @property {'loading'|'ready'|'stale'|'error'} status
 * @property {object|null} vm View model (null while loading or on error without data).
 * @property {object|null} alert The alert to show, or null.
 * @property {number|null} fetchedAt Epoch ms the forecast was fetched (cache `savedAt`).
 * @property {string|null} notice Small notice line (e.g. default location in use).
 * @property {*} error Last error when `status === 'error'`.
 * @property {{lat:number, lon:number, name:string, source:'gps'|'default'|'place', id?:string}|null} location
 * @property {boolean} locating True while the device position is being resolved.
 * @property {string} current Current place: `'gps'` (default) or a saved place id (`ps:current`).
 * @property {Object<string, PlaceEntry>} places Extra places (work, trip destination) keyed by their forecast
 *   cache key; filled lazily by `ensurePlace`. Their errors never touch the fields above.
 */

/**
 * @typedef {object} PlaceEntry
 * @property {'loading'|'ready'|'stale'|'error'} status
 * @property {object|null} vm
 * @property {*} error
 * @property {number|null} fetchedAt
 */

/** Most extra places (work + trip) kept in memory; with the current place that is at most 3 live. */
export const MAX_EXTRA_PLACES = 2;

/**
 * Forecast cache key of a place (the key of its `controller.state.places` entry).
 * @param {{lat: number, lon: number}} place
 * @returns {string}
 */
export function placeKey(place) {
  return cacheKey("forecast", place.lat, place.lon);
}

/**
 * Create the Today controller.
 * @param {object} deps
 * @param {{getForecast: Function, getAirQuality: Function}} deps.api Open-Meteo client (see js/api/openmeteo.js).
 * @param {object} deps.cache Cache from `createCache`.
 * @param {Storage} [deps.storage] Storage for alert state.
 * @param {() => number} deps.now Epoch ms clock.
 * @param {() => Promise<{lat:number, lon:number}>} deps.geolocate Rejects when unavailable or denied.
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {{lat:number, lon:number}} [deps.defaultLocation]
 * @returns {{store: object, init: () => Promise<void>, refresh: (opts?: {relocate?: boolean}) => Promise<void>,
 *   selectCurrent: (id: string) => Promise<void>, ensurePlace: (place: object, opts?: {keep?: string[], force?: boolean}) => Promise<void>,
 *   refreshIfStale: () => Promise<void>, tick: () => void, dismissAlert: () => void}}
 */
export function createController({ api, cache, storage, now, geolocate, fetchImpl, defaultLocation = DEFAULT_LOCATION }) {
  /** @type {TodayState} */
  const initial = { status: "loading", vm: null, alert: null, fetchedAt: null, notice: null, error: null, location: null, locating: false, current: "gps", places: {} };
  const store = createStore(initial);

  let gen = 0; // load generation: results of an older load are ignored
  let locGen = 0; // locate generation: the last location request wins
  let loc = null;
  let forecastKey = null;
  let raw = { forecast: null, air: null };

  function computeAlert(vm) {
    const nowMs = now();
    const date = String(vm.now.hourKey).slice(0, 10);
    let st = readAlertState(storage, date, nowMs);
    const { alerts, inherited } = evaluateAlertsDetailed(vm, { ...st, nowMs });
    for (const a of inherited) st = recordInheritedDismissal(storage, st, a);
    const alert = pickAlert(alerts);
    if (alert) recordShown(storage, st, alert, nowMs);
    return alert;
  }

  function rebuild(status) {
    const vm = toViewModel({ forecast: raw.forecast, air: raw.air, nowMs: now() });
    const savedAt = cache?.get(forecastKey)?.savedAt;
    store.set({
      status,
      vm,
      alert: computeAlert(vm),
      fetchedAt: typeof savedAt === "number" ? savedAt : now(),
      error: null,
    });
  }

  /** Air data arrived (or refreshed): keep it, and rebuild the view if a forecast is already showing. */
  function applyAir(air) {
    raw.air = air;
    const { status } = store.get();
    if (raw.forecast && (status === "ready" || status === "stale")) rebuild(status);
  }

  async function resolveLocation() {
    try {
      const p = await geolocate();
      return { location: { lat: p.lat, lon: p.lon, name: GPS_NAME, source: "gps" }, notice: null };
    } catch {
      return {
        location: { ...defaultLocation, name: DEFAULT_NAME, source: "default" },
        notice: DEFAULT_NOTICE,
      };
    }
  }

  /**
   * Resolve the location; the latest request wins.
   * @returns {Promise<{location: object, notice: string|null}|null>} null when a newer request superseded this one.
   */
  async function locate() {
    const mine = ++locGen;
    store.set({ locating: true });
    const r = await resolveLocation();
    if (mine !== locGen) return null;
    store.set({ notice: r.notice, locating: false });
    return r;
  }

  async function load(location) {
    const myGen = ++gen;
    const fKey = cacheKey("forecast", location.lat, location.lon);
    const aKey = cacheKey("air", location.lat, location.lon);
    // Same place = same cache key (2 dp), so GPS jitter does not blank the screen.
    const sameLoc = Boolean(loc) && forecastKey === fKey;
    const wasStale = sameLoc && store.get().status === "stale";
    loc = location;
    forecastKey = fKey;
    if (!(sameLoc && raw.forecast)) {
      raw = { forecast: null, air: null };
      store.set({ status: "loading", vm: null, alert: null, error: null, fetchedAt: null, location });
    } else {
      store.set({ location });
    }

    let failed = false;
    let updated = false; // a background refresh already applied newer data
    const base = { cache, now, fetchImpl };
    const forecastDeps = {
      ...base,
      onError: (err) => {
        if (myGen !== gen || (err && err.phase === "onUpdate")) return;
        failed = true;
        if (raw.forecast) store.set({ status: "stale" });
      },
      onUpdate: (fresh, meta) => {
        if (myGen !== gen || meta?.key !== fKey) return;
        raw.forecast = fresh[0];
        updated = true;
        failed = false;
        rebuild("ready");
      },
    };
    const airDeps = {
      ...base,
      onError: () => {},
      onUpdate: (fresh, meta) => {
        if (myGen !== gen || meta?.key !== aKey) return;
        applyAir(fresh[0] ?? null);
      },
    };

    // Air is independent and non-fatal: it never delays the forecast render.
    const airDone = api.getAirQuality([location], airDeps).then(
      (air) => {
        if (myGen === gen) applyAir(air?.[0] ?? null);
      },
      () => {},
    );

    let forecast;
    try {
      forecast = await api.getForecast([location], forecastDeps);
    } catch (error) {
      if (myGen !== gen) return;
      if (raw.forecast) store.set({ status: "stale" });
      else store.set({ status: "error", vm: null, alert: null, error });
      return;
    }
    if (myGen !== gen) return;
    if (!updated) {
      raw.forecast = forecast[0];
      // A stale cache hit has a refresh in flight: stay "stale" until it lands (onUpdate) or fails.
      const entry = cache?.get(fKey);
      const refreshing = Boolean(entry) && !entry.fresh;
      rebuild(failed || (wasStale && refreshing) ? "stale" : "ready");
    }
    await airDone;
  }

  // ---- extra places (work, trip destination): one single-location fetch each, own cache keys ----
  /** @type {Map<string, {place: {lat: number, lon: number}, raw: {forecast: object|null, air: object|null}, gen: number, promise: Promise<void>|null}>} */
  const extra = new Map(); // insertion order = least recently ensured first

  /** Replace one entry of `state.places` (immutably) or drop it with `null`. */
  function setEntry(key, entry) {
    const places = { ...store.get().places };
    if (entry === null) delete places[key];
    else places[key] = entry;
    store.set({ places });
  }

  function rebuildPlace(key, status) {
    const rec = extra.get(key);
    if (!rec?.raw.forecast) return;
    const savedAt = cache?.get(key)?.savedAt;
    setEntry(key, {
      status,
      vm: toViewModel({ forecast: rec.raw.forecast, air: rec.raw.air, nowMs: now() }),
      error: null,
      fetchedAt: typeof savedAt === "number" ? savedAt : now(),
    });
  }

  async function loadPlace(place, key) {
    const rec = extra.get(key);
    const myGen = ++rec.gen;
    const aKey = cacheKey("air", place.lat, place.lon);
    const prev = store.get().places[key];
    if (!rec.raw.forecast) setEntry(key, { status: "loading", vm: null, error: null, fetchedAt: null });
    else if (prev && prev.status === "error") setEntry(key, { ...prev, status: "stale", error: null });
    let failed = false;
    let updated = false;
    const base = { cache, now, fetchImpl };
    const forecastDeps = {
      ...base,
      onError: (err) => {
        if (myGen !== rec.gen || (err && err.phase === "onUpdate")) return;
        failed = true;
        if (rec.raw.forecast) rebuildPlace(key, "stale");
      },
      onUpdate: (fresh, meta) => {
        if (myGen !== rec.gen || meta?.key !== key) return;
        rec.raw.forecast = fresh[0];
        updated = true;
        failed = false;
        rebuildPlace(key, "ready");
      },
    };
    const airDeps = {
      ...base,
      onError: () => {},
      onUpdate: (fresh, meta) => {
        if (myGen !== rec.gen || meta?.key !== aKey) return;
        rec.raw.air = fresh[0] ?? null;
        if (rec.raw.forecast) rebuildPlace(key, store.get().places[key]?.status ?? "ready");
      },
    };
    const airDone = api.getAirQuality([place], airDeps).then(
      (air) => {
        if (myGen !== rec.gen) return;
        rec.raw.air = air?.[0] ?? null;
        if (rec.raw.forecast) rebuildPlace(key, store.get().places[key]?.status ?? "ready");
      },
      () => {},
    );
    let forecast;
    try {
      forecast = await api.getForecast([place], forecastDeps);
    } catch (error) {
      if (myGen !== rec.gen) return;
      if (rec.raw.forecast) rebuildPlace(key, "stale");
      else setEntry(key, { status: "error", vm: null, error, fetchedAt: null });
      return;
    }
    if (myGen !== rec.gen) return;
    if (!updated) {
      rec.raw.forecast = forecast[0];
      const entry = cache?.get(key);
      rebuildPlace(key, failed || (Boolean(entry) && !entry.fresh) ? "stale" : "ready");
    }
    await airDone;
  }

  function startPlace(key) {
    const rec = extra.get(key);
    if (rec.promise) return rec.promise;
    rec.promise = loadPlace(rec.place, key).finally(() => {
      rec.promise = null;
    });
    return rec.promise;
  }

  /** Select the current place: `'gps'` or a saved place id. */
  async function selectCurrent(id) {
    const place = id === "gps" ? null : readPlaces(storage).saved.find((p) => p.id === id) ?? null;
    if (!place) {
      writeCurrent(storage, "gps");
      store.set({ current: "gps" });
      const r = await locate();
      return r ? load(r.location) : undefined;
    }
    writeCurrent(storage, place.id);
    locGen++; // a pending GPS request must not replace this choice
    store.set({ current: place.id, locating: false, notice: null });
    return load({ lat: place.lat, lon: place.lon, name: place.name, source: "place", id: place.id });
  }

  return {
    store,

    /**
     * Resolve the location (GPS, else default Taichung) and load data.
     * @returns {Promise<void>}
     */
    async init() {
      store.set({ status: "loading", vm: null, alert: null, error: null });
      const id = readCurrent(storage);
      const place = id === "gps" ? null : readPlaces(storage).saved.find((p) => p.id === id) ?? null;
      if (place) {
        store.set({ current: place.id });
        await load({ lat: place.lat, lon: place.lon, name: place.name, source: "place", id: place.id });
        return;
      }
      if (id !== "gps") writeCurrent(storage, "gps"); // the saved place is gone
      store.set({ current: "gps" });
      const r = await locate();
      if (r) await load(r.location);
    },

    /**
     * Make a saved place (`ps:places` id) or the device position (`'gps'`) the current place for
     * Today and exercise; persists `ps:current`. An unknown id falls back to `'gps'`.
     * @param {string} id
     * @returns {Promise<void>}
     */
    selectCurrent,

    /**
     * Lazily load an extra place (work, trip destination) with its own single-location forecast and
     * air requests (own cache keys, own stale-while-revalidate). Idempotent: an in-flight or fresh
     * place is not requested again; a stale or failed one is reloaded. Its state lives in
     * `store.get().places[placeKey(place)]`; failures stay there and never touch the current place.
     * At most `MAX_EXTRA_PLACES` are kept: the least recently ensured one that is not in `keep` is dropped.
     * @param {{lat: number, lon: number}} place
     * @param {{keep?: string[], force?: boolean}} [opts] `keep`: place keys that must survive eviction.
     * @returns {Promise<void>}
     */
    ensurePlace(place, { keep = [], force = false } = {}) {
      const key = placeKey(place);
      let rec = extra.get(key);
      if (rec) {
        extra.delete(key); // refresh recency
        extra.set(key, rec);
        const entry = store.get().places[key];
        const fresh = Boolean(entry) && entry.status === "ready" && cache?.get(key)?.fresh;
        if (rec.promise) return rec.promise;
        if (fresh && !force) return Promise.resolve();
      } else {
        rec = { place: { lat: place.lat, lon: place.lon }, raw: { forecast: null, air: null }, gen: 0, promise: null };
        extra.set(key, rec);
        for (const k of [...extra.keys()]) {
          if (extra.size <= MAX_EXTRA_PLACES) break;
          if (k === key || keep.includes(k) || extra.get(k).promise) continue;
          extra.get(k).gen++; // drop results still in flight
          extra.delete(k);
          setEntry(k, null);
        }
      }
      return startPlace(key);
    },

    /**
     * Reload. With `relocate` the location is resolved again (location button);
     * otherwise the current location is reused (retry).
     * @param {{relocate?: boolean}} [opts]
     * @returns {Promise<void>}
     */
    async refresh({ relocate = false } = {}) {
      if (!loc || relocate) {
        if (relocate) {
          writeCurrent(storage, "gps");
          store.set({ current: "gps" });
        }
        const r = await locate();
        return r ? load(r.location) : undefined;
      }
      return load(loc);
    },

    /**
     * Reload only when the cached forecast is not fresh (tab became visible).
     * @returns {Promise<void>}
     */
    async refreshIfStale() {
      if (!loc) return;
      const stalePlaces = [];
      for (const [key, rec] of extra) {
        const e = store.get().places[key];
        if (e && !rec.promise && !(e.status === "ready" && cache?.get(key)?.fresh)) stalePlaces.push(key);
      }
      const others = stalePlaces.map(startPlace);
      if (cache?.get(forecastKey)?.fresh && store.get().status === "ready") return void (await Promise.all(others));
      await Promise.all([load(loc), ...others]);
    },

    /**
     * Rebuild the view model from the data in memory when the local minute has
     * changed (keeps the clock current without a network call).
     * @returns {void}
     */
    tick() {
      const st = store.get();
      for (const [key, rec] of extra) {
        const e = st.places[key];
        if (rec.raw.forecast && e?.vm && (e.status === "ready" || e.status === "stale")) {
          const vm = toViewModel({ forecast: rec.raw.forecast, air: rec.raw.air, nowMs: now() });
          if (vm.now.minuteKey !== e.vm.now.minuteKey) setEntry(key, { ...e, vm });
        }
      }
      if (!raw.forecast || !st.vm || (st.status !== "ready" && st.status !== "stale")) return;
      const vm = toViewModel({ forecast: raw.forecast, air: raw.air, nowMs: now() });
      if (vm.now.minuteKey === st.vm.now.minuteKey) return;
      store.set({ vm, alert: computeAlert(vm) });
    },

    /**
     * Dismiss the shown alert event (persisted); other events are unaffected.
     * @returns {void}
     */
    dismissAlert() {
      const alert = store.get().alert;
      if (!alert) return;
      const vm = store.get().vm;
      const date = String(vm?.now?.hourKey ?? "").slice(0, 10);
      recordDismissed(storage, readAlertState(storage, date, now()), alert.id);
      store.set({ alert: null });
    },
  };
}
