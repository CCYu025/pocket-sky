import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeVm from "node:vm";
import { resolveTheme, nextPref, THEME_COLORS, readPref, writePref, readLast, writeLast } from "../../js/ui/theme.js";

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

test("resolveTheme: fallback is used for auto only when vm is null", () => {
  assert.equal(resolveTheme("auto", null, 0, "night"), "night");
  assert.equal(resolveTheme("auto", undefined, 0, "night"), "night");
  assert.equal(resolveTheme("auto", null, 0, "day"), "day");
  assert.equal(resolveTheme("auto", null, 0), "day");
  assert.equal(resolveTheme("auto", null, 0, "bogus"), "day");
  assert.equal(resolveTheme("day", null, 0, "night"), "day", "explicit pref wins");
  assert.equal(resolveTheme("auto", vm("2026-11-21T12:00"), 0, "night"), "day", "a view model wins over the fallback");
});

test("readLast/writeLast never throw and validate", () => {
  const data = new Map();
  const s = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v) };
  assert.equal(readLast(s), undefined);
  writeLast(s, "night");
  assert.equal(data.get("ps:theme-last"), "night");
  assert.equal(readLast(s), "night");
  data.set("ps:theme-last", "purple");
  assert.equal(readLast(s), undefined);
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(readLast(bad), undefined);
  assert.doesNotThrow(() => writeLast(bad, "day"));
  assert.equal(readLast(undefined), undefined);
});

// ---- js/theme-boot.js (classic script run before the stylesheets) ----
const BOOT = readFileSync(new URL("../../js/theme-boot.js", import.meta.url), "utf8");
function boot({ items = {}, throwing = false, meta = true } = {}) {
  const metaEl = { content: "#FFF7D6", setAttribute(k, v) { if (k === "content") this.content = v; } };
  const doc = {
    documentElement: { dataset: {} },
    querySelector: (sel) => (meta && sel === 'meta[name="theme-color"]' ? metaEl : null),
  };
  const win = {};
  if (throwing) Object.defineProperty(win, "localStorage", { get() { throw new Error("SecurityError"); } });
  else win.localStorage = { getItem: (k) => (k in items ? items[k] : null) };
  nodeVm.runInNewContext(BOOT, { window: win, document: doc });
  return { theme: doc.documentElement.dataset.theme, color: metaEl.content };
}

test("theme-boot: explicit pref wins over the last resolved theme", () => {
  assert.deepEqual(boot({ items: { "ps:theme": "day", "ps:theme-last": "night" } }), { theme: "day", color: THEME_COLORS.day });
  assert.deepEqual(boot({ items: { "ps:theme": "night" } }), { theme: "night", color: THEME_COLORS.night });
});

test("theme-boot: auto uses ps:theme-last (night before first paint) and the colors match THEME_COLORS", () => {
  assert.deepEqual(boot({ items: { "ps:theme": "auto", "ps:theme-last": "night" } }), { theme: "night", color: THEME_COLORS.night });
  assert.deepEqual(boot({ items: { "ps:theme-last": "night" } }), { theme: "night", color: THEME_COLORS.night });
  assert.deepEqual(boot({ items: { "ps:theme-last": "day" } }), { theme: "day", color: THEME_COLORS.day });
});

test("theme-boot: nothing known leaves the default; garbage is ignored; never throws", () => {
  assert.equal(boot({}).theme, undefined);
  assert.equal(boot({ items: { "ps:theme": "purple", "ps:theme-last": "mauve" } }).theme, undefined);
  assert.doesNotThrow(() => boot({ throwing: true }));
  assert.equal(boot({ throwing: true }).theme, undefined);
  assert.doesNotThrow(() => boot({ items: { "ps:theme-last": "night" }, meta: false }));
  assert.equal(boot({ items: { "ps:theme-last": "night" }, meta: false }).theme, "night");
  assert.doesNotThrow(() => nodeVm.runInNewContext(BOOT, {}), "no window/document at all");
});
