/**
 * Time helpers for Open-Meteo local-time keys.
 *
 * Open-Meteo returns local times as offset-less ISO strings. These helpers
 * never use `new Date(string)`; they use Date.UTC / getUTC* arithmetic only.
 */

const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

/**
 * Zero-pad a non-negative integer to at least `w` digits.
 * @param {number} n
 * @param {number} [w=2]
 * @returns {string}
 */
function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

/**
 * Format a UTC-based millisecond value as "YYYY-MM-DDTHH:MM".
 * @param {number} ms
 * @returns {string}
 */
function formatMinute(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Parse an offset-less local key ("YYYY-MM-DDTHH:MM") into UTC-based ms
 * (the local wall-clock value interpreted as if it were UTC).
 * @param {string} key
 * @returns {number} ms, or NaN when the key is malformed
 */
function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(key));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/**
 * Break the current instant into local-time parts for a UTC offset.
 * @param {number} utcOffsetSeconds Offset from UTC in seconds (may be negative).
 * @param {number} nowMs Current epoch milliseconds (injected).
 * @returns {{date: string, hourKey: string, minuteKey: string, hour: number, minute: number}}
 *   `hourKey` is floored to the hour (14:20 -> "...T14:00").
 */
export function localParts(utcOffsetSeconds, nowMs) {
  const d = new Date(nowMs + utcOffsetSeconds * 1000);
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return {
    date,
    hourKey: `${date}T${pad(hour)}:00`,
    minuteKey: `${date}T${pad(hour)}:${pad(minute)}`,
    hour,
    minute,
  };
}

/**
 * Shift an hour key by n hours (handles day/month/year rollover, negative n).
 * @param {string} hourKey e.g. "2026-11-21T14:00"
 * @param {number} n Hours to add (may be negative).
 * @returns {string} Shifted hour key ("YYYY-MM-DDTHH:00").
 */
export function addHours(hourKey, n) {
  const ms = parseKey(hourKey);
  return formatMinute(ms + n * HOUR_MS).slice(0, 13) + ":00";
}

/**
 * Find an hour key in an `hourly.time` array.
 * @param {string[]} times
 * @param {string} hourKey
 * @returns {number} Index, or -1 when absent.
 */
export function indexOfHour(times, hourKey) {
  return Array.isArray(times) ? times.indexOf(hourKey) : -1;
}

/**
 * Hour keys from the current floored hour through 23:00 today; when the current
 * hour is >= 22 the window extends through 06:00 the next day.
 * @param {number} utcOffsetSeconds
 * @param {number} nowMs
 * @returns {string[]} Hour keys in ascending order.
 */
export function exerciseWindow(utcOffsetSeconds, nowMs) {
  const { hourKey, hour } = localParts(utcOffsetSeconds, nowMs);
  const count = hour >= 22 ? 24 - hour + 6 + 1 : 24 - hour;
  const keys = [];
  for (let i = 0; i < count; i++) keys.push(addHours(hourKey, i));
  return keys;
}

/**
 * Whole minutes from one minute key to another (negative if `to` is earlier).
 * @param {string} fromMinuteKey e.g. "2026-11-21T14:20"
 * @param {string} toMinuteKey
 * @returns {number} Integer minutes.
 */
export function minutesUntil(fromMinuteKey, toMinuteKey) {
  return Math.round((parseKey(toMinuteKey) - parseKey(fromMinuteKey)) / MINUTE_MS);
}
