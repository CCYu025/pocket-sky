/**
 * Open-Meteo API client: URL builders, fetch wrapper, and cached
 * (stale-while-revalidate) getters. Works in browsers and Node 20+.
 *
 * Cache integration is duck-typed (`deps.cache.get/set`) and this module does
 * NOT import `../cache.js`. Keys use the exact format of `cacheKey` from the
 * contract: `om:v1:{api}:{lat.toFixed(2)},{lon.toFixed(2)}`; multiple
 * locations are joined with `|`. Default TTLs equal the contract's `TTL`.
 * @module api/openmeteo
 */

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const AIR_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1/search';

/** Private TTL defaults (ms), identical to the contract's `TTL`. */
const DEFAULT_TTL = Object.freeze({
  forecast: 15 * 60 * 1000,
  air: 30 * 60 * 1000,
  geocoding: 30 * 24 * 60 * 60 * 1000,
});

/** Forecast query parameters (single source of truth). */
export const FORECAST_PARAMS = Object.freeze({
  current: Object.freeze(['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'is_day']),
  hourly: Object.freeze(['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation_probability', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'uv_index', 'visibility']),
  daily: Object.freeze(['temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset', 'daylight_duration', 'uv_index_max']),
  minutely_15: Object.freeze(['precipitation']),
  past_days: 1,
  forecast_days: 2,
  timezone: 'auto',
});

/** Air quality query parameters. */
export const AIR_PARAMS = Object.freeze({
  current: Object.freeze(['us_aqi', 'pm2_5']),
  hourly: Object.freeze(['us_aqi', 'pm2_5']),
  timezone: 'auto',
});

/** Attribution required by Open-Meteo's CC BY 4.0 licence. */
export const ATTRIBUTION = Object.freeze({
  text: 'Weather data by Open-Meteo.com',
  href: 'https://open-meteo.com/',
});

/** Error thrown for any failed Open-Meteo request. */
export class ApiError extends Error {
  /**
   * @param {string} reason Human-readable reason (or "timeout" / network message).
   * @param {number} [status=0] HTTP status, or 0 for timeout/network failures.
   */
  constructor(reason, status = 0) {
    super(reason);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Set params on a URLSearchParams, joining array values with commas.
 * @param {URLSearchParams} sp
 * @param {Record<string, string|number|readonly string[]>} params
 */
function addParams(sp, params) {
  for (const [k, v] of Object.entries(params)) {
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
}

/**
 * @param {Array<{lat:number, lon:number}>} locations
 * @returns {URLSearchParams}
 */
function locationParams(locations) {
  if (!Array.isArray(locations) || locations.length === 0) {
    throw new TypeError('locations must be a non-empty array of { lat, lon }');
  }
  const sp = new URLSearchParams();
  sp.set('latitude', locations.map((l) => l.lat).join(','));
  sp.set('longitude', locations.map((l) => l.lon).join(','));
  return sp;
}

/**
 * Build the forecast request URL.
 * @param {Array<{lat:number, lon:number}>} locations One or more locations (comma-joined).
 * @returns {string} Absolute URL.
 */
export function buildForecastUrl(locations) {
  const sp = locationParams(locations);
  addParams(sp, FORECAST_PARAMS);
  return `${FORECAST_BASE}?${sp}`;
}

/**
 * Build the air-quality request URL.
 * @param {Array<{lat:number, lon:number}>} locations One or more locations (comma-joined).
 * @returns {string} Absolute URL.
 */
export function buildAirQualityUrl(locations) {
  const sp = locationParams(locations);
  addParams(sp, AIR_PARAMS);
  return `${AIR_BASE}?${sp}`;
}

/**
 * Build the geocoding search URL.
 * @param {string} name Place name to search.
 * @param {{ count?: number, language?: string }} [opts]
 * @returns {string} Absolute URL.
 */
export function buildGeocodingUrl(name, { count = 5, language = 'zh' } = {}) {
  const sp = new URLSearchParams({ name, count: String(count), language, format: 'json' });
  return `${GEOCODING_BASE}?${sp}`;
}

/**
 * Fetch and parse JSON with a timeout, normalising all failures to ApiError.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<any>} Parsed JSON body.
 * @throws {ApiError} On HTTP error, `{error:true}` body, timeout (status 0, reason "timeout") or network failure (status 0).
 */
export async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Reject on abort even if fetchImpl ignores the signal.
  const aborted = new Promise((_, reject) => {
    ctrl.signal.addEventListener('abort', () => reject(new ApiError('timeout', 0)), { once: true });
  });
  aborted.catch(() => {});
  try {
    const work = (async () => {
      const res = await fetchImpl(url, { signal: ctrl.signal });
      let body = null;
      try {
        body = await res.json();
      } catch {
        if (res.ok) throw new ApiError('invalid JSON response', res.status);
      }
      if (!res.ok) {
        throw new ApiError(typeof body?.reason === 'string' ? body.reason : `HTTP ${res.status}`, res.status);
      }
      if (body && body.error === true) {
        throw new ApiError(typeof body.reason === 'string' ? body.reason : 'unknown error', res.status || 200);
      }
      return body;
    })();
    work.catch(() => {});
    return await Promise.race([work, aborted]);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (ctrl.signal.aborted) throw new ApiError('timeout', 0);
    throw new ApiError(err?.message ? String(err.message) : 'network error', 0);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cache key for forecast/air requests.
 * @param {string} api
 * @param {Array<{lat:number, lon:number}>} locations
 * @returns {string}
 */
function locKey(api, locations) {
  return `om:v1:${api}:${locations.map((l) => `${Number(l.lat).toFixed(2)},${Number(l.lon).toFixed(2)}`).join('|')}`;
}

/**
 * Stale-while-revalidate wrapper around a loader.
 * @param {{ key: string, ttlMs: number, load: () => Promise<any>, deps: object }} p
 * @returns {Promise<any>}
 */
async function swr({ key, ttlMs, load, deps }) {
  const { cache, onUpdate, onError } = deps;
  if (!cache) return load();
  const hit = cache.get(key);
  if (hit) {
    if (!hit.fresh) {
      // Background refresh: never throws, never rejects.
      (async () => {
        try {
          const fresh = await load();
          cache.set(key, fresh, ttlMs);
          if (onUpdate) onUpdate(fresh);
        } catch (err) {
          try {
            if (onError) onError(err);
          } catch { /* ignore errors thrown by the handler */ }
        }
      })();
    }
    return hit.value;
  }
  const value = await load();
  cache.set(key, value, ttlMs);
  return value;
}

/**
 * @typedef {object} ApiDeps
 * @property {typeof fetch} [fetchImpl] Fetch implementation (default global fetch).
 * @property {{ get(key:string): ({value:any, savedAt:number, fresh:boolean}|null), set(key:string, value:any, ttlMs:number): void }} [cache] Optional cache.
 * @property {() => number} [now] Clock (reserved; the cache owns time).
 * @property {number} [ttlMs] Override TTL for this call.
 * @property {number} [timeoutMs] Request timeout.
 * @property {(fresh:any) => void} [onUpdate] Called with refreshed data after a stale cache hit.
 * @property {(err:Error) => void} [onError] Called when a background refresh fails.
 */

/**
 * @param {any} body
 * @returns {any[]}
 */
const toArray = (body) => (Array.isArray(body) ? body : [body]);

/**
 * Get forecasts, one entry per location (always an array).
 * @param {Array<{lat:number, lon:number}>} locations
 * @param {ApiDeps} [deps]
 * @returns {Promise<object[]>}
 */
export function getForecast(locations, deps = {}) {
  const url = buildForecastUrl(locations);
  return swr({
    key: locKey('forecast', locations),
    ttlMs: deps.ttlMs ?? DEFAULT_TTL.forecast,
    load: async () => toArray(await fetchJson(url, { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs })),
    deps,
  });
}

/**
 * Get air-quality data, one entry per location (always an array).
 * @param {Array<{lat:number, lon:number}>} locations
 * @param {ApiDeps} [deps]
 * @returns {Promise<object[]>}
 */
export function getAirQuality(locations, deps = {}) {
  const url = buildAirQualityUrl(locations);
  return swr({
    key: locKey('air', locations),
    ttlMs: deps.ttlMs ?? DEFAULT_TTL.air,
    load: async () => toArray(await fetchJson(url, { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs })),
    deps,
  });
}

/**
 * Search places by name. Always returns an array (empty when nothing matches).
 * Cache key: `om:v1:geocoding:{language}:{count}:{lowercased name}`.
 * @param {string} name
 * @param {ApiDeps & { count?: number, language?: string }} [deps]
 * @returns {Promise<Array<{name:string, admin1:(string|undefined), country:(string|undefined), lat:number, lon:number, elevation:(number|undefined), timezone:(string|undefined)}>>}
 */
export function searchPlaces(name, deps = {}) {
  const opts = { count: deps.count ?? 5, language: deps.language ?? 'zh' };
  const url = buildGeocodingUrl(name, opts);
  return swr({
    key: `om:v1:geocoding:${opts.language}:${opts.count}:${String(name).trim().toLowerCase()}`,
    ttlMs: deps.ttlMs ?? DEFAULT_TTL.geocoding,
    load: async () => {
      const body = await fetchJson(url, { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs });
      return (body?.results ?? []).map((r) => ({
        name: r.name,
        admin1: r.admin1,
        country: r.country,
        lat: r.latitude,
        lon: r.longitude,
        elevation: r.elevation,
        timezone: r.timezone,
      }));
    },
    deps,
  });
}
