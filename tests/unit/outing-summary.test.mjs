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

test("comfortable both ways only when nothing is on", () => {
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18)), "來回都舒適");
  assert.equal(commuteHeadline(items("sunscreen"), items(), leg(11), leg(18)), "紫外線強，記得防曬");
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
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: items("sunscreen") }), "紫外線強，記得防曬");
});

test("m7: only AQI >= 100 drives the AQI mask branch; PM2.5-only has its own", () => {
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: items("mask") }), "空氣品質差，記得戴口罩");
  assert.equal(commuteHeadline(pmItems(), items(), leg(8), leg(18), { combined: pmItems() }), "PM2.5 偏高，敏感族群記得戴口罩", "PM2.5-only is not the AQI branch");
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

const jk = (field) => items().map((i) => (i.id === "jacket" ? { ...i, on: true, field } : i));
const sun = () => items().map((i) => (i.id === "sunscreen" ? { ...i, on: true, field: "uv" } : i));

test("N2: the jacket headline names its trigger (temperature range vs low feels)", () => {
  const h = (combined) => commuteHeadline(items(), items(), leg(8), leg(18), { combined });
  assert.equal(h(jk("temp")), "早晚溫差大，記得帶外套");
  assert.equal(h(jk("feels")), "氣溫偏低，記得帶外套");
});

test("N3: PM2.5-only mask and sunscreen have their own lower-priority headlines", () => {
  const h = (combined) => commuteHeadline(items(), items(), leg(8), leg(18), { combined });
  assert.equal(h(pmItems()), "PM2.5 偏高，敏感族群記得戴口罩");
  assert.equal(h(sun()), "紫外線強，記得防曬");
  const both = pmItems().map((i) => (i.id === "sunscreen" ? { ...i, on: true, field: "uv" } : i));
  assert.equal(h(both), "PM2.5 偏高，敏感族群記得戴口罩", "mask outranks sunscreen");
  assert.equal(h(items("mask", "sunscreen")), "空氣品質差，記得戴口罩");
  const jacketAndSun = jk("feels").map((i) => (i.id === "sunscreen" ? { ...i, on: true, field: "uv" } : i));
  assert.equal(h(jacketAndSun), "氣溫偏低，記得帶外套", "jacket outranks sunscreen");
});

test("N3: a 舒適 headline never appears while any combined item is on (no rain)", () => {
  const ids = ["umbrella", "jacket", "sunscreen", "mask"];
  const fields = { umbrella: ["rainProb"], jacket: ["feels", "temp"], sunscreen: ["uv"], mask: ["aqi", "pm25"] };
  for (let m = 1; m < 16; m++) {
    const on = ids.filter((_, i) => m & (1 << i));
    for (const pick of [0, 1]) {
      const combined = ids.map((id) => ({ id, on: on.includes(id), field: on.includes(id) ? fields[id][pick] ?? fields[id][0] : null }));
      const out = items(...(on.includes("umbrella") ? ["umbrella"] : [])); // an umbrella item implies a rainy leg
      const text = commuteHeadline(out, items(), leg(8), leg(18), { combined });
      assert.ok(!text.includes("舒適"), `${on.join("+")}/${pick}: ${text}`);
    }
  }
});

test("jacket via temperature range: 兩地溫差大 for two places, 早晚溫差大 otherwise", () => {
  const range = ["umbrella", "jacket", "sunscreen", "mask"].map((id) => ({ id, on: id === "jacket", field: id === "jacket" ? "temp" : null }));
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: range }), "早晚溫差大，記得帶外套");
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: range, twoPlaces: true }), "兩地溫差大，記得帶外套");
  const cold = range.map((i) => (i.id === "jacket" ? { ...i, field: "feels" } : i));
  assert.equal(commuteHeadline(items(), items(), leg(8), leg(18), { combined: cold, twoPlaces: true }), "氣溫偏低，記得帶外套");
});
