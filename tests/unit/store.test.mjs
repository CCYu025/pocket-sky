import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../../js/store.js";

test("get returns initial state; defaults to empty object", () => {
  assert.deepEqual(createStore({ a: 1 }).get(), { a: 1 });
  assert.deepEqual(createStore().get(), {});
});

test("initial object is not mutated by set", () => {
  const initial = { a: 1 };
  const s = createStore(initial);
  s.set({ a: 2 });
  assert.equal(initial.a, 1);
});

test("set shallow-merges", () => {
  const s = createStore({ a: 1, nested: { x: 1, y: 2 } });
  s.set({ b: 2 });
  assert.deepEqual(s.get(), { a: 1, b: 2, nested: { x: 1, y: 2 } });
  s.set({ nested: { z: 3 } });
  assert.deepEqual(s.get().nested, { z: 3 });
});

test("subscribers are notified synchronously with new state, once per set", () => {
  const s = createStore({ n: 0 });
  const seen = [];
  s.subscribe((st) => seen.push(st.n));
  s.set({ n: 1 });
  assert.deepEqual(seen, [1]);
  s.set({ n: 2 });
  s.set({ n: 3 });
  assert.deepEqual(seen, [1, 2, 3]);
});

test("multiple subscribers each get one call per set", () => {
  const s = createStore({});
  let a = 0;
  let b = 0;
  s.subscribe(() => a++);
  s.subscribe(() => b++);
  s.set({ x: 1 });
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test("unsubscribe stops notifications and is idempotent", () => {
  const s = createStore({});
  let calls = 0;
  const off = s.subscribe(() => calls++);
  s.set({ a: 1 });
  off();
  off();
  s.set({ a: 2 });
  assert.equal(calls, 1);
});

test("same function subscribed twice is notified twice and unsubscribed independently", () => {
  const s = createStore({});
  let calls = 0;
  const fn = () => calls++;
  const off1 = s.subscribe(fn);
  s.subscribe(fn);
  s.set({ a: 1 });
  assert.equal(calls, 2);
  off1();
  s.set({ a: 2 });
  assert.equal(calls, 3);
});

test("a subscriber unsubscribing itself during notify does not break others", () => {
  const s = createStore({});
  const log = [];
  let offA;
  offA = s.subscribe(() => {
    log.push("a");
    offA();
  });
  s.subscribe(() => log.push("b"));
  s.subscribe(() => log.push("c"));
  s.set({ x: 1 });
  assert.deepEqual(log, ["a", "b", "c"]);
  log.length = 0;
  s.set({ x: 2 });
  assert.deepEqual(log, ["b", "c"]);
});

test("a subscriber unsubscribing a later subscriber during notify skips it", () => {
  const s = createStore({});
  const log = [];
  let offC;
  s.subscribe(() => {
    log.push("a");
    offC();
  });
  s.subscribe(() => log.push("b"));
  offC = s.subscribe(() => log.push("c"));
  s.set({ x: 1 });
  assert.deepEqual(log, ["a", "b"]);
});

test("a subscriber added during notify is not called in the same pass", () => {
  const s = createStore({});
  const log = [];
  s.subscribe(() => {
    log.push("a");
    s.subscribe(() => log.push("late"));
  });
  s.set({ x: 1 });
  assert.deepEqual(log, ["a"]);
});

test("get inside a subscriber reflects the merged state", () => {
  const s = createStore({ a: 1 });
  let observed;
  s.subscribe(() => {
    observed = s.get();
  });
  s.set({ b: 2 });
  assert.deepEqual(observed, { a: 1, b: 2 });
});

test("a throwing subscriber is reported via onError; others still run; set does not throw", () => {
  const errors = [];
  const s = createStore({}, { onError: (e) => errors.push(e) });
  const log = [];
  const boom = new Error("boom");
  s.subscribe(() => log.push("a"));
  s.subscribe(() => {
    throw boom;
  });
  s.subscribe(() => log.push("c"));
  assert.doesNotThrow(() => s.set({ x: 1 }));
  assert.deepEqual(log, ["a", "c"]);
  assert.deepEqual(errors, [boom]);
  assert.equal(s.get().x, 1);
});

test("default onError rethrows asynchronously via queueMicrotask", async () => {
  const realQM = globalThis.queueMicrotask;
  const queued = [];
  globalThis.queueMicrotask = (fn) => queued.push(fn);
  try {
    const s = createStore({});
    const boom = new Error("boom");
    s.subscribe(() => {
      throw boom;
    });
    assert.doesNotThrow(() => s.set({ x: 1 }));
    assert.equal(queued.length, 1);
    assert.throws(() => queued[0](), (e) => e === boom);
  } finally {
    globalThis.queueMicrotask = realQM;
  }
});
