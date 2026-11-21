/**
 * Trip (出遊) scenario: pure view model + HTML template (no DOM access).
 * Every interpolated string goes through `escapeHtml`.
 * @module ui/views/trip
 */
import { seg7Svg, escapeHtml as esc } from "../seg7.js";
import { tripPlan, isWet, bestWindow, tempDiff, tripChecklist, tripHeadline } from "../../rules/trip.js";
import { T } from "../../rules/config.js";
import { levelWord } from "./exercise.js";
import { checklistHtml, valueText } from "./commute.js";
import { entryOf } from "./places.js";
import { clockAt, intText } from "../format.js";
import { ERROR_TEXT } from "./today.js";
import { placeLabel } from "../../app/places-state.js";

const pad2 = (h) => String(h).padStart(2, "0");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Accessible and visible wording of the temperature difference.
 * @param {number|null} diff `tempDiff` result.
 * @returns {{text: string, sign: string, label: string}} `text` is what seg7 can draw (`-6`, `0`, `6`;
 *   there is no `+` glyph, so a positive value carries a separate `sign`), `label` is the spoken form.
 */
export function diffParts(diff) {
  if (diff === null) return { text: "--", sign: "", label: "與目前位置的溫差 無資料" };
  if (diff === 0) return { text: "0", sign: "", label: "與目前位置溫度相同" };
  return diff < 0
    ? { text: String(diff), sign: "", label: `比目前位置低 ${-diff} 度` }
    : { text: String(diff), sign: "+", label: `比目前位置高 ${diff} 度` };
}

/**
 * Build the trip view model.
 * @param {{vm: object, place: object, originVm: (object|null)}} dest Destination view model (`state.places[key].vm`),
 *   its Place and the current place's view model (origin of the difference).
 * @param {{start: number, end: number}} trip Selected hours.
 * @param {number} nowMs Epoch ms.
 * @returns {{slots: object[], best: (object|null), items: object[], headline: string, diff: (number|null),
 *   name: string, elevation: (number|null), condition: string, wet: (object|null), rows: object[], tail: (number|null)}}
 *   `items` are checklist items with `tags` (`13:00・降雨 60%`, `明日 ` prefix, `全程・溫差 7°` for a range
 *   trigger); `wet` is the first wet slot (`isWet`: rainProb >= 40 or rain >= 0.5 mm; the `!RAIN` warning);
 *   `tail` is N when the running window has only N hours left today and tomorrow's is shown (`tripPlan`); `rows[i]` is a strip row
 *   `{ hourKey, hour, isTomorrow, comfort, level, temp, rain, wet, best, aria }` (`level` is the trip level: the
 *   exercise level capped by rain; `wet` is `isWet`, marked in text and not by colour alone).
 */
export function tripModel({ vm, place, originVm }, trip, nowMs) {
  const { slots, tail } = tripPlan(vm, trip.start, trip.end, nowMs);
  const best = bestWindow(slots);
  const today = String(vm?.now?.hourKey ?? "").slice(0, 10);
  const items = tripChecklist(slots, today).map((it) => {
    const v = valueText(it);
    const tags = it.on
      ? [`${it.hourKey ? `${String(it.hourKey).slice(0, 10) !== today ? "明日 " : ""}${String(it.hourKey).slice(11, 16)}` : "全程"}${v ? `・${v}` : ""}`]
      : [];
    return { ...it, tags };
  });
  const rows = slots.map((s, i) => {
    const inBest = Boolean(best) && i >= best.startIndex && i <= best.endIndex;
    const rain = num(s.rainProb);
    const t = `${s.isTomorrow ? "明日 " : ""}${pad2(s.hour)}:00`;
    const wetHour = isWet(s);
    const aria = `${t}，${intText(s.temp)}度，降雨 ${rain === null ? "無資料" : `${Math.round(rain)}%`}${wetHour ? "，可能下雨" : ""}，${s.comfort === null ? "舒適度無資料" : `舒適度 ${s.comfort}，${levelWord(s.level)}`}${inBest ? "，最佳時段" : ""}`;
    return { hourKey: s.hourKey, hour: s.hour, isTomorrow: s.isTomorrow, comfort: s.comfort, level: s.level, temp: s.temp, rain, wet: wetHour, best: inBest, aria };
  });
  const wet = slots.find(isWet) ?? null;
  const elev = num(vm?.location?.elevation) ?? num(place?.elevation);
  return {
    slots,
    tail,
    best,
    items,
    headline: tripHeadline(slots, best, items),
    diff: tempDiff(vm, originVm),
    name: place ? placeLabel(place) : "",
    elevation: elev,
    condition: vm ? `現在 ${intText(vm.now.temp)}° ${vm.now.label ?? "--"}` : "--",
    wet,
    rows,
  };
}

/**
 * Hour `<select>` with a visible label (native control, >= 44 px high).
 * @param {'start'|'end'} key
 * @param {string} name Visible label (`開始時間`).
 * @param {number} value 0-23
 * @returns {string} HTML.
 */
function selectHtml(key, name, value) {
  const opts = Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === value ? " selected" : ""}>${pad2(h)}:00</option>`).join("");
  return `<div class="field" data-k="t-field-${key}"><label class="field-k" for="sel-${key}">${esc(name)}</label><div class="selwrap"><select id="sel-${key}" data-trip="${key}">${opts}</select></div></div>`;
}

/**
 * Destination chips: saved places (single-select: the chosen one has `aria-current="true"`) and the
 * search key that opens the picker in trip mode. A chip shows the plain name, or the label with its
 * admin1 (`新竹・新竹縣`) when two saved places share a name.
 * @param {object[]} saved Saved places.
 * @param {object|null} trip The trip place.
 * @returns {string} HTML.
 */
function chipsBlock(saved, trip) {
  const counts = new Map();
  for (const p of saved) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const chips = saved
    .map((p) => `<button type="button" class="key dest" data-k="d-${esc(p.id)}" id="dest-${esc(p.id)}" data-action="trip-pick" data-id="${esc(p.id)}"${trip?.id === p.id ? ' aria-current="true"' : ""}>${esc(counts.get(p.name) > 1 ? placeLabel(p) : p.name)}</button>`)
    .join("");
  return `<div class="dests" data-k="t-dests" role="group" aria-label="目的地">${chips}<button type="button" class="key dest dest--add" data-k="d-add" id="t-add" data-action="open-picker" data-mode="trip">＋ 搜尋</button></div>`;
}

/**
 * The hero LCD (VS 目前位置).
 * @param {ReturnType<typeof tripModel>|null} m Null for the loading skeleton.
 * @param {object|null} place
 * @returns {string} HTML.
 */
function heroHtml(m, place) {
  const d = diffParts(m ? m.diff : null);
  const elev = m && m.elevation !== null ? `海拔 ${Math.round(m.elevation)} m` : "海拔 --";
  const warn = m?.wet
    ? `<span class="warn-row"><span class="warn" role="img" aria-label="${m.wet.isTomorrow ? "明日 " : ""}${pad2(m.wet.hour)}:00 起降雨機率高">!RAIN</span><span class="warn-at">${m.wet.isTomorrow ? "明日 " : ""}${pad2(m.wet.hour)}:00</span></span>`
    : "";
  return `<section class="hero" data-k="t-hero" aria-label="目的地溫差"><div class="lcd lcd--trip">
<div class="trip-l"><span class="mono">VS 目前位置</span><div class="trip-diff">${d.sign ? `<span class="sign" aria-hidden="true">${d.sign}</span>` : ""}${seg7Svg(d.text, { height: 72, ghost: true, label: d.label })}<span class="unit" aria-hidden="true">°C</span></div></div>
<div class="trip-r"><span class="trip-name">${esc(m ? m.name : place ? place.name : "--")}</span><span>${esc(elev)}</span><span>${esc(m ? m.condition : "載入中")}</span>${warn}</div>
</div></section>`;
}

/**
 * The comfort strip: one row per hour, bar length = comfort, colour = trip level (an outlined fill),
 * best window ringed; wet hours (rain >= 40%) carry a bold, underlined `雨70%` (text and shape, not colour alone).
 * The legend names all three levels, the ring and the wet marker.
 * @param {object[]} rows `tripModel().rows`.
 * @param {number|null} [tail] `tripModel().tail`: shows the note `今天行程只剩 N 小時，顯示明天` above the strip.
 * @returns {string} HTML.
 */
function stripHtml(rows, tail = null) {
  const items = rows
    .map((r, i) => {
      const rainText = `雨${r.rain === null ? "--" : Math.round(r.rain)}%`;
      return `<li class="srow${r.best ? " is-best" : ""}${r.wet ? " is-wet" : ""}" data-k="s-${esc(r.hourKey)}"><span class="st" aria-hidden="true"><b>${pad2(r.hour)}</b>${r.isTomorrow ? "<i>明日</i>" : ""}</span><span class="strack" aria-hidden="true"><span class="sfill sfill--${r.level ?? "none"}" data-p="${r.comfort ?? 0}" data-i="${i}"></span></span><span class="sval" aria-hidden="true">${esc(intText(r.temp))}° ${r.wet ? `<b class="wet">${rainText}</b>` : rainText}</span><span class="sr-only">${esc(r.aria)}</span></li>`;
    })
    .join("");
  const body = rows.length ? `<ol class="strip" aria-label="逐時舒適度">${items}</ol>` : `<p class="notice">這個時段沒有逐時資料</p>`;
  const legend = `<p class="legend"><span class="lg"><i class="sw sw--good" aria-hidden="true"></i>適合</span><span class="lg"><i class="sw sw--ok" aria-hidden="true"></i>普通</span><span class="lg"><i class="sw sw--bad" aria-hidden="true"></i>不建議</span><span class="lg"><i class="sw sw--best" aria-hidden="true"></i>外框 = 最佳時段</span><span class="lg"><b class="wet">雨</b> = 降雨機率 ≥ ${T.rainProb}% 或雨量 ≥ ${T.rain} mm</span></p>`;
  const note = tail ? `<p class="note strip-note" data-k="t-tail">今天行程只剩 ${tail} 小時，顯示${rows[0]?.isTomorrow === false ? "稍後的時段" : "明天"}</p>` : "";
  return `<section class="card" data-k="t-strip" aria-label="逐時狀態"><div class="card-head"><span>逐時舒適度</span><span class="hint">長度 = 舒適度（雨天不超過「普通」）</span></div>${note}${body}${legend}</section>`;
}

/**
 * Trip blocks (everything below the scenario chips).
 * @param {{status: string, vm: (object|null), places?: object}} state Controller state; `state.vm` is the current place (origin).
 * @param {{outing: {trip: {start: number, end: number}}, trip: (object|null), saved: object[], nowMs: number}} ui
 *   `ui.trip`: the destination Place or null; `ui.saved`: saved places for the chips.
 * @returns {string} HTML.
 */
export function tripHtml(state, ui) {
  const t = ui.outing.trip;
  const place = ui.trip ?? null;
  const parts = [chipsBlock(ui.saved ?? [], place)];
  if (!place) {
    parts.push(
      `<h1 class="sr-only" data-k="t-h1">出遊：選擇目的地</h1>`,
      `<section class="card empty" data-k="t-empty" aria-label="尚未選擇目的地"><p class="empty-title">還沒有出遊目的地</p><p class="note">選一個地點，看看那裡比你現在的位置冷還是熱、哪個時段最適合出遊。</p><button type="button" class="key key--accent" id="t-empty-add" data-action="open-picker" data-mode="trip">＋ 搜尋地點</button></section>`,
    );
    return parts.join("\n");
  }
  const entry = entryOf(state, place);
  const vm = entry?.vm ?? null;
  const ready = Boolean(vm) && (entry.status === "ready" || entry.status === "stale");
  const model = ready ? tripModel({ vm, place, originVm: state.vm ?? null }, t, ui.nowMs) : null;
  if (entry?.status === "stale" && vm) {
    parts.push(`<p class="banner" data-k="t-stale">資料時間 ${esc(clockAt(entry.fetchedAt ?? 0, vm.location.utcOffsetSeconds))}・無法更新</p>`);
  }
  if (entry?.status === "error" && !vm) {
    parts.push(`<div class="error-card" data-k="t-error"><p>${esc(ERROR_TEXT)}</p><button type="button" class="key" id="t-retry" data-action="retry-place" data-id="${esc(place.id)}">重試</button></div>`);
  }
  if (ready && !vm.hoursAvailable) parts.push(`<p class="banner" data-k="t-no-hours">沒有逐時資料，無法規劃出遊</p>`);
  let title = "載入天氣中…";
  if (model) title = model.headline;
  else if (entry?.status === "error") title = "目的地天氣暫時無法取得";
  parts.push(
    heroHtml(model, place),
    `<div class="fields" data-k="t-fields">${selectHtml("start", "開始時間", t.start)}${selectHtml("end", "結束時間", t.end)}</div>`,
    `<h1 class="headline headline--sm" data-k="t-headline">${esc(title)}</h1>`,
  );
  if (model) parts.push(stripHtml(model.rows, model.tail), checklistHtml(model.items, "t-checklist"));
  return parts.join("\n");
}
