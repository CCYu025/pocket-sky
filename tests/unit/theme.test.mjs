import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTheme, nextPref, THEME_COLORS, readPref, writePref } from "../../js/ui/theme.js";

const vm = (minuteKey) => ({
  now: { minuteKey, isDay: null },
  today: { sunrise: "2026-11-21T06:20", sunset: "2026-11-21T17:05" },
  location: { utcOffsetSeconds: 28800 },
});

test("explicit day/night ignore time", () => {
  assert.equal(resolveTheme("day", vm("2026-11-21T02:00"), 0), "day");
  assert.equal(resolveTheme("night", vm("2026-11-21T12:00"), 0), "night");
});

test("auto boundaries", () => {
  assert.equal(resolveTheme("auto", vm("2026-11-21T06:19"), 0), "night");
  assert.equal(resolveTheme("auto", vm("2026-11-21T06:20"), 0), "day");
  assert.equal(resolveTheme("auto", vm("2026-11-21T17:04"), 0), "day");
  assert.equal(resolveTheme("auto", vm("2026-11-21T17:05"), 0), "night");
  assert.equal(resolveTheme("auto", vm("2026-11-21T22:00"), 0), "night");
});

test("auto computes minuteKey from offset when missing", () => {
  const v = vm(undefined);
  delete v.now.minuteKey;
  // 04:00 UTC = 12:00 Taipei
  assert.equal(resolveTheme("auto", v, Date.UTC(2026, 10, 21, 4, 0)), "day");
  // 14:00 UTC = 22:00 Taipei
  assert.equal(resolveTheme("auto", v, Date.UTC(2026, 10, 21, 14, 0)), "night");
});

test("missing sunrise/sunset falls back to isDay, then day", () => {
  const noSun = (isDay) => ({
    now: { minuteKey: "2026-11-21T12:00", isDay },
    today: { sunrise: null, sunset: "2026-11-21T17:05" },
  });
  assert.equal(resolveTheme("auto", noSun(0), 0), "night");
  assert.equal(resolveTheme("auto", noSun(1), 0), "day");
  assert.equal(resolveTheme("auto", noSun(null), 0), "day");
  assert.equal(resolveTheme("auto", {}, 0), "day");
  assert.equal(resolveTheme("auto", { now: {}, today: { sunrise: null, sunset: null } }, 0), "day");
});

test("invalid pref behaves as auto", () => {
  assert.equal(resolveTheme("bogus", vm("2026-11-21T22:00"), 0), "night");
  assert.equal(resolveTheme(undefined, vm("2026-11-21T12:00"), 0), "day");
});

test("nextPref and colors", () => {
  assert.equal(nextPref("day"), "night");
  assert.equal(nextPref("night"), "day");
  assert.deepEqual(THEME_COLORS, { day: "#FFF7D6", night: "#141414" });
});

test("readPref/writePref", () => {
  const data = new Map();
  const s = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v) };
  assert.equal(readPref(s), "auto");
  writePref(s, "night");
  assert.equal(data.get("ps:theme"), "night");
  assert.equal(readPref(s), "night");
  data.set("ps:theme", "purple");
  assert.equal(readPref(s), "auto");
});

test("storage failures never throw", () => {
  const bad = {
    getItem() { throw new Error("x"); },
    setItem() { throw new Error("x"); },
  };
  assert.equal(readPref(bad), "auto");
  assert.doesNotThrow(() => writePref(bad, "day"));
  assert.equal(readPref(undefined), "auto");
  assert.doesNotThrow(() => writePref(undefined, "day"));
});
