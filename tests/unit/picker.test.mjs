import { test } from "node:test";
import assert from "node:assert/strict";
import { createPicker, SEARCH_DEBOUNCE_MS } from "../../js/app/picker.js";
import { readPlaces, writePlaces, emptyPlaces, addPlace, setWork, setTrip, MAX_PLACES } from "../../js/app/places-state.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

/** Minimal dialog/input stand-ins: the picker only needs listeners, a value, open state and a rect. */
function fakeDialog() {
  const handlers = {};
  const input = { id: "pk-q", tagName: "INPUT", value: "", focus() {} };
  const doc = { activeElement: null, querySelector: () => null };
  const dlg = {
    open: false,
    ownerDocument: doc,
    rect: { left: 100, top: 100, right: 300, bottom: 500 },
    getBoundingClientRect() { return this.rect; },
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    querySelector(sel) { return sel === "#pk-q" ? input : null; },
    querySelectorAll: () => [],
    contains: () => false,
    showModal() { this.open = true; },
    close() { if (!this.open) return; this.open = false; this.fire("close", {}); },
    fire(type, ev) { for (const fn of handlers[type] ?? []) fn(ev); },
  };
  return { dlg, input };
}

/** Injected timers: `fire()` runs the pending callback; `pending()` says how many are scheduled. */
function fakeTimers() {
  let next = 1;
  const t = new Map();
  return {
    setTimer: (fn, ms) => { const id = next++; t.set(id, { fn, ms }); return id; },
    clearTimer: (id) => void t.delete(id),
    pending: () => t.size,
    delays: () => [...t.values()].map((x) => x.ms),
    fire() { const e = [...t.entries()].at(-1); t.delete(e[0]); return e[1].fn(); },
  };
}

const R = (name, lat, lon, admin1 = null) => ({ name, latitude: lat, longitude: lon, lat, lon, admin1, country: "臺灣", elevation: 10, timezone: "Asia/Taipei" });

function setup({ search, current = "gps" } = {}) {
  const { dlg, input } = fakeDialog();
  const storage = memStorage();
  const timers = fakeTimers();
  const calls = [];
  const selected = [];
  const changes = [];
  const controller = { store: { get: () => ({ current }) }, selectCurrent: async (id) => void selected.push(id) };
  const searchFn = search ?? (async (q) => { calls.push(q); return []; });
  const picker = createPicker({
    dialog: dlg, storage, controller, search: searchFn, onChange: () => changes.push(1),
    renderView: () => {}, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  const type = (value, extra = {}) => { input.value = value; dlg.fire("input", { target: input, ...extra }); };
  return { dlg, input, storage, timers, calls, selected, changes, picker, type, setCurrent: (c) => (current = c) };
}
const tick = () => new Promise((r) => setImmediate(r));

test("debounce: each keystroke restarts one 400 ms timer; only the final text is searched", async () => {
  const s = setup();
  s.picker.open();
  s.type("H"); s.type("Hu"); s.type("Hua");
  assert.equal(s.timers.pending(), 1);
  assert.deepEqual(s.timers.delays(), [SEARCH_DEBOUNCE_MS]);
  assert.deepEqual(s.calls, []);
  await s.timers.fire(); await tick();
  assert.deepEqual(s.calls, ["Hua"]);
});

test("debounce: an empty (whitespace) value schedules nothing", () => {
  const s = setup();
  s.picker.open();
  s.type("  ");
  assert.equal(s.timers.pending(), 0);
});

test("seq guard: a slow older search never overwrites a newer one", async () => {
  const pending = [];
  const search = (q) => new Promise((res) => pending.push({ q, res }));
  const s = setup({ search });
  s.picker.open();
  s.type("aa"); s.timers.fire(); // search #1 in flight
  await tick();
  s.type("bb"); s.timers.fire(); // search #2 in flight
  await tick();
  assert.deepEqual(pending.map((p) => p.q), ["aa", "bb"]);
  pending[1].res([R("B", 23.1, 120.1)]);
  await tick();
  pending[0].res([R("A", 22.1, 120.1)]);
  await tick();
  assert.deepEqual(s.picker.getState().results.map((r) => r.name), ["B"]);
});

test("seq guard: typing while a search is in flight drops its result; closing does too", async () => {
  const pending = [];
  const s = setup({ search: (q) => new Promise((res) => pending.push(res)) });
  s.picker.open();
  s.type("aa"); s.timers.fire(); await tick();
  s.type("aab"); // new keystroke: the in-flight result is stale
  pending[0]([R("A", 22.1, 120.1)]); await tick();
  assert.equal(s.picker.getState().results.length, 0);
  s.timers.fire(); await tick();
  s.dlg.close(); // close while search #2 in flight
  pending[1]([R("B", 23.1, 120.1)]); await tick();
  assert.equal(s.picker.getState().results.length, 0, "a closed picker ignores late results");
});

test("not found names the typed query, not the last fallback variant", async () => {
  const s = setup();
  s.picker.open();
  s.type("花蓮");
  await s.timers.fire(); await tick();
  assert.equal(s.picker.getState().status, "done");
  assert.deepEqual(s.calls, ["花蓮", "花蓮市"]);
  assert.equal(s.picker.getState().searched, "花蓮");
});

test("Enter searches at once and cancels the debounce timer", async () => {
  const s = setup();
  s.picker.open();
  s.type("Hualien");
  let prevented = false;
  s.dlg.fire("keydown", { key: "Enter", target: s.input, preventDefault: () => (prevented = true) });
  await tick();
  assert.equal(prevented, true);
  assert.equal(s.timers.pending(), 0);
  assert.deepEqual(s.calls, ["Hualien"]);
});

// ---- IME ------------------------------------------------------------------------------------

test("IME: input events while composing start no timer and no search; compositionend starts the debounce", async () => {
  const s = setup();
  s.picker.open();
  s.type("ㄊ", { isComposing: true });
  s.type("ㄊㄞ", { isComposing: true });
  s.type("ㄊㄞˊ", { isComposing: true });
  assert.equal(s.timers.pending(), 0, "no debounce while composing");
  assert.deepEqual(s.calls, []);
  s.input.value = "台";
  s.dlg.fire("compositionend", { target: s.input });
  assert.equal(s.timers.pending(), 1);
  await s.timers.fire(); await tick();
  assert.equal(s.calls[0], "台", "the committed text is searched (first variant)");
});

test("IME: a search timer pending before the composition began is cancelled", () => {
  const s = setup();
  s.picker.open();
  s.type("Taichung");
  assert.equal(s.timers.pending(), 1);
  s.type("Taichungㄊ", { isComposing: true });
  assert.equal(s.timers.pending(), 0);
});

test("IME: Enter that commits a composition (isComposing or keyCode 229) does not search", async () => {
  const s = setup();
  s.picker.open();
  s.input.value = "ㄊㄞˊ";
  for (const ev of [{ isComposing: true }, { keyCode: 229 }]) {
    let prevented = false;
    s.dlg.fire("keydown", { key: "Enter", target: s.input, preventDefault: () => (prevented = true), ...ev });
    assert.equal(prevented, false);
  }
  await tick();
  assert.deepEqual(s.calls, []);
});

// ---- backdrop -------------------------------------------------------------------------------

test("backdrop: only a click outside the dialog's rectangle closes it", () => {
  const s = setup();
  s.picker.open();
  s.dlg.fire("click", { target: s.dlg, clientX: 110, clientY: 300 }); // inside: padding / gap
  s.dlg.fire("click", { target: s.dlg, clientX: 200, clientY: 120 });
  assert.equal(s.dlg.open, true);
  s.dlg.fire("click", { target: s.dlg, clientX: 50, clientY: 300 });
  assert.equal(s.dlg.open, false);
  s.picker.open();
  s.dlg.fire("click", { target: s.dlg, clientX: 200, clientY: 550 });
  assert.equal(s.dlg.open, false);
});

// ---- add / evict / mode actions -------------------------------------------------------------

const clickEl = (s, action, data = {}) => {
  const el = { dataset: { action, ...data }, closest() { return this; } };
  s.dlg.contains = () => true;
  s.dlg.fire("click", { target: { closest: () => el }, clientX: 200, clientY: 200 });
};

function withResults(s, mode, results) {
  s.picker.open(mode);
  const st = s.picker.getState();
  st.results = results;
  st.status = "done";
}

test("add in current mode keeps the picker open and reports the new place", () => {
  const s = setup();
  withResults(s, "current", [R("日月潭", 23.87, 120.91, "南投縣")]);
  clickEl(s, "pk-add", { i: "0" });
  assert.equal(readPlaces(s.storage).saved.length, 1);
  assert.equal(s.dlg.open, true);
  assert.match(s.picker.getState().message, /已加入 日月潭・南投縣/);
  assert.equal(s.changes.length, 1);
});

test("add in work / trip mode sets the role and closes", () => {
  for (const [mode, key] of [["work", "workId"], ["trip", "tripId"]]) {
    const s = setup();
    withResults(s, mode, [R("新竹", 24.8, 120.97, "新竹縣")]);
    clickEl(s, "pk-add", { i: "0" });
    const p = readPlaces(s.storage);
    assert.equal(p[key], "p:24.80,120.97", mode);
    assert.equal(s.dlg.open, false, mode);
  }
});

test("adding a 6th place evicts the oldest; evicting the current place falls back to GPS", () => {
  const s = setup({ current: "p:20.00,120.00" });
  let st = emptyPlaces();
  for (let i = 0; i < MAX_PLACES; i++) st = addPlace(st, R(`P${i}`, 20 + i, 120)).state; // P4 newest, P0 oldest
  writePlaces(s.storage, st);
  withResults(s, "current", [R("新", 30, 121)]);
  clickEl(s, "pk-add", { i: "0" });
  const ids = readPlaces(s.storage).saved.map((p) => p.id);
  assert.equal(ids.length, MAX_PLACES);
  assert.ok(!ids.includes("p:20.00,120.00"));
  assert.deepEqual(s.selected, ["gps"], "the evicted place was the current one");
  assert.match(s.picker.getState().message, /並移除最舊的 P0/);
});

test("work toggle: setting from the matching mode closes; unsetting keeps the picker open", () => {
  const s = setup();
  writePlaces(s.storage, addPlace(emptyPlaces(), R("新竹", 24.8, 120.97)).state);
  s.picker.open("work");
  clickEl(s, "pk-work", { id: "p:24.80,120.97" });
  assert.equal(readPlaces(s.storage).workId, "p:24.80,120.97");
  assert.equal(s.dlg.open, false);
  s.picker.open("current");
  clickEl(s, "pk-work", { id: "p:24.80,120.97" });
  assert.equal(readPlaces(s.storage).workId, null);
  assert.equal(s.dlg.open, true);
  assert.equal(s.picker.getState().message, "已取消公司地點");
});

test("trip toggle and delete: deleting the current place falls back to GPS and clears the pins", () => {
  const s = setup({ current: "p:24.80,120.97" });
  let st = addPlace(emptyPlaces(), R("新竹", 24.8, 120.97)).state;
  st = setTrip(setWork(st, "p:24.80,120.97"), "p:24.80,120.97");
  writePlaces(s.storage, st);
  s.picker.open("current");
  clickEl(s, "pk-del", { id: "p:24.80,120.97" });
  const p = readPlaces(s.storage);
  assert.deepEqual([p.saved.length, p.workId, p.tripId], [0, null, null]);
  assert.deepEqual(s.selected, ["gps"]);
  assert.match(s.picker.getState().message, /已刪除 新竹.*改用目前位置/);
});

test("使用 (pk-use) selects the place and closes", () => {
  const s = setup();
  writePlaces(s.storage, addPlace(emptyPlaces(), R("新竹", 24.8, 120.97)).state);
  s.picker.open();
  clickEl(s, "pk-use", { id: "p:24.80,120.97" });
  assert.deepEqual(s.selected, ["p:24.80,120.97"]);
  assert.equal(s.dlg.open, false);
});
