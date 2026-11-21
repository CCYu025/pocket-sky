/**
 * One-line commute headline (pure).
 * @module domain/outing-summary
 */
import { COMMUTE_HEADLINE_RAIN_ID } from "../rules/config.js";

const on = (items, id) => Array.isArray(items) && items.some((i) => i.id === id && i.on);
/** The mask branch is only for poor air (AQI >= 100); a PM2.5-only item does not change the headline. */
const maskOn = (items) => Array.isArray(items) && items.some((i) => i.id === "mask" && i.on && i.field === "aqi");

/**
 * Period-of-day word for an hour, in the day-relative form (`明早`, `明天下午`, `明天傍晚`, `明晚`,
 * `明天凌晨`) when the leg is tomorrow.
 * @param {number} h
 * @param {boolean} [tomorrow=false]
 * @returns {string}
 */
function period(h, tomorrow = false) {
  const p = h < 6 ? "凌晨" : h < 12 ? "早上" : h < 18 ? "下午" : h < 20 ? "傍晚" : "晚上";
  if (!tomorrow) return p;
  return p === "早上" ? "明早" : p === "晚上" ? "明晚" : `明天${p}`;
}

/**
 * Headline for the commute scenario.
 * @param {object[]} outItems Checklist items evaluated on the OUT leg only.
 * @param {object[]} backItems Checklist items evaluated on the BACK leg only.
 * @param {object[]} outHours OUT leg hour entries (`legHours`).
 * @param {object[]} backHours BACK leg hour entries.
 * @param {{combined?: object[], tomorrow?: {out?: boolean, back?: boolean}}} [opts] `combined`: the
 *   checklist evaluated over both legs together (the items the list shows); the mask and jacket
 *   branches use it so the headline never contradicts the list (default: the per-leg items).
 *   `tomorrow`: which legs fall on tomorrow, for the day words.
 * @returns {string} Priority: both legs empty `資料不足`; rain on both
 *   `來回都可能下雨`; back only `{period}回家會遇到雨`; out only `{period}出門可能下雨`
 *   (`明早 / 明天下午 / 明天傍晚 / 明晚` for a tomorrow leg); mask (AQI >= 100 only)
 *   `空氣品質差，記得戴口罩`; jacket `氣溫偏低，記得帶外套`; else `來回都舒適`.
 */
export function commuteHeadline(outItems, backItems, outHours, backHours, opts = {}) {
  const oh = outHours ?? [];
  const bh = backHours ?? [];
  if (oh.length === 0 && bh.length === 0) return "資料不足";
  const id = COMMUTE_HEADLINE_RAIN_ID;
  const o = on(outItems, id);
  const b = on(backItems, id);
  const tm = opts.tomorrow ?? {};
  if (o && b) return "來回都可能下雨";
  if (b) return `${period(bh[0]?.hour ?? 18, Boolean(tm.back))}回家會遇到雨`;
  if (o) return `${period(oh[0]?.hour ?? 8, Boolean(tm.out))}出門可能下雨`;
  const all = opts.combined ?? [...(outItems ?? []), ...(backItems ?? [])];
  if (maskOn(all)) return "空氣品質差，記得戴口罩";
  if (on(all, "jacket")) return "氣溫偏低，記得帶外套";
  return "來回都舒適";
}
