/**
 * Pure display formatters for the Today screen (no DOM, no clock).
 * @module ui/format
 */
import { minutesUntil } from "../time.js";

const COMPASS = [
  "北", "北北東", "東北", "東北東", "東", "東南東", "東南", "南南東",
  "南", "南南西", "西南", "西南西", "西", "西北西", "西北", "北北西",
];
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * 16-point compass name in zh-Hant for a wind direction (the direction the wind blows from).
 * @param {number|null|undefined} deg Degrees, any real number (wrapped to 0-360).
 * @returns {string|null} e.g. 45 -> "東北"; null when `deg` is not a finite number.
 */
export function compassZh(deg) {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[i];
}

/**
 * WHO UV index band word, using the rounded index.
 * @param {number|null|undefined} uv
 * @returns {string|null} 低 (0-2) / 中 (3-5) / 高 (6-7) / 過量 (8-10) / 危險 (11+); null if no value.
 */
export function uvBand(uv) {
  if (typeof uv !== "number" || !Number.isFinite(uv)) return null;
  const r = Math.round(uv);
  if (r <= 2) return "低";
  if (r <= 5) return "中";
  if (r <= 7) return "高";
  if (r <= 10) return "過量";
  return "危險";
}

/**
 * US AQI band word (rounded index).
 * @param {number|null|undefined} aqi
 * @returns {string|null} 良好 (0-50) / 普通 (51-100) / 敏感族群注意 (101-150) / 不健康 (151-200) / 非常不健康 (201-300) / 危害 (301+).
 */
export function aqiBand(aqi) {
  if (typeof aqi !== "number" || !Number.isFinite(aqi)) return null;
  const r = Math.round(aqi);
  if (r <= 50) return "良好";
  if (r <= 100) return "普通";
  if (r <= 150) return "敏感族群注意";
  if (r <= 200) return "不健康";
  if (r <= 300) return "非常不健康";
  return "危害";
}

/**
 * Comfort word for relative humidity.
 * @param {number|null|undefined} rh Percent.
 * @returns {string|null} 乾燥 (<40) / 舒適 (40-60) / 略悶 (61-75) / 潮濕 (>75).
 */
export function humidityWord(rh) {
  if (typeof rh !== "number" || !Number.isFinite(rh)) return null;
  const r = Math.round(rh);
  if (r < 40) return "乾燥";
  if (r <= 60) return "舒適";
  if (r <= 75) return "略悶";
  return "潮濕";
}

/**
 * Rounded integer as text, or "--" when missing. Never "-0".
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function intText(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "--";
  const r = Math.round(n);
  return String(r === 0 ? 0 : r);
}

/**
 * Signed integer delta text such as "+2°", "-4°", "0°"; "--" when missing.
 * @param {number|null|undefined} d
 * @returns {string}
 */
export function deltaText(d) {
  if (typeof d !== "number" || !Number.isFinite(d)) return "--";
  const r = Math.round(d);
  return r > 0 ? `+${r}°` : `${r === 0 ? 0 : r}°`;
}

/**
 * "SA 11-21" label from a local minute key.
 * @param {string|null|undefined} minuteKey "YYYY-MM-DDTHH:MM"
 * @returns {string} "-- --" when the key is malformed.
 */
export function dateLabel(minuteKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(minuteKey ?? ""));
  if (!m) return "-- --";
  const wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${WEEKDAYS[wd]} ${m[2]}-${m[3]}`;
}

/**
 * "HH:MM" part of a local key.
 * @param {string|null|undefined} key "YYYY-MM-DDTHH:MM"
 * @returns {string|null}
 */
export function clockOf(key) {
  const m = /T(\d{2}:\d{2})/.exec(String(key ?? ""));
  return m ? m[1] : null;
}

/**
 * Format the clock for an epoch instant in a location's UTC offset.
 * @param {number} ms Epoch ms.
 * @param {number} utcOffsetSeconds
 * @returns {string} "HH:MM"
 */
export function clockAt(ms, utcOffsetSeconds) {
  const d = new Date(ms + (utcOffsetSeconds || 0) * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Percent of daylight elapsed, clamped to 0-100.
 * @param {{now?: {minuteKey?: string}, today?: {sunrise?: string, sunset?: string}}} vm
 * @returns {number|null} Integer percent; null when sunrise/sunset/now is missing or sunset <= sunrise.
 */
export function daylightPercent(vm) {
  const now = vm?.now?.minuteKey;
  const rise = vm?.today?.sunrise;
  const set = vm?.today?.sunset;
  if (!now || !rise || !set) return null;
  const total = minutesUntil(rise, set);
  const done = minutesUntil(rise, now);
  if (!Number.isFinite(total) || !Number.isFinite(done) || total <= 0) return null;
  return Math.round(Math.min(100, Math.max(0, (done / total) * 100)));
}

/**
 * "X 時 Y 分" text for a minute count.
 * @param {number} minutes Non-negative minutes.
 * @returns {string}
 */
export function hm(minutes) {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)} 時 ${m % 60} 分`;
}

/**
 * Countdown text under the sun row: before sunset "還有 X 時 Y 分天黑"; at night "距日出 X 時 Y 分"
 * (after sunset the next sunrise is estimated as today's sunrise + 24 h).
 * @param {{now?: {minuteKey?: string}, today?: {sunrise?: string, sunset?: string}}} vm
 * @returns {string|null} null when data is missing.
 */
export function countdownText(vm) {
  const now = vm?.now?.minuteKey;
  const rise = vm?.today?.sunrise;
  const set = vm?.today?.sunset;
  if (!now || !rise || !set) return null;
  const toRise = minutesUntil(now, rise);
  const toSet = minutesUntil(now, set);
  if (!Number.isFinite(toRise) || !Number.isFinite(toSet)) return null;
  if (toRise > 0) return `距日出 ${hm(toRise)}`;
  if (toSet > 0) return `還有 ${hm(toSet)}天黑`;
  return `距日出 ${hm(toRise + 1440)}`;
}
