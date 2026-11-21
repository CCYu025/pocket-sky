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
 * Trip comfort level of an hour: the exercise level capped by rain, so a wet hour never reads as good.
 * `rainProb >= 60` is `bad`; `>= 40` is at most `ok`; an unknown level stays unknown.
 * @param {'good'|'ok'|'bad'|null} level Exercise level (`levelOf(scoreHour(h))`).
 * @param {number|null|undefined} rainProb Precipitation probability in %.
 * @returns {'good'|'ok'|'bad'|null}
 */
export function tripLevel(level, rainProb) {
  const r = num(rainProb);
  if (level === null || level === undefined || r === null) return level ?? null;
  if (r >= T.rainProbBad) return "bad";
  if (r >= T.rainProb && level === "good") return "ok";
  return level;
}

/** Minutes of day of an ISO local time `YYYY-MM-DDTHH:MM`, or null. */
const minutesOfDay = (iso) => (typeof iso === "string" && /T\d{2}:\d{2}/.test(iso) ? Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) : null);

/**
 * Where an hour lies relative to daylight: `day` when at least 30 minutes of the hour fall between
 * sunrise and sunset, else `before` (earlier than sunrise) or `after` (sunset passed).
 * @param {number} hour 0-23
 * @param {string|null} sunrise `YYYY-MM-DDTHH:MM` (only the time of day is used)
 * @param {string|null} sunset
 * @returns {'day'|'before'|'after'|null} `null` when sunrise or sunset is unknown.
 */
export function daylightPhase(hour, sunrise, sunset) {
  const sr = minutesOfDay(sunrise);
  const ss = minutesOfDay(sunset);
  if (sr === null || ss === null) return null;
  const from = hour * 60;
  if (Math.min(from + 60, ss) - Math.max(from, sr) >= 30) return "day";
  return from < sr ? "before" : "after";
}

/**
 * Hourly slots of the destination between `startHour` and `endHour`.
 * The window is the next occurrence of `startHour`..`endHour` (end exclusive; it wraps past midnight
 * when `endHour <= startHour`; length capped at `MAX_TRIP_HOURS`). When now already lies inside the
 * window (start <= now < end, wrapping included) it starts **today at the current hour**; otherwise
 * today's `startHour` when that is still ahead (`startHour >=` the current local hour), else
 * tomorrow's. Hours missing from `vm.hours` are omitted.
 * @param {object} vm Destination view model (`vm.today` / `vm.tomorrow` give sunrise and sunset).
 * @param {number} startHour 0-23
 * @param {number} endHour 0-23
 * @param {number} nowMs
 * @returns {object[]} Copies of the `vm.hours` entries (so slots can be fed to `evaluateChecklist`)
 *   plus `isTomorrow`, `comfort` (`scoreHour`), `level` (the trip level: exercise level capped by rain,
 *   see `tripLevel`) and `daylight` (`daylightPhase` with the slot day's sunrise/sunset: tomorrow's from
 *   `vm.tomorrow` when present, else today's as an approximation).
 */
export function tripSlots(vm, startHour, endHour, nowMs) {
  const hours = vm?.hours;
  if (!Array.isArray(hours) || hours.length === 0) return [];
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) return [];
  const { date, hour: nowHour } = localParts(vm.location?.utcOffsetSeconds ?? 0, nowMs);
  const len = Math.min(MAX_TRIP_HOURS, endHour > startHour ? endHour - startHour : endHour + 24 - startHour);
  const done = (nowHour - startHour + 24) % 24; // hours of the window that have already begun
  const inside = done < len;
  const first = inside ? `${date}T${hh(nowHour)}:00` : addHours(`${date}T${hh(startHour)}:00`, startHour >= nowHour ? 0 : 24);
  const count = inside ? len - done : len;
  const tomorrow = addHours(`${date}T00:00`, 24).slice(0, 10);
  const sunOf = (d) => (d === tomorrow && vm.tomorrow?.sunrise && vm.tomorrow?.sunset ? vm.tomorrow : vm.today ?? {});
  const byKey = new Map(hours.map((h) => [h.hourKey, h]));
  const slots = [];
  for (let i = 0; i < count; i++) {
    const key = addHours(first, i);
    const h = byKey.get(key);
    if (!h) continue;
    const comfort = scoreHour(h);
    const sun = sunOf(key.slice(0, 10));
    slots.push({ ...h, isTomorrow: key.slice(0, 10) !== date, comfort, level: tripLevel(levelOf(comfort), h.rainProb), daylight: daylightPhase(h.hour, sun.sunrise, sun.sunset) });
  }
  return slots;
}

/** Best contiguous run of `ok` slots, at least `minLen` long: highest mean comfort, ties earliest start then longer run. */
function bestRun(list, ok, minLen) {
  let best = null;
  for (let i = 0; i < list.length; i++) {
    let sum = 0;
    for (let j = i; j < list.length; j++) {
      if (!ok(list[j])) break;
      sum += list[j].comfort;
      const len = j - i + 1;
      if (len < minLen) continue;
      // exact mean comparison by cross-multiplication (comfort values are integers)
      const better =
        best === null || sum * best.len > best.sum * len || (sum * best.len === best.sum * len && i === best.i && len > best.len);
      if (better) best = { i, j, sum, len };
    }
  }
  return best;
}

/**
 * Best contiguous window. Candidate runs contain only **dry** (`rainProb < 40`; an unknown probability
 * is not wet) slots with a known comfort. Daylight first: a run of at least `minLen` slots that are all
 * daylight (`daylight` `day`, or unknown) with the highest mean comfort. If none exists, the best dry
 * run of any time of day (`night` says why it is not daylight: `after` sunset or `before` sunrise, from
 * the run's first non-daylight slot). No dry run of `minLen` at all: `null` (no recommendation).
 * Ties: earliest start, then the longer run.
 * @param {object[]} slots Output of `tripSlots`.
 * @param {number} [minLen=3]
 * @returns {{ startIndex: number, endIndex: number, length: number, mean: number,
 *   start: object, end: object, night: ('after'|'before'|null) }|null} `endIndex` is inclusive;
 *   `night` is `null` for a daylight window.
 */
export function bestWindow(slots, minLen = 3) {
  const list = Array.isArray(slots) ? slots : [];
  const dry = (s) => num(s.comfort) !== null && !(num(s.rainProb) !== null && s.rainProb >= T.rainProb);
  const lit = (s) => s.daylight !== "before" && s.daylight !== "after";
  let night = null;
  let best = bestRun(list, (s) => dry(s) && lit(s), minLen);
  if (!best) {
    best = bestRun(list, dry, minLen);
    if (!best) return null;
    night = list.slice(best.i, best.j + 1).find((s) => !lit(s))?.daylight ?? null;
  }
  return { startIndex: best.i, endIndex: best.j, length: best.len, mean: best.sum / best.len, start: list[best.i], end: list[best.j], night };
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
 * Checklist for the trip slots (same rules as commute; reasons say `出遊時段`).
 * @param {object[]} slots
 * @param {string|null} [today] Local `YYYY-MM-DD` for the `明日` prefix.
 * @returns {object[]} `evaluateChecklist` items.
 */
export function tripChecklist(slots, today = null) {
  return evaluateChecklist(slots, CHECKLIST_RULES, { today, period: "出遊時段" });
}

/**
 * `15–19 時` span of the wet slots (first to last wet hour, end exclusive); a tomorrow start is
 * prefixed `明天`, an end that falls on tomorrow while the start is today too (`22–明天02 時`).
 * @param {object[]} wet Wet slots in time order.
 * @returns {string}
 */
function wetSpan(wet) {
  const f = wet[0];
  const l = wet[wet.length - 1];
  const endTomorrow = (l.isTomorrow || l.hour === 23) && !f.isTomorrow;
  return `${f.isTomorrow ? "明天" : ""}${hh(f.hour)}–${endTomorrow ? "明天" : ""}${hh((l.hour + 1) % 24)} 時`;
}

const NIGHT_NOTE = { after: "（已日落）", before: "（日出前）" };

/**
 * One-line trip headline. Priority: no slots `資料不足`; rain (slots with rainProb >= 40, else the
 * umbrella item's hour when it triggered by rain amount) names the wet span, `15–19 時可能下雨，建議
 * {range} 遊玩` (`15–19 時可能下雨` without a best window); AQI mask `空氣品質差，記得戴口罩`; jacket
 * `氣溫偏低，記得帶外套` / `早晚溫差大，記得帶外套`; PM2.5 mask; sunscreen `紫外線強，記得防曬`;
 * else `{range} 最適合遊玩`, or `天氣穩定，適合出遊` without a best window. A best window that is not
 * daylight (`night`) reads `{range} 較適合（已日落）` / `（日出前）` (in the rain headline
 * `建議 {range} 遊玩（已日落）`). A tomorrow hour or range start is prefixed `明天`
 * (`明天13–15 時可能下雨`, `明天09:00–12:00`).
 * @param {object[]} slots
 * @param {object|null} best `bestWindow` result.
 * @param {object[]} [items] Checklist items (`tripChecklist`).
 * @returns {string}
 */
export function tripHeadline(slots, best, items = []) {
  if (!Array.isArray(slots) || slots.length === 0) return "資料不足";
  const on = (id) => items.find((i) => i.id === id && i.on);
  const umbrella = on("umbrella");
  let wet = slots.filter((s) => num(s.rainProb) !== null && s.rainProb >= T.rainProb);
  if (wet.length === 0 && umbrella?.hourKey) wet = slots.filter((s) => s.hourKey === umbrella.hourKey);
  const range = best ? windowRange(best) : null;
  const note = best?.night ? NIGHT_NOTE[best.night] ?? "" : "";
  if (wet.length) return range ? `${wetSpan(wet)}可能下雨，建議 ${range} 遊玩${note}` : `${wetSpan(wet)}可能下雨`;
  if (items.some((i) => i.id === "mask" && i.on && i.field === "aqi")) return "空氣品質差，記得戴口罩";
  const jacket = on("jacket");
  if (jacket) return jacket.field === "temp" ? "早晚溫差大，記得帶外套" : "氣溫偏低，記得帶外套";
  if (on("mask")) return "PM2.5 偏高，敏感族群記得戴口罩";
  if (on("sunscreen")) return "紫外線強，記得防曬";
  if (!range) return "天氣穩定，適合出遊";
  return best.night ? `${range} 較適合${note}` : `${range} 最適合遊玩`;
}
