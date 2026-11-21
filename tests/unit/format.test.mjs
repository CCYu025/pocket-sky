import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compassZh, uvBand, aqiBand, humidityWord, intText, deltaText, dateLabel, clockOf, clockAt,
  daylightPercent, daylightProgress, countdownText, hm,
} from "../../js/ui/format.js";

test("compassZh maps 16 points and wraps", () => {
  const cases = [[0, "北"], [22.5, "北北東"], [45, "東北"], [67.5, "東北東"], [90, "東"], [135, "東南"], [180, "南"],
    [225, "西南"], [270, "西"], [315, "西北"], [337.5, "北北西"], [354, "北"], [360, "北"], [-45, "西北"], [725, "北"]];
  for (const [deg, want] of cases) assert.equal(compassZh(deg), want, `deg ${deg}`);
  assert.equal(compassZh(11.24), "北");
  assert.equal(compassZh(11.26), "北北東");
  assert.equal(compassZh(null), null);
  assert.equal(compassZh(NaN), null);
});

test("uvBand follows WHO bands on the rounded index", () => {
  const cases = [[0, "低"], [2.4, "低"], [2.5, "中"], [5, "中"], [5.4, "中"], [5.5, "高"], [7, "高"], [7.6, "過量"], [10, "過量"], [10.6, "危險"], [14, "危險"]];
  for (const [uv, want] of cases) assert.equal(uvBand(uv), want, `uv ${uv}`);
  assert.equal(uvBand(null), null);
});

test("aqiBand follows US AQI bands", () => {
  const cases = [[0, "良好"], [50, "良好"], [51, "普通"], [100, "普通"], [101, "敏感族群注意"], [150, "敏感族群注意"],
    [151, "不健康"], [200, "不健康"], [201, "非常不健康"], [300, "非常不健康"], [301, "危害"]];
  for (const [v, want] of cases) assert.equal(aqiBand(v), want, `aqi ${v}`);
  assert.equal(aqiBand(undefined), null);
});

test("humidityWord bands", () => {
  assert.equal(humidityWord(39), "乾燥");
  assert.equal(humidityWord(40), "舒適");
  assert.equal(humidityWord(60), "舒適");
  assert.equal(humidityWord(68), "略悶");
  assert.equal(humidityWord(76), "潮濕");
  assert.equal(humidityWord(null), null);
});

test("intText and deltaText never produce -0 or NaN", () => {
  assert.equal(intText(23.4), "23");
  assert.equal(intText(-0.4), "0");
  assert.equal(intText(-3.6), "-4");
  assert.equal(intText(null), "--");
  assert.equal(deltaText(-4.2), "-4°");
  assert.equal(deltaText(5.1), "+5°");
  assert.equal(deltaText(-0.2), "0°");
  assert.equal(deltaText(null), "--");
});

test("dateLabel, clockOf, clockAt", () => {
  assert.equal(dateLabel("2026-11-21T14:20"), "SA 11-21");
  assert.equal(dateLabel("2026-11-22T00:05"), "SU 11-22");
  assert.equal(dateLabel(null), "-- --");
  assert.equal(clockOf("2026-11-21T06:16"), "06:16");
  assert.equal(clockOf(undefined), null);
  assert.equal(clockAt(Date.parse("2026-11-21T06:20:00Z"), 28800), "14:20");
  assert.equal(clockAt(Date.parse("2026-11-21T20:00:00Z"), 28800), "04:00");
});

const vmAt = (minuteKey) => ({
  now: { minuteKey },
  today: { sunrise: "2026-11-21T06:16", sunset: "2026-11-21T17:09" },
});

test("daylightPercent is proportional and clamped", () => {
  assert.equal(daylightPercent(vmAt("2026-11-21T14:20")), 74);
  assert.equal(daylightPercent(vmAt("2026-11-21T06:16")), 0);
  assert.equal(daylightPercent(vmAt("2026-11-21T17:09")), 100);
  assert.equal(daylightPercent(vmAt("2026-11-21T03:00")), 0);
  assert.equal(daylightPercent(vmAt("2026-11-21T22:00")), 100);
  assert.equal(daylightPercent({ now: {}, today: {} }), null);
  assert.equal(daylightPercent({ now: { minuteKey: "2026-11-21T10:00" }, today: { sunrise: "2026-11-21T10:00", sunset: "2026-11-21T10:00" } }), null);
});

test("countdownText: before sunset, at night after sunset, before sunrise", () => {
  assert.equal(hm(169), "2 時 49 分");
  assert.equal(countdownText(vmAt("2026-11-21T14:20")), "還有 2 時 49 分天黑");
  assert.equal(countdownText(vmAt("2026-11-21T20:30")), "距日出 9 時 46 分");
  assert.equal(countdownText(vmAt("2026-11-21T04:00")), "距日出 2 時 16 分");
  assert.equal(countdownText(vmAt("2026-11-21T06:16")), "還有 10 時 53 分天黑");
  assert.equal(countdownText({ now: {}, today: {} }), null);
});

test("daylightProgress: day fraction by day, night fraction (sunset -> next sunrise) by night", () => {
  assert.deepEqual(daylightProgress(vmAt("2026-11-21T14:20")), { phase: "day", pct: 74 });
  assert.deepEqual(daylightProgress(vmAt("2026-11-21T06:16")), { phase: "day", pct: 0 });
  // night: sunset 17:09, next sunrise 06:16 + 24 h => 787 min
  assert.deepEqual(daylightProgress(vmAt("2026-11-21T17:09")), { phase: "night", pct: 0 });
  assert.deepEqual(daylightProgress(vmAt("2026-11-21T20:30")), { phase: "night", pct: Math.round((201 / 787) * 100) });
  // before sunrise: previous sunset = today's sunset - 24 h, elapsed 05:00 - (17:09 - 24 h) = 711 min
  assert.deepEqual(daylightProgress(vmAt("2026-11-21T05:00")), { phase: "night", pct: Math.round((711 / 787) * 100) });
  assert.equal(daylightProgress(vmAt("2026-11-21T23:59")).pct, Math.round((410 / 787) * 100));
  assert.equal(daylightProgress({ now: {}, today: {} }), null);
});
