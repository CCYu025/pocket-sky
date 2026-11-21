import { test } from "node:test";
import assert from "node:assert/strict";
import { initialPicker, pickerReduce, pickerModel, pickerHtml, liveText, entryOf, SEARCH_ERROR } from "../../js/ui/views/places.js";
import { emptyPlaces, addPlace, setWork, setTrip } from "../../js/app/places-state.js";

const lake = { name: "日月潭", admin1: "南投縣", country: "臺灣", lat: 23.87, lon: 120.91, elevation: 748, timezone: "Asia/Taipei" };
const hsinchu = { name: "新竹", admin1: "新竹縣", country: "臺灣", lat: 24.8, lon: 120.97, elevation: 31, timezone: null };
const places = () => {
  let st = emptyPlaces();
  st = addPlace(st, hsinchu).state;
  st = addPlace(st, lake).state;
  return st;
};

test("reducer: open resets and validates the mode", () => {
  const s = pickerReduce({ ...initialPicker("trip"), query: "x", status: "done" }, { type: "open", mode: "work" });
  assert.deepEqual(s, initialPicker("work"));
  assert.equal(initialPicker("bogus").mode, "current");
});

test("reducer: typing keeps results until the query is emptied; an empty query clears everything", () => {
  let s = initialPicker();
  s = pickerReduce(s, { type: "done", results: [lake], usedQuery: "日月潭" });
  s = pickerReduce(s, { type: "query", value: "日月" });
  assert.equal(s.results.length, 1);
  assert.equal(s.query, "日月");
  s = pickerReduce(s, { type: "query", value: "   " });
  assert.deepEqual([s.status, s.results.length, s.usedQuery, s.message], ["idle", 0, "", ""]);
});

test("reducer: search lifecycle and messages; the input state is never mutated", () => {
  const s0 = initialPicker();
  const frozen = Object.freeze({ ...s0, results: Object.freeze([]) });
  const s1 = pickerReduce(frozen, { type: "search" });
  assert.equal(s1.status, "searching");
  const s2 = pickerReduce(s1, { type: "done", results: [lake], usedQuery: "日月潭" });
  assert.deepEqual([s2.status, s2.results.length], ["done", 1]);
  const s3 = pickerReduce(s2, { type: "say", text: "已加入 日月潭" });
  assert.equal(s3.message, "已加入 日月潭");
  assert.equal(pickerReduce(s3, { type: "search" }).message, "", "a new search clears the action message");
  assert.equal(pickerReduce(s3, { type: "query", value: "a" }).message, "");
  const e = pickerReduce(s2, { type: "error" });
  assert.deepEqual([e.status, e.results.length], ["error", 0]);
  assert.equal(pickerReduce(s0, { type: "unknown" }), s0);
});

test("liveText: message first, then status; counts and the inline error", () => {
  const base = initialPicker();
  assert.equal(liveText(base), "");
  assert.equal(liveText({ ...base, status: "searching" }), "搜尋中…");
  assert.equal(liveText({ ...base, status: "done", results: [lake, hsinchu], usedQuery: "x" }), "找到 2 個地點");
  assert.equal(liveText({ ...base, status: "done", results: [], usedQuery: "花蓮市" }), "找不到「花蓮市」");
  assert.equal(liveText({ ...base, status: "error" }), SEARCH_ERROR);
  assert.equal(SEARCH_ERROR, "搜尋失敗，請稍後再試");
  assert.equal(liveText({ ...base, status: "error", message: "已刪除 X" }), "已刪除 X");
});

test("pickerModel: saved rows carry current / work / trip flags; results know whether they are saved", () => {
  let st = places();
  const lakeId = st.saved[0].id;
  st = setTrip(setWork(st, st.saved[1].id), lakeId);
  const m = pickerModel({ ...initialPicker("work"), status: "done", results: [lake, { name: "花蓮市", lat: 23.98, lon: 121.6, admin1: "花蓮縣", country: "臺灣" }], usedQuery: "x" }, st, lakeId);
  assert.equal(m.title, "設定公司地點");
  assert.deepEqual(m.saved.map((p) => [p.label, p.current, p.work, p.trip]), [["日月潭・南投縣", true, false, true], ["新竹・新竹縣", false, true, false]]);
  assert.equal(m.saved[0].sub, "海拔 748 m", "admin1 is in the label, not repeated in the sub line");
  assert.ok(!m.results[1].sub.includes("花蓮縣"), "nor in a result row");
  assert.deepEqual(m.results.map((r) => [r.label, r.saved]), [["日月潭・南投縣", true], ["花蓮市・花蓮縣", false]]);
  assert.equal(m.count, "已儲存 2 / 5");
  assert.equal(m.gpsCurrent, false);
  assert.equal(pickerModel(initialPicker(), st, "gps").gpsCurrent, true);
});

test("pickerModel: the empty-result hint shows only for a CJK query", () => {
  const empty = (q) => pickerModel({ ...initialPicker(), status: "done", results: [], usedQuery: q, query: q }, emptyPlaces(), "gps").hint;
  assert.deepEqual(empty("花蓮市"), ["試試英文名稱，例如 Taichung", "或加上「市」，例如 花蓮市"]);
  assert.deepEqual(empty("Hualienx"), []);
  assert.deepEqual(pickerModel({ ...initialPicker(), status: "done", results: [lake], usedQuery: "日月潭", query: "日月潭" }, emptyPlaces(), "gps").hint, []);
});

test("pickerHtml: real buttons with accessible names, pressed state, keyed blocks, 44px-class keys", () => {
  let st = places();
  st = setWork(st, st.saved[1].id);
  const m = pickerModel({ ...initialPicker("current"), status: "done", results: [lake, { ...hsinchu, name: "竹北", lat: 24.83, lon: 121.0 }], usedQuery: "x" }, st, st.saved[0].id);
  const html = pickerHtml(m);
  const id = st.saved[0].id;
  assert.match(html, new RegExp(`data-action="pk-use" data-id="${id}" aria-pressed="true" aria-label="目前位置：日月潭・南投縣">目前</button>`));
  assert.match(html, /data-action="pk-work" data-id="p:24\.80,120\.97" aria-pressed="true" aria-label="公司地點：新竹・新竹縣">公司<\/button>/);
  assert.match(html, /data-action="pk-trip" data-id="p:24\.80,120\.97" aria-pressed="false" aria-label="出遊地點：新竹・新竹縣">出遊<\/button>/);
  assert.match(html, /data-action="pk-del" data-id="p:23\.87,120\.91" aria-label="刪除 日月潭・南投縣">刪除<\/button>/);
  assert.match(html, /data-action="pk-use" data-id="gps" aria-pressed="false" aria-label="目前位置：使用裝置定位">/);
  // results: the saved one has no add button, the other does
  assert.match(html, /已儲存<\/span>/);
  assert.match(html, /data-action="pk-add" data-i="1" aria-label="加入 竹北・新竹縣（臺灣・海拔 31 m）">加入/);
  assert.doesNotMatch(html, /data-action="pk-add" data-i="0"/);
  // search field: labelled, type=search, a single persistent live node
  assert.match(html, /<label for="pk-q" class="pk-label">搜尋地點<\/label><input type="search" id="pk-q"/);
  assert.equal((html.match(/aria-live="polite"/g) || []).length, 1);
  assert.match(html, /<p class="pk-live" id="pk-live" data-k="pk-live" aria-live="polite" aria-atomic="true">找到 2 個地點<\/p>/);
  assert.match(html, /<h2 id="pk-title">選擇地點<\/h2>/);
  assert.doesNotMatch(html, /style=/);
  // the mode's own key is the accent key
  assert.match(pickerHtml(pickerModel(initialPicker("work"), st, "gps")), /pk-btn pk-btn--main" data-action="pk-work"/);
  assert.match(pickerHtml(pickerModel(initialPicker("trip"), st, "gps")), /pk-btn pk-btn--main" data-action="pk-trip"/);
});

test("pickerHtml: empty saved list message and escaping of API strings", () => {
  const html = pickerHtml(pickerModel(initialPicker(), emptyPlaces(), "gps"));
  assert.match(html, /尚未儲存地點/);
  const evil = { name: '<script>x</script>"', admin1: "<b>", country: "&", lat: 1, lon: 2 };
  const h2 = pickerHtml(pickerModel({ ...initialPicker(), status: "done", results: [evil], usedQuery: "q" }, emptyPlaces(), "gps"));
  assert.doesNotMatch(h2, /<script>/);
  assert.match(h2, /&lt;script&gt;/);
  assert.match(h2, /&lt;b&gt;/);
});

test("entryOf finds a place's controller entry by its forecast cache key", () => {
  const entry = { status: "ready", vm: {}, error: null, fetchedAt: 1 };
  const state = { places: { "om:v1:forecast:23.87,120.91": entry } };
  assert.equal(entryOf(state, { lat: 23.87, lon: 120.91 }), entry);
  assert.equal(entryOf(state, { lat: 23.8704, lon: 120.9104 }), entry, "2-dp rounding like the cache key");
  assert.equal(entryOf(state, { lat: 1, lon: 1 }), null);
  assert.equal(entryOf(state, null), null);
  assert.equal(entryOf({}, { lat: 1, lon: 1 }), null);
});

test("lead text says 今天 (not Today); the not-found text names what the user typed", () => {
  assert.match(pickerModel(initialPicker("current"), emptyPlaces(), "gps").lead, /今天/);
  for (const m of ["current", "work", "trip"]) assert.doesNotMatch(pickerModel(initialPicker(m), emptyPlaces(), "gps").lead, /Today/);
  let s = pickerReduce(initialPicker(), { type: "done", results: [], usedQuery: "花蓮市", query: "花蓮" });
  assert.equal(s.searched, "花蓮");
  assert.equal(liveText(s), "找不到「花蓮」");
  assert.equal(liveText(pickerReduce(initialPicker(), { type: "done", results: [], usedQuery: "x" })), "找不到「x」", "older callers without `query`");
  s = pickerReduce(s, { type: "query", value: "" });
  assert.equal(s.searched, "");
});
