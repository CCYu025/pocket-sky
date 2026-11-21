/**
 * Outing screen: scenario chips, shared status blocks and the DOM renderer.
 * The view is reconciled (`js/ui/morph.js`), not replaced, like Today.
 * @module ui/views/outing
 */
import { escapeHtml as esc } from "../seg7.js";
import { morphHtml } from "../morph.js";
import { clockAt } from "../format.js";
import { scenarioHref } from "../route.js";
import { ERROR_TEXT } from "./today.js";
import { commuteHtml } from "./commute.js";
import { exerciseHtml } from "./exercise.js";

/**
 * Scenario chips: 通勤 / 運動 are links (`aria-current` on the active one); 出遊 is a
 * non-interactive, disabled element with a `v2` badge.
 * @param {'commute'|'exercise'} scenario Active scenario.
 * @returns {string} HTML.
 */
export function chipsHtml(scenario) {
  const link = (id, label) =>
    `<a class="key chip chip--${id}" href="${scenarioHref(id)}"${scenario === id ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<div class="chips" data-k="chips" role="group" aria-label="情境">${link("commute", "通勤")}${link("exercise", "運動")}<span class="key chip chip--trip" role="link" aria-disabled="true">出遊 <span class="badge">v2</span></span></div>`;
}

/**
 * Full Outing HTML for a controller state.
 * @param {object} state Controller state (see js/app/controller.js).
 * @param {{outing: {scenario: string, commute: {out: number, back: number}}, nowMs: number, picked: (string|null), flip: number}} ui
 *   `ui.outing.scenario` is the *resolved* scenario of the route.
 * @returns {string} HTML.
 */
export function outingHtml(state, ui) {
  const { status, vm } = state;
  const parts = [chipsHtml(ui.outing.scenario)];
  if (status === "stale" && vm) {
    parts.push(`<p class="banner" data-k="stale">資料時間 ${esc(clockAt(state.fetchedAt ?? 0, vm.location.utcOffsetSeconds))}・無法更新</p>`);
  }
  if (status === "error") {
    parts.push(`<div class="error-card" data-k="error"><p>${esc(ERROR_TEXT)}</p><button type="button" class="key" data-action="retry">重試</button></div>`);
  }
  if (status !== "loading" && status !== "error" && vm && !vm.hoursAvailable) {
    parts.push(`<p class="banner" data-k="no-hours">沒有逐時資料，無法規劃外出</p>`);
  }
  parts.push(ui.outing.scenario === "exercise" ? exerciseHtml(state, ui) : commuteHtml(state, ui));
  return parts.join("\n");
}

/**
 * Set the numeric custom properties from `data-*` through the CSSOM (inline `style` attributes are
 * blocked by the CSP): `--p` (bar score) and `--i` (stagger index).
 * @param {ParentNode} root
 * @returns {void}
 */
export function applyOutingStyles(root) {
  for (const el of root.querySelectorAll("[data-p]")) el.style.setProperty("--p", el.dataset.p);
  for (const el of root.querySelectorAll("[data-i]")) el.style.setProperty("--i", el.dataset.i);
}

/**
 * Controls whose value is a DOM *property* that diverges from its attribute once the user
 * has touched it: push the model value back after each reconcile.
 * @param {ParentNode} root
 * @param {{commute: {out: number, back: number}}} outing
 * @returns {void}
 */
export function syncControls(root, outing) {
  for (const key of ["out", "back"]) {
    const sel = root.querySelector(`#sel-${key}`);
    if (sel && sel.value !== String(outing.commute[key])) sel.value = String(outing.commute[key]);
  }
  const range = root.querySelector("#x-range");
  if (range) {
    const sel = range.getAttribute("value");
    if (range.value !== sel) range.value = sel;
  }
  // keep the focused (else selected) bar, with its focus ring, in view inside the scrolling picker
  const bars = root.querySelector(".xbars");
  if (bars) {
    const active = root.ownerDocument?.activeElement;
    const focused = active && bars.contains(active) && active.classList.contains("xbar") ? active : null;
    const bar = focused ?? bars.querySelector('.xbar[aria-pressed="true"]');
    if (bar) revealBar(bars, bar);
  }
}

/** Space kept clear on each side of a revealed bar: the scroller's own 14px padding, so the first and last bar land exactly at scrollLeft 0 / max and the 6px ring is never clipped. */
export const REVEAL_MARGIN = 14;

/**
 * Pure scroll computation: the `scrollLeft` that brings a bar, plus `margin` on both sides, fully
 * inside the visible area of a horizontal scroller. Edges are measured as bounding-rect deltas
 * (`barRect.left - scrollerRect.left`), so it does not depend on which ancestor is the `offsetParent`.
 * The result is clamped to `[0, scrollWidth - clientWidth]`.
 * @param {{scrollLeft: number, clientWidth: number, scrollWidth: number, left: number, right: number, margin?: number}} g
 *   `left` / `right`: the bar's edges relative to the scroller's visible left edge.
 * @returns {number} The new `scrollLeft`.
 */
export function revealScrollLeft({ scrollLeft, clientWidth, scrollWidth, left, right, margin = REVEAL_MARGIN }) {
  let next = scrollLeft;
  if (left - margin < 0) next = scrollLeft + (left - margin);
  else if (right + margin > clientWidth) next = scrollLeft + (right + margin - clientWidth);
  return Math.min(Math.max(0, scrollWidth - clientWidth), Math.max(0, next));
}

/**
 * Scroll the picker so `bar` (and its focus ring) is fully visible.
 * @param {HTMLElement} bars The `.xbars` scroller.
 * @param {HTMLElement} bar A `.xbar` button inside it.
 * @returns {void}
 */
export function revealBar(bars, bar) {
  const s = bars.getBoundingClientRect();
  const r = bar.getBoundingClientRect();
  const next = revealScrollLeft({
    scrollLeft: bars.scrollLeft,
    clientWidth: bars.clientWidth,
    scrollWidth: bars.scrollWidth,
    left: r.left - s.left - bars.clientLeft,
    right: r.right - s.left - bars.clientLeft,
  });
  if (next !== bars.scrollLeft) bars.scrollLeft = next;
}

/**
 * Render the Outing screen into `root`.
 * @param {HTMLElement} root The `<main>` element.
 * @param {object} state Controller state.
 * @param {object} ui See `outingHtml`.
 * @returns {void}
 */
export function renderOuting(root, state, ui) {
  const busy = state.status === "loading" ? "true" : "false";
  if (root.getAttribute("aria-busy") !== busy) root.setAttribute("aria-busy", busy);
  morphHtml(root, outingHtml(state, ui));
  applyOutingStyles(root);
  syncControls(root, ui.outing);
}
