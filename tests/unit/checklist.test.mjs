import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChecklist, legHours } from "../../js/rules/checklist.js";

const key = (hour, date = "2026-11-21") => `${date}T${String(hour).padStart(2, "0")}:00`;
const H = (hour, o = {}, date) => ({
  hourKey: key(hour, date), hour, temp: 22, feels: 22, humidity: 50, rainProb: 0, rain: 0, wind: 5, gust: 8, uv: 0, aqi: 30, pm25: 10, ...o,
});
const item = (hours, id) => evaluateChecklist(hours).find((i) => i.id === id);

test("returns the four items in rule order", () => {
  assert.deepEqual(evaluateChecklist([H(8)]).map((i) => i.id), ["umbrella", "jacket", "sunscreen", "mask"]);
});

test("umbrella: rainProb 39/40 and rain 0.49/0.5", () => {
  assert.equal(item([H(8, { rainProb: 39 })], "umbrella").on, false);
  assert.equal(item([H(8, { rainProb: 40 })], "umbrella").on, true);
  assert.equal(item([H(8, { rain: 0.49 })], "umbrella").on, false);
  assert.equal(item([H(8, { rain: 0.5 })], "umbrella").on, true);
});

test("jacket: feels 18 / 18.1 and temp range 5.9 / 6", () => {
  assert.equal(item([H(8, { feels: 18 })], "jacket").on, true);
  assert.equal(item([H(8, { feels: 18.1 })], "jacket").on, false);
  assert.equal(item([H(8, { temp: 20 }), H(9, { temp: 25.9 })], "jacket").on, false);
  assert.equal(item([H(8, { temp: 20 }), H(9, { temp: 26 })], "jacket").on, true);
});

test("jacket uses the minimum feels across hours", () => {
  assert.equal(item([H(8, { feels: 25 }), H(9, { feels: 17 })], "jacket").on, true);
});

test("sunscreen: UV 5.9 / 6 inside the window; UV 6+ outside 10-15 is ignored; bounds inclusive", () => {
  assert.equal(item([H(12, { uv: 5.9 })], "sunscreen").on, false);
  assert.equal(item([H(12, { uv: 6 })], "sunscreen").on, true);
  assert.equal(item([H(9, { uv: 9 })], "sunscreen").on, false);
  assert.equal(item([H(16, { uv: 9 })], "sunscreen").on, false);
  assert.equal(item([H(10, { uv: 6 })], "sunscreen").on, true);
  assert.equal(item([H(15, { uv: 6 })], "sunscreen").on, true);
});

test("mask: AQI 99 / 100 and PM2.5 34.9 / 35", () => {
  assert.equal(item([H(8, { aqi: 99 })], "mask").on, false);
  assert.equal(item([H(8, { aqi: 100 })], "mask").on, true);
  assert.equal(item([H(8, { pm25: 34.9 })], "mask").on, false);
  assert.equal(item([H(8, { pm25: 35 })], "mask").on, true);
});

test("why text: on cases show the triggering value, rounded, with the threshold", () => {
  assert.equal(item([H(17, { rainProb: 20 }), H(18, { rainProb: 59.6 })], "umbrella").why, "18:00 降雨機率 60%（≥ 40% 建議）");
  assert.equal(item([H(8, { rain: 0.84 })], "umbrella").why, "08:00 預估降雨 0.8 mm（≥ 0.5 mm 建議）");
  assert.equal(item([H(8, { feels: 20 }), H(9, { feels: 16.4 })], "jacket").why, "09:00 體感 16°（≤ 18° 建議）");
  assert.equal(item([H(8, { temp: 20 }), H(9, { temp: 26.4 })], "jacket").why, "溫差 6°（≥ 6° 建議）");
  assert.equal(item([H(11, { uv: 7.2 })], "sunscreen").why, "11:00 紫外線指數 7（≥ 6 建議）");
  assert.equal(item([H(8, { aqi: 120 })], "mask").why, "空氣品質差（AQI 120）");
  assert.equal(item([H(8, { aqi: 50, pm25: 40 })], "mask").why, "PM2.5 偏高（40 µg/m³），敏感族群建議戴口罩");
});

test("why text: off cases give a reassuring reason", () => {
  const hs = [H(8, { rainProb: 10, aqi: 41.6 }), H(9, { rainProb: 25, aqi: 42 })];
  assert.equal(item(hs, "umbrella").why, "降雨機率低（最高 25%）");
  assert.equal(item(hs, "jacket").why, "體感溫暖（最低 22°）");
  assert.equal(item(hs, "sunscreen").why, "通勤時段不在 10–15 時");
  assert.equal(item(hs, "mask").why, "空氣品質良好 AQI 42");
  assert.equal(item([H(8, { aqi: null, pm25: 12 })], "mask").why, "空氣品質良好 PM2.5 12");
});

test("why text: null data gives 資料不足 and on=false", () => {
  const nulls = { rainProb: null, rain: null, feels: null, temp: null, uv: null, aqi: null, pm25: null };
  for (const i of evaluateChecklist([H(12, nulls)])) {
    assert.equal(i.on, false);
    assert.equal(i.why, "資料不足", i.id);
  }
  for (const i of evaluateChecklist([])) assert.equal(i.why, "資料不足");
  assert.equal(item([H(12, { aqi: null, pm25: null })], "mask").why, "資料不足");
});

test("null in one condition does not block another; partial data still evaluates", () => {
  assert.equal(item([H(8, { rainProb: null, rain: 1 })], "umbrella").on, true);
  assert.equal(item([H(8, { rainProb: null, rain: 0 })], "umbrella").why, "預估無明顯降雨");
  assert.equal(item([H(8, { aqi: null, pm25: 50 })], "mask").on, true);
});

test("null UV inside the window is 資料不足; hours only outside the window are not", () => {
  assert.equal(item([H(12, { uv: null })], "sunscreen").why, "資料不足");
  assert.equal(item([H(8, { uv: null }), H(18, { uv: null })], "sunscreen").why, "通勤時段不在 10–15 時");
});

test("hit hourKey identifies the triggering hour (null when off or for range)", () => {
  assert.equal(item([H(8), H(18, { rainProb: 70 })], "umbrella").hourKey, key(18));
  assert.equal(item([H(8)], "umbrella").hourKey, null);
  assert.equal(item([H(8, { temp: 20 }), H(9, { temp: 28 })], "jacket").hourKey, null);
});

test("sunscreen off reason: no leg hour in 10-15 vs hours in the window with low UV", () => {
  assert.equal(item([H(8, { uv: 9 }), H(18, { uv: 9 })], "sunscreen").why, "通勤時段不在 10–15 時");
  assert.equal(item([H(9), H(16)], "sunscreen").why, "通勤時段不在 10–15 時", "bounds 10 and 15 are inclusive, 9 and 16 are outside");
  assert.equal(item([H(8), H(10, { uv: 5.9 })], "sunscreen").why, "通勤時段紫外線低");
  assert.equal(item([H(15, { uv: 0 })], "sunscreen").why, "通勤時段紫外線低");
  assert.equal(item([H(11, { uv: 0 })], "sunscreen").on, false);
});

test("mask is split: AQI >= 100 vs PM2.5 >= 35 with AQI < 100; result exposes the hit field", () => {
  const aqi = item([H(8, { aqi: 100, pm25: 50 })], "mask");
  assert.equal(aqi.on, true);
  assert.equal(aqi.field, "aqi", "AQI wins when both trigger");
  assert.equal(aqi.why, "空氣品質差（AQI 100）");
  const pm = item([H(8, { aqi: 99, pm25: 35 })], "mask");
  assert.equal(pm.on, true);
  assert.equal(pm.field, "pm25");
  assert.equal(pm.why, "PM2.5 偏高（35 µg/m³），敏感族群建議戴口罩");
  assert.equal(item([H(8, { aqi: 99, pm25: 34.9 })], "mask").on, false);
  assert.equal(item([H(8)], "mask").field, null);
});

test("result exposes field, agg and value of the triggering condition (null when off)", () => {
  const u = item([H(8, { rainProb: 20 }), H(9, { rainProb: 60 })], "umbrella");
  assert.deepEqual([u.field, u.agg, u.value], ["rainProb", null, 60]);
  const f = item([H(8, { feels: 16 })], "jacket");
  assert.deepEqual([f.field, f.value], ["feels", 16]);
  const r = item([H(8, { temp: 20 }), H(9, { temp: 27 })], "jacket");
  assert.deepEqual([r.field, r.agg, r.value], ["temp", "range", 7]);
  const off = item([H(8)], "umbrella");
  assert.deepEqual([off.field, off.agg, off.value], [null, null, null]);
});

test("tomorrow hours are prefixed 明日 in the reason when `today` is given", () => {
  const hs = [H(18, { rainProb: 10 }), H(8, { rainProb: 60, uv: 0, aqi: 120, feels: 15 }, "2026-11-22")];
  const get = (id) => evaluateChecklist(hs, undefined, { today: "2026-11-21" }).find((i) => i.id === id);
  assert.equal(get("umbrella").why, "明日 08:00 降雨機率 60%（≥ 40% 建議）");
  assert.equal(get("jacket").why, "明日 08:00 體感 15°（≤ 18° 建議）");
  assert.equal(get("mask").why, "空氣品質差（AQI 120）", "no hour in this text");
  const sun = evaluateChecklist([H(11, { uv: 8 }, "2026-11-22")], undefined, { today: "2026-11-21" }).find((i) => i.id === "sunscreen");
  assert.equal(sun.why, "明日 11:00 紫外線指數 8（≥ 6 建議）");
  const today = evaluateChecklist([H(18, { rainProb: 60 })], undefined, { today: "2026-11-21" })[0];
  assert.equal(today.why, "18:00 降雨機率 60%（≥ 40% 建議）", "today's hours have no prefix");
  assert.equal(item([H(8, { rainProb: 60 }, "2026-11-22")], "umbrella").why, "08:00 降雨機率 60%（≥ 40% 建議）", "no today: no prefix");
});

// legHours
const vmHours = (startHour, n = 24) =>
  Array.from({ length: n }, (_, i) => {
    const t = startHour + i;
    return H(t % 24, {}, t >= 24 ? "2026-11-22" : "2026-11-21");
  });

test("legHours: later today, current hour counts, span 2", () => {
  const hs = vmHours(14);
  assert.deepEqual(legHours(hs, 18).map((h) => h.hourKey), [key(18), key(19)]);
  assert.deepEqual(legHours(hs, 14).map((h) => h.hourKey), [key(14), key(15)]);
});

test("legHours: an hour already passed means tomorrow", () => {
  const hs = vmHours(14);
  assert.deepEqual(legHours(hs, 8).map((h) => h.hourKey), [key(8, "2026-11-22"), key(9, "2026-11-22")]);
});

test("legHours: out of horizon, empty input, span", () => {
  assert.deepEqual(legHours(vmHours(14), 14 + 0, 1).length, 1);
  assert.deepEqual(legHours(vmHours(14, 10), 8), []); // tomorrow 08 is not within 10 entries
  assert.deepEqual(legHours([], 8), []);
  assert.deepEqual(legHours(vmHours(14, 10), 22, 2).map((h) => h.hour), [22, 23]);
  assert.deepEqual(legHours(vmHours(14, 10), 23, 2).map((h) => h.hour), [23]); // only entries that exist
});

test("legHours: crosses midnight with consecutive entries", () => {
  assert.deepEqual(legHours(vmHours(14), 23, 2).map((h) => h.hourKey), [key(23), key(0, "2026-11-22")]);
});

test("period option names the evaluated period in the sunscreen reasons (default 通勤時段)", () => {
  const evening = [H(18), H(19)];
  const sun = (hs, o) => evaluateChecklist(hs, undefined, o).find((i) => i.id === "sunscreen").why;
  assert.equal(sun(evening), "通勤時段不在 10–15 時");
  assert.equal(sun(evening, { period: "出遊時段" }), "出遊時段不在 10–15 時");
  assert.equal(sun([H(11), H(12)], { period: "出遊時段" }), "出遊時段紫外線低");
});
