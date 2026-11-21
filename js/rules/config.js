/**
 * Rule data for the Outing screen. All thresholds live here and nowhere else.
 *
 * `why` of a checklist rule is a function `(ctx) => string` (zh-Hant). `ctx`
 * is built by `evaluateChecklist`: `{ on, hit, max(field), min(field), range(field) }`
 * where `hit` is `{ field, agg, value, hour } | null` (the first matching
 * condition; `hour` is the entry's local hour 0-23 or `null` for `range`) and
 * `max/min/range(field)` give the aggregate over all supplied hours (or `null`).
 * @module rules/config
 */

/** Numeric thresholds shared by the rules and their explanations. */
export const T = {
  rainProb: 40,
  rain: 0.5,
  feels: 18,
  range: 6,
  uv: 6,
  uvHours: [10, 15],
  aqi: 100,
  pm25: 35,
};

/** Shown when every value a rule needs is null. */
export const NO_DATA_TEXT = "資料不足";

const hh = (h) => `${String(h).padStart(2, "0")}:00`;
const r = (v) => Math.round(v);

/**
 * @typedef {{ field: string, op: '>='|'<=', value: number, agg?: 'max'|'min'|'range', hours?: [number, number] }} Cond
 * @typedef {{ id: string, label: string, any: Cond[], why: (ctx: object) => string }} ChecklistRule
 */

/** @type {ChecklistRule[]} */
export const CHECKLIST_RULES = [
  {
    id: "umbrella",
    label: "雨傘",
    any: [
      { field: "rainProb", op: ">=", value: T.rainProb },
      { field: "rain", op: ">=", value: T.rain },
    ],
    why: (c) => {
      if (c.on && c.hit.field === "rain") return `${hh(c.hit.hour)} 預估降雨 ${Math.round(c.hit.value * 10) / 10} mm（≥ ${T.rain} mm 建議）`;
      if (c.on) return `${hh(c.hit.hour)} 降雨機率 ${r(c.hit.value)}%（≥ ${T.rainProb}% 建議）`;
      const p = c.max("rainProb");
      return p == null ? "預估無明顯降雨" : `降雨機率低（最高 ${r(p)}%）`;
    },
  },
  {
    id: "jacket",
    label: "外套",
    any: [
      { agg: "min", field: "feels", op: "<=", value: T.feels },
      { agg: "range", field: "temp", op: ">=", value: T.range },
    ],
    why: (c) => {
      if (c.on && c.hit.field === "feels") return `${hh(c.hit.hour)} 體感 ${r(c.hit.value)}°（≤ ${T.feels}° 建議）`;
      if (c.on) return `溫差 ${r(c.hit.value)}°（≥ ${T.range}° 建議）`;
      const m = c.min("feels");
      return m == null ? "氣溫變化不大" : `體感溫暖（最低 ${r(m)}°）`;
    },
  },
  {
    id: "sunscreen",
    label: "防曬",
    any: [{ field: "uv", op: ">=", value: T.uv, hours: T.uvHours }],
    why: (c) => {
      if (c.on) return `${hh(c.hit.hour)} 紫外線指數 ${r(c.hit.value)}（≥ ${T.uv} 建議）`;
      return "通勤時段紫外線低";
    },
  },
  {
    id: "mask",
    label: "口罩",
    any: [
      { field: "aqi", op: ">=", value: T.aqi },
      { field: "pm25", op: ">=", value: T.pm25 },
    ],
    why: (c) => {
      if (c.on && c.hit.field === "aqi") return `${hh(c.hit.hour)} AQI ${r(c.hit.value)}（≥ ${T.aqi} 建議）`;
      if (c.on) return `${hh(c.hit.hour)} PM2.5 ${r(c.hit.value)} µg/m³（≥ ${T.pm25} 建議）`;
      const a = c.max("aqi");
      if (a != null) return `空氣品質良好 AQI ${r(a)}`;
      return `空氣品質良好 PM2.5 ${r(c.max("pm25"))}`;
    },
  },
];

/** Exercise slots cover this many hours, starting at the current floored hour. */
export const EXERCISE_LOOKAHEAD_HOURS = 12;

/** Exercise scoring curves are `[x, score]` points, clamped at both ends. */
export const EXERCISE_SCORING = {
  factors: {
    temp: [[5, 20], [12, 70], [18, 100], [24, 100], [30, 40], [35, 0]],
    humidity: [[30, 100], [60, 100], [85, 40], [100, 20]],
    rainProb: [[0, 100], [20, 90], [50, 30], [80, 0]],
    wind: [[0, 100], [20, 90], [35, 40], [50, 0]],
    aqi: [[0, 100], [50, 100], [100, 50], [150, 0]],
    uv: [[0, 100], [5, 100], [8, 50], [11, 20]],
  },
  weights: { temp: 3, humidity: 1, rainProb: 3, wind: 1, aqi: 2, uv: 1 },
  levels: { good: 75, ok: 50 },
};

/** Thresholds for the one-line exercise advice (checked in this order). */
export const EXERCISE_ADVICE = { rainProb: 50, feels: 30, aqi: 100 };

/** Checklist id that drives the commute headline's rain wording. */
export const COMMUTE_HEADLINE_RAIN_ID = "umbrella";
