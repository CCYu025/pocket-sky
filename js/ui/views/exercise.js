/**
 * Exercise scenario: pure view model, selection/keyboard helpers and HTML template (no DOM access).
 * Every interpolated string goes through `escapeHtml`.
 * @module ui/views/exercise
 */
import { seg7Svg, escapeHtml as esc } from "../seg7.js";
import { exerciseSlots, bestSlot, exerciseAdvice } from "../../rules/exercise.js";
import { intText, clockOf } from "../format.js";
import { EXERCISE_LOOKAHEAD_HOURS } from "../../rules/config.js";

const pad2 = (h) => String(h).padStart(2, "0");
const WORD = { good: "適合", ok: "普通", bad: "不建議" };
const VERDICT = { good: "適合運動", ok: "普通", bad: "不建議" };

/**
 * Short level word used in accessible names.
 * @param {'good'|'ok'|'bad'|null} level
 * @returns {string} 適合 / 普通 / 不建議 / 無資料.
 */
export function levelWord(level) {
  return WORD[level] ?? "無資料";
}

/**
 * Which slot is selected: the user's pick if it still exists, else the best slot, else the first.
 * @param {{hourKey: string, score: (number|null)}[]} slots
 * @param {string|null} pickedKey Hour key the user picked, or null.
 * @returns {{index: number, slot: (object|null), picked: boolean}} `index` is -1 when there are no slots;
 *   `picked` is true only when `pickedKey` matched a slot.
 */
export function resolveSelection(slots, pickedKey) {
  if (!slots.length) return { index: -1, slot: null, picked: false };
  const p = pickedKey ? slots.findIndex((s) => s.hourKey === pickedKey) : -1;
  if (p >= 0) return { index: p, slot: slots[p], picked: true };
  const best = bestSlot(slots);
  const index = best ? slots.indexOf(best) : 0;
  return { index, slot: slots[index], picked: false };
}

/**
 * Keyboard selection: Left/Right move one slot (clamped, no wrap), Home/End jump to the ends.
 * @param {string} key `KeyboardEvent.key`.
 * @param {number} index Index of the focused bar.
 * @param {number} count Number of bars.
 * @returns {number|null} The new index (may equal `index` at an end), or null when the key is not handled.
 */
export function stepIndex(key, index, count) {
  if (!(count > 0)) return null;
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowRight") return Math.min(count - 1, index + 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Accessible name of a bar, e.g. `21:00，評分 84，適合` (`明日 ` prefix on tomorrow's slots).
 * @param {{hour: number, score: (number|null), level: (string|null), isTomorrow: boolean}} slot
 * @returns {string}
 */
export function slotLabel(slot) {
  const t = `${slot.isTomorrow ? "明日 " : ""}${pad2(slot.hour)}:00`;
  return slot.score === null ? `${t}，無資料` : `${t}，評分 ${slot.score}，${levelWord(slot.level)}`;
}

/**
 * Exercise view model.
 * @param {object} vm Controller view model.
 * @param {number} nowMs Epoch ms (for the slot window).
 * @param {string|null} pickedKey The user's picked hour key, or null for the default (best).
 * @returns {{slots: object[], best: (object|null), index: number, slot: (object|null), picked: boolean,
 *   verdict: string, advice: string, metrics: {k: string, v: string}[], note: string}}
 */
export function exerciseModel(vm, nowMs, pickedKey) {
  const slots = exerciseSlots(vm, nowMs);
  const best = bestSlot(slots);
  const sel = resolveSelection(slots, pickedKey);
  const m = sel.slot?.metrics;
  const pct = (v) => (intText(v) === "--" ? "--" : `${intText(v)}%`);
  const metrics = [
    { k: "溫度 / 體感", v: m ? `${intText(m.temp)}° / ${intText(m.feels)}°` : "--" },
    { k: "濕度", v: m ? pct(m.humidity) : "--" },
    { k: "降雨機率", v: m ? pct(m.rainProb) : "--" },
    { k: "風速", v: m && intText(m.wind) !== "--" ? `${intText(m.wind)} km/h` : "--" },
    { k: "紫外線", v: m ? intText(m.uv) : "--" },
    { k: "空氣品質", v: m && intText(m.aqi) !== "--" ? `AQI ${intText(m.aqi)}` : "--" },
  ];
  const now = clockOf(vm?.now?.minuteKey) ?? "--:--";
  const start = slots[0] ? `${pad2(slots[0].hour)}:00` : "--:--";
  return {
    slots,
    best,
    ...sel,
    verdict: sel.slot ? VERDICT[sel.slot.level] ?? "無資料" : "無資料",
    advice: sel.slot ? exerciseAdvice(sel.slot) : "資料不足",
    metrics,
    note: `現在 ${now}・從 ${start} 起算・未來 ${EXERCISE_LOOKAHEAD_HOURS} 小時`,
  };
}

/**
 * The LCD with TIME and SCORE.
 * @param {object|null} model From `exerciseModel`, or null (loading/error skeleton).
 * @param {number} flip One-shot flip counter: 0 none; odd `flip-a`, even `flip-b` (alternating class
 *   names restart the CSS animation exactly when the selection changes).
 * @returns {string} HTML.
 */
function heroHtml(model, flip) {
  const slot = model?.slot ?? null;
  const time = slot ? `${pad2(slot.hour)}:00` : "--:--";
  const score = slot && slot.score !== null ? String(slot.score) : "--";
  const timeLabel = slot ? `時間 ${slot.isTomorrow ? "明日 " : ""}${time}` : "時間 無資料";
  const scoreLabel = slot && slot.score !== null ? `評分 ${slot.score}` : "評分 無資料";
  const fl = flip > 0 ? (flip % 2 ? " flip-a" : " flip-b") : "";
  return `<section class="hero" data-k="x-hero" aria-label="選定時段"><div class="lcd">
<div class="lcd-top"><span>TIME${slot?.isTomorrow ? " 明日" : ""}</span><span>SCORE</span></div>
<div class="x-digits"><div class="x-time${fl}">${seg7Svg(time, { height: 50, ghost: false, label: timeLabel })}</div><div class="x-score${fl}">${seg7Svg(score, { height: 50, label: scoreLabel })}</div></div>
<div class="verdict-row"><span class="verdict">${esc(model ? model.verdict : "--")}</span><span class="advice">${esc(model ? model.advice : "載入中")}</span></div>
</div></section>`;
}

/**
 * Bars, `最佳` key, range slider and note.
 * @param {object|null} model
 * @param {string} loadingText Text for the empty placeholder.
 * @returns {string} HTML.
 */
function pickerHtml(model, loadingText) {
  const slots = model?.slots ?? [];
  const best = model?.best ? `${pad2(model.best.hour)}:00` : "--:--";
  const head = `<div class="card-head"><span>點長條選時間</span><button type="button" class="key best" data-action="pick-best"${model?.best ? "" : " disabled"}>最佳 ${esc(best)}</button></div>`;
  if (!slots.length) {
    return `<section class="card picker" data-k="x-picker" aria-label="選擇時間">${head}<p class="notice">${esc(loadingText)}</p></section>`;
  }
  const cols = slots
    .map((s, i) => {
      const sel = i === model.index;
      const cls = s.level ? ` xbar--${s.level}` : "";
      return `<div class="xcol" data-k="s-${esc(s.hourKey)}"><button type="button" class="xbar${cls}" id="slot-${esc(s.hourKey)}" data-action="pick-slot" data-hk="${esc(s.hourKey)}" aria-label="${esc(slotLabel(s))}" aria-pressed="${sel}"><span class="xfill" data-p="${s.score ?? 0}" data-i="${i}"></span></button><span class="xt${sel ? " is-sel" : ""}" aria-hidden="true"><b>${pad2(s.hour)}</b>${s.isTomorrow ? "<i>明日</i>" : ""}</span></div>`;
    })
    .join("");
  const cur = model.slot;
  const range = `<div class="range"><label for="x-range" class="range-k">滑桿選時間・<span class="range-v">${pad2(cur.hour)}:00</span></label><input type="range" id="x-range" min="0" max="${slots.length - 1}" step="1" value="${model.index}" aria-valuetext="${esc(slotLabel(cur))}"${slots.length < 2 ? " disabled" : ""}></div>`;
  return `<section class="card picker" data-k="x-picker" aria-label="選擇時間">${head}<div class="xbars" data-k="bars">${cols}</div>${range}<p class="note">${esc(model.note)}</p></section>`;
}

/**
 * Exercise blocks (everything below the scenario chips).
 * @param {{status: string, vm: (object|null)}} state Controller state.
 * @param {{outing: object, nowMs: number, picked: (string|null), flip: number, exercise?: object}} ui
 *   `ui.exercise`: the `exerciseModel` the caller already computed for this render (reused, not recomputed).
 * @returns {string} HTML.
 */
export function exerciseHtml(state, ui) {
  const { status, vm } = state;
  const ready = vm && status !== "loading" && status !== "error";
  const model = ready ? ui.exercise ?? exerciseModel(vm, ui.nowMs, ui.picked) : null;
  const metrics = (model ? model.metrics : ["溫度 / 體感", "濕度", "降雨機率", "風速", "紫外線", "空氣品質"].map((k) => ({ k, v: "--" })))
    .map((m) => `<div class="metric"><span class="k">${esc(m.k)}</span><span class="v">${esc(m.v)}</span></div>`)
    .join("");
  const emptyText = status === "error" ? "無法取得資料" : model ? "沒有可選時段" : "載入中…";
  return [
    `<h1 class="sr-only" data-k="x-h1">運動：選擇時段</h1>`,
    heroHtml(model, ui.flip),
    pickerHtml(model, emptyText),
    `<section class="metrics" data-k="x-metrics" aria-label="該時段指標">${metrics}</section>`,
  ].join("\n");
}
