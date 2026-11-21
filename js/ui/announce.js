/**
 * Decides what to write into the single persistent `aria-live` region.
 * A message is produced only when an announced condition *changes*, so
 * re-renders (ticks, refreshes) are silent.
 * @module ui/announce
 */
import { ERROR_TEXT } from "./views/today.js";

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
