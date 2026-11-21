/**
 * Persisted Outing state (`ps:outing`).
 * Shape: `{ scenario: 'commute'|'exercise'|'trip', commute: { out: 0-23, back: 0-23 }, trip: { start: 0-23, end: 0-23 } }`.
 * @module app/outing-state
 */

export const OUTING_KEY = "ps:outing";

/** Defaults (frozen; the helpers return fresh copies). */
export const DEFAULT_OUTING = Object.freeze({
  scenario: "commute",
  commute: Object.freeze({ out: 8, back: 18 }),
  trip: Object.freeze({ start: 9, end: 16 }),
});

const hourOr = (v, d) => (Number.isInteger(v) && v >= 0 && v <= 23 ? v : d);

/**
 * Validate a raw value field by field, falling back to defaults.
 * @param {*} raw
 * @returns {{scenario: string, commute: {out: number, back: number}, trip: {start: number, end: number}}}
 */
function normalize(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const c = o.commute && typeof o.commute === "object" ? o.commute : {};
  const t = o.trip && typeof o.trip === "object" ? o.trip : {};
  return {
    scenario: ["commute", "exercise", "trip"].includes(o.scenario) ? o.scenario : DEFAULT_OUTING.scenario,
    commute: { out: hourOr(c.out, DEFAULT_OUTING.commute.out), back: hourOr(c.back, DEFAULT_OUTING.commute.back) },
    trip: { start: hourOr(t.start, DEFAULT_OUTING.trip.start), end: hourOr(t.end, DEFAULT_OUTING.trip.end) },
  };
}

/**
 * Read the outing state. Never throws.
 * @param {Storage|undefined} storage
 * @returns {{scenario: string, commute: {out: number, back: number}, trip: {start: number, end: number}}}
 */
export function readOuting(storage) {
  try {
    return normalize(JSON.parse(storage.getItem(OUTING_KEY)));
  } catch {
    return normalize(null);
  }
}

/**
 * Persist the outing state (validated first); swallows storage errors.
 * @param {Storage|undefined} storage
 * @param {object} value
 * @returns {void}
 */
export function writeOuting(storage, value) {
  try {
    storage.setItem(OUTING_KEY, JSON.stringify(normalize(value)));
  } catch {
    /* ignore */
  }
}
