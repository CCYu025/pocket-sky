import { test } from "node:test";
import assert from "node:assert/strict";
import { searchVariants, searchWithFallback, isTaiwan, MAX_RESULTS } from "../../js/domain/place-search.js";

const r = (name, lat, lon, country = "Japan") => ({ name, admin1: null, country, lat, lon, elevation: null, timezone: null });

test("searchVariants: 台 gives the 臺 variant first", () => {
  assert.deepEqual(searchVariants("台中"), ["臺中", "台中"]);
  assert.deepEqual(searchVariants(" 台北台南 "), ["臺北臺南", "台北台南"]);
});

test("searchVariants: unique, trimmed, no invented variants", () => {
  assert.deepEqual(searchVariants("  Taichung "), ["Taichung"]);
  assert.deepEqual(searchVariants("臺中"), ["臺中"]);
  assert.deepEqual(searchVariants("日月潭"), ["日月潭"]);
  assert.deepEqual(searchVariants(""), []);
  assert.deepEqual(searchVariants("   "), []);
  assert.deepEqual(searchVariants(undefined), []);
});

test("empty query never calls search", async () => {
  let calls = 0;
  const search = async () => (calls++, []);
  assert.deepEqual(await searchWithFallback("  ", search), { results: [], usedQuery: "" });
  assert.equal(calls, 0);
});

test("calls variants in order and stops at the first non-empty", async () => {
  const calls = [];
  const search = async (q) => (calls.push(q), q === "臺中" ? [r("臺中市", 24.16, 120.64, "臺灣")] : [r("x", 1, 1)]);
  const out = await searchWithFallback("台中", search);
  assert.deepEqual(calls, ["臺中"]);
  assert.equal(out.usedQuery, "臺中");
  assert.equal(out.results.length, 1);
});

test("falls through empty variants to the next", async () => {
  const calls = [];
  const search = async (q) => (calls.push(q), q === "台中" ? [r("A", 2, 2)] : []);
  const out = await searchWithFallback("台中", search);
  assert.deepEqual(calls, ["臺中", "台中"]);
  assert.equal(out.usedQuery, "台中");
});

test("all variants empty: usedQuery is the last tried", async () => {
  assert.deepEqual(await searchWithFallback("台中", async () => []), { results: [], usedQuery: "台中" });
  assert.deepEqual(await searchWithFallback("zzz", async () => null), { results: [], usedQuery: "zzz" });
});

test("results without usable coordinates count as empty", async () => {
  const calls = [];
  const search = async (q) => (calls.push(q), q === "臺中" ? [{ name: "bad", lat: null, lon: null }] : [r("ok", 3, 3)]);
  const out = await searchWithFallback("台中", search);
  assert.deepEqual(calls, ["臺中", "台中"]);
  assert.equal(out.results[0].name, "ok");
});

test("search rejection propagates", async () => {
  await assert.rejects(searchWithFallback("台中", async () => { throw new Error("net"); }), /net/);
});

test("dedupes by 2-dp id keeping the first", async () => {
  const out = await searchWithFallback("x", async () => [r("A", 24.161, 120.641), r("B", 24.164, 120.644), r("C", 24.2, 120.6)]);
  assert.deepEqual(out.results.map((x) => x.name), ["A", "C"]);
});

test("Taiwan results first, stable otherwise", async () => {
  const input = [r("J1", 1, 1), r("T1", 2, 2, "Taiwan"), r("J2", 3, 3), r("T2", 4, 4, "臺灣"), r("T3", 5, 5, "台灣"), r("T4", 6, 6, "台湾")];
  const out = await searchWithFallback("x", async () => input);
  assert.deepEqual(out.results.map((x) => x.name), ["T1", "T2", "T3", "T4", "J1", "J2"]);
  assert.equal(isTaiwan({ country: "Taiwan" }), true);
  assert.equal(isTaiwan({ country: "Japan" }), false);
  assert.equal(isTaiwan(null), false);
});

test("limited to 8 after ordering", async () => {
  const input = Array.from({ length: 10 }, (_, i) => r(`J${i}`, i + 1, 1));
  input.push(r("TW", 50, 50, "Taiwan"));
  const out = await searchWithFallback("x", async () => input);
  assert.equal(MAX_RESULTS, 8);
  assert.equal(out.results.length, 8);
  assert.equal(out.results[0].name, "TW");
});
