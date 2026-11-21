import { test } from "node:test";
import assert from "node:assert/strict";
import { commuteHeadline } from "../../js/domain/outing-summary.js";

const items = (...on) =>
  ["umbrella", "jacket", "sunscreen", "mask"].map((id) => ({ id, on: on.includes(id), field: on.includes(id) ? (id === "mask" ? "aqi" : "x") : null }));
const pmItems = () => ["umbrella", "jacket", "sunscreen", "mask"].map((id) => ({ id, on: id === "mask", field: id === "mask" ? "pm25" : null }));
const leg = (hour) => [{ hour }, { hour: hour + 1 }];

test("no data on both legs", () => {
  assert.equal(commuteHeadline(items(), items(), [], []), "資料不足");
  assert.equal(commuteHeadline(undefined, undefined, undefined, undefined), "資料不足");
});

test("rain on the back leg only", () => {
  assert.equal(commuteHeadline(items(), items("umbrella"), leg(8), leg(18)), "傍晚回家會遇到雨");
  assert.equal(commuteHeadline(items(), items("umbrella"), leg(8), leg(14)), "下午回家會遇到雨");
});

test("rain on the out leg only", () => {
  assert.equal(commuteHeadline(items("umbrella"), items(), leg(8), leg(18)), "早上出門可能下雨");
});

test("rain on both legs", () => {
  assert.equal(commuteHeadline(items("umbrella"), items("umbrella"), leg(8), leg(18)), "來回都可能下雨");
});

test("mask then jacket when dry; priority rain > mask > jacket", () => {
  assert.equal(commuteHeadline(items("mask"), items("jacket"), leg(8), leg(18)), "空氣品質差，記得戴口罩");
  assert.equal(commuteHeadline(items(), items("jacket"), leg(8), leg(18)), "氣溫偏低，記得帶外套");
  assert.equal(commuteHeadline(items("mask", "jacket"), items("umbrella"), leg(8), leg(18)), "傍晚回家會遇到雨");
});

test("comfortable both ways (sunscreen alone does not change it)", () => {
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18)), "來回都舒適");
  assert.equal(commuteHeadline(items("sunscreen"), items(), leg(11), leg(18)), "來回都舒適");
});

test("one empty leg still produces a headline", () => {
  assert.equal(commuteHeadline(items(), items(), [], leg(18)), "來回都舒適");
  assert.equal(commuteHeadline(items(), items("umbrella"), [], leg(18)), "傍晚回家會遇到雨");
});

test("M1: jacket/mask come from the COMBINED items, never 來回都舒適 while an item is on", () => {
  // each leg alone is mild; only the two legs together trigger the jacket (temperature range)
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: items("jacket") }), "氣溫偏低，記得帶外套");
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: items("mask") }), "空氣品質差，記得戴口罩");
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: items() }), "來回都舒適");
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: items("sunscreen") }), "來回都舒適", "sunscreen alone does not change it");
});

test("m7: only AQI >= 100 drives the headline mask branch; PM2.5-only does not", () => {
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: items("mask") }), "空氣品質差，記得戴口罩");
  assert.equal(commuteHeadline(pmItems(), items(), leg(8), leg(18), { combined: pmItems() }), "來回都舒適");
  assert.equal(commuteHeadline(pmItems(), items("jacket"), leg(8), leg(18), { combined: items("jacket") }), "氣溫偏低，記得帶外套");
});

test("m3: a tomorrow leg uses 明早 / 明天下午 / 明天傍晚 / 明晚 in the rain headline", () => {
  const out = { tomorrow: { out: true, back: false } };
  assert.equal(commuteHeadline(items("umbrella"), items(), leg(8), leg(18), out), "明早出門可能下雨");
  assert.equal(commuteHeadline(items("umbrella"), items(), leg(14), leg(18), out), "明天下午出門可能下雨");
  assert.equal(commuteHeadline(items("umbrella"), items(), leg(18), leg(8), out), "明天傍晚出門可能下雨");
  assert.equal(commuteHeadline(items("umbrella"), items(), leg(21), leg(8), out), "明晚出門可能下雨");
  assert.equal(commuteHeadline(items("umbrella"), items(), leg(3), leg(8), out), "明天凌晨出門可能下雨");
  const back = { tomorrow: { out: false, back: true } };
  assert.equal(commuteHeadline(items(), items("umbrella"), leg(18), leg(8), back), "明早回家會遇到雨");
  assert.equal(commuteHeadline(items(), items("umbrella"), leg(8), leg(18), { tomorrow: { out: true, back: false } }), "傍晚回家會遇到雨", "today's leg keeps the plain word");
  assert.equal(commuteHeadline(items("umbrella"), items("umbrella"), leg(8), leg(18), { tomorrow: { out: true, back: true } }), "來回都可能下雨");
});
