import { test } from "node:test";
import assert from "node:assert/strict";
import { commuteHeadline } from "../../js/domain/outing-summary.js";

const items = (...on) => ["umbrella", "jacket", "sunscreen", "mask"].map((id) => ({ id, on: on.includes(id) }));
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
