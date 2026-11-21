import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTING_KEY, DEFAULT_OUTING, readOuting, writeOuting } from "../../js/app/outing-state.js";

function mem(initial) {
  const m = new Map(initial === undefined ? [] : [[OUTING_KEY, initial]]);
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), raw: () => m.get(OUTING_KEY) };
}
const DEFAULTS = { scenario: "commute", commute: { out: 8, back: 18 }, trip: { start: 9, end: 16 } };
const T = { start: 9, end: 16 };

test("defaults when nothing is stored", () => {
  assert.deepEqual(readOuting(mem()), DEFAULTS);
  assert.deepEqual(DEFAULT_OUTING, DEFAULTS);
});

test("read returns fresh copies, not the frozen default", () => {
  const a = readOuting(mem());
  a.commute.out = 5;
  assert.equal(readOuting(mem()).commute.out, 8);
});

test("round trip", () => {
  const st = mem();
  writeOuting(st, { scenario: "exercise", commute: { out: 7, back: 0 } });
  assert.deepEqual(readOuting(st), { scenario: "exercise", commute: { out: 7, back: 0 }, trip: T });
  writeOuting(st, { scenario: "trip", commute: { out: 7, back: 0 }, trip: { start: 6, end: 22 } });
  assert.deepEqual(readOuting(st), { scenario: "trip", commute: { out: 7, back: 0 }, trip: { start: 6, end: 22 } });
});

test("invalid JSON and non-object values fall back to defaults", () => {
  for (const raw of ["{nope", "null", "42", '"x"', "[]"]) assert.deepEqual(readOuting(mem(raw)), DEFAULTS, raw);
});

test("invalid fields fall back individually", () => {
  assert.deepEqual(readOuting(mem(JSON.stringify({ scenario: "v2", commute: { out: 6, back: 24 } }))), { scenario: "commute", commute: { out: 6, back: 18 }, trip: T });
  assert.deepEqual(readOuting(mem(JSON.stringify({ scenario: "trip", trip: { start: 7, end: 24 } }))).trip, { start: 7, end: 16 });
  assert.deepEqual(readOuting(mem(JSON.stringify({ scenario: "trip", trip: { start: "7", end: -1 } }))).trip, T);
  assert.deepEqual(readOuting(mem(JSON.stringify({ scenario: "trip", trip: null }))).trip, T);
  assert.deepEqual(readOuting(mem(JSON.stringify({ scenario: "exercise", commute: { out: "7", back: 9.5 } }))), { scenario: "exercise", commute: { out: 8, back: 18 }, trip: T });
  assert.deepEqual(readOuting(mem(JSON.stringify({ scenario: "exercise", commute: { out: -1, back: 23 } }))), { scenario: "exercise", commute: { out: 8, back: 23 }, trip: T });
  assert.deepEqual(readOuting(mem(JSON.stringify({ scenario: "exercise", commute: null }))), { scenario: "exercise", commute: { out: 8, back: 18 }, trip: T });
});

test("write validates before storing", () => {
  const st = mem();
  writeOuting(st, { scenario: "bogus", commute: { out: 99, back: 17 } });
  assert.deepEqual(JSON.parse(st.raw()), { scenario: "commute", commute: { out: 8, back: 17 }, trip: T });
});

test("throwing or missing storage never throws", () => {
  const bad = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  assert.deepEqual(readOuting(bad), DEFAULTS);
  assert.doesNotThrow(() => writeOuting(bad, DEFAULTS));
  assert.deepEqual(readOuting(undefined), DEFAULTS);
  assert.doesNotThrow(() => writeOuting(undefined, DEFAULTS));
});
