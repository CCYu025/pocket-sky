import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { todayHtml, metricItems } from "../../js/ui/views/today.js";
import { toViewModel } from "../../js/domain/derive.js";
import { ATTRIBUTION } from "../../js/api/openmeteo.js";

const fx = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-20T12:20:00Z"); // 20:20 Taipei
const vm = () => toViewModel({ forecast: fx("forecast-taichung.json"), air: fx("air-taichung.json"), nowMs: NOW });
const ui = { attribution: ATTRIBUTION };

test("metricItems derives the five cards from the view model", () => {
  const m = metricItems(vm());
  assert.deepEqual(m.map((x) => x.k), ["降雨機率", "濕度", "風", "紫外線", "空氣品質"]);
  assert.equal(m[4].v, "84");
  assert.equal(m[4].s, "AQI 普通");
  for (const x of m) assert.ok(!/undefined|NaN/.test(x.v + x.s));
});

test("loading state renders -- placeholders and the busy-friendly text", () => {
  const html = todayHtml({ status: "loading", vm: null, alert: null, notice: null, fetchedAt: null }, ui);
  assert.match(html, /載入天氣中/);
  assert.match(html, /aria-label="氣溫 無資料"/);
  assert.match(html, /aria-label="時間 無資料"/);
  assert.equal((html.match(/class="v">--</g) || []).length, 5);
});

test("error state shows a retry button and no metrics", () => {
  const html = todayHtml({ status: "error", vm: null, alert: null, notice: null, fetchedAt: null }, ui);
  assert.match(html, /data-action="retry"/);
  assert.doesNotMatch(html, /class="metric"/);
});

test("interpolated strings are escaped", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const html = todayHtml(
    { status: "ready", vm: vm(), alert: { id: "a", kind: "rainJump", title: evil, detail: evil }, notice: evil, fetchedAt: NOW },
    { attribution: { text: evil, href: 'https://x/"><script>' } },
  );
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;img/);
});

test("stale banner shows the local fetch time", () => {
  const html = todayHtml({ status: "stale", vm: vm(), alert: null, notice: null, fetchedAt: Date.parse("2026-11-21T06:20:00Z") }, ui);
  assert.match(html, /資料時間 14:20・無法更新/);
});
