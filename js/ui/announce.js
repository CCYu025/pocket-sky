/**
 * Decides what to write into the single persistent `aria-live` region.
 * A message is produced only when an announced condition *changes*, so
 * re-renders (ticks, refreshes) are silent.
 * @module ui/announce
 */
import { ERROR_TEXT } from "./views/today.js";
import { SCENARIO_NAMES } from "./route.js";

export const STALE_TEXT = "資料已過期";

/**
 * Create an announcer.
 * @returns {{next: (state: object) => (string|null)}} `next(state)` returns the message to announce now, or null.
 */
export function createAnnouncer() {
  let alertId = null;
  let stale = false;
  let error = false;
  return {
    next(state) {
      const hasVm = Boolean(state?.vm);
      const nowAlertId = hasVm && state.alert ? state.alert.id : null;
      const nowStale = hasVm && state.status === "stale";
      const nowError = state?.status === "error";
      const msgs = [];
      if (nowAlertId && nowAlertId !== alertId && !(alertId && state.alert.continuation)) msgs.push(state.alert.title);
      if (nowStale && !stale) msgs.push(STALE_TEXT);
      if (nowError && !error) msgs.push(ERROR_TEXT);
      alertId = nowAlertId;
      stale = nowStale;
      error = nowError;
      return msgs.length ? msgs.join("。") : null;
    },
  };
}

/**
 * Trailing-edge debounce for the live region: the last message said within `delay` ms wins, so
 * dragging a slider across many hours announces only the hour where it stops.
 * @param {object} deps
 * @param {(message: string) => void} deps.write Writes into the live region.
 * @param {number} [deps.delay=500] Quiet period in ms.
 * @param {typeof setTimeout} [deps.setTimer]
 * @param {typeof clearTimeout} [deps.clearTimer]
 * @returns {{say: (message: (string|null|undefined)) => void, cancel: () => void}} `say` ignores empty messages.
 */
export function createDebouncedAnnouncer({ write, delay = 500, setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = (id) => globalThis.clearTimeout(id) }) {
  let timer = null;
  return {
    say(message) {
      if (!message) return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        write(message);
      }, delay);
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

/**
 * Decides the Outing announcements: a scenario change (`外出：運動`) and a *user-picked*
 * exercise hour. Silent on the first call (page load), for refreshes, and when the default
 * (best) selection moves because new data arrived.
 * @returns {{next: (o: {scenario: (string|null), selection?: ({key: string, text: string, picked: boolean}|null)}) => (string|null)}}
 *   `scenario` is `null` off the Outing screen (state resets, so returning announces again).
 */
export function createOutingAnnouncer() {
  let seen = false;
  let scenario = null;
  let key = null;
  return {
    next({ scenario: s, selection = null }) {
      const first = !seen;
      seen = true;
      if (s === null) {
        scenario = null;
        key = null;
        return null;
      }
      const selKey = selection ? selection.key : null;
      if (s !== scenario) {
        scenario = s;
        key = selKey;
        return first ? null : `外出：${SCENARIO_NAMES[s] ?? "通勤"}`;
      }
      const changed = selKey !== key;
      key = selKey;
      return changed && selection && selection.picked ? selection.text : null;
    },
  };
}
