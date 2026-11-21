import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSW, shouldRegister, showBanner } from "../../js/app/sw-register.js";

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

test("registers ./sw.js with scope ./", async () => {
  const f = fakeSW();
  assert.equal(await registerSW({ navigator: { serviceWorker: f.sw }, document: fakeDoc(), location: { search: "" }, win: {} }), true);
  assert.deepEqual(f.calls, [["./sw.js", { scope: "./" }]]);
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
