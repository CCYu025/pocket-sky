import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnnouncer, STALE_TEXT } from "../../js/ui/announce.js";
import { ERROR_TEXT } from "../../js/ui/views/today.js";

const vm = { now: {} };
const alert = (id, title = "16:00 起可能下雨") => ({ id, title, detail: "降雨機率 70%" });

test("silent for plain ready renders and ticks", () => {
  const a = createAnnouncer();
  assert.equal(a.next({ status: "loading", vm: null, alert: null }), null);
  assert.equal(a.next({ status: "ready", vm, alert: null }), null);
  assert.equal(a.next({ status: "ready", vm, alert: null }), null);
});

test("an alert is announced once; re-renders and refreshes stay silent; a new id announces again", () => {
  const a = createAnnouncer();
  const s1 = { status: "ready", vm, alert: alert("rainJump:2026-11-21T16:00") };
  assert.equal(a.next(s1), "16:00 起可能下雨");
  assert.equal(a.next(s1), null);
  assert.equal(a.next({ ...s1, status: "stale" }), STALE_TEXT, "only the stale change speaks");
  assert.equal(a.next({ ...s1 }), null);
  assert.equal(a.next({ status: "ready", vm, alert: null }), null, "dismissal is silent");
  assert.equal(a.next({ status: "ready", vm, alert: alert("rainJump:2026-11-21T18:00", "18:00 起可能下雨") }), "18:00 起可能下雨");
});

test("stale is announced on entering, not while it persists, and again after recovery", () => {
  const a = createAnnouncer();
  assert.equal(a.next({ status: "stale", vm, alert: null }), STALE_TEXT);
  assert.equal(a.next({ status: "stale", vm, alert: null }), null);
  assert.equal(a.next({ status: "ready", vm, alert: null }), null);
  assert.equal(a.next({ status: "stale", vm, alert: null }), STALE_TEXT);
});

test("error text is announced once per error state", () => {
  const a = createAnnouncer();
  assert.equal(a.next({ status: "error", vm: null, alert: null }), ERROR_TEXT);
  assert.equal(a.next({ status: "error", vm: null, alert: null }), null);
  assert.equal(a.next({ status: "loading", vm: null, alert: null }), null);
  assert.equal(a.next({ status: "error", vm: null, alert: null }), ERROR_TEXT);
});

test("alert and stale together are joined in one message", () => {
  const a = createAnnouncer();
  assert.equal(a.next({ status: "stale", vm, alert: alert("x:2026-11-21T16:00", "T") }), `T。${STALE_TEXT}`);
});

test("a continuation (same event moved) is silent, and is not announced again afterwards", () => {
  const a = createAnnouncer();
  assert.equal(a.next({ status: "ready", vm, alert: alert("rainJump:2026-11-21T16:00") }), "16:00 起可能下雨");
  const moved = { ...alert("rainJump:2026-11-21T15:00", "15:00 起可能下雨"), continuation: true, continues: "rainJump:2026-11-21T16:00" };
  assert.equal(a.next({ status: "ready", vm, alert: moved }), null);
  const settled = { ...moved, continuation: undefined, continues: undefined };
  assert.equal(a.next({ status: "ready", vm, alert: settled }), null);
  assert.equal(a.next({ status: "ready", vm, alert: alert("rainJump:2026-11-21T20:00", "20:00 起可能下雨") }), "20:00 起可能下雨");
});
