/**
 * Exercise scoring and slots (pure).
 * @module rules/exercise
 */
import { EXERCISE_SCORING, EXERCISE_ADVICE } from "./config.js";
import { exerciseWindow } from "../time.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Piecewise-linear interpolation, clamped at both ends.
 * @param {number[][]} curve Ascending `[x, score]` points.
 * @param {number} x
 * @returns {number}
 */
export function interpolate(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

/**
 * Weighted score of one hour entry. Null factors are skipped and the weights
 * renormalised.
 * @param {object} h Hour entry (`temp, humidity, rainProb, wind, aqi, uv`).
 * @param {object} [cfg] Scoring config.
 * @returns {number|null} Integer 0-100, or `null` when every factor is null.
 */
export function scoreHour(h, cfg = EXERCISE_SCORING) {
  let sum = 0;
  let wsum = 0;
  for (const [f, w] of Object.entries(cfg.weights)) {
    const v = num(h?.[f]);
    if (v === null || !cfg.factors[f]) continue;
    sum += w * interpolate(cfg.factors[f], v);
    wsum += w;
  }
  return wsum === 0 ? null : Math.round(sum / wsum);
}

/**
 * Level of a score.
 * @param {number|null} score
 * @param {{good: number, ok: number}} [levels]
 * @returns {'good'|'ok'|'bad'|null}
 */
export function levelOf(score, levels = EXERCISE_SCORING.levels) {
  if (score === null) return null;
  return score >= levels.good ? "good" : score >= levels.ok ? "ok" : "bad";
}

/**
 * Scored slots for the exercise window (see `exerciseWindow`); hours absent
 * from `vm.hours` are omitted.
 * @param {object} vm View model.
 * @param {number} nowMs
 * @returns {{hourKey: string, hour: number, score: number|null, level: string|null, isTomorrow: boolean, metrics: object}[]}
 */
export function exerciseSlots(vm, nowMs) {
  const byKey = new Map((vm.hours ?? []).map((h) => [h.hourKey, h]));
  const today = String(vm.now.hourKey).slice(0, 10);
  const slots = [];
  for (const key of exerciseWindow(vm.location.utcOffsetSeconds, nowMs)) {
    const h = byKey.get(key);
    if (!h) continue;
    const score = scoreHour(h);
    slots.push({
      hourKey: key,
      hour: h.hour,
      score,
      level: levelOf(score),
      isTomorrow: key.slice(0, 10) !== today,
      metrics: { temp: h.temp, feels: h.feels, humidity: h.humidity, rainProb: h.rainProb, wind: h.wind, uv: h.uv, aqi: h.aqi },
    });
  }
  return slots;
}

/**
 * Best slot: highest non-null score, earliest on ties.
 * @param {object[]} slots
 * @returns {object|null}
 */
export function bestSlot(slots) {
  let best = null;
  for (const s of slots ?? []) if (s.score !== null && (best === null || s.score > best.score)) best = s;
  return best;
}

/**
 * One-line advice for a slot (priority: rain, heat, air, good, other).
 * @param {object|null} slot
 * @returns {string}
 */
export function exerciseAdvice(slot) {
  const m = slot?.metrics;
  if (!m) return "資料不足";
  if (num(m.rainProb) !== null && m.rainProb >= EXERCISE_ADVICE.rainProb) return `降雨機率 ${Math.round(m.rainProb)}%，建議改室內`;
  if (num(m.feels) !== null && m.feels >= EXERCISE_ADVICE.feels) return "偏熱，多補水";
  if (num(m.aqi) !== null && m.aqi >= EXERCISE_ADVICE.aqi) return "空氣品質差，建議室內";
  if (slot.level === "good") return "涼爽少雨，適合慢跑或騎車";
  return "留意天氣變化";
}
