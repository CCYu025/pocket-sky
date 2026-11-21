import { test } from "node:test";
import assert from "node:assert/strict";
import { tripSlots, bestWindow, windowRange, tempDiff, tripChecklist, tripHeadline, MAX_TRIP_HOURS } from "../../js/rules/trip.js";
import { scoreHour, levelOf } from "../../js/rules/exercise.js";
import { addHours } from "../../js/time.js";

const NOW = Date.UTC(2026, 10, 21, 6, 20); // 14:20 at UTC+8
const TODAY = "2026-11-21";
const GOOD = { temp: 22, feels: 22, humidity: 50, rainProb: 0, rain: 0, wind: 5, uv: 1, aqi: 30, pm25: 5 };

/** 24 hourly entries from 14:00 today to 13:00 tomorrow; `over(hourKey)` overrides fields. */
function vm(over = () => ({}), { offset = 28800 } = {}) {
  const hours = [];
  for (let i = 0; i < 24; i++) {
    const hourKey = addHours(`${TODAY}T14:00`, i);
    hours.push({ hourKey, hour: Number(hourKey.slice(11, 13)), ...GOOD, ...over(hourKey) });
  }
  return { location: { utcOffsetSeconds: offset }, now: { hourKey: `${TODAY}T14:00`, temp: 20 }, hours };
}
const hoursOf = (slots) => slots.map((s) => s.hour);
const slot = (hour, o = {}) => ({ hourKey: `${TODAY}T${String(hour).padStart(2, "0")}:00`, hour, isTomorrow: false, comfort: 80, level: "good", temp: 22, rainProb: 0, ...o });
const run = (hrs, comforts) => hrs.map((h, i) => slot(h, { comfort: comforts[i] }));

test("tripSlots 09-16 at 14:20 is tomorrow, only hours present in vm.hours", () => {
  const s = tripSlots(vm(), 9, 16, NOW);
  assert.deepEqual(hoursOf(s), [9, 10, 11, 12, 13]); // tomorrow 14:00+ is beyond the 24-entry horizon
  assert.ok(s.every((x) => x.isTomorrow));
  assert.equal(s[0].hourKey, "2026-11-22T09:00");
});

test("tripSlots 15-20 is today from 15, end exclusive", () => {
  const s = tripSlots(vm(), 15, 20, NOW);
  assert.deepEqual(hoursOf(s), [15, 16, 17, 18, 19]);
  assert.ok(s.every((x) => !x.isTomorrow));
});

test("tripSlots start at the current hour counts as today", () => {
  const s = tripSlots(vm(), 14, 17, NOW);
  assert.deepEqual(hoursOf(s), [14, 15, 16]);
  assert.equal(s[0].hourKey, "2026-11-21T14:00");
  assert.equal(s[0].isTomorrow, false);
  // one hour earlier is tomorrow
  assert.equal(tripSlots(vm(), 13, 15, NOW)[0].hourKey, "2026-11-22T13:00");
});

test("tripSlots 22-02 wraps past midnight", () => {
  const s = tripSlots(vm(), 22, 2, NOW);
  assert.deepEqual(hoursOf(s), [22, 23, 0, 1]);
  assert.deepEqual(s.map((x) => x.isTomorrow), [false, false, true, true]);
});

test("tripSlots caps the window at 12 hours (end <= start and long windows)", () => {
  assert.equal(MAX_TRIP_HOURS, 12);
  assert.equal(tripSlots(vm(), 15, 14, NOW).length, 12); // 23 hours -> 12
  assert.equal(tripSlots(vm(), 15, 15, NOW).length, 12); // equal wraps a full day -> 12
  assert.deepEqual(hoursOf(tripSlots(vm(), 15, 14, NOW)), [15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2]);
  assert.equal(tripSlots(vm(), 15, 3, NOW).length, 12); // exactly 12
  assert.equal(tripSlots(vm(), 15, 2, NOW).length, 11);
});

test("tripSlots fields: comfort and level reuse exercise scoring", () => {
  const v = vm((k) => (k === "2026-11-21T16:00" ? { rainProb: 80, temp: 30, humidity: 90 } : {}));
  const s = tripSlots(v, 15, 18, NOW);
  assert.equal(s[0].comfort, scoreHour(v.hours[1]));
  assert.equal(s[0].level, levelOf(s[0].comfort));
  assert.equal(s[1].level, levelOf(s[1].comfort));
  assert.ok(s[1].comfort < s[0].comfort);
  assert.deepEqual(Object.keys(s[0]).filter((k) => ["hourKey", "hour", "isTomorrow", "comfort", "level", "temp", "rainProb"].includes(k)).length, 7);
});

test("tripSlots uses the destination's UTC offset and handles empty input", () => {
  // 06:20 UTC is 15:20 at +09:00: start 15 still counts as today
  const v = vm(() => ({}), { offset: 32400 });
  assert.equal(tripSlots(v, 15, 17, NOW)[0].isTomorrow, false);
  assert.equal(tripSlots(v, 13, 15, NOW)[0].isTomorrow, true);
  assert.deepEqual(tripSlots({ hours: [] }, 9, 16, NOW), []);
  assert.deepEqual(tripSlots(null, 9, 16, NOW), []);
  assert.deepEqual(tripSlots(vm(), "9", 16, NOW), []);
});

test("bestWindow picks the highest mean run of at least 3", () => {
  const s = run([9, 10, 11, 12, 13], [50, 90, 90, 90, 50]);
  const w = bestWindow(s);
  assert.equal(w.startIndex, 1);
  assert.equal(w.endIndex, 3);
  assert.equal(w.length, 3);
  assert.equal(w.mean, 90);
  assert.equal(w.start.hour, 10);
  assert.equal(w.end.hour, 12);
});

test("bestWindow may extend past minLen when the mean rises", () => {
  const w = bestWindow(run([9, 10, 11, 12], [60, 100, 100, 100]));
  assert.deepEqual([w.startIndex, w.endIndex], [1, 3]);
  const x = bestWindow(run([9, 10, 11, 12, 13], [70, 100, 100, 100, 100]));
  assert.deepEqual([x.startIndex, x.endIndex], [1, 4]);
});

test("bestWindow ties: earliest start, then the longer run", () => {
  const w = bestWindow(run([9, 10, 11, 12, 13, 14, 15, 16], [60, 90, 90, 90, 60, 90, 90, 90]));
  assert.equal(w.startIndex, 1);
  const eq = bestWindow(run([9, 10, 11, 12], [80, 80, 80, 80]));
  assert.deepEqual([eq.startIndex, eq.endIndex, eq.mean], [0, 3, 80]);
});

test("bestWindow minLen and nulls", () => {
  assert.equal(bestWindow(run([9, 10], [90, 90])), null);
  assert.equal(bestWindow([]), null);
  assert.equal(bestWindow(null), null);
  assert.equal(bestWindow(run([9, 10], [90, 70]), 2).mean, 80);
  assert.equal(bestWindow(run([9, 10], [90, 70]), 1).start.hour, 9);
  assert.equal(bestWindow(run([9, 10, 11, 12], [null, null, null, null])), null);
  const w = bestWindow(run([9, 10, 11, 12, 13, 14], [95, null, 60, 61, 62, 63]));
  assert.deepEqual([w.startIndex, w.endIndex], [3, 5]); // never spans the null slot; mean 62 beats 61.5
  assert.equal(bestWindow(run([9, 10, 11, 12], [90, 90, null, 90])), null);
});

test("bestWindow mean is exact for fractional means", () => {
  const w = bestWindow(run([9, 10, 11, 12], [100, 100, 99, 0]));
  assert.deepEqual([w.startIndex, w.endIndex], [0, 2]);
  assert.ok(Math.abs(w.mean - 99.6666666667) < 1e-6);
});

test("windowRange formats end-exclusive ranges with tomorrow markers", () => {
  assert.equal(windowRange(bestWindow(run([9, 10, 11], [1, 1, 1]))), "09:00–12:00");
  const tom = run([9, 10, 11], [1, 1, 1]).map((s) => ({ ...s, isTomorrow: true }));
  assert.equal(windowRange(bestWindow(tom)), "明天09:00–12:00");
  assert.equal(windowRange(bestWindow(run([21, 22, 23], [1, 1, 1]))), "21:00–明天00:00");
  const wrap = [slot(22), slot(23), slot(0, { isTomorrow: true }), slot(1, { isTomorrow: true })];
  assert.equal(windowRange(bestWindow(wrap)), "22:00–明天02:00");
});

test("tempDiff rounds, handles null and never returns -0", () => {
  const t = (temp) => ({ now: { temp } });
  assert.equal(tempDiff(t(18.4), t(24.1)), -6);
  assert.equal(tempDiff(t(26.6), t(24.1)), 3);
  assert.equal(tempDiff(t(24.5), t(24)), 1);
  assert.ok(Object.is(tempDiff(t(24.1), t(24.4)), 0)); // -0.3 rounds to -0 -> 0
  assert.ok(Object.is(tempDiff(t(20), t(20.5)), 0)); // -0.5 -> -0 -> 0
  assert.ok(Object.is(tempDiff(t(21), t(21)), 0));
  assert.equal(tempDiff(t(null), t(20)), null);
  assert.equal(tempDiff(t(20), {}), null);
  assert.equal(tempDiff(null, null), null);
  assert.equal(tempDiff(t(NaN), t(20)), null);
});

test("tripHeadline: no slots", () => {
  assert.equal(tripHeadline([], null, []), "資料不足");
  assert.equal(tripHeadline(null, null, []), "資料不足");
});

test("tripHeadline: rain with and without a best window", () => {
  const slots = [slot(9), slot(10), slot(11), slot(12, { rainProb: 60, comfort: 20 }), slot(13, { rainProb: 80, comfort: 10 })];
  const best = bestWindow(slots);
  assert.equal(best.start.hour, 9);
  assert.equal(tripHeadline(slots, best, []), "12 時後可能下雨，建議 09:00–12:00 遊玩");
  assert.equal(tripHeadline(slots, null, []), "12 時起可能下雨");
  assert.equal(tripHeadline([slot(9, { rainProb: 40 })], null, []), "09 時起可能下雨"); // boundary 40
  assert.equal(tripHeadline([slot(9, { rainProb: 39 })], null, []), "天氣穩定，適合出遊");
});

test("tripHeadline: tomorrow wording", () => {
  const tom = (h, o = {}) => slot(h, { isTomorrow: true, ...o });
  const slots = [tom(9), tom(10), tom(11), tom(13, { rainProb: 70, comfort: 10 })];
  assert.equal(tripHeadline(slots, bestWindow(slots), []), "明天13 時後可能下雨，建議 明天09:00–12:00 遊玩");
  assert.equal(tripHeadline(slots, null, []), "明天13 時起可能下雨");
  const dry = [tom(9), tom(10), tom(11)];
  assert.equal(tripHeadline(dry, bestWindow(dry), []), "明天09:00–12:00 最適合遊玩");
});

test("tripHeadline: umbrella item triggered by rain amount only", () => {
  const slots = [slot(9), slot(10, { rain: 1.2 }), slot(11)];
  const items = tripChecklist(slots, TODAY);
  assert.equal(items.find((i) => i.id === "umbrella").on, true);
  assert.equal(tripHeadline(slots, null, items), "10 時起可能下雨");
});

test("tripHeadline: item branches in priority order", () => {
  const slots = [slot(9), slot(10), slot(11)];
  const best = bestWindow(slots);
  const it = (id, field = null, on = true) => ({ id, on, field, hourKey: null });
  assert.equal(tripHeadline(slots, best, [it("mask", "aqi"), it("jacket", "feels"), it("sunscreen")]), "空氣品質差，記得戴口罩");
  assert.equal(tripHeadline(slots, best, [it("jacket", "feels"), it("mask", "pm25"), it("sunscreen")]), "氣溫偏低，記得帶外套");
  assert.equal(tripHeadline(slots, best, [it("jacket", "temp")]), "早晚溫差大，記得帶外套");
  assert.equal(tripHeadline(slots, best, [it("mask", "pm25"), it("sunscreen")]), "PM2.5 偏高，敏感族群記得戴口罩");
  assert.equal(tripHeadline(slots, best, [it("sunscreen")]), "紫外線強，記得防曬");
  assert.equal(tripHeadline(slots, best, [it("sunscreen", null, false), it("mask", "aqi", false)]), "09:00–12:00 最適合遊玩");
  assert.equal(tripHeadline(slots, null, []), "天氣穩定，適合出遊");
  // rain beats everything
  const wet = [slot(9, { rainProb: 90 }), slot(10), slot(11)];
  assert.match(tripHeadline(wet, null, [it("mask", "aqi")]), /可能下雨/);
});

test("integration: slots -> checklist -> headline", () => {
  const v = vm((k) => (k >= "2026-11-21T17:00" && k <= "2026-11-21T18:00" ? { rainProb: 70, rain: 1, feels: 15 } : {}));
  const slots = tripSlots(v, 15, 20, NOW);
  const items = tripChecklist(slots, TODAY);
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(by.umbrella.on, true);
  assert.equal(by.umbrella.hourKey, "2026-11-21T17:00");
  assert.equal(by.jacket.on, true);
  const best = bestWindow(slots);
  assert.equal(tripHeadline(slots, best, items), `17 時後可能下雨，建議 ${windowRangeOf(best)} 遊玩`);
});

function windowRangeOf(best) {
  return `${String(best.start.hour).padStart(2, "0")}:00–${String((best.end.hour + 1) % 24).padStart(2, "0")}:00`;
}
