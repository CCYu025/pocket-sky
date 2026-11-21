/**
 * Trip (出遊) rules: slots, best window, temperature difference, headline (pure).
 * @module rules/trip
 */
import { CHECKLIST_RULES, T } from "./config.js";
import { evaluateChecklist } from "./checklist.js";
import { scoreHour, levelOf } from "./exercise.js";
import { localParts, addHours } from "../time.js";

/** Longest trip window in hours. */
export const MAX_TRIP_HOURS = 12;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const hh = (h) => String(h).padStart(2, "0");

/**
 * Hourly slots of the destination between `startHour` and `endHour`.
 * The window starts at the next occurrence of `startHour` (same rule as `legHours`: today's when
 * `startHour >=` the current local hour, so the current hour counts, else tomorrow's) and ends
 * before `endHour` (exclusive). When `endHour <= startHour` it wraps past midnight; the length is
 * capped at `MAX_TRIP_HOURS`. Hours missing from `vm.hours` are omitted.
 * @param {object} vm Destination view model.
 * @param {number} startHour 0-23
 * @param {number} endHour 0-23
 * @param {number} nowMs
 * @returns {object[]} Copies of the `vm.hours` entries (so slots can be fed to `evaluateChecklist`)
 *   plus `isTomorrow`, `comfort` (`scoreHour`) and `level`, i.e. at least
 *   `{ hourKey, hour, isTomorrow, comfort, level, temp, rainProb }`.
 */
export function tripSlots(vm, startHour, endHour, nowMs) {
  const hours = vm?.hours;
  if (!Array.isArray(hours) || hours.length === 0) return [];
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) return [];
  const { date, hour: nowHour } = localParts(vm.location?.utcOffsetSeconds ?? 0, nowMs);
  const len = Math.min(MAX_TRIP_HOURS, endHour > startHour ? endHour - startHour : endHour + 24 - startHour);
  const first = addHours(`${date}T${hh(startHour)}:00`, startHour >= nowHour ? 0 : 24);
  const byKey = new Map(hours.map((h) => [h.hourKey, h]));
  const slots = [];
  for (let i = 0; i < len; i++) {
    const key = addHours(first, i);
    const h = byKey.get(key);
    if (!h) continue;
    const comfort = scoreHour(h);
    slots.push({ ...h, isTomorrow: key.slice(0, 10) !== date, comfort, level: levelOf(comfort) });
  }
  return slots;
}

/**
 * Best contiguous window: at least `minLen` consecutive slots, all with a known comfort, with the
 * highest mean comfort. Ties: earliest start, then the longer run.
 * @param {object[]} slots Output of `tripSlots`.
 * @param {number} [minLen=3]
 * @returns {{ startIndex: number, endIndex: number, length: number, mean: number,
 *   start: object, end: object }|null} `endIndex` is inclusive; `null` when there are fewer than
 *   `minLen` slots or no such window.
 */
export function bestWindow(slots, minLen = 3) {
  const list = Array.isArray(slots) ? slots : [];
  let best = null;
  for (let i = 0; i < list.length; i++) {
    let sum = 0;
    for (let j = i; j < list.length; j++) {
      const c = num(list[j].comfort);
      if (c === null) break;
      sum += c;
      const len = j - i + 1;
      if (len < minLen) continue;
      // exact mean comparison by cross-multiplication (comfort values are integers)
      const better =
        best === null || sum * best.len > best.sum * len || (sum * best.len === best.sum * len && i === best.i && len > best.len);
      if (better) best = { i, j, sum, len };
    }
  }
  if (!best) return null;
  return { startIndex: best.i, endIndex: best.j, length: best.len, mean: best.sum / best.len, start: list[best.i], end: list[best.j] };
}

/**
 * Text range of a window, end exclusive: `09:00–12:00`. A tomorrow start is prefixed `明天`; an end
 * that falls on tomorrow while the start is today is prefixed too (`22:00–明天02:00`).
 * @param {{start: object, end: object}} win
 * @returns {string}
 */
export function windowRange(win) {
  const { start: s, end: e } = win;
  const endTomorrow = e.isTomorrow || e.hour === 23;
  return `${s.isTomorrow ? "明天" : ""}${hh(s.hour)}:00–${endTomorrow && !s.isTomorrow ? "明天" : ""}${hh((e.hour + 1) % 24)}:00`;
}

/**
 * Destination temperature minus origin temperature, rounded to an integer.
 * @param {object} destVm
 * @param {object} originVm
 * @returns {number|null} `null` when either `now.temp` is missing; never `-0`.
 */
export function tempDiff(destVm, originVm) {
  const d = num(destVm?.now?.temp);
  const o = num(originVm?.now?.temp);
  if (d === null || o === null) return null;
  const r = Math.round(d - o);
  return r === 0 ? 0 : r;
}

/**
 * Checklist for the trip slots (same rules as commute).
 * @param {object[]} slots
 * @param {string|null} [today] Local `YYYY-MM-DD` for the `明日` prefix.
 * @returns {object[]} `evaluateChecklist` items.
 */
export function tripChecklist(slots, today = null) {
  return evaluateChecklist(slots, CHECKLIST_RULES, { today });
}

/**
 * One-line trip headline. Priority: no slots `資料不足`; rain (a slot with rainProb >= 40, else the
 * umbrella item's hour when it triggered by rain amount) `{HH} 時後可能下雨，建議 {range} 遊玩`
 * (`{HH} 時起可能下雨` without a best window); AQI mask `空氣品質差，記得戴口罩`; jacket
 * `氣溫偏低，記得帶外套` / `早晚溫差大，記得帶外套`; PM2.5 mask; sunscreen `紫外線強，記得防曬`;
 * else `{range} 最適合遊玩`, or `天氣穩定，適合出遊` without a best window. A tomorrow hour or
 * range start is prefixed `明天` (`明天13 時後…`, `明天09:00–12:00`).
 * @param {object[]} slots
 * @param {object|null} best `bestWindow` result.
 * @param {object[]} [items] Checklist items (`tripChecklist`).
 * @returns {string}
 */
export function tripHeadline(slots, best, items = []) {
  if (!Array.isArray(slots) || slots.length === 0) return "資料不足";
  const on = (id) => items.find((i) => i.id === id && i.on);
  const umbrella = on("umbrella");
  const wet =
    slots.find((s) => num(s.rainProb) !== null && s.rainProb >= T.rainProb) ??
    (umbrella?.hourKey ? slots.find((s) => s.hourKey === umbrella.hourKey) : null);
  const range = best ? windowRange(best) : null;
  if (wet) {
    const pre = wet.isTomorrow ? "明天" : "";
    return range ? `${pre}${hh(wet.hour)} 時後可能下雨，建議 ${range} 遊玩` : `${pre}${hh(wet.hour)} 時起可能下雨`;
  }
  if (items.some((i) => i.id === "mask" && i.on && i.field === "aqi")) return "空氣品質差，記得戴口罩";
  const jacket = on("jacket");
  if (jacket) return jacket.field === "temp" ? "早晚溫差大，記得帶外套" : "氣溫偏低，記得帶外套";
  if (on("mask")) return "PM2.5 偏高，敏感族群記得戴口罩";
  if (on("sunscreen")) return "紫外線強，記得防曬";
  return range ? `${range} 最適合遊玩` : "天氣穩定，適合出遊";
}
