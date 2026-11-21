/**
 * Location picker controller: owns the `<dialog>` (showModal, focus trap, Esc, focus return), the
 * picker state, the debounced search and the place mutations. Rendering is `ui/views/places.js`.
 * @module app/picker
 */
import { readPlaces, writePlaces, addPlace, removePlace, setWork, setTrip, placeLabel, placeFromSearchResult } from "./places-state.js";
import { searchWithFallback } from "../domain/place-search.js";
import { initialPicker, pickerReduce, pickerModel, renderPicker } from "../ui/views/places.js";

/** Search debounce in ms. */
export const SEARCH_DEBOUNCE_MS = 400;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Stable selector of an element that can be found again after a re-render (`id`, else `data-action`).
 * @param {Element|null} el
 * @returns {string|null}
 */
function selectorOf(el) {
  if (!el || !el.getAttribute) return null;
  if (el.id) return `#${el.id}`;
  const a = el.getAttribute("data-action");
  return a ? `[data-action="${a}"]` : null;
}

/**
 * Create the picker.
 * @param {object} deps
 * @param {HTMLDialogElement} deps.dialog
 * @param {Storage} deps.storage
 * @param {{selectCurrent: (id: string) => Promise<void>, store: {get: () => {current: string}}}} deps.controller
 * @param {(name: string) => Promise<object[]>} deps.search `searchPlaces` with its deps bound.
 * @param {() => void} deps.onChange Called after saved places, work or trip changed (the app re-renders).
 * @param {() => HTMLElement|null} [deps.fallbackFocus] Where focus goes when the opener no longer exists.
 * @param {typeof setTimeout} [deps.setTimer] Defaults call `globalThis.setTimeout` as a method: an unbound `setTimeout` loses its `this`
 *   under Playwright's fake clock, so `clearTimeout` would silently not clear.
 * @param {typeof clearTimeout} [deps.clearTimer]
 * @returns {{open: (mode?: 'current'|'work'|'trip', opener?: Element|null) => void, close: () => void, isOpen: () => boolean, opener: () => (Element|null), getState: () => object}}
 */
export function createPicker({ dialog, storage, controller, search, onChange, fallbackFocus = () => null, setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = (id) => globalThis.clearTimeout(id) }) {
  let state = initialPicker("current");
  let seq = 0; // search generation: only the latest search may update the state
  let timer = null;
  let openerEl = null;
  let openerSel = null;

  const doc = dialog.ownerDocument;
  const input = () => dialog.querySelector("#pk-q");

  function render() {
    renderPicker(dialog, pickerModel(state, readPlaces(storage), controller.store.get().current));
  }
  function dispatch(action) {
    state = pickerReduce(state, action);
    render();
  }
  const say = (text) => dispatch({ type: "say", text });
  const focusEl = (el) => el?.focus({ preventScroll: false });
  const focusFirstAction = (sel) => focusEl(dialog.querySelector(sel) ?? input());

  async function runSearch() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    const q = (input()?.value ?? state.query).trim();
    if (!q) return;
    const mine = ++seq;
    dispatch({ type: "search" });
    try {
      const { results, usedQuery } = await searchWithFallback(q, search);
      if (mine === seq) dispatch({ type: "done", results, usedQuery });
    } catch {
      if (mine === seq) dispatch({ type: "error" });
    }
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  /** Persist places changes and tell the app. */
  function commit(next) {
    writePlaces(storage, next);
    onChange();
  }

  function actionAdd(i) {
    const r = state.results[i];
    const p = placeFromSearchResult(r);
    if (!p) return say("無法加入此地點");
    const before = readPlaces(storage);
    const { state: added, error } = addPlace(before, p);
    if (error) return say(error === "full" ? "已達 5 個地點上限，請先刪除一個" : "無法加入此地點");
    const evicted = before.saved.filter((s) => !added.saved.some((a) => a.id === s.id) && s.id !== p.id);
    let next = added;
    const mode = state.mode;
    if (mode === "work") next = setWork(next, p.id);
    if (mode === "trip") next = setTrip(next, p.id);
    commit(next);
    const cur = controller.store.get().current;
    if (evicted.some((e) => e.id === cur)) controller.selectCurrent("gps");
    const dropped = evicted.length ? `，並移除最舊的 ${evicted.map(placeLabel).join("、")}（最多 5 個）` : "";
    if (mode === "work" || mode === "trip") {
      // the mode's own action completes the task: close; the opener regains focus
      state = pickerReduce(state, { type: "say", text: `已加入 ${placeLabel(p)}${dropped}` });
      return close();
    }
    say(`已加入 ${placeLabel(p)}${dropped}`);
    focusFirstAction(`[data-action="pk-use"][data-id="${p.id}"]`);
  }

  function actionToggle(kind, id) {
    const places = readPlaces(storage);
    const place = places.saved.find((s) => s.id === id);
    if (!place) return;
    const wasSet = kind === "work" ? places.workId === id : places.tripId === id;
    const next = kind === "work" ? setWork(places, wasSet ? null : id) : setTrip(places, wasSet ? null : id);
    commit(next);
    const what = kind === "work" ? "公司地點" : "出遊地點";
    if (!wasSet && state.mode === kind) {
      state = pickerReduce(state, { type: "say", text: `已設為${what}：${placeLabel(place)}` });
      return close();
    }
    say(wasSet ? `已取消${what}` : `已設為${what}：${placeLabel(place)}`);
  }

  function actionDelete(id) {
    const places = readPlaces(storage);
    const place = places.saved.find((s) => s.id === id);
    if (!place) return;
    commit(removePlace(places, id));
    const wasCurrent = controller.store.get().current === id;
    if (wasCurrent) controller.selectCurrent("gps");
    say(`已刪除 ${placeLabel(place)}${wasCurrent ? "，改用目前位置" : ""}`);
    focusEl(input());
  }

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) return close(); // backdrop
    const el = e.target instanceof Element ? e.target.closest("[data-action]") : null;
    if (!el || !dialog.contains(el)) return;
    switch (el.dataset.action) {
      case "pk-close": return close();
      case "pk-use":
        controller.selectCurrent(el.dataset.id);
        return close();
      case "pk-work": return actionToggle("work", el.dataset.id);
      case "pk-trip": return actionToggle("trip", el.dataset.id);
      case "pk-del": return actionDelete(el.dataset.id);
      case "pk-add": return actionAdd(Number(el.dataset.i));
      default: return undefined;
    }
  });

  dialog.addEventListener("input", (e) => {
    if (!(e.target instanceof HTMLInputElement) || e.target.id !== "pk-q") return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    seq++; // an older in-flight search must not overwrite what the user is typing now
    dispatch({ type: "query", value: e.target.value });
    const typed = seq; // a timer that survives a later keystroke (or a failed clear) finds `seq` moved on and does nothing
    if (e.target.value.trim()) timer = setTimer(() => typed === seq && runSearch(), SEARCH_DEBOUNCE_MS);
  });

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.id === "pk-q") {
      e.preventDefault();
      runSearch();
      return;
    }
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    // keep Tab inside the dialog (wrap at both ends)
    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.getClientRects().length > 0);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement;
    if (e.shiftKey && (active === first || !dialog.contains(active))) {
      e.preventDefault();
      focusEl(last);
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
      e.preventDefault();
      focusEl(first);
    }
  });

  // Esc and every other way of closing end up here: stop timers, give focus back to the opener.
  dialog.addEventListener("close", () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    seq++;
    const target = (openerEl?.isConnected ? openerEl : null) ?? (openerSel ? doc.querySelector(openerSel) : null) ?? fallbackFocus();
    openerEl = null;
    openerSel = null;
    focusEl(target);
  });

  return {
    open(mode = "current", opener = doc.activeElement) {
      if (dialog.open) return;
      openerEl = opener;
      openerSel = selectorOf(opener);
      state = pickerReduce(state, { type: "open", mode });
      render();
      const q = input();
      if (q) q.value = "";
      dialog.showModal(); // focus starts on the first control (close key), so no on-screen keyboard pops up
    },
    close,
    isOpen: () => dialog.open,
    opener: () => openerEl,
    getState: () => state,
  };
}
