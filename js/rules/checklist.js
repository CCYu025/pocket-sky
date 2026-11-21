/**
 * Commute checklist evaluation (pure).
 * @module rules/checklist
 */
import { CHECKLIST_RULES, NO_DATA_TEXT } from "./config.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cmp = (op, a, b) => (op === ">=" ? a >= b : a <= b);
const gt = (a, b) => a > b;
const lt = (a, b) => a < b;

/**
 * Evaluate one condition over the entries.
 * @param {object} cond Condition from config.
 * @param {object[]} hours Hour entries.
 * @returns {{state: 'excluded'|'nodata'|'ok', hit: object|null}}
 *   `excluded`: no entry lies in `cond.hours`; `nodata`: entries but all values null.
 */
function evalCond(cond, hours) {
  const [lo, hi] = cond.hours ?? [0, 23];
  const cands = hours.filter((h) => h.hour >= lo && h.hour <= hi);
  if (cands.length === 0) return { state: "excluded", hit: null };
  const vals = cands.map((h) => ({ v: num(h[cond.field]), hour: h.hour, hourKey: h.hourKey ?? null })).filter((x) => x.v !== null);
  if (vals.length === 0) return { state: "nodata", hit: null };
  const pick = (better) => vals.reduce((a, b) => (better(b.v, a.v) ? b : a)); // first wins ties
  let hit;
  if (cond.agg === "range") {
    hit = { value: pick(gt).v - pick(lt).v, hour: null, hourKey: null };
  } else {
    // default and 'max'/'min': the strongest entry in the operator's direction
    const e = pick(cond.agg === "min" ? lt : cond.agg === "max" ? gt : cond.op === ">=" ? gt : lt);
    hit = { value: e.v, hour: e.hour, hourKey: e.hourKey };
  }
  const matched = cmp(cond.op, hit.value, cond.value);
  return { state: "ok", hit: matched ? { field: cond.field, agg: cond.agg ?? null, ...hit } : null };
}

/**
 * Evaluate the checklist rules over the given hour entries (usually both
 * commute legs combined).
 * @param {object[]} hours Entries of `vm.hours`.
 * @param {object[]} [rules] Defaults to `CHECKLIST_RULES`.
 * @returns {{id: string, label: string, on: boolean, why: string, hourKey: string|null}[]}
 *   Rule order. `hourKey` is the hour of the triggering value (null when off
 *   or for `range`), so views can attribute an item to a leg. When every value
 *   a rule needs is null (or `hours` is empty), `on` is false and `why` is `資料不足`.
 */
export function evaluateChecklist(hours, rules = CHECKLIST_RULES) {
  const list = Array.isArray(hours) ? hours.filter(Boolean) : [];
  const agg = (f, fn) => {
    const v = list.map((h) => num(h[f])).filter((x) => x !== null);
    return v.length ? fn(v) : null;
  };
  return rules.map((rule) => {
    const res = rule.any.map((c) => evalCond(c, list));
    const hit = res.map((x) => x.hit).find(Boolean) ?? null;
    const known = res.some((x) => x.state !== "nodata");
    if (!hit && (!known || list.length === 0)) return { id: rule.id, label: rule.label, on: false, why: NO_DATA_TEXT, hourKey: null };
    const ctx = {
      on: Boolean(hit),
      hit,
      max: (f) => agg(f, (v) => Math.max(...v)),
      min: (f) => agg(f, (v) => Math.min(...v)),
      range: (f) => agg(f, (v) => Math.max(...v) - Math.min(...v)),
    };
    return { id: rule.id, label: rule.label, on: ctx.on, why: rule.why(ctx), hourKey: hit?.hourKey ?? null };
  });
}

/**
 * Entries of a commute leg on the next occurrence of `hour`.
 * @param {object[]} vmHours `vm.hours` (starts at the current hour).
 * @param {number} hour Leg start hour 0-23.
 * @param {number} [span=2] Number of consecutive entries to take.
 * @returns {object[]} Up to `span` entries; `[]` when not within `vmHours`.
 *   If `hour >= vmHours[0].hour` it is today's entry, otherwise tomorrow's.
 */
export function legHours(vmHours, hour, span = 2) {
  if (!Array.isArray(vmHours) || vmHours.length === 0) return [];
  const first = vmHours[0];
  const date = String(first.hourKey).slice(0, 10);
  const today = hour >= first.hour;
  const i = vmHours.findIndex((h) => h.hour === hour && (String(h.hourKey).slice(0, 10) === date) === today);
  return i < 0 ? [] : vmHours.slice(i, i + span);
}
