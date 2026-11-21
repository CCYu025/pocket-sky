/**
 * Persisted alert state (`ps:alerts`): dismissals and cooldown bookkeeping.
 * Shape: `{ dismissed: {id: true}, lastShown: {kind: ms}, lastShownId: {kind: id} }`.
 * @module app/alert-state
 */

export const ALERTS_KEY = "ps:alerts";
const DAY_MS = 24 * 3600e3;

/**
 * Read the alert state, pruned to the given local date. Never throws.
 * @param {Storage|undefined} storage
 * @param {string} date Local date "YYYY-MM-DD"; ids for other dates are dropped.
 * @param {number} nowMs Epoch ms; `lastShown` entries older than 24 h are dropped.
 * @returns {{dismissed: Object<string, boolean>, lastShown: Object<string, number>, lastShownId: Object<string, string>}}
 */
export function readAlertState(storage, date, nowMs) {
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(ALERTS_KEY));
  } catch {
    raw = null;
  }
  const out = { dismissed: {}, lastShown: {}, lastShownId: {} };
  if (!raw || typeof raw !== "object") return out;
  const today = (id) => typeof id === "string" && id.endsWith(`:${date}`);
  for (const [id, v] of Object.entries(raw.dismissed ?? {})) if (v && today(id)) out.dismissed[id] = true;
  for (const [k, id] of Object.entries(raw.lastShownId ?? {})) if (today(id)) out.lastShownId[k] = id;
  for (const [k, ms] of Object.entries(raw.lastShown ?? {})) {
    if (typeof ms === "number" && nowMs - ms >= 0 && nowMs - ms < DAY_MS) out.lastShown[k] = ms;
  }
  return out;
}

/**
 * Persist an alert state; swallows storage errors.
 * @param {Storage|undefined} storage
 * @param {object} state Value from `readAlertState`.
 * @returns {void}
 */
export function writeAlertState(storage, state) {
  try {
    storage.setItem(ALERTS_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * Record that an alert is being shown. The cooldown clock starts only on the
 * first display of an id, so re-renders do not extend it.
 * @param {Storage|undefined} storage
 * @param {object} state Current state (from `readAlertState`).
 * @param {{id: string, kind: string}} alert
 * @param {number} nowMs
 * @returns {object} The updated state (also persisted when it changed).
 */
export function recordShown(storage, state, alert, nowMs) {
  if (state.lastShownId[alert.kind] === alert.id) return state;
  const next = {
    ...state,
    lastShown: { ...state.lastShown, [alert.kind]: nowMs },
    lastShownId: { ...state.lastShownId, [alert.kind]: alert.id },
  };
  writeAlertState(storage, next);
  return next;
}

/**
 * Record a dismissal.
 * @param {Storage|undefined} storage
 * @param {object} state Current state.
 * @param {string} id Alert id.
 * @returns {object} Updated state (persisted).
 */
export function recordDismissed(storage, state, id) {
  const next = { ...state, dismissed: { ...state.dismissed, [id]: true } };
  writeAlertState(storage, next);
  return next;
}
