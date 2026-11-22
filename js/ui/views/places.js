/**
 * Location picker (`<dialog>`): pure state reducer, view model and HTML template (no DOM access
 * except `renderPicker`). Every interpolated string goes through `escapeHtml`.
 * @module ui/views/places
 */
import { escapeHtml as esc } from "../seg7.js";
import { morphHtml } from "../morph.js";
import { placeLabel, placeFromSearchResult, MAX_PLACES } from "../../app/places-state.js";
import { SEARCH_HINT, SEARCH_HINT_SUFFIX } from "../../domain/place-search.js";
import { cacheKey } from "../../cache.js";

/** Picker modes: choose the current place, the work place or the trip destination. */
export const MODES = Object.freeze(["current", "work", "trip"]);
export const SEARCH_ERROR = "搜尋失敗，請稍後再試";
export const SEARCH_OFFLINE = "離線中，無法搜尋";

const TITLES = { current: "選擇地點", work: "設定公司地點", trip: "選擇出遊地點" };
const LEADS = {
  current: "點「目前」切換今天與運動的地點。\n搜尋後按「加入」儲存。",
  work: "按已儲存地點的「公司」，或搜尋後按「加入」，作為回家（BACK）的天氣地點。",
  trip: "按已儲存地點的「出遊」，或搜尋後按「加入」，作為出遊目的地。",
};
const CJK_RE = /[㐀-鿿]/;

/**
 * Initial picker state.
 * @param {'current'|'work'|'trip'} [mode='current']
 * @returns {{mode: string, query: string, status: 'idle'|'searching'|'done'|'error', results: object[], usedQuery: string, searched: string, message: string}}
 *   `searched` is the text the user typed for the last finished search (`usedQuery` may be a fallback spelling of it).
 */
export function initialPicker(mode = "current") {
  return { mode: MODES.includes(mode) ? mode : "current", query: "", status: "idle", results: [], usedQuery: "", searched: "", message: "" };
}

/**
 * Picker state reducer (pure).
 * - `open {mode}`: fresh state. `query {value}`: typing; an empty (trimmed) query clears the results.
 * - `search`: a search started. `done {results, usedQuery, query}` (`query`: what the user typed) / `error`: it finished. Typing or searching
 *   clears the action message.
 * - `say {text}`: an action message (added, deleted, ...) for the live text.
 * @param {object} state
 * @param {{type: string, [k: string]: *}} action
 * @returns {object} The next state (the input state is never mutated).
 */
export function pickerReduce(state, action) {
  switch (action.type) {
    case "open":
      return initialPicker(action.mode);
    case "query": {
      const value = String(action.value ?? "");
      if (value.trim() === "") return { ...state, query: value, status: "idle", results: [], usedQuery: "", searched: "", message: "" };
      return { ...state, query: value, message: "" };
    }
    case "search":
      return { ...state, status: "searching", message: "" };
    case "done":
      return { ...state, status: "done", results: action.results ?? [], usedQuery: action.usedQuery ?? "", searched: String(action.query ?? action.usedQuery ?? "") };
    case "error":
      return { ...state, status: "error", results: [] };
    case "offline": // a search was asked for while offline: nothing was requested
      return { ...state, status: "offline", results: [], message: "" };
    case "say":
      return { ...state, message: String(action.text ?? "") };
    default:
      return state;
  }
}

/**
 * Live text of the picker (the single `aria-live` node): the latest action message, else the
 * search status (`搜尋中…`, `找到 N 個地點`, `找不到「…」`, `搜尋失敗，請稍後再試`).
 * @param {object} state
 * @returns {string}
 */
export function liveText(state) {
  if (state.message) return state.message;
  switch (state.status) {
    case "searching": return "搜尋中…";
    case "done": return state.results.length ? `找到 ${state.results.length} 個地點` : `找不到「${state.searched || state.usedQuery}」`;
    case "error": return SEARCH_ERROR;
    case "offline": return SEARCH_OFFLINE;
    default: return "";
  }
}

/**
 * Elevation text, e.g. `海拔 748 m` (`null` when unknown).
 * @param {number|null|undefined} e
 * @returns {string|null}
 */
function elevText(e) {
  return typeof e === "number" && Number.isFinite(e) ? `海拔 ${Math.round(e)} m` : null;
}

/**
 * View model of the picker.
 * @param {object} state `pickerReduce` state.
 * @param {{saved: object[], workId: (string|null), tripId: (string|null)}} places `ps:places` state.
 * @param {string} currentId `'gps'` or the current place id.
 * @returns {{mode: string, title: string, lead: string, live: string, saved: object[], results: object[], hint: string[], count: string}}
 *   `saved[i]`: `{ id, label, sub, current, work, trip }`; `results[i]`: `{ index, label, sub, saved }`;
 *   `hint` has the two empty-result hint lines (only for a CJK query that found nothing).
 */
export function pickerModel(state, places, currentId) {
  const savedIds = new Set(places.saved.map((p) => p.id));
  const saved = places.saved.map((p) => ({
    id: p.id,
    label: placeLabel(p),
    name: p.name,
    sub: elevText(p.elevation) ?? "", // the label already carries admin1
    current: p.id === currentId,
    work: p.id === places.workId,
    trip: p.id === places.tripId,
  }));
  const results = state.results.map((r, index) => {
    const p = placeFromSearchResult(r);
    return {
      index,
      label: p ? placeLabel(p) : String(r?.name ?? ""),
      sub: [p?.country, elevText(p?.elevation)].filter(Boolean).join("・"), // the label already carries admin1
      saved: p ? savedIds.has(p.id) : false,
    };
  });
  const empty = state.status === "done" && results.length === 0;
  return {
    mode: state.mode,
    title: TITLES[state.mode],
    lead: LEADS[state.mode],
    live: liveText(state),
    saved,
    results,
    hint: empty && CJK_RE.test(state.usedQuery || state.query) ? [SEARCH_HINT, SEARCH_HINT_SUFFIX] : [],
    count: `已儲存 ${saved.length} / ${MAX_PLACES}`,
    gpsCurrent: currentId === "gps",
  };
}

/**
 * Buttons of a saved place row. 目前 / 公司 / 出遊 are toggles (`aria-pressed`); the one that matches
 * the picker mode is the accent (main) key.
 * @param {object} p Row from `pickerModel().saved`.
 * @param {string} mode
 * @returns {string} HTML.
 */
function rowButtons(p, mode) {
  const main = (m) => (mode === m ? " pk-btn--main" : "");
  return `<button type="button" class="key pk-btn${main("current")}" data-action="pk-use" data-id="${esc(p.id)}" aria-pressed="${p.current}" aria-label="目前位置：${esc(p.label)}">目前</button>`
    + `<button type="button" class="key pk-btn${main("work")}" data-action="pk-work" data-id="${esc(p.id)}" aria-pressed="${p.work}" aria-label="公司地點：${esc(p.label)}">公司</button>`
    + `<button type="button" class="key pk-btn${main("trip")}" data-action="pk-trip" data-id="${esc(p.id)}" aria-pressed="${p.trip}" aria-label="出遊地點：${esc(p.label)}">出遊</button>`
    + `<button type="button" class="key pk-btn pk-btn--del" data-action="pk-del" data-id="${esc(p.id)}" aria-label="刪除 ${esc(p.label)}">刪除</button>`;
}

/**
 * Dialog contents. Top-level blocks are keyed (`data-k`) so the search input survives every
 * re-render with its value and focus.
 * @param {ReturnType<typeof pickerModel>} m
 * @returns {string} HTML.
 */
export function pickerHtml(m) {
  const tags = (p) => [p.current ? "目前" : "", p.work ? "公司" : "", p.trip ? "出遊" : ""].filter(Boolean).map((t) => `<span class="tag">${t}</span>`).join("");
  const rows = m.saved.length
    ? m.saved.map((p) => `<li class="pk-row" data-k="p-${esc(p.id)}"><div class="pk-name"><b>${esc(p.label)}</b>${p.sub ? `<span class="pk-sub">${esc(p.sub)}</span>` : ""}<span class="pk-tags">${tags(p)}</span></div><div class="pk-acts">${rowButtons(p, m.mode)}</div></li>`).join("")
    : `<li class="pk-empty" data-k="p-none">尚未儲存地點，搜尋後按「加入」。</li>`;
  const results = m.results
    .map((r) => `<li class="pk-row pk-row--r" data-k="r-${r.index}"><div class="pk-name"><b>${esc(r.label)}</b>${r.sub ? `<span class="pk-sub">${esc(r.sub)}</span>` : ""}</div>${r.saved ? `<span class="pk-done">已儲存</span>` : `<button type="button" class="key pk-btn pk-btn--main" data-action="pk-add" data-i="${r.index}" aria-label="加入 ${esc(r.label)}${r.sub ? `（${esc(r.sub)}）` : ""}">加入</button>`}</li>`)
    .join("");
  const hint = m.hint.length ? `<p class="pk-hint" data-k="pk-hint">${m.hint.map(esc).join("<br>")}</p>` : "";
  return [
    `<div class="pk-head" data-k="pk-head"><h2 id="pk-title">${esc(m.title)}</h2><button type="button" class="key pk-close" data-action="pk-close" aria-label="關閉">×</button></div>`,
    `<p class="pk-lead" data-k="pk-lead">${esc(m.lead)}</p>`,
    `<div class="pk-search" data-k="pk-search" role="search"><label for="pk-q" class="pk-label">搜尋地點</label><input type="search" id="pk-q" class="pk-input" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="例如 日月潭、Hualien"></div>`,
    `<p class="pk-live" id="pk-live" data-k="pk-live" aria-live="polite" aria-atomic="true">${esc(m.live)}</p>`,
    hint,
    results ? `<ul class="pk-list" data-k="pk-results" aria-label="搜尋結果">${results}</ul>` : "",
    `<div class="pk-sect" data-k="pk-sect"><h3>已儲存的地點</h3><span>${esc(m.count)}</span></div>`,
    `<ul class="pk-list" data-k="pk-saved" aria-label="已儲存的地點"><li class="pk-row" data-k="p-gps"><div class="pk-name"><b>目前位置</b><span class="pk-sub">使用裝置定位（GPS）</span><span class="pk-tags">${m.gpsCurrent ? '<span class="tag">目前</span>' : ""}</span></div><div class="pk-acts"><button type="button" class="key pk-btn${m.mode === "current" ? " pk-btn--main" : ""}" data-action="pk-use" data-id="gps" aria-pressed="${m.gpsCurrent}" aria-label="目前位置：使用裝置定位">目前</button></div></li>${rows}</ul>`,
  ].join("\n");
}

/**
 * Render the picker contents into the dialog (reconciled: the input keeps its value and focus).
 * @param {HTMLElement} dialog
 * @param {ReturnType<typeof pickerModel>} model
 * @returns {void}
 */
export function renderPicker(dialog, model) {
  morphHtml(dialog, pickerHtml(model));
}

/**
 * The controller's entry for an extra place (work, trip destination).
 * @param {{places?: Object<string, object>}} state Controller state.
 * @param {{lat: number, lon: number}|null} place
 * @returns {{status: string, vm: (object|null), error: *, fetchedAt: (number|null)}|null} `null` when
 *   there is no place or it was not requested yet.
 */
export function entryOf(state, place) {
  if (!place) return null;
  return state?.places?.[cacheKey("forecast", place.lat, place.lon)] ?? null;
}
