/**
 * Derive a UI-ready view model from normalized Open-Meteo responses.
 * Pure: no Date.now, fetch or storage. "Now" is injected as `nowMs`.
 * @module domain/derive
 */

import { localParts, addHours, indexOfHour, minutesUntil } from '../time.js';
import { describeWeather } from './weathercode.js';

/**
 * Coerce to a finite number, otherwise null (never undefined/NaN).
 * @param {*} v
 * @returns {number|null}
 */
export function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Coerce to a string, otherwise null.
 * @param {*} v
 * @returns {string|null}
 */
export function str(v) {
  return typeof v === 'string' ? v : null;
}

/**
 * Safe numeric lookup in a parallel array.
 * @param {Object|null|undefined} section Object holding arrays (e.g. `hourly`).
 * @param {string} field Array name.
 * @param {number} i Index (negative or out of range gives null).
 * @returns {number|null}
 */
function at(section, field, i) {
  const arr = section && section[field];
  return Array.isArray(arr) && i >= 0 ? num(arr[i]) : null;
}

/**
 * Index of a key in a `time` array of a section, or -1.
 * @param {Object|null|undefined} section
 * @param {string} key
 * @returns {number}
 */
function indexIn(section, key) {
  return indexOfHour(section && section.time, key);
}

/**
 * Build a Map of time key -> index for a section's time array.
 * @param {Object|null|undefined} section
 * @returns {Map<string, number>}
 */
function timeIndex(section) {
  const map = new Map();
  const times = section && section.time;
  if (Array.isArray(times)) times.forEach((t, i) => map.set(t, i));
  return map;
}

/**
 * Temperature difference between the current hour and the same hour yesterday.
 * Both sides use `hourly.temperature_2m` (not `current`) so they are measured
 * the same way; rounded to 1 decimal place.
 * @param {Object|null|undefined} hourly Forecast hourly section.
 * @param {string} hourKey Current floored hour key.
 * @returns {number|null} Delta in degrees, or null if either side is missing.
 */
export function computeYesterdayDelta(hourly, hourKey) {
  const now = at(hourly, 'temperature_2m', indexIn(hourly, hourKey));
  const prev = at(hourly, 'temperature_2m', indexIn(hourly, addHours(hourKey, -24)));
  if (now === null || prev === null) return null;
  // `|| 0` turns -0 (small negative deltas rounding to zero) into 0.
  return Math.round((now - prev) * 10) / 10 || 0;
}

/** Observations older (or further in the future) than this many minutes are not "current". */
const STALE_CURRENT_MINUTES = 90;

/**
 * Convert one forecast location (plus optional air quality) into a view model.
 * Hourly air quality is joined by hourKey, never by index. Missing sections or
 * values become `null` / empty arrays; this function does not throw on partial data.
 * @param {Object} args
 * @param {Object} args.forecast One normalized forecast location object.
 * @param {Object|null} [args.air=null] One air-quality location object, or null.
 * @param {number} args.nowMs Current epoch milliseconds (injected).
 * @param {number} [args.hoursAhead=24] Length of `hours` (entries from the current hour; capped by the data).
 * @returns {{
 *   location: {lat: number|null, lon: number|null, elevation: number|null, utcOffsetSeconds: number},
 *   now: Object, today: Object, yesterdayDelta: number|null,
 *   stale: {current: boolean, ageMinutes: number|null}, hoursAvailable: boolean,
 *   hours: Object[], minutely15: Object[], air: {aqi: number|null, pm25: number|null}|null
 * }} View model; see docs/ARCHITECTURE.md.
 */
export function toViewModel({ forecast, air = null, nowMs, hoursAhead = 24 }) {
  const f = forecast || {};
  const offset = num(f.utc_offset_seconds) ?? 0;
  const parts = localParts(offset, nowMs);
  const { hourKey, minuteKey } = parts;
  const cur = f.current || {};
  const hourly = f.hourly || null;

  // Staleness: `current` is trusted only if observed within 90 minutes of "now".
  const observedAt = str(cur.time);
  let ageMinutes = observedAt === null ? null : minutesUntil(observedAt, minuteKey);
  if (!Number.isFinite(ageMinutes)) ageMinutes = null;
  const staleCurrent = ageMinutes === null || Math.abs(ageMinutes) > STALE_CURRENT_MINUTES;

  let now;
  if (staleCurrent) {
    // Fall back to the hourly entry at hourKey (null when absent). Hourly has no
    // wind direction or is_day, so those are null rather than a stale observation.
    const hi = indexIn(hourly, hourKey);
    const code = at(hourly, 'weather_code', hi);
    now = {
      hourKey,
      minuteKey,
      observedAt,
      temp: at(hourly, 'temperature_2m', hi),
      feels: at(hourly, 'apparent_temperature', hi),
      humidity: at(hourly, 'relative_humidity_2m', hi),
      code,
      label: code === null ? null : describeWeather(code, true).label,
      wind: at(hourly, 'wind_speed_10m', hi),
      windDir: null,
      isDay: null,
    };
  } else {
    const code = num(cur.weather_code);
    const isDay = num(cur.is_day);
    now = {
      hourKey,
      minuteKey,
      observedAt,
      temp: num(cur.temperature_2m),
      feels: num(cur.apparent_temperature),
      humidity: num(cur.relative_humidity_2m),
      code,
      label: code === null ? null : describeWeather(code, isDay === 1).label,
      wind: num(cur.wind_speed_10m),
      windDir: num(cur.wind_direction_10m),
      isDay,
    };
  }

  // daily.time is date-only, so compare against the local date.
  const daily = f.daily || null;
  const di = indexIn(daily, parts.date);
  const today = {
    max: at(daily, 'temperature_2m_max', di),
    min: at(daily, 'temperature_2m_min', di),
    sunrise: di >= 0 && Array.isArray(daily.sunrise) ? str(daily.sunrise[di]) : null,
    sunset: di >= 0 && Array.isArray(daily.sunset) ? str(daily.sunset[di]) : null,
    daylightSeconds: at(daily, 'daylight_duration', di),
    uvMax: at(daily, 'uv_index_max', di),
  };

  // Air hourly is not aligned with forecast hourly: join by hourKey.
  const airHourly = air && air.hourly ? air.hourly : null;
  const airIdx = timeIndex(airHourly);

  const hours = [];
  const start = indexIn(hourly, hourKey);
  if (start >= 0) {
    const end = Math.min(start + hoursAhead, hourly.time.length);
    for (let i = start; i < end; i++) {
      const key = hourly.time[i];
      const ai = airIdx.has(key) ? airIdx.get(key) : -1;
      hours.push({
        hourKey: key,
        hour: Number(String(key).slice(11, 13)),
        temp: at(hourly, 'temperature_2m', i),
        feels: at(hourly, 'apparent_temperature', i),
        humidity: at(hourly, 'relative_humidity_2m', i),
        rainProb: at(hourly, 'precipitation_probability', i),
        rain: at(hourly, 'precipitation', i),
        code: at(hourly, 'weather_code', i),
        wind: at(hourly, 'wind_speed_10m', i),
        gust: at(hourly, 'wind_gusts_10m', i),
        uv: at(hourly, 'uv_index', i),
        visibility: at(hourly, 'visibility', i),
        aqi: at(airHourly, 'us_aqi', ai),
        pm25: at(airHourly, 'pm2_5', ai),
      });
    }
  }

  const m15 = f.minutely_15 || null;
  const slotMinute = Math.floor(parts.minute / 15) * 15;
  const slotKey = `${parts.date}T${hourKey.slice(11, 13)}:${String(slotMinute).padStart(2, '0')}`;
  const minutely15 = [];
  const si = indexIn(m15, slotKey);
  if (si >= 0) {
    const end = Math.min(si + 8, m15.time.length);
    for (let i = si; i < end; i++) {
      minutely15.push({ minuteKey: m15.time[i], rain: at(m15, 'precipitation', i) });
    }
  }

  const airCur = air && air.current ? air.current : null;
  return {
    location: {
      lat: num(f.latitude),
      lon: num(f.longitude),
      elevation: num(f.elevation),
      utcOffsetSeconds: offset,
    },
    now,
    today,
    yesterdayDelta: computeYesterdayDelta(hourly, hourKey),
    stale: { current: staleCurrent, ageMinutes },
    hoursAvailable: hours.length > 0,
    hours,
    minutely15,
    air: airCur ? { aqi: num(airCur.us_aqi), pm25: num(airCur.pm2_5) } : null,
  };
}
