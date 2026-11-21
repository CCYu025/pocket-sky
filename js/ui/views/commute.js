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
import { entryOf } from "./places.js";

/**
 * Note under the legs: which place the BACK leg uses.
 * @param {{name: string}|null} work The work place, or null when none is set.
 * @returns {string}
 */
export function workNote(work) {
  return work ? `回家（BACK）使用公司地點：${work.name}` : "出門與回家都使用目前位置；設定公司地點後，回家改看公司所在地";
}
const LEGS = [
  { key: "out", name: "出門", label: "OUT" },
  { key: "back", name: "回家", label: "BACK" },
];

/**
 * The triggering value of a checklist item, for a leg tag.
 * @param {{field: (string|null), agg: (string|null), value: (number|null)}} it
 * @returns {string} e.g. `體感 16°`, `降雨 60%`, `雨量 0.8 mm`, `溫差 7°`, `UV 8`, `AQI 120`, `PM2.5 41`.
 */
export function valueText(it) {
  const v = it.value;
  const r = Math.round(v);
  switch (it.field) {
    case "rainProb": return `降雨 ${r}%`;
    case "rain": return `雨量 ${Math.round(v * 10) / 10} mm`;
    case "feels": return `體感 ${r}°`;
    case "temp": return `溫差 ${r}°`;
    case "uv": return `UV ${r}`;
    case "aqi": return `AQI ${r}`;
    case "pm25": return `PM2.5 ${r}`;
    default: return "";
  }
}

const pad2 = (h) => String(h).padStart(2, "0");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Build the commute view model.
 * @param {object} vm Controller view model (`vm.hours` starts at the current hour).
 * @param {{out: number, back: number}} commute Selected leg start hours.
 * @param {{place: object, entry: (object|null), differs?: boolean}|null} [work] The work place and its controller entry
 *   (`state.places[key]`; `differs: false` when the current place is the work place itself). When set, the BACK leg is evaluated on the work place's hours (`BACK・{name}`);
 *   while that entry has no data the leg is empty (`workState` `loading` / `error`) and the OUT leg is
 *   unaffected. Without it both legs use `vm`.
 * @returns {{legs: object[], ordered: object[], items: object[], headline: string, workState: (null|'ready'|'loading'|'error')}}
 *   `legs` is `[out, back]`; `ordered` is the same legs in chronological order (today's BACK comes
 *   before tomorrow's OUT) for display. `legs[i]`: `{ key, name, label, hour, time: 'HH:00', tomorrow, entry, wx, detail, rainMax, warn, aria }`
 *   (`entry` is the leg's first hour; the rain figure is the peak over the leg's two hours, which is
 *   what the checklist evaluates). `items[i]`: checklist item plus `tags`, one per leg that triggers it on
 *   its own, carrying that leg's own value (`出門 08:00・體感 16°`, `回家 18:00・降雨 60%`; `明日 ` prefix for a tomorrow leg); `來回`
 *   when only both legs together trigger it (a large temperature range across the legs).
 */
export function commuteModel(vm, commute, work = null) {
  const today = String(vm?.now?.hourKey ?? "").slice(0, 10);
  const workVm = work?.entry?.vm ?? null;
  const workState = work ? (workVm ? "ready" : work.entry?.status === "error" ? "error" : "loading") : null;
  const legs = LEGS.map((def) => {
    const isWork = Boolean(work) && def.key === "back";
    const src = isWork ? workVm : vm;
    const l = isWork ? { ...def, label: `${def.label}・${work.place.name}` } : def;
    const hour = commute[l.key];
    const hs = legHours(src?.hours ?? [], hour, 2);
    const entry = hs[0] ?? null;
    const rains = hs.map((h) => num(h.rainProb)).filter((x) => x !== null);
    const rainMax = rains.length ? Math.max(...rains) : null;
    const time = `${pad2(hour)}:00`;
    const tomorrow = entry ? String(entry.hourKey).slice(0, 10) !== String(src?.now?.hourKey ?? today).slice(0, 10) : false;
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
      detail: entry
        ? `雨 ${rainMax === null ? "--" : intText(rainMax)}%・風 ${intText(entry.wind)} km/h`
        : isWork && workState === "loading" ? "載入中" : isWork && workState === "error" ? "無法取得資料" : "無資料",
      aria: `${tomorrow ? "明日 " : ""}${l.name} ${time}${isWork ? `，公司 ${work.place.name}` : ""}`,
    };
  });
  const opts = { today, period: "通勤時段" };
  const perLeg = legs.map((l) => evaluateChecklist(l.hours, undefined, opts));
  const combined = evaluateChecklist([...legs[0].hours, ...legs[1].hours], undefined, opts);
  const items = combined.map((it, i) => {
    const tags = legs.flatMap((l, j) => (perLeg[j][i].on ? [`${l.tomorrow ? "明日 " : ""}${l.name} ${l.time}・${valueText(perLeg[j][i])}`] : []));
    if (it.on && tags.length === 0) tags.push("來回");
    return { ...it, tags };
  });
  const headline = workState === "loading" ? "公司天氣載入中…" : workState === "error" ? "公司天氣暫時無法取得" : commuteHeadline(perLeg[0], perLeg[1], legs[0].hours, legs[1].hours, {
    combined,
    tomorrow: { out: legs[0].tomorrow, back: legs[1].tomorrow },
    twoPlaces: Boolean(work) && work.differs !== false,
  });
  const [a, b] = legs;
  const ordered = a.entry && b.entry && String(b.entry.hourKey) < String(a.entry.hourKey) ? [b, a] : [a, b];
  return { legs, ordered, items, headline, workState };
}

/**
 * One LCD leg.
 * @param {object|null} leg From `commuteModel`, or null for the loading skeleton.
 * @param {{key: string, label: string, name: string}} def
 * @param {boolean} [blink=true] Whether this leg's `!RAIN` is the screen's blinking one; a second
 *   warning is rendered static (`warn--still`) so only one infinite animation ever runs.
 * @returns {string} HTML.
 */
function legHtml(leg, def, blink = true) {
  const time = leg ? leg.time : "--:--";
  const aria = leg ? leg.aria : `${def.name} 無資料`;
  const warn = leg?.warn ? `<span class="${blink ? "warn" : "warn warn--still"}" role="img" aria-label="降雨機率高">!RAIN</span>` : "";
  return `<div class="leg" data-k="leg-${def.key}"><div class="leg-top"><span class="leg-name">${esc(def.label)}${leg?.tomorrow ? " 明日" : ""}</span>${warn}</div>
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
 * @param {string} [key] Top-level `data-k` (a per-scenario key makes a scenario switch build fresh nodes).
 * @returns {string} HTML.
 */
export function checklistHtml(items, key = "c-checklist") {
  const rows = (items ?? CHECKLIST_RULES.map((r) => ({ id: r.id, label: r.label, on: false, why: "載入中", tags: [] }))).map((it, i) => {
    const tags = it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const state = items ? (it.on ? "建議攜帶" : "不需要") : "載入中";
    return `<li class="check-item${it.on ? " is-on" : ""}" data-k="item-${esc(it.id)}" data-i="${i}"><span class="cbox" aria-hidden="true">${it.on ? '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 12.5l5 5L20 6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="square"/></svg>' : ""}</span>
<div class="check-body"><span class="check-name">${esc(it.label)}<span class="sr-only">，${state}</span></span><span class="check-why">${esc(it.why)}</span></div><div class="tags">${tags}</div></li>`;
  });
  return `<section class="card checklist" data-k="${esc(key)}" aria-label="準備清單"><ul>${rows.join("")}</ul></section>`;
}

/**
 * Commute blocks (everything below the scenario chips).
 * @param {{status: string, vm: (object|null)}} state Controller state.
 * @param {{outing: {commute: {out: number, back: number}}, work?: (object|null)}} ui `ui.work`: the work
 *   place (or null).
 * @returns {string} HTML.
 */
export function commuteHtml(state, ui) {
  const { status, vm } = state;
  const c = ui.outing.commute;
  const work = ui.work ? { place: ui.work, entry: entryOf(state, ui.work), differs: ui.work.id !== state.current } : null;
  const model = vm && status !== "loading" && status !== "error" ? commuteModel(vm, c, work) : null;
  let title = "載入天氣中…";
  if (model) title = model.headline;
  else if (status === "error") title = "資料暫時無法取得";
  // only the first !RAIN (in display order) blinks: the screen's single infinite animation
  const firstWarn = model ? model.ordered.findIndex((l) => l.warn) : -1;
  const legSlots = model ? model.ordered.map((l, i) => legHtml(l, l, i === firstWarn)) : LEGS.map((d) => legHtml(null, d));
  return [
    `<div class="work" data-k="c-note"><p class="note">${esc(workNote(ui.work ?? null))}</p><button type="button" class="key key--sm" id="c-set-work" data-action="open-picker" data-mode="work">設定公司地點</button></div>`,
    model?.workState === "error" ? `<div class="banner banner--row" data-k="c-work-err"><span>公司天氣暫時無法取得</span><button type="button" class="key key--sm" id="c-retry" data-action="retry-place" data-id="${esc(ui.work.id)}">重試</button></div>` : "",
    `<section class="hero" data-k="c-hero" aria-label="通勤時段天氣"><div class="lcd lcd--legs">${legSlots.join("")}</div></section>`,
    `<div class="fields" data-k="c-fields">${selectHtml(LEGS[0], c.out)}${selectHtml(LEGS[1], c.back)}</div>`,
    `<h1 class="headline headline--sm" data-k="c-headline">${esc(title)}</h1>`,
    status === "error" ? "" : checklistHtml(model ? model.items : null),
  ].join("\n");
}
