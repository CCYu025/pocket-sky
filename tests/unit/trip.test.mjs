import { test } from "node:test";
import assert from "node:assert/strict";
import { tripSlots, tripPlan, isWet, MIN_TRIP_HOURS, bestWindow, windowRange, tempDiff, tripChecklist, tripHeadline, tripLevel, daylightPhase, MAX_TRIP_HOURS } from "../../js/rules/trip.js";
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
  return {
    location: { utcOffsetSeconds: offset },
    now: { hourKey: `${TODAY}T14:00`, temp: 20 },
    today: { sunrise: `${TODAY}T06:10`, sunset: `${TODAY}T17:20` },
    tomorrow: { sunrise: "2026-11-22T06:11", sunset: "2026-11-22T17:19" },
    hours,
  };
}
const hoursOf = (slots) => slots.map((s) => s.hour);
const slot = (hour, o = {}) => ({ hourKey: `${TODAY}T${String(hour).padStart(2, "0")}:00`, hour, isTomorrow: false, comfort: 80, level: "good", temp: 22, rainProb: 0, daylight: "day", ...o });
const run = (hrs, comforts) => hrs.map((h, i) => slot(h, { comfort: comforts[i] }));

test("tripSlots: a window that has not started yet today is today's; one already over starts tomorrow (only hours present in vm.hours)", () => {
  const s = tripSlots(vm(), 9, 12, NOW); // 09-12 is over at 14:20
  assert.deepEqual(hoursOf(s), [9, 10, 11]);
  assert.ok(s.every((x) => x.isTomorrow));
  assert.equal(s[0].hourKey, "2026-11-22T09:00");
  // beyond the 24-entry horizon (tomorrow 14:00+) nothing is returned
  assert.deepEqual(hoursOf(tripSlots(vm(), 9, 16, NOW)), [9, 10, 11, 12, 13], "tomorrow 09-16 (2 hours left today) is cut at the horizon");
  assert.deepEqual(hoursOf(tripSlots(vm(), 9, 17, NOW).filter((x) => x.isTomorrow)), []);
});

test("tripSlots: now inside [start, end) starts today at the current hour, not tomorrow", () => {
  const s = tripSlots(vm(), 9, 17, NOW); // 14:20 is inside 09-17 (3 hours left)
  assert.deepEqual(hoursOf(s), [14, 15, 16]);
  assert.ok(s.every((x) => !x.isTomorrow));
  assert.equal(s[0].hourKey, "2026-11-21T14:00");
  // the end is exclusive: at 14:20 the window 09-14 is over
  assert.equal(tripSlots(vm(), 9, 14, NOW)[0].isTomorrow, true);
  // fewer than 3 hours left (09-15 has 1): the next occurrence, see the tail test below
  assert.equal(tripSlots(vm(), 9, 15, NOW)[0].hourKey, "2026-11-22T09:00");
});

test("tripSlots: inside a window that wraps past midnight (now 01:20, window 22-03) starts today at the current hour", () => {
  const hours = [];
  for (let i = 0; i < 24; i++) {
    const hourKey = addHours("2026-11-21T01:00", i);
    hours.push({ hourKey, hour: Number(hourKey.slice(11, 13)), ...GOOD });
  }
  const v = { location: { utcOffsetSeconds: 28800 }, today: {}, hours };
  const now = Date.UTC(2026, 10, 20, 17, 20); // 01:20 on the 21st at +08:00
  const s = tripSlots(v, 22, 4, now); // 22-04: 3 hours left (01, 02, 03)
  assert.deepEqual(hoursOf(s), [1, 2, 3]);
  assert.deepEqual(s.map((x) => x.isTomorrow), [false, false, false]);
  assert.equal(s[0].hourKey, "2026-11-21T01:00");
  // not inside (03:20 is after 03): tonight's 22:00 instead (the vm holds 24 hours from 01:00, so 22, 23 and tomorrow 00)
  const later = tripSlots(v, 22, 3, Date.UTC(2026, 10, 20, 19, 20));
  assert.equal(later[0].hourKey, "2026-11-21T22:00");
  assert.deepEqual(hoursOf(later), [22, 23, 0]);
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
  assert.equal(tripSlots(vm(), 13, 14, NOW)[0].hourKey, "2026-11-22T13:00", "13-14 is over");
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

test("tripSlots fields: comfort reuses exercise scoring; level is the exercise level capped by rain", () => {
  const v = vm((k) => (k === "2026-11-21T16:00" ? { rainProb: 80, temp: 30, humidity: 90 } : {}));
  const s = tripSlots(v, 15, 18, NOW);
  assert.equal(s[0].comfort, scoreHour(v.hours[1]));
  assert.equal(s[0].level, levelOf(s[0].comfort));
  assert.equal(s[1].level, "bad");
  assert.ok(s[1].comfort < s[0].comfort);
  assert.deepEqual(Object.keys(s[0]).filter((k) => ["hourKey", "hour", "isTomorrow", "comfort", "level", "temp", "rainProb", "daylight"].includes(k)).length, 8);
});

test("tripLevel: rain >= 60 is bad, >= 40 is at most ok, otherwise the exercise level; null stays null", () => {
  assert.deepEqual([0, 39, 40, 59, 60, 100].map((r) => tripLevel("good", r)), ["good", "good", "ok", "ok", "bad", "bad"]);
  assert.deepEqual([39, 40, 59, 60].map((r) => tripLevel("ok", r)), ["ok", "ok", "ok", "bad"]);
  assert.deepEqual([0, 40, 60].map((r) => tripLevel("bad", r)), ["bad", "bad", "bad"]);
  assert.equal(tripLevel("good", null), "good", "unknown rain leaves the level alone");
  assert.equal(tripLevel(null, 90), null);
});

test("tripSlots: 70% rain hours are bad even though the exercise score alone says good/ok (probe: rain 70 scored 75 = good)", () => {
  const v = vm((k) => (k === "2026-11-21T16:00" || k === "2026-11-21T17:00" ? { rainProb: 70 } : k === "2026-11-21T15:00" ? { rainProb: 45 } : {})); // otherwise ideal
  const s = tripSlots(v, 15, 19, NOW);
  assert.equal(levelOf(s[1].comfort) !== "bad", true, "the comfort score alone does not call it bad");
  assert.deepEqual(s.map((x) => x.level), ["ok", "bad", "bad", "good"]);
});

test("daylightPhase: an hour is daylight when >= 30 min of it lie between sunrise and sunset", () => {
  const f = (h) => daylightPhase(h, "2026-11-21T06:40", "2026-11-21T17:25");
  assert.equal(f(5), "before");
  assert.equal(f(6), "before", "06:00-07:00 has only 20 min of daylight");
  assert.equal(f(7), "day");
  assert.equal(f(16), "day");
  assert.equal(f(17), "after", "17:00-18:00 has only 25 min of daylight");
  assert.equal(f(23), "after");
  assert.equal(daylightPhase(6, "2026-11-21T06:30", "2026-11-21T17:30"), "day", "exactly 30 min counts");
  assert.equal(daylightPhase(17, "2026-11-21T06:30", "2026-11-21T17:30"), "day");
  assert.equal(daylightPhase(9, null, "2026-11-21T17:30"), null);
});

test("tripSlots daylight: today's sunrise/sunset for today, tomorrow's for tomorrow, today's as approximation without them", () => {
  const v = vm();
  const s = tripSlots(v, 16, 21, NOW); // 16:00-21:00 today (14:20 is not inside)
  assert.deepEqual(s.map((x) => x.daylight), ["day", "after", "after", "after", "after"], "sunset 17:20: hour 17 has only 20 min of daylight");
  // tomorrow morning: 06:11 sunrise -> 06 has 49 min of daylight
  const m = tripSlots(v, 5, 9, NOW);
  assert.deepEqual(m.map((x) => [x.hour, x.daylight]), [[5, "before"], [6, "day"], [7, "day"], [8, "day"]]);
  // tomorrow's own times are used for tomorrow's slots (sunrise 06:50 -> hour 06 is night)
  const own = { ...v, tomorrow: { sunrise: "2026-11-22T06:50", sunset: "2026-11-22T17:19" } };
  assert.equal(tripSlots(own, 5, 9, NOW).find((x) => x.hour === 6).daylight, "before");
  // no tomorrow data: today's times approximate it (06:10 -> hour 06 is daylight)
  const noTom = { ...v, tomorrow: { sunrise: null, sunset: null } };
  assert.equal(tripSlots(noTom, 5, 9, NOW).find((x) => x.hour === 6).daylight, "day");
  // no sun data at all: unknown (null), which bestWindow treats as daylight
  assert.ok(tripSlots({ ...v, today: {}, tomorrow: {} }, 16, 19, NOW).every((x) => x.daylight === null));
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

const wetSlot = (h, rp, o = {}) => slot(h, { rainProb: rp, comfort: 95, ...o });

test("bestWindow never contains a wet slot (rainProb >= 40), however comfortable the score says it is", () => {
  // probe: the exercise score of 45% rain is 80+, so the old rule happily bridged 10:00-13:00 over the wet 11:00
  const s = [slot(9, { comfort: 90 }), slot(10, { comfort: 95 }), wetSlot(11, 45), slot(12, { comfort: 95 }), slot(13, { comfort: 95 }), slot(14, { comfort: 90 }), wetSlot(15, 80)];
  const w = bestWindow(s);
  assert.deepEqual([w.startIndex, w.endIndex], [3, 5], "12:00-15:00 is the only dry run of 3");
  for (let i = w.startIndex; i <= w.endIndex; i++) assert.ok(s[i].rainProb < 40);
  // two dry hours on either side of a wet one: no recommendation at all
  assert.equal(bestWindow([slot(9), slot(10), wetSlot(11, 40), slot(12), slot(13)]), null);
  // 39% is still dry
  assert.equal(bestWindow([slot(9, { rainProb: 39 }), slot(10), slot(11)]).length, 3);
});

test("bestWindow: an unknown rain probability is not wet", () => {
  assert.equal(bestWindow([slot(9, { rainProb: null }), slot(10, { rainProb: null }), slot(11, { rainProb: null })]).length, 3);
});

test("bestWindow is daylight first: a lower-scoring daylight run beats a better one at night", () => {
  const s = [slot(14, { comfort: 70 }), slot(15, { comfort: 70 }), slot(16, { comfort: 70 }), slot(17, { comfort: 70, daylight: "after" }), slot(18, { comfort: 100, daylight: "after" }), slot(19, { comfort: 100, daylight: "after" }), slot(20, { comfort: 100, daylight: "after" })];
  const w = bestWindow(s);
  assert.deepEqual([w.startIndex, w.endIndex, w.night], [0, 2, null]);
});

test("bestWindow never contains a night slot when a daylight run exists; a run is cut at the last daylight hour", () => {
  const s = [slot(14), slot(15), slot(16), slot(17), slot(18, { daylight: "after" }), slot(19, { daylight: "after" })];
  const w = bestWindow(s);
  assert.deepEqual([w.startIndex, w.endIndex, w.night], [0, 3, null]);
  assert.ok(s.slice(w.startIndex, w.endIndex + 1).every((x) => x.daylight === "day"));
});

test("bestWindow falls back to the best dry run of any time: night is `after` sunset or `before` sunrise", () => {
  const after = [slot(17), slot(18, { daylight: "after" }), slot(19, { daylight: "after" }), slot(20, { daylight: "after" })];
  const a = bestWindow(after);
  assert.deepEqual([a.startIndex, a.endIndex, a.night], [0, 3, "after"], "equal means: the earliest, longest run; its first non-daylight hour is after sunset");
  const before = [slot(3, { daylight: "before" }), slot(4, { daylight: "before" }), slot(5, { daylight: "before" })];
  assert.equal(bestWindow(before).night, "before");
  // a mixed run (daylight hours first) is `after` when its first non-daylight hour is after sunset
  const mixed = [slot(16), slot(17), slot(18, { daylight: "after" }), slot(19, { daylight: "after" })];
  assert.deepEqual([bestWindow(mixed).startIndex, bestWindow(mixed).endIndex, bestWindow(mixed).night], [0, 3, "after"]);
  // the fallback still only uses dry slots
  assert.equal(bestWindow([slot(19, { daylight: "after" }), slot(20, { daylight: "after" }), wetSlot(21, 70, { daylight: "after" })]), null);
});

test("bestWindow: unknown daylight (no sun data) counts as daylight", () => {
  const w = bestWindow([slot(9, { daylight: null }), slot(10, { daylight: null }), slot(11, { daylight: null })]);
  assert.equal(w.night, null);
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

test("tripHeadline: rain names the wet span, with and without a best window", () => {
  const slots = [slot(9), slot(10), slot(11), slot(12, { rainProb: 60, comfort: 20 }), slot(13, { rainProb: 80, comfort: 10 })];
  const best = bestWindow(slots);
  assert.equal(best.start.hour, 9);
  assert.equal(tripHeadline(slots, best, []), "12–14 時可能下雨，建議 09:00–12:00 遊玩");
  assert.equal(tripHeadline(slots, null, []), "12–14 時可能下雨");
  assert.equal(tripHeadline([slot(9, { rainProb: 40 })], null, []), "09 時可能下雨"); // boundary 40; a single hour is `HH 時`
  assert.equal(tripHeadline([slot(9, { rainProb: 39 })], null, []), "天氣穩定，適合出遊");
  // the span runs from the first to the last wet hour (15, 16, 17, 18 -> 15–19)
  const showers = [slot(13), slot(14), slot(15, { rainProb: 50 }), slot(16, { rainProb: 70 }), slot(17, { rainProb: 70 }), slot(18, { rainProb: 55 }), slot(19), slot(20), slot(21)];
  assert.equal(tripHeadline(showers, null, []), "15–19 時可能下雨");
  assert.equal(tripHeadline(showers, { ...bestWindow(showers), night: "after" }, []).startsWith("15–19 時可能下雨，建議 "), true);
});

test("tripHeadline: the wet span crosses midnight and tomorrow keeps its prefix", () => {
  const tom = (h, o = {}) => slot(h, { isTomorrow: true, ...o });
  const slots = [slot(22, { rainProb: 60 }), slot(23, { rainProb: 60 }), tom(0, { rainProb: 60 }), tom(1)];
  assert.equal(tripHeadline(slots, null, []), "22–明天01 時可能下雨");
  assert.equal(tripHeadline([slot(23, { rainProb: 60 })], null, []), "23 時可能下雨");
});

test("tripHeadline: tomorrow wording", () => {
  const tom = (h, o = {}) => slot(h, { isTomorrow: true, ...o });
  const slots = [tom(9), tom(10), tom(11), tom(13, { rainProb: 70, comfort: 10 })];
  assert.equal(tripHeadline(slots, bestWindow(slots), []), "明天13 時可能下雨，建議 明天09:00–12:00 遊玩");
  assert.equal(tripHeadline(slots, null, []), "明天13 時可能下雨");
  const dry = [tom(9), tom(10), tom(11)];
  assert.equal(tripHeadline(dry, bestWindow(dry), []), "明天09:00–12:00 最適合遊玩");
});

test("tripHeadline: a window that is not daylight says so (已日落 / 日出前); in the rain headline as a note", () => {
  const night = [slot(19, { daylight: "after" }), slot(20, { daylight: "after" }), slot(21, { daylight: "after" })];
  assert.equal(tripHeadline(night, bestWindow(night), []), "19:00–22:00 較適合（已日落）");
  const early = [slot(3, { daylight: "before" }), slot(4, { daylight: "before" }), slot(5, { daylight: "before" })];
  assert.equal(tripHeadline(early, bestWindow(early), []), "03:00–06:00 較適合（日出前）");
  const wet = [slot(15, { rainProb: 70 }), slot(16, { rainProb: 70 }), ...night];
  assert.equal(tripHeadline(wet, bestWindow(wet), []), "15–17 時可能下雨，建議 19:00–22:00 遊玩（已日落）");
  // a daylight window has no note
  const day = [slot(9), slot(10), slot(11)];
  assert.doesNotMatch(tripHeadline(day, bestWindow(day), []), /已日落|日出前|較適合/);
});

test("tripHeadline: no dry run of 3 hours gives no recommendation", () => {
  const slots = [slot(9), slot(10), slot(11, { rainProb: 60 }), slot(12), slot(13)];
  assert.equal(bestWindow(slots), null);
  assert.equal(tripHeadline(slots, bestWindow(slots), []), "11 時可能下雨");
});

test("tripHeadline: umbrella item triggered by rain amount only", () => {
  const slots = [slot(9), slot(10, { rain: 1.2 }), slot(11)];
  const items = tripChecklist(slots, TODAY);
  assert.equal(items.find((i) => i.id === "umbrella").on, true);
  assert.equal(tripHeadline(slots, null, items), "10 時可能下雨");
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

test("integration: slots -> checklist -> headline (showers 17-18, evening window after sunset)", () => {
  const v = vm((k) => (k >= "2026-11-21T17:00" && k <= "2026-11-21T18:00" ? { rainProb: 70, rain: 1, feels: 15 } : {}));
  const slots = tripSlots(v, 15, 22, NOW);
  const items = tripChecklist(slots, TODAY);
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(by.umbrella.on, true);
  assert.equal(by.umbrella.hourKey, "2026-11-21T17:00");
  assert.equal(by.jacket.on, true);
  const best = bestWindow(slots);
  assert.equal(best.night, "after", "the dry daylight run is only 15:00-17:00 (2 h)");
  assert.equal(tripHeadline(slots, best, items), `17–19 時可能下雨，建議 ${windowRangeOf(best)} 遊玩（已日落）`);
  assert.equal(windowRangeOf(best), "19:00–22:00");
});

test("tripChecklist reasons say 出遊時段 (commute keeps 通勤時段)", () => {
  const slots = [slot(11, { uv: 1 }), slot(12, { uv: 1 }), slot(13, { uv: 1 })];
  const sun = (list) => list.find((i) => i.id === "sunscreen");
  assert.equal(sun(tripChecklist(slots, TODAY)).why, "出遊時段紫外線低");
  const evening = [slot(18, { uv: 0 }), slot(19, { uv: 0 })];
  assert.equal(sun(tripChecklist(evening, TODAY)).why, "出遊時段不在 10–15 時");
  assert.doesNotMatch(JSON.stringify(tripChecklist(slots, TODAY)), /通勤/);
});

function windowRangeOf(best) {
  return `${String(best.start.hour).padStart(2, "0")}:00–${String((best.end.hour + 1) % 24).padStart(2, "0")}:00`;
}

// ---- N1: the headline names wet RUNS, never a span over dry gaps
test("tripHeadline: one wet run is `HH–HH 時`, several runs are listed (single hours `HH 時`), 3+ runs are summarised", () => {
  const dryAll = (hs, wetHs) => hs.map((h) => slot(h, wetHs.includes(h) ? { rainProb: 70, comfort: 20 } : {}));
  const hs = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  // gap: wet 09 and 15, dry between; the recommendation lies in the gap and is not inside a named run
  const gap = dryAll(hs, [9, 15]);
  const b = bestWindow(gap);
  assert.equal(tripHeadline(gap, b, []), "09 時、15 時可能下雨，建議 10:00–15:00 遊玩");
  assert.doesNotMatch(tripHeadline(gap, b, []), /09–16/);
  assert.equal(tripHeadline(dryAll(hs, [9, 10, 14, 15, 16]), null, []), "09–11 時、14–17 時可能下雨");
  assert.equal(tripHeadline(dryAll(hs, [9, 12, 15]), null, []), "多個時段可能下雨");
  assert.equal(tripHeadline(dryAll(hs, [9, 10, 12, 14, 16]), null, []), "多個時段可能下雨");
  // one run keeps the old wording
  assert.equal(tripHeadline(dryAll(hs, [15, 16, 17]), null, []), "15–18 時可能下雨");
  // tomorrow prefix per run
  const tom = (h, o = {}) => slot(h, { isTomorrow: true, ...o });
  const t = [tom(9, { rainProb: 70 }), tom(10), tom(11), tom(12), tom(13, { rainProb: 70 })];
  assert.equal(tripHeadline(t, null, []), "明天09 時、明天13 時可能下雨");
});

test("tripHeadline: the recommended window never falls inside a named wet run (property over wet patterns)", () => {
  const hs = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  for (let mask = 0; mask < 1 << hs.length; mask++) {
    const slots = hs.map((h, i) => slot(h, mask & (1 << i) ? { rainProb: 60, comfort: 20 } : { rainProb: 10 }));
    const best = bestWindow(slots);
    if (!best) continue;
    for (let i = best.startIndex; i <= best.endIndex; i++) assert.equal(isWet(slots[i]), false, `mask ${mask} slot ${i}`);
  }
});

// ---- N2: an hour the umbrella rule treats as wet (rain >= T.rain) is never dry
test("bestWindow: an hour with rain >= 0.5 mm is not dry even when the probability is low; wet runs use the same predicate", () => {
  const slots = [9, 10, 11, 12, 13].map((h) => slot(h, h === 11 ? { rain: 0.5, rainProb: 20 } : { rain: 0 }));
  assert.equal(isWet(slots[2]), true);
  assert.equal(isWet(slot(9, { rain: 0.4, rainProb: 20 })), false);
  assert.equal(isWet(slot(9, { rain: null, rainProb: null })), false);
  assert.equal(bestWindow(slots), null, "09-10 and 12-13 are too short");
  const long = [8, 9, 10, 11, 12, 13, 14].map((h) => slot(h, h === 11 ? { rain: 1.2, rainProb: 10 } : { rain: 0 }));
  const b = bestWindow(long);
  assert.ok(b.endIndex < 3 || b.startIndex > 3, "the wet hour is outside the window");
  assert.equal(tripHeadline(long, b, []), `11 時可能下雨，建議 ${windowRange(b)} 遊玩`);
});

// ---- N3: running window with fewer than 3 hours left plans the next occurrence
test("tripSlots/tripPlan: a running window with fewer than minLen hours left shows the next occurrence (tomorrow) and reports the remainder", () => {
  assert.equal(MIN_TRIP_HOURS, 3);
  const hours = [];
  for (let i = 0; i < 36; i++) {
    const hourKey = addHours(`${TODAY}T15:00`, i);
    hours.push({ hourKey, hour: Number(hourKey.slice(11, 13)), ...GOOD });
  }
  const v = { ...vm(), hours };
  const at = (h, m) => Date.UTC(2026, 10, 21, h - 8, m);
  const p = tripPlan(v, 9, 16, at(15, 20)); // 1 hour (15:00) left
  assert.equal(p.tail, 1);
  assert.deepEqual(hoursOf(p.slots), [9, 10, 11, 12, 13, 14, 15]);
  assert.ok(p.slots.every((x) => x.isTomorrow));
  assert.deepEqual(hoursOf(tripSlots(v, 9, 16, at(15, 20))), [9, 10, 11, 12, 13, 14, 15]);
  assert.equal(tripPlan(v, 9, 16, at(14, 20)).tail, 2, "2 hours left");
  assert.equal(tripPlan(v, 9, 16, at(14, 20)).slots[0].isTomorrow, true);
  // exactly minLen hours left stays today
  const q = tripPlan(v, 9, 16, at(13, 20));
  assert.equal(q.tail, null);
  assert.deepEqual(hoursOf(q.slots), [15]); // vm starts at 15:00 today, the hours before are not in the forecast
  // a window that is not running, or that is shorter than minLen, is unchanged
  assert.equal(tripPlan(v, 16, 18, at(15, 20)).tail, null);
  assert.equal(tripPlan(v, 15, 17, at(15, 20)).tail, null, "a 2-hour window can never reach minLen: no switch");
  // wrap: 22-02 at 00:20 has 2 hours left; the next occurrence is tonight (today), not tomorrow
  const w = tripPlan(v, 22, 2, at(0, 20));
  assert.equal(w.tail, 2);
});
