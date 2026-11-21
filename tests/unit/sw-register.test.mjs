import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSW, shouldRegister, showBanner } from "../../js/app/sw-register.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Minimal DOM for the banner. */
function fakeDoc() {
  const mk = (tag) => {
    const el = { tag, children: [], attrs: {}, listeners: {}, parentNode: null, textContent: "", disabled: false };
    el.setAttribute = (k, v) => (el.attrs[k] = v);
    el.addEventListener = (t, f) => (el.listeners[t] = f);
    el.append = (...c) => c.forEach((x) => ((x.parentNode = el), el.children.push(x)));
    el.insertBefore = (n, ref) => ((n.parentNode = el), el.children.splice(el.children.indexOf(ref), 0, n));
    return el;
  };
  const body = mk("body");
  const nav = mk("nav");
  body.append(nav);
  return { body, createElement: mk, getElementById: (id) => body.children.find((c) => c.id === id) ?? null, querySelector: (s) => (s === ".nav" ? nav : null) };
}

function fakeSW({ controller = {}, waiting = null } = {}) {
  const ev = {};
  const regEv = {};
  const reg = { waiting, installing: null, addEventListener: (t, f) => (regEv[t] = f) };
  const calls = [];
  const sw = {
    controller,
    addEventListener: (t, f) => (ev[t] = f),
    register: async (url, opts) => (calls.push([url, opts]), reg),
  };
  return { sw, reg, ev, regEv, calls };
}

test("no registration without serviceWorker, with ?nosw or __PS_NO_SW__", async () => {
  const f = fakeSW();
  assert.equal(await registerSW({ navigator: {}, document: fakeDoc(), location: { search: "" }, win: {} }), false);
  assert.equal(await registerSW({ navigator: { serviceWorker: f.sw }, document: fakeDoc(), location: { search: "?nosw" }, win: {} }), false);
  assert.equal(await registerSW({ navigator: { serviceWorker: f.sw }, document: fakeDoc(), location: { search: "" }, win: { __PS_NO_SW__: true } }), false);
  assert.equal(f.calls.length, 0);
  assert.equal(shouldRegister({ search: "?a=1" }, {}), true);
});

test("registers ./sw.js with scope ./ and updateViaCache none", async () => {
  const f = fakeSW();
  assert.equal(await registerSW({ navigator: { serviceWorker: f.sw }, document: fakeDoc(), location: { search: "" }, win: {} }), true);
  assert.deepEqual(f.calls, [["./sw.js", { scope: "./", updateViaCache: "none" }]]);
});

test("waiting worker shows one banner; click posts SKIP_WAITING; controllerchange reloads once", async () => {
  const posted = [];
  const f = fakeSW({ waiting: { postMessage: (m) => posted.push(m) } });
  const doc = fakeDoc();
  let reloads = 0;
  await registerSW({ navigator: { serviceWorker: f.sw }, document: doc, location: { search: "", reload: () => reloads++ }, win: {} });
  const bar = doc.getElementById("update-banner");
  assert.ok(bar);
  assert.equal(bar.attrs.role, "status");
  assert.equal(bar.children[0].textContent, "", "inserted empty so the live region announces the text that follows");
  await tick();
  assert.equal(bar.children[0].textContent, "有新版本");
  assert.equal(bar.children[1].textContent, "重新整理");
  assert.equal(doc.body.children.indexOf(bar), doc.body.children.length - 2, "inserted right before the nav");
  assert.equal(showBanner(doc, () => {}), bar, "never duplicated");

  f.ev.controllerchange();
  assert.equal(reloads, 0, "no reload before the user asked");
  bar.children[1].listeners.click();
  assert.deepEqual(posted, [{ type: "SKIP_WAITING" }]);
  f.ev.controllerchange();
  f.ev.controllerchange();
  assert.equal(reloads, 1);
});

test("updatefound -> installed shows the banner; first install (no controller) does not", async () => {
  const f = fakeSW();
  const doc = fakeDoc();
  await registerSW({ navigator: { serviceWorker: f.sw }, document: doc, location: { search: "" }, win: {} });
  const w = { state: "installing", addEventListener: (t, fn) => (w.fn = fn) };
  f.reg.installing = w;
  f.regEv.updatefound();
  w.state = "installed";
  f.reg.waiting = { postMessage() {} };
  w.fn();
  assert.ok(doc.getElementById("update-banner"));

  const g = fakeSW({ controller: null, waiting: {} });
  const d2 = fakeDoc();
  await registerSW({ navigator: { serviceWorker: g.sw }, document: d2, location: { search: "" }, win: {} });
  assert.equal(d2.getElementById("update-banner"), null);
});

test("register rejection is swallowed", async () => {
  const sw = { controller: null, addEventListener() {}, register: async () => { throw new Error("x"); } };
  assert.equal(await registerSW({ navigator: { serviceWorker: sw }, document: fakeDoc(), location: { search: "" }, win: {} }), false);
});

test("banner text is set on the next tick and announced through a ps:announce event", async () => {
  const f = fakeSW({ waiting: { postMessage() {} } });
  const events = [];
  const win = { dispatchEvent: (e) => events.push([e.type, e.detail]) };
  const doc = fakeDoc();
  await registerSW({ navigator: { serviceWorker: f.sw }, document: doc, location: { search: "" }, win });
  const bar = doc.getElementById("update-banner");
  assert.equal(bar.children[0].textContent, "");
  assert.deepEqual(events, []);
  await tick();
  assert.equal(bar.children[0].textContent, "有新版本");
  assert.deepEqual(events, [["ps:announce", "有新版本"]], "announced exactly once");
});

test("second tab: another tab activated the update -> banner text is replaced and the key reloads", async () => {
  const f = fakeSW({ waiting: null });
  const doc = fakeDoc();
  const events = [];
  let reloads = 0;
  await registerSW({ navigator: { serviceWorker: f.sw }, document: doc, location: { search: "", reload: () => reloads++ }, win: { dispatchEvent: (e) => events.push(e.detail) } });
  assert.equal(doc.getElementById("update-banner"), null);
  f.ev.controllerchange(); // this tab never pressed the key
  assert.equal(reloads, 0, "no automatic reload");
  const bar = doc.getElementById("update-banner");
  assert.ok(bar, "banner appears even if it was not shown before");
  await tick();
  assert.equal(bar.children[0].textContent, "已更新，重新整理以載入新版");
  assert.deepEqual(events, ["已更新，重新整理以載入新版"], "announced once");
  bar.children[1].listeners.click(); // no waiting worker any more: plain reload
  assert.equal(reloads, 1);
});

test("second tab with the old banner showing: controllerchange replaces its text; key still works", async () => {
  const posted = [];
  const f = fakeSW({ waiting: { postMessage: (m) => posted.push(m) } });
  const doc = fakeDoc();
  let reloads = 0;
  await registerSW({ navigator: { serviceWorker: f.sw }, document: doc, location: { search: "", reload: () => reloads++ }, win: {} });
  await tick();
  const bar = doc.getElementById("update-banner");
  f.reg.waiting = null; // the other tab's click activated it
  f.ev.controllerchange();
  await tick();
  assert.equal(doc.body.children.filter((c) => c.id === "update-banner").length, 1, "one banner");
  assert.equal(bar.children[0].textContent, "已更新，重新整理以載入新版");
  bar.children[1].listeners.click();
  assert.deepEqual(posted, [], "nothing to activate");
  assert.equal(reloads, 1);
});

test("first install claiming the page (no previous controller) neither reloads nor shows a banner", async () => {
  const f = fakeSW({ controller: null });
  const doc = fakeDoc();
  let reloads = 0;
  await registerSW({ navigator: { serviceWorker: f.sw }, document: doc, location: { search: "", reload: () => reloads++ }, win: {} });
  f.sw.controller = {};
  f.ev.controllerchange();
  await tick();
  assert.equal(doc.getElementById("update-banner"), null);
  assert.equal(reloads, 0);
});
