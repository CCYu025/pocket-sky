import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLACES_KEY, CURRENT_KEY, MAX_PLACES, placeId, placeFromSearchResult, placeLabel, emptyPlaces,
  readPlaces, writePlaces, addPlace, removePlace, setWork, setTrip, readCurrent, writeCurrent,
} from "../../js/app/places-state.js";

function mem(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), raw: (k) => m.get(k) };
}
const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
const mk = (i, extra = {}) => ({ name: `P${i}`, admin1: "A", country: "Taiwan", lat: 20 + i, lon: 120 + i, elevation: 10, timezone: "Asia/Taipei", ...extra });
const fill = (n) => {
  let s = emptyPlaces();
  for (let i = 1; i <= n; i++) s = addPlace(s, mk(i)).state;
  return s;
};

test("placeId rounds to 2 dp, handles negatives and -0", () => {
  assert.equal(placeId(24.1637, 120.6478), "p:24.16,120.65");
  assert.equal(placeId(-33.8688, -70.123), "p:-33.87,-70.12");
  assert.equal(placeId(-0, -0.001), "p:0.00,0.00");
  assert.equal(placeId(-0.004, 0), "p:0.00,0.00");
});

test("placeFromSearchResult maps and rounds", () => {
  const p = placeFromSearchResult({ name: "臺中市", admin1: "臺中市", country: "臺灣", lat: 24.1637, lon: 120.6478, elevation: 84, timezone: "Asia/Taipei", extra: 1 });
  assert.deepEqual(p, { id: "p:24.16,120.65", name: "臺中市", admin1: "臺中市", country: "臺灣", lat: 24.16, lon: 120.65, elevation: 84, timezone: "Asia/Taipei" });
});

test("placeFromSearchResult: nulls, -0 coordinates and invalid input", () => {
  const p = placeFromSearchResult({ name: "X", lat: -0.001, lon: -0.002 });
  assert.equal(p.id, "p:0.00,0.00");
  assert.ok(Object.is(p.lat, 0) && Object.is(p.lon, 0));
  assert.deepEqual([p.admin1, p.country, p.elevation, p.timezone], [null, null, null, null]);
  for (const bad of [null, 5, {}, { name: "", lat: 1, lon: 1 }, { name: "x", lat: NaN, lon: 1 }, { name: "x", lat: 91, lon: 1 }, { name: "x", lat: 1, lon: 181 }, { name: "x", lat: "1", lon: 1 }]) {
    assert.equal(placeFromSearchResult(bad), null);
  }
});

test("placeLabel: admin1 differing, equal and null", () => {
  assert.equal(placeLabel({ name: "日月潭", admin1: "南投縣" }), "日月潭・南投縣");
  assert.equal(placeLabel({ name: "臺中市", admin1: "臺中市" }), "臺中市");
  assert.equal(placeLabel({ name: "臺中市", admin1: null }), "臺中市");
});

test("addPlace dedupes by id, updates the name and moves to front", () => {
  const s = fill(3);
  const r = addPlace(s, mk(1, { name: "Renamed", lat: 21.001, lon: 120.999 }));
  assert.equal(r.error, null);
  assert.deepEqual(r.state.saved.map((p) => p.name), ["Renamed", "P3", "P2"]);
});

test("addPlace: newest first, max 5 evicts the oldest", () => {
  const s = fill(6);
  assert.equal(MAX_PLACES, 5);
  assert.deepEqual(s.saved.map((p) => p.name), ["P6", "P5", "P4", "P3", "P2"]);
});

test("addPlace: re-adding an existing place at the cap evicts nothing", () => {
  const s = fill(5);
  const r = addPlace(s, mk(2));
  assert.deepEqual(r.state.saved.map((p) => p.name), ["P2", "P5", "P4", "P3", "P1"]);
});

test("addPlace: eviction skips pinned work/trip places", () => {
  let s = fill(5); // P5..P1
  s = setWork(s, placeId(21, 121)); // P1, the oldest
  s = setTrip(s, placeId(22, 122)); // P2, second oldest
  const r = addPlace(s, mk(6));
  assert.equal(r.error, null);
  assert.deepEqual(r.state.saved.map((p) => p.name), ["P6", "P5", "P4", "P2", "P1"]); // P3 evicted
  assert.equal(r.state.workId, placeId(21, 121));
  assert.equal(r.state.tripId, placeId(22, 122));
});

test("addPlace: invalid place is rejected without changing state", () => {
  const s = fill(1);
  const r = addPlace(s, { name: "", lat: 1, lon: 1 });
  assert.equal(r.error, "invalid");
  assert.equal(r.state, s);
});

test("addPlace is pure", () => {
  const s = fill(2);
  const before = JSON.stringify(s);
  addPlace(s, mk(7));
  assert.equal(JSON.stringify(s), before);
});

test("removePlace clears work/trip references", () => {
  let s = fill(3);
  s = setTrip(setWork(s, placeId(23, 123)), placeId(23, 123));
  const r = removePlace(s, placeId(23, 123));
  assert.equal(r.saved.length, 2);
  assert.equal(r.workId, null);
  assert.equal(r.tripId, null);
  const keep = removePlace(setWork(s, placeId(21, 121)), placeId(22, 122));
  assert.equal(keep.workId, placeId(21, 121));
});

test("setWork / setTrip: null clears, unknown id gives null", () => {
  const s = fill(2);
  const id = s.saved[0].id;
  assert.equal(setWork(s, id).workId, id);
  assert.equal(setWork(setWork(s, id), null).workId, null);
  assert.equal(setWork(s, "p:1.00,1.00").workId, null);
  assert.equal(setTrip(s, id).tripId, id);
  assert.equal(setTrip(s, "nope").tripId, null);
});

test("read/write round trip with v1 schema", () => {
  const st = mem();
  const s = setTrip(setWork(fill(3), placeId(21, 121)), placeId(22, 122));
  assert.equal(writePlaces(st, s), true);
  assert.equal(JSON.parse(st.raw(PLACES_KEY)).v, 1);
  assert.deepEqual(readPlaces(st), s);
});

test("readPlaces: defaults and invalid storage", () => {
  assert.deepEqual(readPlaces(mem()), emptyPlaces());
  assert.deepEqual(readPlaces(undefined), emptyPlaces());
  assert.deepEqual(readPlaces(throwing), emptyPlaces());
  for (const raw of ["{nope", "null", "42", "[]", '"x"']) assert.deepEqual(readPlaces(mem({ [PLACES_KEY]: raw })), emptyPlaces(), raw);
});

test("readPlaces drops invalid and duplicate entries, caps at 5, nulls dangling refs", () => {
  const good = (i) => ({ id: "ignored", ...mk(i) });
  const raw = { v: 1, saved: [good(1), null, { name: "x" }, good(1), good(2), good(3), good(4), good(5), good(6)], workId: "p:99.00,99.00", tripId: "p:22.00,122.00" };
  const s = readPlaces(mem({ [PLACES_KEY]: JSON.stringify(raw) }));
  assert.deepEqual(s.saved.map((p) => p.name), ["P1", "P2", "P3", "P4", "P5"]);
  assert.equal(s.saved[0].id, "p:21.00,121.00"); // recomputed from coordinates
  assert.equal(s.workId, null);
  assert.equal(s.tripId, "p:22.00,122.00");
});

test("writePlaces never throws and reports failure", () => {
  assert.equal(writePlaces(throwing, emptyPlaces()), false);
  assert.equal(writePlaces(undefined, emptyPlaces()), false);
});

test("current place: default, round trip and invalid values", () => {
  assert.equal(readCurrent(mem()), "gps");
  assert.equal(readCurrent(undefined), "gps");
  assert.equal(readCurrent(throwing), "gps");
  const st = mem();
  writeCurrent(st, "p:24.16,120.65");
  assert.equal(st.raw(CURRENT_KEY), "p:24.16,120.65");
  assert.equal(readCurrent(st), "p:24.16,120.65");
  writeCurrent(st, "p:-33.87,-70.12");
  assert.equal(readCurrent(st), "p:-33.87,-70.12");
  writeCurrent(st, "gps");
  assert.equal(readCurrent(st), "gps");
  for (const bad of ["", "home", "p:1,2", "p:24.16;120.65", 5, null]) {
    writeCurrent(st, bad);
    assert.equal(st.raw(CURRENT_KEY), "gps", String(bad));
  }
  assert.equal(readCurrent(mem({ [CURRENT_KEY]: "zzz" })), "gps");
  assert.doesNotThrow(() => writeCurrent(throwing, "gps"));
});
