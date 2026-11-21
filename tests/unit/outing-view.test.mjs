import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toViewModel } from "../../js/domain/derive.js";
import { commuteModel, commuteHtml, LOCATION_NOTE } from "../../js/ui/views/commute.js";
import { exerciseModel, exerciseHtml, resolveSelection, stepIndex, slotLabel, levelWord } from "../../js/ui/views/exercise.js";
import { chipsHtml, outingHtml } from "../../js/ui/views/outing.js";

const fx = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-21T06:20:00Z"); // 14:20 Taipei
const LATE = Date.parse("2026-11-21T14:30:00Z"); // 22:30 Taipei
const vmAt = (nowMs, mutate) => {
  const f = fx("forecast-taichung.json");
  f.current.time = "2026-11-21T14:15";
  mutate?.(f);
  return toViewModel({ forecast: f, air: fx("air-taichung.json"), nowMs });
};
const rainy = (f) => {
  for (const i of [42, 43]) {
    f.hourly.precipitation_probability[i] = 60;
    f.hourly.apparent_temperature[i] = 14;
  }
};
const COMMUTE = { out: 8, back: 18 };
const ui = (o = {}) => ({ outing: { scenario: "commute", commute: COMMUTE }, nowMs: NOW, picked: null, flip: 0, ...o });
const ready = (vm) => ({ status: "ready", vm, alert: null, fetchedAt: NOW });

// ---- commute

test("commuteModel: legs, rain peak over the two leg hours, tomorrow marker", () => {
  const m = commuteModel(vmAt(NOW, rainy), COMMUTE);
  assert.deepEqual(m.legs.map((l) => [l.key, l.time, l.tomorrow, l.warn]), [["out", "08:00", true, false], ["back", "18:00", false, true]]);
  assert.equal(m.legs[1].rainMax, 60);
  assert.equal(m.legs[1].aria, "回家 18:00");
  assert.equal(m.legs[0].aria, "明日 出門 08:00");
  assert.match(m.legs[1].detail, /^雨 60%・風 \d+ km\/h$/);
  assert.equal(m.headline, "傍晚回家會遇到雨");
});

test("commuteModel: !RAIN threshold is rainProb >= 40 over either leg hour", () => {
  const at = (p18, p19) => commuteModel(vmAt(NOW, (f) => { f.hourly.precipitation_probability[42] = p18; f.hourly.precipitation_probability[43] = p19; }), COMMUTE).legs[1];
  assert.equal(at(39, 0).warn, false);
  assert.equal(at(40, 0).warn, true);
  assert.equal(at(0, 40).warn, true, "second hour of the leg counts, as in the checklist");
  assert.equal(at(0, 0).rainMax, 0);
});

test("commuteModel: leg attribution tags", () => {
  const m = commuteModel(vmAt(NOW, rainy), COMMUTE);
  const by = Object.fromEntries(m.items.map((i) => [i.id, i]));
  assert.deepEqual(by.umbrella.tags, ["回家 18:00"]);
  assert.deepEqual(by.jacket.tags, ["出門 08:00", "回家 18:00"]);
  assert.deepEqual(by.sunscreen.tags, []);
  const both = commuteModel(vmAt(NOW, rainy), { out: 18, back: 18 });
  assert.deepEqual(both.items[0].tags, ["出門 18:00", "回家 18:00"]);
  assert.equal(both.headline, "來回都可能下雨");
});

test("commuteModel: a range-only trigger is attributed to both legs together (來回)", () => {
  // each leg alone is mild (no feels <= 18, range < 6), the two together span >= 6 degrees
  const vm = vmAt(NOW, (f) => {
    const h = f.hourly;
    for (const i of [56, 57]) { h.temperature_2m[i] = 20; h.apparent_temperature[i] = 20; }
    for (const i of [42, 43]) { h.temperature_2m[i] = 27; h.apparent_temperature[i] = 27; }
  });
  const jacket = commuteModel(vm, COMMUTE).items.find((i) => i.id === "jacket");
  assert.equal(jacket.on, true);
  assert.deepEqual(jacket.tags, ["來回"]);
});

test("commuteModel: missing hours render as no data, never throw", () => {
  const m = commuteModel({ hours: [], now: {} }, COMMUTE);
  assert.equal(m.headline, "資料不足");
  assert.equal(m.legs[0].wx, "--");
  assert.equal(m.legs[0].detail, "無資料");
  assert.equal(m.legs[0].warn, false);
  assert.ok(m.items.every((i) => !i.on && i.why === "資料不足" && i.tags.length === 0));
});

test("commuteHtml: structure, labels, note, no inline styles", () => {
  const html = commuteHtml(ready(vmAt(NOW, rainy)), ui());
  assert.ok(html.includes(LOCATION_NOTE));
  assert.match(html, /<label class="field-k" for="sel-out">出門時間<\/label>/);
  assert.match(html, /<label class="field-k" for="sel-back">回家時間<\/label>/);
  assert.equal((html.match(/<option /g) || []).length, 48);
  assert.match(html, /<option value="8" selected>08:00<\/option>/);
  assert.match(html, /<option value="18" selected>18:00<\/option>/);
  assert.equal((html.match(/class="warn"/g) || []).length, 1);
  assert.equal((html.match(/class="check-item/g) || []).length, 4);
  assert.match(html, /<span class="tag">回家 18:00<\/span>/);
  assert.match(html, /data-k="item-umbrella"/);
  assert.doesNotMatch(html, /\sstyle=/, "CSP: no inline style attributes");
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("commuteHtml: loading and error skeletons", () => {
  const loading = commuteHtml({ status: "loading", vm: null }, ui());
  assert.match(loading, /載入天氣中/);
  assert.match(loading, /出門 無資料/);
  assert.equal((loading.match(/載入中/g) || []).length >= 4, true);
  assert.doesNotMatch(loading, /class="warn"/);
  const err = commuteHtml({ status: "error", vm: null }, ui());
  assert.match(err, /資料暫時無法取得/);
  assert.doesNotMatch(err, /class="card checklist"/);
});

// ---- exercise

test("resolveSelection: pick wins, else best, else first; empty list", () => {
  const slots = [{ hourKey: "a", score: 50 }, { hourKey: "b", score: 80 }, { hourKey: "c", score: 80 }];
  assert.deepEqual(resolveSelection(slots, null), { index: 1, slot: slots[1], picked: false }, "best, earliest on ties");
  assert.deepEqual(resolveSelection(slots, "c"), { index: 2, slot: slots[2], picked: true });
  assert.equal(resolveSelection(slots, "gone").index, 1, "a vanished pick falls back to the best");
  assert.equal(resolveSelection(slots, "gone").picked, false);
  assert.equal(resolveSelection([{ hourKey: "x", score: null }], null).index, 0, "no scored slot: first");
  assert.deepEqual(resolveSelection([], "a"), { index: -1, slot: null, picked: false });
});

test("stepIndex: arrows move one, clamp at the ends; Home/End; others unhandled", () => {
  assert.equal(stepIndex("ArrowRight", 2, 5), 3);
  assert.equal(stepIndex("ArrowLeft", 2, 5), 1);
  assert.equal(stepIndex("ArrowLeft", 0, 5), 0);
  assert.equal(stepIndex("ArrowRight", 4, 5), 4);
  assert.equal(stepIndex("Home", 3, 5), 0);
  assert.equal(stepIndex("End", 1, 5), 4);
  assert.equal(stepIndex("ArrowUp", 1, 5), null);
  assert.equal(stepIndex("a", 1, 5), null);
  assert.equal(stepIndex("ArrowRight", 0, 0), null);
  assert.equal(stepIndex("ArrowRight", 0, 1), 0);
});

test("slotLabel and levelWord", () => {
  assert.equal(slotLabel({ hour: 21, score: 84, level: "good", isTomorrow: false }), "21:00，評分 84，適合");
  assert.equal(slotLabel({ hour: 5, score: 60, level: "ok", isTomorrow: true }), "明日 05:00，評分 60，普通");
  assert.equal(slotLabel({ hour: 16, score: 25, level: "bad", isTomorrow: false }), "16:00，評分 25，不建議");
  assert.equal(slotLabel({ hour: 3, score: null, level: null, isTomorrow: false }), "03:00，無資料");
  assert.equal(levelWord(null), "無資料");
});

test("exerciseModel: 14:20 window, default best, picked slot, six metrics", () => {
  const vm = vmAt(NOW);
  const m = exerciseModel(vm, NOW, null);
  assert.equal(m.slots.length, 12);
  assert.equal(m.slot, m.best);
  assert.equal(m.picked, false);
  assert.equal(m.metrics.length, 6);
  assert.deepEqual(m.metrics.map((x) => x.k), ["溫度 / 體感", "濕度", "降雨機率", "風速", "紫外線", "空氣品質"]);
  assert.match(m.metrics[0].v, /^-?\d+° \/ -?\d+°$/);
  assert.match(m.metrics[3].v, /^\d+ km\/h$/);
  assert.match(m.metrics[5].v, /^AQI \d+$/);
  const other = m.slots.find((s) => s !== m.best);
  const p = exerciseModel(vm, NOW, other.hourKey);
  assert.equal(p.slot, p.slots.find((s) => s.hourKey === other.hourKey));
  assert.equal(p.picked, true);
  assert.equal(m.note, "現在 14:20・從 14:00 起算・未來 12 小時");
});

test("exerciseModel: 22:30 looks 12 hours ahead, to 09:00 tomorrow", () => {
  const m = exerciseModel(vmAt(LATE), LATE, null);
  assert.equal(m.slots.length, 12);
  assert.deepEqual(m.slots.map((s) => s.isTomorrow), [false, false, ...Array(10).fill(true)]);
  assert.equal(m.note, "現在 22:30・從 22:00 起算・未來 12 小時");
});

test("exerciseHtml: bars are buttons with accessible names and aria-pressed; escaping; no inline styles", () => {
  const vm = vmAt(NOW);
  const model = exerciseModel(vm, NOW, null);
  const html = exerciseHtml(ready(vm), ui({ outing: { scenario: "exercise", commute: COMMUTE } }));
  assert.equal((html.match(/<button type="button" class="xbar/g) || []).length, 12);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  for (const s of model.slots) assert.ok(html.includes(`aria-label="${slotLabel(s)}"`), slotLabel(s));
  assert.ok(html.includes(`id="slot-${model.best.hourKey}"`));
  assert.match(html, new RegExp(`class="key best" data-action="pick-best">最佳 ${String(model.best.hour).padStart(2, "0")}:00`));
  assert.match(html, /<input type="range" id="x-range" min="0" max="11" step="1" value="\d"/);
  assert.match(html, /<label for="x-range" class="range-k">/);
  assert.equal((html.match(/class="metric"/g) || []).length, 6);
  assert.doesNotMatch(html, /\sstyle=/);
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.doesNotMatch(html, /flip-/, "no flip class until the selection changes");
  assert.match(exerciseHtml(ready(vm), ui({ flip: 1 })), /class="x-time flip-a"/);
  assert.match(exerciseHtml(ready(vm), ui({ flip: 2 })), /class="x-score flip-b"/);
});

test("exerciseHtml: tomorrow markers; loading, empty and error skeletons", () => {
  const late = exerciseHtml(ready(vmAt(LATE)), ui({ nowMs: LATE }));
  assert.equal((late.match(/<i>明日<\/i>/g) || []).length, 10);
  assert.match(late, /aria-label="明日 09:00，/);
  const loading = exerciseHtml({ status: "loading", vm: null }, ui());
  assert.match(loading, /時間 無資料/);
  assert.match(loading, /載入中…/);
  assert.match(loading, /class="key best" data-action="pick-best" disabled/);
  assert.equal((loading.match(/class="v">--</g) || []).length, 6);
  const empty = exerciseHtml(ready({ ...vmAt(NOW), hours: [] }), ui());
  assert.match(empty, /沒有可選時段/);
  assert.doesNotMatch(empty, /<input/);
});

// ---- chips / shell

test("chipsHtml: links with aria-current; 出遊 is a disabled non-link with v2", () => {
  const c = chipsHtml("exercise");
  assert.match(c, /<a class="key chip chip--commute" href="#outing\/commute">通勤<\/a>/);
  assert.match(c, /<a class="key chip chip--exercise" href="#outing\/exercise" aria-current="page">運動<\/a>/);
  assert.match(c, /<span class="key chip chip--trip" role="link" aria-disabled="true">出遊 <span class="badge">v2<\/span><\/span>/);
  assert.equal((c.match(/aria-current/g) || []).length, 1);
  assert.doesNotMatch(c, /chip--trip" href/);
});

test("outingHtml: stale banner, error card, no-hours notice", () => {
  const vm = vmAt(NOW);
  assert.match(outingHtml({ status: "stale", vm, fetchedAt: NOW }, ui()), /資料時間 14:20・無法更新/);
  const err = outingHtml({ status: "error", vm: null }, ui());
  assert.match(err, /data-action="retry"/);
  assert.match(err, /class="chips"/);
  assert.match(outingHtml({ status: "ready", vm: { ...vm, hoursAvailable: false, hours: [] }, fetchedAt: NOW }, ui()), /沒有逐時資料/);
});
