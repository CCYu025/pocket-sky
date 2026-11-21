import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toViewModel } from "../../js/domain/derive.js";
import { tripModel, tripHtml, diffParts } from "../../js/ui/views/trip.js";
import { tempDiff } from "../../js/rules/trip.js";

const fx = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-21T06:20:00Z"); // 14:20 Taipei
const IDX = 38;
const withObservation = (f, mutate) => {
  const h = f.hourly;
  f.current = { ...f.current, time: "2026-11-21T14:15", temperature_2m: h.temperature_2m[IDX], weather_code: h.weather_code[IDX], is_day: 1 };
  mutate?.(f);
  return f;
};
const origin = (mutate) => toViewModel({ forecast: withObservation(fx("forecast-taichung.json"), mutate), air: fx("air-taichung.json"), nowMs: NOW });
const dest = (mutate) => toViewModel({ forecast: withObservation(fx("forecast-multi.json")[1], mutate), air: null, nowMs: NOW, hoursAhead: 36 }); // like the controller's extra places
const LAKE = { id: "p:23.87,120.91", name: "日月潭", admin1: "南投縣", elevation: 748, lat: 23.87, lon: 120.91 };
const TRIP = { start: 9, end: 16 };
const entry = (vm, status = "ready") => ({ status, vm, error: null, fetchedAt: NOW });
const key = "om:v1:forecast:23.87,120.91";

test("diffParts: seg7-drawable text, sign for positives, spoken label", () => {
  assert.deepEqual(diffParts(-6), { text: "-6", sign: "", label: "比目前位置低 6 度" });
  assert.deepEqual(diffParts(4), { text: "4", sign: "+", label: "比目前位置高 4 度" });
  assert.deepEqual(diffParts(0), { text: "0", sign: "", label: "與目前位置溫度相同" });
  assert.equal(diffParts(null).text, "--");
});

test("tripModel: slots, best window, diff, headline and strip rows from the fixtures", () => {
  const o = origin();
  const d = dest();
  const m = tripModel({ vm: d, place: LAKE, originVm: o }, TRIP, NOW);
  assert.equal(m.diff, tempDiff(d, o));
  assert.equal(m.diff, Math.round(d.now.temp - o.now.temp));
  assert.ok(m.diff < 0, "the lake is colder than Taichung");
  assert.equal(m.name, "日月潭・南投縣");
  assert.equal(m.elevation, 747, "the forecast grid elevation");
  assert.match(m.condition, /^現在 \d+° /);
  assert.equal(m.slots.length, 7, "09:00 to 16:00 exclusive");
  assert.equal(m.rows.length, 7);
  assert.equal(m.rows.filter((r) => r.best).length, m.best.length);
  assert.ok(m.best.length >= 3);
  assert.match(m.headline, /外套/, "jacket wording: the lake is cool");
  assert.ok(m.rows.every((r) => r.isTomorrow), "09:00 is already past at 14:20: the window is tomorrow's");
  assert.ok(m.rows.every((r) => /^(明日 )?\d{2}:00，/.test(r.aria) && r.aria.includes("舒適度")));
  assert.match(m.rows.find((r) => r.best).aria, /，最佳時段$/);
});

test("tripModel: the !RAIN slot, checklist tags and the 明日 rows", () => {
  const o = origin();
  const wet = dest((f) => {
    for (const i of [IDX + 1, IDX + 2]) f.hourly.precipitation_probability[i] = 70; // 15:00-16:00
  });
  const m = tripModel({ vm: wet, place: LAKE, originVm: o }, { start: 15, end: 19 }, NOW);
  assert.equal(m.wet.hour, 15);
  assert.match(m.headline, /^15 時起可能下雨|^15 時後可能下雨/);
  assert.deepEqual(m.items.find((i) => i.id === "umbrella").tags, ["15:00・降雨 70%"]);
  const night = tripModel({ vm: dest(), place: LAKE, originVm: o }, { start: 22, end: 3 }, NOW);
  assert.deepEqual(night.rows.map((r) => [r.hour, r.isTomorrow]), [[22, false], [23, false], [0, true], [1, true], [2, true]]);
  assert.ok(night.rows.every((r) => r.aria.startsWith(r.isTomorrow ? "明日 " : "")));
  const none = tripModel({ vm: dest(), place: LAKE, originVm: null }, TRIP, NOW);
  assert.equal(none.diff, null);
});

test("tripModel: no slots (hours outside the horizon) gives 資料不足 and no strip rows", () => {
  const d = dest();
  const m = tripModel({ vm: { ...d, hours: [] }, place: LAKE, originVm: origin() }, TRIP, NOW);
  assert.equal(m.headline, "資料不足");
  assert.deepEqual(m.rows, []);
  assert.equal(m.best, null);
});

const ui = (o = {}) => ({ outing: { scenario: "trip", trip: TRIP }, nowMs: NOW, trip: LAKE, saved: [LAKE], ...o });
const readyState = (extra = {}) => ({ status: "ready", vm: origin(), alert: null, fetchedAt: NOW, places: { [key]: entry(dest()) }, ...extra });

test("tripHtml: hero with the diff, name, elevation and condition; selects; strip; checklist", () => {
  const html = tripHtml(readyState(), ui());
  assert.match(html, /VS 目前位置/);
  assert.match(html, /role="img" aria-label="比目前位置低 \d+ 度"/);
  assert.match(html, /<span class="trip-name">日月潭・南投縣<\/span>/);
  assert.match(html, /海拔 747 m/);
  assert.match(html, /<label class="field-k" for="sel-start">開始時間<\/label>/);
  assert.match(html, /<option value="9" selected>09:00<\/option>/);
  assert.match(html, /<option value="16" selected>16:00<\/option>/);
  assert.equal((html.match(/<option /g) || []).length, 48);
  assert.match(html, /<ol class="strip" aria-label="逐時舒適度">/);
  assert.equal((html.match(/class="srow/g) || []).length, 7);
  assert.equal((html.match(/class="check-item/g) || []).length, 4);
  assert.match(html, /data-k="t-checklist"/);
  assert.match(html, /<h1 class="headline headline--sm" data-k="t-headline">/);
  assert.doesNotMatch(html, /style=/);
  assert.equal((html.match(/class="warn"/g) || []).length, 0, "dry: no !RAIN");
});

test("tripHtml: !RAIN appears once with its hour when any slot is wet", () => {
  const wet = dest((f) => (f.hourly.precipitation_probability[IDX + 2] = 80));
  const html = tripHtml(readyState({ places: { [key]: entry(wet) } }), ui({ outing: { scenario: "trip", trip: { start: 15, end: 19 } } }));
  assert.equal((html.match(/class="warn"/g) || []).length, 1);
  assert.match(html, /class="warn-at">16:00<\/span>/);
});

test("tripHtml: destination chips with one pressed; 搜尋 opens the picker in trip mode", () => {
  const other = { ...LAKE, id: "p:24.80,120.97", name: "新竹", lat: 24.8, lon: 120.97 };
  const html = tripHtml(readyState(), ui({ saved: [LAKE, other] }));
  assert.match(html, /role="group" aria-label="目的地"/);
  assert.match(html, /data-action="trip-pick" data-id="p:23\.87,120\.91" aria-pressed="true">日月潭<\/button>/);
  assert.match(html, /data-action="trip-pick" data-id="p:24\.80,120\.97" aria-pressed="false">新竹<\/button>/);
  assert.match(html, /data-action="open-picker" data-mode="trip">＋ 搜尋<\/button>/);
});

test("tripHtml: empty state without a destination (chips for saved places still shown)", () => {
  const html = tripHtml(readyState(), ui({ trip: null, saved: [] }));
  assert.match(html, /還沒有出遊目的地/);
  assert.match(html, /id="t-empty-add" data-action="open-picker" data-mode="trip">＋ 搜尋地點/);
  assert.doesNotMatch(html, /class="hero"|<ol class="strip"/);
  const withSaved = tripHtml(readyState(), ui({ trip: null, saved: [LAKE] }));
  assert.match(withSaved, /aria-pressed="false">日月潭<\/button>/);
});

test("tripHtml: destination loading, error (retry, isolated from the current place) and stale", () => {
  const loading = tripHtml(readyState({ places: {} }), ui());
  assert.match(loading, /載入天氣中…/);
  assert.match(loading, /海拔 --/);
  assert.doesNotMatch(loading, /<ol class="strip"/);
  const failed = tripHtml(readyState({ places: { [key]: entry(null, "error") } }), ui());
  assert.match(failed, /data-action="retry-place" data-id="p:23\.87,120\.91">重試/);
  assert.match(failed, /目的地天氣暫時無法取得/);
  const stale = tripHtml(readyState({ places: { [key]: entry(dest(), "stale") } }), ui());
  assert.match(stale, /資料時間 14:20・無法更新/);
  assert.match(stale, /<ol class="strip"/);
});

test("tripHtml: an unknown current place (still loading) gives a diff of '--', not an error", () => {
  const html = tripHtml({ status: "loading", vm: null, places: { [key]: entry(dest()) } }, ui());
  assert.match(html, /aria-label="與目前位置的溫差 無資料"/);
  assert.match(html, /<ol class="strip"/);
});

test("tripHtml escapes the destination name", () => {
  const evil = { ...LAKE, name: '<img src=x onerror="a">' };
  const html = tripHtml(readyState(), ui({ trip: evil, saved: [evil] }));
  assert.doesNotMatch(html, /<img/);
});
