/**
 * One-line commute headline (pure).
 * @module domain/outing-summary
 */
import { COMMUTE_HEADLINE_RAIN_ID } from "../rules/config.js";

const on = (items, id) => Array.isArray(items) && items.some((i) => i.id === id && i.on);

/**
 * Period-of-day word for an hour.
 * @param {number} h
 * @returns {string}
 */
function period(h) {
  return h < 6 ? "凌晨" : h < 12 ? "早上" : h < 18 ? "下午" : h < 20 ? "傍晚" : "晚上";
}

/**
 * Headline for the commute scenario.
 * @param {object[]} outItems Checklist items evaluated on the OUT leg only.
 * @param {object[]} backItems Checklist items evaluated on the BACK leg only.
 * @param {object[]} outHours OUT leg hour entries (`legHours`).
 * @param {object[]} backHours BACK leg hour entries.
 * @returns {string} Priority: both legs empty `資料不足`; rain on both
 *   `來回都可能下雨`; back only `{period}回家會遇到雨`; out only `{period}出門可能下雨`;
 *   mask `空氣品質差，記得戴口罩`; jacket `氣溫偏低，記得帶外套`; else `來回都舒適`.
 */
export function commuteHeadline(outItems, backItems, outHours, backHours) {
  const oh = outHours ?? [];
  const bh = backHours ?? [];
  if (oh.length === 0 && bh.length === 0) return "資料不足";
  const id = COMMUTE_HEADLINE_RAIN_ID;
  const o = on(outItems, id);
  const b = on(backItems, id);
  if (o && b) return "來回都可能下雨";
  if (b) return `${period(bh[0]?.hour ?? 18)}回家會遇到雨`;
  if (o) return `${period(oh[0]?.hour ?? 8)}出門可能下雨`;
  if (on(outItems, "mask") || on(backItems, "mask")) return "空氣品質差，記得戴口罩";
  if (on(outItems, "jacket") || on(backItems, "jacket")) return "氣溫偏低，記得帶外套";
  return "來回都舒適";
}
