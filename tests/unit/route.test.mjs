import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, scenarioHref } from "../../js/ui/route.js";

test("today is the default and the fallback for unknown hashes", () => {
  for (const h of ["", "#", "#today", "#nope", "#outing2", "#outings", "#/outing", undefined, null]) {
    assert.deepEqual(parseRoute(h), { name: "today", scenario: null, key: "today" }, String(h));
  }
});

test("#outing opens the last used scenario (default commute)", () => {
  assert.deepEqual(parseRoute("#outing"), { name: "outing", scenario: "commute", key: "outing/commute" });
  assert.equal(parseRoute("#outing", "exercise").scenario, "exercise");
  assert.equal(parseRoute("#outing/", "exercise").scenario, "exercise", "trailing slash");
  assert.equal(parseRoute("#outing", "trip").scenario, "trip", "出遊 can be the last used scenario");
  assert.equal(parseRoute("#outing", "nonsense").scenario, "commute", "an invalid last scenario falls back to commute");
});

test("explicit scenarios win over the last used one; unknown ones fall back to it", () => {
  assert.deepEqual(parseRoute("#outing/exercise", "commute"), { name: "outing", scenario: "exercise", key: "outing/exercise" });
  assert.equal(parseRoute("#outing/commute", "exercise").scenario, "commute");
  assert.deepEqual(parseRoute("#outing/trip", "exercise"), { name: "outing", scenario: "trip", key: "outing/trip" });
  assert.equal(parseRoute("#outing/nonsense/more", "exercise").name, "today");
  assert.equal(parseRoute("#outing/", undefined).scenario, "commute");
});

test("scenarioHref builds chip links", () => {
  assert.equal(scenarioHref("commute"), "#outing/commute");
  assert.equal(scenarioHref("exercise"), "#outing/exercise");
  assert.equal(scenarioHref("trip"), "#outing/trip");
});
