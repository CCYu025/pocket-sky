import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { todayHtml, metricItems, applyDynamicStyles } from "../../js/ui/views/today.js";
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

test("no inline style attributes (CSP has no 'unsafe-inline'); numbers travel as data-* attributes", () => {
  const html = todayHtml({ status: "ready", vm: vm(), alert: null, notice: null, fetchedAt: NOW }, ui);
  assert.doesNotMatch(html, /\sstyle=/);
  assert.equal((html.match(/class="bar" data-p="\d+" data-i="\d"/g) || []).length, 8);
  assert.match(html, /<div data-pct="\d+"><\/div>/);
});

test("applyDynamicStyles sets --p/--i/--pct through the CSSOM", () => {
  const mk = (data) => {
    const props = {};
    return { dataset: data, style: { setProperty: (k, v) => (props[k] = v) }, props };
  };
  const bars = [mk({ p: "70", i: "2" }), mk({ p: "0" })];
  const fill = mk({ pct: "74" });
  applyDynamicStyles({
    querySelectorAll: (sel) => (sel === "[data-p]" ? bars : sel === "[data-pct]" ? [fill] : []),
  });
  assert.deepEqual(bars[0].props, { "--p": "70", "--i": "2" });
  assert.deepEqual(bars[1].props, { "--p": "0", "--i": "0" });
  assert.deepEqual(fill.props, { "--pct": "74" });
});

test("the 24px clock hides ghost segments, the big temperature keeps them", () => {
  const html = todayHtml({ status: "ready", vm: vm(), alert: null, notice: null, fetchedAt: NOW }, ui);
  assert.match(html, /<span class="clock"><span class="seg7 seg7--noghost"/);
  assert.match(html, /<div class="temp"><span class="seg7" /);
});

test("index.html CSP: no 'unsafe-inline' styles; fonts hosts only in style-src/font-src", () => {
  const page = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(page)[1];
  const dir = (n) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${n} `)) ?? "";
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(dir("style-src"), /fonts\.googleapis\.com/);
  assert.match(dir("font-src"), /fonts\.gstatic\.com/);
  assert.doesNotMatch(dir("connect-src"), /fonts\.(googleapis|gstatic)\.com/);
  assert.match(dir("connect-src"), /api\.open-meteo\.com/);
  assert.match(dir("connect-src"), /air-quality-api\.open-meteo\.com/);
});

test("daylight bar: night label and class after sunset, day label by day", () => {
  const mk = (minuteKey) => {
    const v = vm();
    return todayHtml({ status: "ready", vm: { ...v, now: { ...v.now, minuteKey } }, alert: null, notice: null, fetchedAt: NOW }, ui);
  };
  const night = mk(`${vm().today.sunset.slice(0, 11)}23:00`);
  assert.match(night, /class="daybar daybar--night"[^>]*aria-label="夜間已過"/);
  const day = mk(`${vm().today.sunrise.slice(0, 11)}12:00`);
  assert.match(day, /class="daybar"[^>]*aria-label="日照已過"/);
});
