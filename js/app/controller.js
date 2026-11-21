/**
 * Load/refresh logic for the Today screen. All side effects (network, cache,
 * storage, geolocation, clock) are injected so it can be unit-tested.
 * @module app/controller
 */
import { createStore } from "../store.js";
import { cacheKey } from "../cache.js";
import { toViewModel } from "../domain/derive.js";
import { evaluateAlerts, pickAlert } from "../rules/alerts.js";
import { readAlertState, recordShown, recordDismissed } from "./alert-state.js";

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
 * @property {{lat:number, lon:number, name:string, source:'gps'|'default'}|null} location
 */

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
 * @returns {{store: object, init: () => Promise<void>, refresh: (opts?: {relocate?: boolean}) => Promise<void>, refreshIfStale: () => Promise<void>, tick: () => void, dismissAlert: () => void}}
 */
export function createController({ api, cache, storage, now, geolocate, fetchImpl, defaultLocation = DEFAULT_LOCATION }) {
  /** @type {TodayState} */
  const initial = { status: "loading", vm: null, alert: null, fetchedAt: null, notice: null, error: null, location: null };
  const store = createStore(initial);

  let gen = 0;
  let loc = null;
  let forecastKey = null;
  let airKey = null;
  let raw = { forecast: null, air: null };

  function computeAlert(vm) {
    const nowMs = now();
    const date = String(vm.now.hourKey).slice(0, 10);
    let st = readAlertState(storage, date, nowMs);
    const alert = pickAlert(evaluateAlerts(vm, { ...st, nowMs }));
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

  async function load(location) {
    const myGen = ++gen;
    const sameLoc = loc && loc.lat === location.lat && loc.lon === location.lon;
    loc = location;
    forecastKey = cacheKey("forecast", location.lat, location.lon);
    airKey = cacheKey("air", location.lat, location.lon);
    if (!(sameLoc && raw.forecast)) {
      raw = { forecast: null, air: null };
      store.set({ status: "loading", vm: null, alert: null, error: null, fetchedAt: null, location });
    } else {
      store.set({ location });
    }

    let failed = false;
    const base = { cache, now, fetchImpl };
    const fKey = forecastKey;
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
        failed = false;
        rebuild("ready");
      },
    };
    const aKey = airKey;
    const airDeps = {
      ...base,
      onError: () => {},
      onUpdate: (fresh, meta) => {
        if (myGen !== gen || meta?.key !== aKey || !raw.forecast) return;
        raw.air = fresh[0] ?? null;
        rebuild(store.get().status === "stale" ? "stale" : "ready");
      },
    };

    try {
      const [forecast, air] = await Promise.all([
        api.getForecast([location], forecastDeps),
        api.getAirQuality([location], airDeps).catch(() => null),
      ]);
      if (myGen !== gen) return;
      raw.forecast = forecast[0];
      raw.air = air?.[0] ?? null;
      rebuild(failed ? "stale" : "ready");
    } catch (error) {
      if (myGen !== gen) return;
      if (raw.forecast) store.set({ status: "stale" });
      else store.set({ status: "error", vm: null, alert: null, error });
    }
  }

  return {
    store,

    /**
     * Resolve the location (GPS, else default Taichung) and load data.
     * @returns {Promise<void>}
     */
    async init() {
      store.set({ status: "loading", vm: null, alert: null, error: null });
      const r = await resolveLocation();
      store.set({ notice: r.notice });
      await load(r.location);
    },

    /**
     * Reload. With `relocate` the location is resolved again (location button);
     * otherwise the current location is reused (retry).
     * @param {{relocate?: boolean}} [opts]
     * @returns {Promise<void>}
     */
    async refresh({ relocate = false } = {}) {
      if (!loc || relocate) {
        const r = await resolveLocation();
        store.set({ notice: r.notice });
        return load(r.location);
      }
      return load(loc);
    },

    /**
     * Reload only when the cached forecast is not fresh (tab became visible).
     * @returns {Promise<void>}
     */
    async refreshIfStale() {
      if (!loc) return;
      if (cache?.get(forecastKey)?.fresh && store.get().status === "ready") return;
      return load(loc);
    },

    /**
     * Rebuild the view model from the data in memory when the local minute has
     * changed (keeps the clock current without a network call).
     * @returns {void}
     */
    tick() {
      const st = store.get();
      if (!raw.forecast || !st.vm || (st.status !== "ready" && st.status !== "stale")) return;
      const vm = toViewModel({ forecast: raw.forecast, air: raw.air, nowMs: now() });
      if (vm.now.minuteKey === st.vm.now.minuteKey) return;
      store.set({ vm, alert: computeAlert(vm) });
    },

    /**
     * Dismiss the shown alert for the rest of the local day (persisted).
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
