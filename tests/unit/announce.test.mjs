import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnnouncer, createDebouncedAnnouncer, createOutingAnnouncer, STALE_TEXT } from "../../js/ui/announce.js";
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

/** Manual timers: `advance(ms)` fires what is due. */
function fakeTimers() {
  let now = 0;
  let id = 0;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => { pending.set(++id, { at: now + ms, fn }); return id; },
    clearTimer: (i) => pending.delete(i),
    advance(ms) {
      now += ms;
      for (const [k, t] of [...pending]) if (t.at <= now) { pending.delete(k); t.fn(); }
    },
    pending: () => pending.size,
  };
}

test("debounced announcer: trailing edge, last message wins, 500 ms quiet period", () => {
  const t = fakeTimers();
  const out = [];
  const d = createDebouncedAnnouncer({ write: (m) => out.push(m), setTimer: t.setTimer, clearTimer: t.clearTimer });
  d.say("a");
  t.advance(499);
  assert.deepEqual(out, []);
  d.say("b"); // restarts the quiet period
  t.advance(499);
  assert.deepEqual(out, []);
  d.say("c");
  t.advance(500);
  assert.deepEqual(out, ["c"]);
  t.advance(5000);
  assert.deepEqual(out, ["c"], "nothing repeats");
  assert.equal(t.pending(), 0);
});

test("debounced announcer: ignores empty messages, cancel drops the pending one, delay is configurable", () => {
  const t = fakeTimers();
  const out = [];
  const d = createDebouncedAnnouncer({ write: (m) => out.push(m), delay: 100, setTimer: t.setTimer, clearTimer: t.clearTimer });
  d.say(null);
  d.say("");
  d.say(undefined);
  assert.equal(t.pending(), 0);
  d.say("x");
  d.cancel();
  t.advance(1000);
  assert.deepEqual(out, []);
  d.say("y");
  t.advance(100);
  assert.deepEqual(out, ["y"]);
  d.say("z"); // a ready-after-fire announcer works again
  t.advance(100);
  assert.deepEqual(out, ["y", "z"]);
});

test("outing announcer: silent on load, announces scenario changes and user-picked hours only", () => {
  const a = createOutingAnnouncer();
  const sel = (key, picked = false) => ({ key, text: `${key} text`, picked });
  assert.equal(a.next({ scenario: "commute" }), null, "first call (page load)");
  assert.equal(a.next({ scenario: "commute" }), null, "re-render");
  assert.equal(a.next({ scenario: "exercise", selection: sel("21") }), "外出：運動");
  assert.equal(a.next({ scenario: "exercise", selection: sel("21") }), null, "same selection");
  assert.equal(a.next({ scenario: "exercise", selection: sel("22") }), null, "default (best) moved with new data: silent");
  assert.equal(a.next({ scenario: "exercise", selection: sel("19", true) }), "19 text");
  assert.equal(a.next({ scenario: "exercise", selection: sel("19", true) }), null, "unchanged");
  assert.equal(a.next({ scenario: "exercise", selection: null }), null, "data went away");
  assert.equal(a.next({ scenario: "commute" }), "外出：通勤");
  assert.equal(a.next({ scenario: "trip" }), "外出：出遊");
  assert.equal(a.next({ scenario: "commute" }), "外出：通勤");
  assert.equal(a.next({ scenario: null }), null, "left the screen");
  assert.equal(a.next({ scenario: "commute" }), "外出：通勤", "coming back announces again");
});

test("outing announcer: a page load straight into exercise is silent", () => {
  const a = createOutingAnnouncer();
  assert.equal(a.next({ scenario: "exercise", selection: { key: "k", text: "t", picked: false } }), null);
  assert.equal(a.next({ scenario: "exercise", selection: { key: "k2", text: "t2", picked: true } }), "t2");
});
