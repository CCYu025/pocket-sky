import { test } from "node:test";
import assert from "node:assert/strict";
import { ALERTS_KEY, readAlertState, recordShown, recordDismissed, recordInheritedDismissal } from "../../js/app/alert-state.js";

function mem() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}
const NOW = Date.UTC(2026, 10, 21, 6, 20);
const A = { id: "tempDrop:2026-11-21T17:00", kind: "tempDrop" };
const B = { id: "tempDrop:2026-11-21T18:00", kind: "tempDrop", continuation: true, continues: A.id };

test("a continuation replaces lastShownId but does not restart the cooldown", () => {
  const st = mem();
  let s = readAlertState(st, "2026-11-21", NOW);
  s = recordShown(st, s, A, NOW);
  s = recordShown(st, s, B, NOW + 3600e3);
  assert.equal(s.lastShownId.tempDrop, B.id);
  assert.equal(s.lastShown.tempDrop, NOW);
  const back = readAlertState(st, "2026-11-21", NOW + 3600e3);
  assert.equal(back.lastShown.tempDrop, NOW);
  assert.equal(back.lastShownId.tempDrop, B.id);
});

test("a genuinely new event restarts the cooldown", () => {
  const st = mem();
  let s = recordShown(st, readAlertState(st, "2026-11-21", NOW), A, NOW);
  s = recordShown(st, s, { id: "tempDrop:2026-11-21T22:00", kind: "tempDrop" }, NOW + 5 * 3600e3);
  assert.equal(s.lastShown.tempDrop, NOW + 5 * 3600e3);
});

test("inherited dismissal records the new id as dismissed and as lastShownId", () => {
  const st = mem();
  let s = recordShown(st, readAlertState(st, "2026-11-21", NOW), A, NOW);
  s = recordDismissed(st, s, A.id);
  s = recordInheritedDismissal(st, s, B);
  const back = readAlertState(st, "2026-11-21", NOW);
  assert.equal(back.dismissed[B.id], true);
  assert.equal(back.dismissed[A.id], true);
  assert.equal(back.lastShownId.tempDrop, B.id);
  assert.equal(back.lastShown.tempDrop, NOW);
  assert.ok(st.getItem(ALERTS_KEY));
});
