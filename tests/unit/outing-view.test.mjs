import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toViewModel } from "../../js/domain/derive.js";
import { commuteModel, commuteHtml, workNote } from "../../js/ui/views/commute.js";
import { exerciseModel, exerciseHtml, resolveSelection, stepIndex, slotLabel, levelWord } from "../../js/ui/views/exercise.js";
import { chipsHtml, outingHtml, revealScrollLeft } from "../../js/ui/views/outing.js";

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
  assert.deepEqual(by.umbrella.tags, ["回家 18:00・降雨 60%"]);
  assert.match(by.jacket.tags[0], /^明日 出門 08:00・體感 -?\d+°$/);
  assert.match(by.jacket.tags[1], /^回家 18:00・體感 14°$/);
  assert.deepEqual(by.sunscreen.tags, []);
  const both = commuteModel(vmAt(NOW, rainy), { out: 18, back: 18 });
  assert.deepEqual(both.items[0].tags, ["出門 18:00・降雨 60%", "回家 18:00・降雨 60%"]);
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

// synthetic hours for the day-word / tag / headline scenarios (fully deterministic)
const synth = (date, h0, n, f = () => ({})) =>
  Array.from({ length: n }, (_, i) => {
    const t = h0 + i;
    const day = Number(date.slice(8)) + Math.floor(t / 24);
    const hour = t % 24;
    const k = `${date.slice(0, 8)}${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`;
    return { hourKey: k, hour, temp: 22, feels: 22, humidity: 50, rainProb: 0, rain: 0, wind: 5, uv: 0, aqi: 30, pm25: 10, code: 0, ...f(hour, k) };
  });
const vmOfHours = (hours) => ({ hours, now: { hourKey: hours[0].hourKey } });
const tomorrowKey = (k) => k.startsWith("2026-11-22");

test("M1: range across legs ticks 外套 and the headline says so (never 來回都舒適)", () => {
  // 10:30: OUT tomorrow 08-09 at 19 degrees, BACK today 18-19 at 26 degrees
  const hours = synth("2026-11-21", 10, 24, (h, k) => (tomorrowKey(k) ? { temp: 19, feels: 19 } : { temp: 26, feels: 26 }));
  const m = commuteModel(vmOfHours(hours), { out: 8, back: 18 });
  const jacket = m.items.find((i) => i.id === "jacket");
  assert.equal(jacket.on, true);
  assert.match(jacket.why, /溫差 7°/);
  assert.match(m.headline, /外套/);
  assert.notEqual(m.headline, "來回都舒適");
  assert.deepEqual(jacket.tags, ["來回"]);
  const html = commuteHtml(ready(vmOfHours(hours)), ui());
  assert.match(html, /早晚溫差大，記得帶外套/);
});

test("N4: tags of a tomorrow leg carry the 明日 prefix", () => {
  const hours = synth("2026-11-21", 10, 24, (h, k) => (tomorrowKey(k) && h === 8 ? { rainProb: 60, feels: 17 } : {}));
  const m = commuteModel(vmOfHours(hours), { out: 8, back: 18 });
  assert.deepEqual(m.items.find((i) => i.id === "jacket").tags, ["明日 出門 08:00・體感 17°"]);
  assert.deepEqual(m.items.find((i) => i.id === "umbrella").tags, ["明日 出門 08:00・降雨 60%"]);
  const today = commuteModel(vmOfHours(synth("2026-11-21", 6, 24, (h) => (h === 18 ? { rainProb: 60 } : {}))), { out: 8, back: 18 });
  assert.deepEqual(today.items.find((i) => i.id === "umbrella").tags, ["回家 18:00・降雨 60%"], "today's leg has no prefix");
});

test("M1: headline is consistent with the list for jacket / mask(AQI) / umbrella over many combos", () => {
  const mk = (o, b) => synth("2026-11-21", 10, 24, (h, k) => (tomorrowKey(k) ? o : b));
  const combos = [
    [{ temp: 19, feels: 19 }, { temp: 26, feels: 26 }],
    [{ temp: 22, feels: 17 }, { temp: 22, feels: 22 }],
    [{ aqi: 130 }, {}],
    [{}, { aqi: 130 }],
    [{ rainProb: 70 }, {}],
    [{}, {}],
  ];
  for (const [o, b] of combos) {
    const m = commuteModel(vmOfHours(mk(o, b)), { out: 8, back: 18 });
    const on = (id) => m.items.find((i) => i.id === id).on;
    if (m.headline === "來回都舒適") assert.ok(!on("umbrella") && !on("jacket") && !(on("mask") && m.items.find((i) => i.id === "mask").field === "aqi"), JSON.stringify([o, b]));
    if (on("jacket") && !on("umbrella") && !(on("mask") && m.items.find((i) => i.id === "mask").field === "aqi")) assert.match(m.headline, /外套/);
  }
});

test("m3: tomorrow leg gets day words in the headline and 明日 in the reason text", () => {
  const hours = synth("2026-11-21", 10, 24, (h, k) => (tomorrowKey(k) && h === 8 ? { rainProb: 60, feels: 16 } : {}));
  const m = commuteModel(vmOfHours(hours), { out: 8, back: 18 });
  assert.equal(m.headline, "明早出門可能下雨");
  assert.equal(m.items.find((i) => i.id === "umbrella").why, "明日 08:00 降雨機率 60%（≥ 40% 建議）");
  assert.equal(m.items.find((i) => i.id === "jacket").why, "明日 08:00 體感 16°（≤ 18° 建議）");
  const eve = synth("2026-11-21", 10, 24, (h, k) => (!tomorrowKey(k) && h === 19 ? { rainProb: 60 } : {}));
  assert.equal(commuteModel(vmOfHours(eve), { out: 8, back: 19 }).headline, "傍晚回家會遇到雨", "BACK today keeps the plain word (OUT is tomorrow but dry)");
  const tmBack = synth("2026-11-21", 20, 24, (h, k) => (tomorrowKey(k) && h === 18 ? { rainProb: 60 } : {}));
  assert.equal(commuteModel(vmOfHours(tmBack), { out: 21, back: 18 }).headline, "明天傍晚回家會遇到雨");
});

test("m3: legs are shown chronologically (today's BACK before tomorrow's OUT) with their labels", () => {
  const hours = synth("2026-11-21", 10, 24);
  const m = commuteModel(vmOfHours(hours), { out: 8, back: 18 });
  assert.deepEqual(m.legs.map((l) => l.key), ["out", "back"], "model order is stable: out, back");
  assert.deepEqual(m.ordered.map((l) => l.key), ["back", "out"]);
  const html = commuteHtml(ready(vmOfHours(hours)), ui());
  assert.ok(html.indexOf('data-k="leg-back"') < html.indexOf('data-k="leg-out"'), "BACK first in the DOM");
  assert.match(html, /<span class="leg-name">BACK<\/span>/);
  assert.match(html, /<span class="leg-name">OUT 明日<\/span>/);
  // both today: OUT then BACK; both tomorrow: OUT then BACK
  const today = commuteModel(vmOfHours(synth("2026-11-21", 6, 24)), { out: 8, back: 18 });
  assert.deepEqual(today.ordered.map((l) => l.key), ["out", "back"]);
  const late = commuteModel(vmOfHours(synth("2026-11-21", 20, 30)), { out: 8, back: 18 });
  assert.deepEqual(late.ordered.map((l) => l.key), ["out", "back"]);
  // loading skeleton keeps the default order
  const loading = commuteHtml({ status: "loading", vm: null }, ui());
  assert.ok(loading.indexOf('data-k="leg-out"') < loading.indexOf('data-k="leg-back"'));
});

test("m3: tags show each leg's own value", () => {
  const tags = (f, commute = { out: 8, back: 18 }) => {
    const m = commuteModel(vmOfHours(synth("2026-11-21", 6, 30, f)), commute);
    return Object.fromEntries(m.items.map((i) => [i.id, i.tags]));
  };
  const feels = tags((h, k) => (!tomorrowKey(k) && h === 8 ? { feels: 16 } : h === 18 && !tomorrowKey(k) ? { feels: 14 } : {}));
  assert.deepEqual(feels.jacket, ["出門 08:00・體感 16°", "回家 18:00・體感 14°"]);
  const rain = tags((h, k) => (!tomorrowKey(k) && h === 18 ? { rainProb: 60 } : {}));
  assert.deepEqual(rain.umbrella, ["回家 18:00・降雨 60%"]);
  const mm = tags((h, k) => (!tomorrowKey(k) && h === 8 ? { rain: 0.84 } : {}));
  assert.deepEqual(mm.umbrella, ["出門 08:00・雨量 0.8 mm"]);
  const uv = tags((h) => (h === 11 ? { uv: 8 } : {}), { out: 11, back: 18 });
  assert.deepEqual(uv.sunscreen, ["出門 11:00・UV 8"]);
  const aqi = tags((h, k) => (!tomorrowKey(k) && h === 18 ? { aqi: 120 } : {}));
  assert.deepEqual(aqi.mask, ["回家 18:00・AQI 120"]);
  const pm = tags((h, k) => (!tomorrowKey(k) && h === 8 ? { pm25: 41.2 } : {}));
  assert.deepEqual(pm.mask, ["出門 08:00・PM2.5 41"]);
  const range = tags((h, k) => (!tomorrowKey(k) && h === 8 ? { temp: 20, feels: 20 } : !tomorrowKey(k) && h === 9 ? { temp: 27, feels: 27 } : {}));
  assert.deepEqual(range.jacket, ["出門 08:00・溫差 7°"], "a range inside one leg shows that leg's range");
  const swing = tags((h, k) => (!tomorrowKey(k) && h < 12 ? { temp: 20, feels: 20 } : { temp: 27, feels: 27 }));
  assert.deepEqual(swing.jacket, ["來回"], "only both legs together: 來回 without a value");
  assert.deepEqual(swing.umbrella, []);
});

test("n8: sunscreen off reason distinguishes no hour in 10-15 from low UV", () => {
  const sun = (commute) => commuteModel(vmOfHours(synth("2026-11-21", 6, 30)), commute).items.find((i) => i.id === "sunscreen");
  assert.equal(sun({ out: 8, back: 18 }).why, "通勤時段不在 10–15 時");
  assert.equal(sun({ out: 12, back: 18 }).why, "通勤時段紫外線低");
});

test("m7: PM2.5-only turns the mask item on with the PM2.5 headline; AQI >= 100 with the AQI one", () => {
  const pm = commuteModel(vmOfHours(synth("2026-11-21", 6, 30, (h) => (h === 8 ? { pm25: 40, aqi: 80 } : {}))), { out: 8, back: 18 });
  const mask = pm.items.find((i) => i.id === "mask");
  assert.equal(mask.on, true);
  assert.equal(mask.why, "PM2.5 偏高（40 µg/m³），敏感族群建議戴口罩");
  assert.equal(pm.headline, "PM2.5 偏高，敏感族群記得戴口罩");
  const aq = commuteModel(vmOfHours(synth("2026-11-21", 6, 30, (h) => (h === 8 ? { aqi: 120 } : {}))), { out: 8, back: 18 });
  assert.equal(aq.items.find((i) => i.id === "mask").why, "空氣品質差（AQI 120）");
  assert.equal(aq.headline, "空氣品質差，記得戴口罩");
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
  assert.ok(html.includes(workNote(null)));
  assert.match(html, /<label class="field-k" for="sel-out">出門時間<\/label>/);
  assert.match(html, /<label class="field-k" for="sel-back">回家時間<\/label>/);
  assert.equal((html.match(/<option /g) || []).length, 48);
  assert.match(html, /<option value="8" selected>08:00<\/option>/);
  assert.match(html, /<option value="18" selected>18:00<\/option>/);
  assert.equal((html.match(/class="warn"/g) || []).length, 1);
  assert.equal((html.match(/class="check-item/g) || []).length, 4);
  assert.match(html, /<span class="tag">回家 18:00・降雨 60%<\/span>/);
  assert.match(html, /data-k="item-umbrella"/);
  assert.doesNotMatch(html, /\sstyle=/, "CSP: no inline style attributes");
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("m4: both legs rainy -> one blinking !RAIN (the first in display order), the other static", () => {
  const wet = vmOfHours(synth("2026-11-21", 10, 24, () => ({ rainProb: 70 })));
  const html = commuteHtml(ready(wet), ui());
  assert.equal((html.match(/class="warn"/g) || []).length, 1, "exactly one blinking indicator");
  assert.equal((html.match(/class="warn warn--still"/g) || []).length, 1, "the other is static");
  assert.equal((html.match(/!RAIN/g) || []).length, 2, "both legs still say !RAIN");
  // OUT is tomorrow, BACK is today: BACK is displayed first and owns the blink
  assert.match(html, /data-k="leg-back">[\s\S]*?class="warn"[\s\S]*data-k="leg-out">[\s\S]*class="warn warn--still"/);
  // one wet leg: blinks as before
  const one = commuteHtml(ready(vmAt(NOW, rainy)), ui());
  assert.equal((one.match(/class="warn"/g) || []).length, 1);
  assert.doesNotMatch(one, /warn--still/);
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

test("n10: exerciseHtml renders the model it is given (computed once per render), not a fresh one", () => {
  const vm = vmAt(NOW);
  const model = exerciseModel(vm, NOW, null);
  const marked = { ...model, verdict: "SENTINEL-VERDICT", advice: "SENTINEL-ADVICE" };
  const html = exerciseHtml(ready(vm), ui({ exercise: marked }));
  assert.match(html, /SENTINEL-VERDICT/);
  assert.match(html, /SENTINEL-ADVICE/);
  assert.doesNotMatch(exerciseHtml(ready(vm), ui()), /SENTINEL/, "without ui.exercise it computes its own");
  assert.match(exerciseHtml({ status: "loading", vm: null }, ui({ exercise: marked })), /時間 無資料/, "never rendered while loading");
  assert.doesNotMatch(exerciseHtml({ status: "loading", vm: null }, ui({ exercise: marked })), /SENTINEL/);
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

test("chipsHtml: three links, one aria-current; 出遊 is an enabled link to #outing/trip", () => {
  const c = chipsHtml("exercise");
  assert.match(c, /<a class="key chip chip--commute" href="#outing\/commute">通勤<\/a>/);
  assert.match(c, /<a class="key chip chip--exercise" href="#outing\/exercise" aria-current="page">運動<\/a>/);
  assert.match(c, /<a class="key chip chip--trip" href="#outing\/trip">出遊<\/a>/);
  assert.equal((c.match(/aria-current/g) || []).length, 1);
  assert.doesNotMatch(c, /v2|aria-disabled/);
  assert.match(chipsHtml("trip"), /chip--trip" href="#outing\/trip" aria-current="page"/);
});

// ---- commute with a work place (M4)

const WORK_PLACE = { id: "p:24.80,120.97", name: "新竹", admin1: "新竹縣", lat: 24.8, lon: 120.97 };
const workEntry = (vm, status = "ready") => ({ status, vm, error: null, fetchedAt: NOW });
const workRainy = (f) => {
  for (const i of [42, 43]) {
    f.hourly.precipitation_probability[i] = 60;
    f.hourly.temperature_2m[i] = 27;
    f.hourly.apparent_temperature[i] = 29;
  }
};

test("commuteModel with a work place: BACK comes from the work place's hours, OUT from the current one", () => {
  const current = vmAt(NOW); // dry
  const work = vmAt(NOW, workRainy);
  const m = commuteModel(current, COMMUTE, { place: WORK_PLACE, entry: workEntry(work) });
  assert.equal(m.workState, "ready");
  const [out, back] = m.legs;
  assert.equal(out.label, "OUT");
  assert.equal(back.label, "BACK・新竹");
  assert.equal(back.warn, true);
  assert.equal(out.warn, false);
  assert.equal(back.hours[0].hourKey, work.hours.find((h) => h.hour === 18).hourKey);
  assert.equal(back.entry.temp, 27, "the BACK temperature is the work place's");
  assert.match(back.aria, /^回家 18:00，公司 新竹$/);
  const by = Object.fromEntries(m.items.map((i) => [i.id, i]));
  assert.deepEqual(by.umbrella.tags, ["回家 18:00・降雨 60%"], "the umbrella is triggered by the BACK leg only");
  assert.equal(m.headline, "傍晚回家會遇到雨");
  // the same current place without a work place: dry, both legs current
  const plain = commuteModel(current, COMMUTE);
  assert.equal(plain.legs[1].label, "BACK");
  assert.equal(plain.items.find((i) => i.id === "umbrella").on, false);
});

test("commuteModel: each leg is evaluated on its own place's hours (a leg's hours are not mixed)", () => {
  const current = vmAt(NOW, rainy); // rain 18-19 here
  const work = vmAt(NOW); // dry at work
  const m = commuteModel(current, { out: 18, back: 18 }, { place: WORK_PLACE, entry: workEntry(work) });
  assert.equal(m.legs[0].warn, true, "OUT at the current place is wet");
  assert.equal(m.legs[1].warn, false, "BACK at the work place is dry");
  assert.deepEqual(m.items.find((i) => i.id === "umbrella").tags, ["出門 18:00・降雨 60%"]);
  assert.equal(m.headline, "傍晚出門可能下雨", "the headline follows the per-leg items");
});

test("commuteModel: a work place that is loading or failed leaves OUT intact", () => {
  for (const [entry, state, detail, headline] of [
    [null, "loading", "載入中", "公司天氣載入中…"],
    [workEntry(null, "loading"), "loading", "載入中", "公司天氣載入中…"],
    [workEntry(null, "error"), "error", "無法取得資料", "公司天氣暫時無法取得"],
  ]) {
    const m = commuteModel(vmAt(NOW), COMMUTE, { place: WORK_PLACE, entry });
    assert.equal(m.workState, state);
    assert.equal(m.legs[1].detail, detail);
    assert.equal(m.legs[1].wx, "--");
    assert.equal(m.headline, headline);
    assert.ok(m.legs[0].entry, "OUT still shows the current place");
    assert.equal(m.legs[1].label, "BACK・新竹");
  }
});

test("commuteHtml: 設定公司地點 opens the picker in work mode; the note names the work place; errors offer a retry", () => {
  const state = { status: "ready", vm: vmAt(NOW), alert: null, fetchedAt: NOW, places: {} };
  const none = commuteHtml(state, ui());
  assert.match(none, /data-action="open-picker" data-mode="work">設定公司地點<\/button>/);
  assert.ok(none.includes(workNote(null)));
  assert.doesNotMatch(none, /M4 可設定/);
  const key = "om:v1:forecast:24.80,120.97";
  const withWork = commuteHtml({ ...state, places: { [key]: workEntry(vmAt(NOW, workRainy)) } }, ui({ work: WORK_PLACE }));
  assert.ok(withWork.includes("回家（BACK）使用公司地點：新竹"));
  assert.match(withWork, /<span class="leg-name">BACK・新竹<\/span>/);
  assert.match(withWork, /data-mode="work">設定公司地點/);
  const failed = commuteHtml({ ...state, places: { [key]: workEntry(null, "error") } }, ui({ work: WORK_PLACE }));
  assert.match(failed, /公司天氣暫時無法取得/);
  assert.match(failed, /data-action="retry-place" data-id="p:24\.80,120\.97">重試/);
  const hostile = commuteHtml(state, ui({ work: { ...WORK_PLACE, name: '<img src=x onerror="a">' } }));
  assert.doesNotMatch(hostile, /<img/);
});

test("outingHtml: stale banner, error card, no-hours notice", () => {
  const vm = vmAt(NOW);
  assert.match(outingHtml({ status: "stale", vm, fetchedAt: NOW }, ui()), /資料時間 14:20・無法更新/);
  const err = outingHtml({ status: "error", vm: null }, ui());
  assert.match(err, /data-action="retry"/);
  assert.match(err, /class="chips"/);
  assert.match(outingHtml({ status: "ready", vm: { ...vm, hoursAvailable: false, hours: [] }, fetchedAt: NOW }, ui()), /沒有逐時資料/);
});

// ---- picker scrolling (M2)

test("revealScrollLeft: scrolls just enough to show the bar plus margin, clamped to [0, max]", () => {
  const g = { clientWidth: 300, scrollWidth: 400, margin: 12 };
  assert.equal(revealScrollLeft({ ...g, scrollLeft: 50, left: 100, right: 126 }), 50, "already visible: unchanged");
  assert.equal(revealScrollLeft({ ...g, scrollLeft: 50, left: 5, right: 31 }), 43, "left ring clipped: scroll left by 7");
  assert.equal(revealScrollLeft({ ...g, scrollLeft: 50, left: -40, right: -14 }), 0, "Home: clamped at 0, never negative");
  assert.equal(revealScrollLeft({ ...g, scrollLeft: 0, left: 280, right: 306 }), 18, "right ring clipped: scroll right by 18");
  assert.equal(revealScrollLeft({ ...g, scrollLeft: 0, left: 600, right: 626 }), 100, "End: clamped at scrollWidth - clientWidth");
  assert.equal(revealScrollLeft({ clientWidth: 300, scrollWidth: 300, scrollLeft: 0, left: -50, right: -24 }), 0, "nothing to scroll");
});

test("css: .xbars pads >= 12px on top and both sides so the selection / focus ring is never clipped", () => {
  const css = readFileSync(new URL("../../css/app.css", import.meta.url), "utf8");
  const m = /\.xbars\s*\{[^}]*?padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s*;/.exec(css);
  assert.ok(m, ".xbars declares a three-value padding");
  assert.ok(Number(m[1]) >= 12 && Number(m[2]) >= 12, `top ${m[1]}px, sides ${m[2]}px`);
});

test("jacket from a temperature range across two different places says 兩地溫差大 (not 早晚溫差大); same place keeps 早晚", () => {
  // OUT at the current place 19 degrees, BACK at the work place 26 degrees: the 7 degree range is between places
  const cur = vmOfHours(synth("2026-11-21", 6, 30, () => ({ temp: 19, feels: 19 })));
  const work = vmOfHours(synth("2026-11-21", 6, 30, () => ({ temp: 26, feels: 26 })));
  const m = commuteModel(cur, COMMUTE, { place: WORK_PLACE, entry: workEntry(work) });
  assert.equal(m.items.find((i) => i.id === "jacket").on, true);
  assert.equal(m.headline, "兩地溫差大，記得帶外套");
  // the work place is the current place itself: one place, the plain wording
  const same = commuteModel(cur, COMMUTE, { place: WORK_PLACE, entry: workEntry(work), differs: false });
  assert.equal(same.headline, "早晚溫差大，記得帶外套");
  // no work place: the plain wording
  const hours = synth("2026-11-21", 10, 24, (h, k) => (tomorrowKey(k) ? { temp: 19, feels: 19 } : { temp: 26, feels: 26 }));
  assert.equal(commuteModel(vmOfHours(hours), COMMUTE).headline, "早晚溫差大，記得帶外套");
  // cold feels is not a between-places statement
  const cold = commuteModel(vmOfHours(synth("2026-11-21", 6, 30, () => ({ temp: 14, feels: 14 }))), COMMUTE, { place: WORK_PLACE, entry: workEntry(vmOfHours(synth("2026-11-21", 6, 30, () => ({ temp: 14, feels: 14 })))) });
  assert.equal(cold.headline, "氣溫偏低，記得帶外套");
});

test("commuteHtml: a work place that is not the current place gets the 兩地 wording; the work place being current does not", () => {
  const cur = vmOfHours(synth("2026-11-21", 6, 30, () => ({ temp: 19, feels: 19 })));
  const work = vmOfHours(synth("2026-11-21", 6, 30, () => ({ temp: 26, feels: 26 })));
  const key = "om:v1:forecast:24.80,120.97";
  const state = { status: "ready", vm: cur, current: "gps", places: { [key]: workEntry(work) } };
  assert.match(commuteHtml(state, ui({ work: WORK_PLACE })), /兩地溫差大，記得帶外套/);
  assert.match(commuteHtml({ ...state, current: WORK_PLACE.id }, ui({ work: WORK_PLACE })), /早晚溫差大，記得帶外套/);
});

test("commute checklist reasons say 通勤時段", () => {
  const m = commuteModel(vmOfHours(synth("2026-11-21", 6, 30)), COMMUTE);
  assert.equal(m.items.find((i) => i.id === "sunscreen").why, "通勤時段不在 10–15 時");
  assert.doesNotMatch(JSON.stringify(m.items), /出遊/);
});
