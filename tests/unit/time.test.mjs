import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts, addHours, indexOfHour, exerciseWindow, minutesUntil } from "../../js/time.js";

const TAIPEI = 28800;
// Build an epoch ms for a UTC wall-clock instant.
const utc = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

test("localParts floors 14:20 to 14:00 (Taipei)", () => {
  const p = localParts(TAIPEI, utc(2026, 11, 21, 6, 20));
  assert.deepEqual(p, {
    date: "2026-11-21",
    hourKey: "2026-11-21T14:00",
    minuteKey: "2026-11-21T14:20",
    hour: 14,
    minute: 20,
  });
});

test("localParts floors 14:59 to 14:00", () => {
  const p = localParts(TAIPEI, utc(2026, 11, 21, 6, 59));
  assert.equal(p.hourKey, "2026-11-21T14:00");
  assert.equal(p.minuteKey, "2026-11-21T14:59");
  assert.equal(p.minute, 59);
});

test("localParts exact hour 00:00 is zero padded", () => {
  const p = localParts(TAIPEI, utc(2026, 11, 20, 16, 0));
  assert.equal(p.date, "2026-11-21");
  assert.equal(p.hourKey, "2026-11-21T00:00");
  assert.equal(p.minuteKey, "2026-11-21T00:00");
  assert.equal(p.hour, 0);
  assert.equal(p.minute, 0);
});

test("localParts zero offset", () => {
  const p = localParts(0, utc(2026, 1, 5, 9, 5));
  assert.equal(p.minuteKey, "2026-01-05T09:05");
  assert.equal(p.hourKey, "2026-01-05T09:00");
});

test("localParts negative offset crosses to previous day", () => {
  // 03:30 UTC at -10:00 is 17:30 the previous day.
  const p = localParts(-36000, utc(2026, 3, 1, 3, 30));
  assert.equal(p.date, "2026-02-28");
  assert.equal(p.hourKey, "2026-02-28T17:00");
  assert.equal(p.minuteKey, "2026-02-28T17:30");
});

test("localParts +5:45 offset (Nepal)", () => {
  // 10:00 UTC + 5:45 = 15:45
  const p = localParts(20700, utc(2026, 11, 21, 10, 0));
  assert.equal(p.hourKey, "2026-11-21T15:00");
  assert.equal(p.minuteKey, "2026-11-21T15:45");
  assert.equal(p.minute, 45);
  // 18:30 UTC + 5:45 = 00:15 next day
  const q = localParts(20700, utc(2026, 11, 21, 18, 30));
  assert.equal(q.minuteKey, "2026-11-22T00:15");
  assert.equal(q.hourKey, "2026-11-22T00:00");
});

test("localParts is independent of the process time zone (pure UTC math)", () => {
  const p = localParts(TAIPEI, 0);
  assert.equal(p.minuteKey, "1970-01-01T08:00");
});

test("addHours within a day", () => {
  assert.equal(addHours("2026-11-21T14:00", 3), "2026-11-21T17:00");
  assert.equal(addHours("2026-11-21T14:00", 0), "2026-11-21T14:00");
});

test("addHours across day boundary", () => {
  assert.equal(addHours("2026-11-21T23:00", 1), "2026-11-22T00:00");
  assert.equal(addHours("2026-11-21T22:00", 9), "2026-11-22T07:00");
});

test("addHours across month boundary (Jan 31 -> Feb 1)", () => {
  assert.equal(addHours("2026-01-31T23:00", 1), "2026-02-01T00:00");
});

test("addHours leap day", () => {
  assert.equal(addHours("2028-02-28T23:00", 1), "2028-02-29T00:00");
  assert.equal(addHours("2028-02-29T23:00", 1), "2028-03-01T00:00");
  assert.equal(addHours("2027-02-28T23:00", 1), "2027-03-01T00:00");
});

test("addHours year rollover", () => {
  assert.equal(addHours("2026-12-31T23:00", 1), "2027-01-01T00:00");
  assert.equal(addHours("2027-01-01T00:00", -1), "2026-12-31T23:00");
});

test("addHours negative n", () => {
  assert.equal(addHours("2026-11-21T02:00", -3), "2026-11-20T23:00");
  assert.equal(addHours("2026-03-01T00:00", -1), "2026-02-28T23:00");
  assert.equal(addHours("2026-11-21T14:00", -24), "2026-11-20T14:00");
});

test("indexOfHour hit and miss", () => {
  const times = ["2026-11-20T23:00", "2026-11-21T00:00", "2026-11-21T01:00"];
  assert.equal(indexOfHour(times, "2026-11-21T00:00"), 1);
  assert.equal(indexOfHour(times, "2026-11-20T23:00"), 0);
  assert.equal(indexOfHour(times, "2026-11-21T05:00"), -1);
  assert.equal(indexOfHour([], "2026-11-21T00:00"), -1);
});

test("exerciseWindow at 14:20 is 14..23 (10 keys)", () => {
  const w = exerciseWindow(TAIPEI, utc(2026, 11, 21, 6, 20));
  assert.equal(w.length, 10);
  assert.equal(w[0], "2026-11-21T14:00");
  assert.equal(w[9], "2026-11-21T23:00");
});

test("exerciseWindow at 21:59 is 21..23", () => {
  const w = exerciseWindow(TAIPEI, utc(2026, 11, 21, 13, 59));
  assert.deepEqual(w, ["2026-11-21T21:00", "2026-11-21T22:00", "2026-11-21T23:00"]);
});

test("exerciseWindow at 22:00 extends through 06:00 next day", () => {
  const w = exerciseWindow(TAIPEI, utc(2026, 11, 21, 14, 0));
  assert.equal(w.length, 9);
  assert.equal(w[0], "2026-11-21T22:00");
  assert.equal(w[1], "2026-11-21T23:00");
  assert.equal(w[2], "2026-11-22T00:00");
  assert.equal(w[8], "2026-11-22T06:00");
});

test("exerciseWindow at 23:30 extends through 06:00 next day", () => {
  const w = exerciseWindow(TAIPEI, utc(2026, 11, 21, 15, 30));
  assert.equal(w.length, 8);
  assert.equal(w[0], "2026-11-21T23:00");
  assert.equal(w[1], "2026-11-22T00:00");
  assert.equal(w[7], "2026-11-22T06:00");
});

test("exerciseWindow at 00:10 is 00..23 (24 keys)", () => {
  const w = exerciseWindow(TAIPEI, utc(2026, 11, 20, 16, 10));
  assert.equal(w.length, 24);
  assert.equal(w[0], "2026-11-21T00:00");
  assert.equal(w[23], "2026-11-21T23:00");
});

test("exerciseWindow keys are consecutive hours", () => {
  const w = exerciseWindow(0, utc(2026, 12, 31, 23, 5));
  assert.equal(w[0], "2026-12-31T23:00");
  assert.equal(w[1], "2027-01-01T00:00");
  assert.equal(w.at(-1), "2027-01-01T06:00");
  for (let i = 1; i < w.length; i++) assert.equal(w[i], addHours(w[i - 1], 1));
});

test("minutesUntil positive", () => {
  assert.equal(minutesUntil("2026-11-21T14:20", "2026-11-21T14:50"), 30);
  assert.equal(minutesUntil("2026-11-21T14:20", "2026-11-21T17:05"), 165);
  assert.equal(minutesUntil("2026-11-21T14:20", "2026-11-21T14:20"), 0);
});

test("minutesUntil negative", () => {
  assert.equal(minutesUntil("2026-11-21T14:20", "2026-11-21T14:00"), -20);
  assert.equal(minutesUntil("2026-11-21T14:20", "2026-11-21T06:00"), -500);
});

test("minutesUntil cross-day", () => {
  assert.equal(minutesUntil("2026-11-21T23:30", "2026-11-22T06:15"), 405);
  assert.equal(minutesUntil("2026-11-22T00:10", "2026-11-21T23:50"), -20);
  assert.equal(minutesUntil("2026-12-31T23:59", "2027-01-01T00:01"), 2);
});
