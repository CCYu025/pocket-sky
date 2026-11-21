import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolate, scoreHour, levelOf, exerciseSlots, bestSlot, exerciseAdvice } from "../../js/rules/exercise.js";
import { EXERCISE_SCORING } from "../../js/rules/config.js";

const PERFECT = { temp: 20, humidity: 50, rainProb: 0, wind: 0, aqi: 20, uv: 0 };
const TERRIBLE = { temp: 40, humidity: 100, rainProb: 100, wind: 80, aqi: 200, uv: 12 };

test("interpolate clamps and interpolates linearly", () => {
  const c = EXERCISE_SCORING.factors.temp;
  assert.equal(interpolate(c, -10), 20);
  assert.equal(interpolate(c, 5), 20);
  assert.equal(interpolate(c, 8.5), 45);
  assert.equal(interpolate(c, 21), 100);
  assert.equal(interpolate(c, 27), 70);
  assert.equal(interpolate(c, 35), 0);
  assert.equal(interpolate(c, 99), 0);
});

test("perfect hour scores 100", () => {
  assert.equal(scoreHour(PERFECT), 100);
});

test("terrible hour scores near 0 (humidity and uv curves floor at 20)", () => {
  // temp/rainProb/wind/aqi score 0; humidity (w1) and uv (w1) floor at 20 -> 40/11 = 3.6 -> 4
  assert.equal(scoreHour(TERRIBLE), 4);
});

test("integer result and weighting", () => {
  // temp 12 -> 70 (w3), everything else perfect: (210 + 8*100) / 11 = 91.8 -> 92
  assert.equal(scoreHour({ ...PERFECT, temp: 12 }), 92);
  assert.ok(Number.isInteger(scoreHour({ ...PERFECT, temp: 13.3, wind: 23 })));
});

test("null aqi / uv renormalise the weights", () => {
  // without aqi (2) and uv (1): weights 3+1+3+1 = 8
  assert.equal(scoreHour({ ...PERFECT, aqi: null, uv: null }), 100);
  // temp 12 -> 70: (210 + 100 + 300 + 100) / 8 = 88.75 -> 89
  assert.equal(scoreHour({ ...PERFECT, temp: 12, aqi: null, uv: null }), 89);
});

test("all-null (or missing) factors give null", () => {
  assert.equal(scoreHour({ temp: null, humidity: null, rainProb: null, wind: null, aqi: null, uv: null }), null);
  assert.equal(scoreHour({}), null);
});

test("levels: 75 good, 74 ok, 50 ok, 49 bad, null", () => {
  assert.equal(levelOf(75), "good");
  assert.equal(levelOf(74), "ok");
  assert.equal(levelOf(50), "ok");
  assert.equal(levelOf(49), "bad");
  assert.equal(levelOf(null), null);
});

// slots
const OFFSET = 8 * 3600;
const nowAt = (h, m) => Date.UTC(2026, 10, 21, h, m) - OFFSET * 1000; // local time 2026-11-21 h:m at UTC+8
const pad = (n) => String(n).padStart(2, "0");
const hourEntry = (t, o = {}) => {
  const day = t >= 24 ? 22 : 21;
  return { hourKey: `2026-11-${day}T${pad(t % 24)}:00`, hour: t % 24, temp: 20, feels: 20, humidity: 50, rainProb: 0, rain: 0, wind: 0, gust: 0, uv: 0, aqi: 20, pm25: 5, ...o };
};
const vmAt = (startHour, n, over = () => ({})) => ({
  location: { utcOffsetSeconds: OFFSET },
  now: { hourKey: `2026-11-21T${pad(startHour)}:00` },
  hours: Array.from({ length: n }, (_, i) => hourEntry(startHour + i, over(startHour + i))),
});

test("slots at 14:20 cover 14..23, none tomorrow", () => {
  const slots = exerciseSlots(vmAt(14, 24), nowAt(14, 20));
  assert.deepEqual(slots.map((s) => s.hour), [14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.ok(slots.every((s) => !s.isTomorrow));
  assert.equal(slots[0].hourKey, "2026-11-21T14:00");
  assert.equal(slots[0].score, 100);
  assert.equal(slots[0].level, "good");
  assert.deepEqual(Object.keys(slots[0].metrics), ["temp", "feels", "humidity", "rainProb", "wind", "uv", "aqi"]);
  assert.equal(slots[0].metrics.temp, 20);
});

test("slots at 22:30 are 22..23 plus tomorrow 00..06 flagged isTomorrow", () => {
  const slots = exerciseSlots(vmAt(22, 24), nowAt(22, 30));
  assert.deepEqual(slots.map((s) => s.hour), [22, 23, 0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(slots.map((s) => s.isTomorrow), [false, false, true, true, true, true, true, true, true]);
  assert.equal(slots[2].hourKey, "2026-11-22T00:00");
});

test("slots only for hours present in vm.hours (shorter than the window)", () => {
  const slots = exerciseSlots(vmAt(14, 3), nowAt(14, 20));
  assert.deepEqual(slots.map((s) => s.hour), [14, 15, 16]);
  assert.deepEqual(exerciseSlots(vmAt(14, 0), nowAt(14, 20)), []);
});

test("slot with null metrics has null score and level", () => {
  const vm = vmAt(14, 2, (t) => (t === 15 ? { temp: null, humidity: null, rainProb: null, wind: null, aqi: null, uv: null } : {}));
  const slots = exerciseSlots(vm, nowAt(14, 0));
  assert.equal(slots[1].score, null);
  assert.equal(slots[1].level, null);
});

test("bestSlot: highest score, earliest on tie, null for empty / all-null", () => {
  const s = (hour, score) => ({ hour, score });
  assert.equal(bestSlot([s(14, 80), s(15, 90), s(16, 90), s(17, 70)]).hour, 15);
  assert.equal(bestSlot([s(14, null), s(15, 40)]).hour, 15);
  assert.equal(bestSlot([]), null);
  assert.equal(bestSlot([s(14, null)]), null);
});

test("bestSlot over real slots picks the earliest best", () => {
  const vm = vmAt(14, 6, (t) => (t >= 17 ? { rainProb: 80 } : {}));
  assert.equal(bestSlot(exerciseSlots(vm, nowAt(14, 0))).hour, 14);
});

// advice
const slot = (m, level = "ok") => ({ level, metrics: { rainProb: 0, feels: 20, aqi: 20, ...m } });

test("advice: each branch", () => {
  assert.equal(exerciseAdvice(slot({ rainProb: 60 })), "降雨機率 60%，建議改室內");
  assert.equal(exerciseAdvice(slot({ feels: 31 })), "偏熱，多補水");
  assert.equal(exerciseAdvice(slot({ aqi: 120 })), "空氣品質差，建議室內");
  assert.equal(exerciseAdvice(slot({}, "good")), "涼爽少雨，適合慢跑或騎車");
  assert.equal(exerciseAdvice(slot({}, "ok")), "留意天氣變化");
  assert.equal(exerciseAdvice(slot({}, "bad")), "留意天氣變化");
});

test("advice: boundaries 49/50, 29/30, 99/100", () => {
  assert.equal(exerciseAdvice(slot({ rainProb: 49 }, "good")), "涼爽少雨，適合慢跑或騎車");
  assert.equal(exerciseAdvice(slot({ rainProb: 50 })), "降雨機率 50%，建議改室內");
  assert.equal(exerciseAdvice(slot({ feels: 29.9 })), "留意天氣變化");
  assert.equal(exerciseAdvice(slot({ feels: 30 })), "偏熱，多補水");
  assert.equal(exerciseAdvice(slot({ aqi: 99 })), "留意天氣變化");
  assert.equal(exerciseAdvice(slot({ aqi: 100 })), "空氣品質差，建議室內");
});

test("advice: priority rain > heat > aqi > good, nulls skipped", () => {
  assert.equal(exerciseAdvice(slot({ rainProb: 60, feels: 33, aqi: 150 }, "good")), "降雨機率 60%，建議改室內");
  assert.equal(exerciseAdvice(slot({ feels: 33, aqi: 150 }, "good")), "偏熱，多補水");
  assert.equal(exerciseAdvice(slot({ aqi: 150 }, "good")), "空氣品質差，建議室內");
  assert.equal(exerciseAdvice(slot({ rainProb: null, feels: null, aqi: null }, "good")), "涼爽少雨，適合慢跑或騎車");
  assert.equal(exerciseAdvice(null), "資料不足");
});
