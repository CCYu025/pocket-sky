/**
 * Commute scenario: pure view model + HTML template (no DOM access).
 * Every interpolated string goes through `escapeHtml`.
 * @module ui/views/commute
 */
import { seg7Svg, escapeHtml as esc } from "../seg7.js";
import { describeWeather } from "../../domain/weathercode.js";
import { evaluateChecklist, legHours } from "../../rules/checklist.js";
import { commuteHeadline } from "../../domain/outing-summary.js";
import { CHECKLIST_RULES, T } from "../../rules/config.js";
import { intText } from "../format.js";

export const LOCATION_NOTE = "出門與回家使用目前位置（M4 可設定公司地點）";
const LEGS = [
  { key: "out", name: "出門", label: "OUT" },
  { key: "back", name: "回家", label: "BACK" },
];

const pad2 = (h) => String(h).padStart(2, "0");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Build the commute view model.
 * @param {object} vm Controller view model (`vm.hours` starts at the current hour).
 * @param {{out: number, back: number}} commute Selected leg start hours.
 * @returns {{legs: object[], items: object[], headline: string}}
 *   `legs[i]`: `{ key, name, label, hour, time: 'HH:00', tomorrow, entry, wx, detail, rainMax, warn, aria }`
 *   (`entry` is the leg's first hour; the rain figure is the peak over the leg's two hours, which is
 *   what the checklist evaluates). `items[i]`: checklist item plus `tags` (e.g. `回家 18:00`; `來回`
 *   when only both legs together trigger it, e.g. a large temperature range).
 */
export function commuteModel(vm, commute) {
  const hours = vm?.hours ?? [];
  const today = String(vm?.now?.hourKey ?? "").slice(0, 10);
  const legs = LEGS.map((l) => {
    const hour = commute[l.key];
    const hs = legHours(hours, hour, 2);
    const entry = hs[0] ?? null;
    const rains = hs.map((h) => num(h.rainProb)).filter((x) => x !== null);
    const rainMax = rains.length ? Math.max(...rains) : null;
    const time = `${pad2(hour)}:00`;
    const tomorrow = entry ? String(entry.hourKey).slice(0, 10) !== today : false;
    const label = entry ? describeWeather(entry.code, entry.hour >= 6 && entry.hour < 18).label : "--";
    return {
      ...l,
      hour,
      time,
      hours: hs,
      entry,
      tomorrow,
      rainMax,
      warn: rainMax !== null && rainMax >= T.rainProb,
      wx: entry ? `${intText(entry.temp)}° ${label}` : "--",
      detail: entry ? `雨 ${rainMax === null ? "--" : intText(rainMax)}%・風 ${intText(entry.wind)} km/h` : "無資料",
      aria: `${tomorrow ? "明日 " : ""}${l.name} ${time}`,
    };
  });
  const perLeg = legs.map((l) => evaluateChecklist(l.hours));
  const combined = evaluateChecklist([...legs[0].hours, ...legs[1].hours]);
  const items = combined.map((it, i) => {
    const tags = legs.filter((l, j) => perLeg[j][i].on).map((l) => `${l.name} ${l.time}`);
    if (it.on && tags.length === 0) tags.push("來回");
    return { ...it, tags };
  });
  return { legs, items, headline: commuteHeadline(perLeg[0], perLeg[1], legs[0].hours, legs[1].hours) };
}

/**
 * One LCD leg.
 * @param {object|null} leg From `commuteModel`, or null for the loading skeleton.
 * @param {{key: string, label: string, name: string}} def
 * @returns {string} HTML.
 */
function legHtml(leg, def) {
  const time = leg ? leg.time : "--:--";
  const aria = leg ? leg.aria : `${def.name} 無資料`;
  const warn = leg?.warn ? `<span class="warn" role="img" aria-label="降雨機率高">!RAIN</span>` : "";
  return `<div class="leg" data-k="leg-${def.key}"><div class="leg-top"><span>${def.label}${leg?.tomorrow ? " 明日" : ""}</span>${warn}</div>
<div class="leg-time">${seg7Svg(time, { height: 36, ghost: true, label: aria })}</div>
<span class="leg-wx">${esc(leg ? leg.wx : "--")}</span><span class="leg-detail">${esc(leg ? leg.detail : "載入中")}</span></div>`;
}

/**
 * Hour `<select>` with a visible label (native control, >= 44 px high).
 * @param {{key: string, name: string}} def
 * @param {number} value Selected hour 0-23.
 * @returns {string} HTML.
 */
function selectHtml(def, value) {
  const opts = Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === value ? " selected" : ""}>${pad2(h)}:00</option>`).join("");
  return `<div class="field" data-k="field-${def.key}"><label class="field-k" for="sel-${def.key}">${esc(def.name)}時間</label><div class="selwrap"><select id="sel-${def.key}" data-field="${def.key}">${opts}</select></div></div>`;
}

/**
 * Checklist list items.
 * @param {object[]|null} items From `commuteModel`, or null while loading.
 * @returns {string} HTML.
 */
function checklistHtml(items) {
  const rows = (items ?? CHECKLIST_RULES.map((r) => ({ id: r.id, label: r.label, on: false, why: "載入中", tags: [] }))).map((it, i) => {
    const tags = it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const state = items ? (it.on ? "建議攜帶" : "不需要") : "載入中";
    return `<li class="check-item${it.on ? " is-on" : ""}" data-k="item-${esc(it.id)}" data-i="${i}"><span class="cbox" aria-hidden="true">${it.on ? '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 12.5l5 5L20 6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="square"/></svg>' : ""}</span>
<div class="check-body"><span class="check-name">${esc(it.label)}<span class="sr-only">，${state}</span></span><span class="check-why">${esc(it.why)}</span></div><div class="tags">${tags}</div></li>`;
  });
  return `<section class="card checklist" data-k="c-checklist" aria-label="準備清單"><ul>${rows.join("")}</ul></section>`;
}

/**
 * Commute blocks (everything below the scenario chips).
 * @param {{status: string, vm: (object|null)}} state Controller state.
 * @param {{outing: {commute: {out: number, back: number}}}} ui
 * @returns {string} HTML.
 */
export function commuteHtml(state, ui) {
  const { status, vm } = state;
  const c = ui.outing.commute;
  const model = vm && status !== "loading" && status !== "error" ? commuteModel(vm, c) : null;
  let title = "載入天氣中…";
  if (model) title = model.headline;
  else if (status === "error") title = "資料暫時無法取得";
  return [
    `<p class="note" data-k="c-note">${esc(LOCATION_NOTE)}</p>`,
    `<section class="hero" data-k="c-hero" aria-label="通勤時段天氣"><div class="lcd lcd--legs">${LEGS.map((d, i) => legHtml(model && model.legs[i], d)).join("")}</div></section>`,
    `<div class="fields" data-k="c-fields">${selectHtml(LEGS[0], c.out)}${selectHtml(LEGS[1], c.back)}</div>`,
    `<h1 class="headline headline--sm" data-k="c-headline">${esc(title)}</h1>`,
    status === "error" ? "" : checklistHtml(model ? model.items : null),
  ].join("\n");
}
