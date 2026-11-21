import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnimTracker } from "../../js/ui/anim.js";

const today = (o = {}) => ({ route: "today", hasData: true, alertId: null, ...o });

test("boot starts with the first render that has data and stays on (no replay on refresh)", () => {
  const t = createAnimTracker();
  assert.equal(t.next(today({ hasData: false })).boot, false, "loading render: no boot yet");
  assert.equal(t.next(today()).boot, true, "first ready render");
  for (let i = 0; i < 3; i++) assert.equal(t.next(today()).boot, true, "class stays; elements are kept, so nothing replays");
});

test("boot is per route visit: leaving and coming back runs it again, outing never boots", () => {
  const t = createAnimTracker();
  t.next(today());
  assert.equal(t.next({ route: "outing", hasData: false, alertId: null }).boot, false);
  assert.equal(t.next(today({ hasData: false })).boot, false);
  assert.equal(t.next(today()).boot, true);
});

test("shake restarts only when a new alert id appears", () => {
  const t = createAnimTracker();
  const a = t.next(today({ alertId: "rainJump:2026-11-21T16:00" }));
  assert.deepEqual([a.shake, a.restartShake], [true, true]);
  const again = t.next(today({ alertId: "rainJump:2026-11-21T16:00" }));
  assert.deepEqual([again.shake, again.restartShake], [true, false], "same id on a refresh: no restart");
  const gone = t.next(today());
  assert.deepEqual([gone.shake, gone.restartShake], [false, false]);
  const back = t.next(today({ alertId: "rainJump:2026-11-21T16:00" }));
  assert.equal(back.restartShake, false, "the same id never shakes twice");
  const other = t.next(today({ alertId: "tempDrop:2026-11-21T17:00" }));
  assert.equal(other.restartShake, true, "a different event shakes");
});

test("revisiting the route with the same alert does not shake", () => {
  const t = createAnimTracker();
  t.next(today({ alertId: "a:2026-11-21T16:00" }));
  t.next({ route: "outing", hasData: false, alertId: "a:2026-11-21T16:00" });
  const r = t.next(today({ alertId: "a:2026-11-21T16:00" }));
  assert.deepEqual([r.shake, r.restartShake], [false, false]);
});

test("a continuation alert id does not restart the shake", () => {
  const t = createAnimTracker();
  assert.equal(t.next({ route: "today", hasData: true, alertId: "a:1" }).restartShake, true);
  assert.equal(t.next({ route: "today", hasData: true, alertId: "a:2", continuation: true }).restartShake, false);
  assert.equal(t.next({ route: "today", hasData: true, alertId: "a:2" }).restartShake, false);
  assert.equal(t.next({ route: "today", hasData: true, alertId: "a:9" }).restartShake, true);
});
