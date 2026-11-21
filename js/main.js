/**
 * App entry: wires storage, cache, API, controller and views.
 * @module main
 */
import { createCache } from "./cache.js";
import { getForecast, getAirQuality, searchPlaces, ATTRIBUTION } from "./api/openmeteo.js";
import { createController, placeKey } from "./app/controller.js";
import { createPicker } from "./app/picker.js";
import { readPlaces, writePlaces, setTrip } from "./app/places-state.js";
import { MAX_RESULTS } from "./domain/place-search.js";
import { browserGeolocate } from "./app/geolocate.js";
import { resolveTheme, nextPref, readPref, writePref, readLast, writeLast, THEME_COLORS } from "./ui/theme.js";
import { renderToday } from "./ui/views/today.js";
import { createAnnouncer } from "./ui/announce.js";
import { createAnimTracker } from "./ui/anim.js";
import { renderOuting, revealBar } from "./ui/views/outing.js";
import { exerciseModel, slotLabel, stepIndex } from "./ui/views/exercise.js";
import { parseRoute } from "./ui/route.js";
import { readOuting, writeOuting } from "./app/outing-state.js";
import { createDebouncedAnnouncer, createOutingAnnouncer } from "./ui/announce.js";
import { registerSW } from "./app/sw-register.js";

/** @returns {Storage|object} localStorage, or an in-memory stand-in when unavailable. */
function safeStorage() {
  try {
    const s = window.localStorage;
    s.getItem("ps:probe");
    return s;
  } catch {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => void m.set(k, String(v)),
      removeItem: (k) => void m.delete(k),
    };
  }
}

const storage = safeStorage();
const now = () => Date.now();
const cache = createCache({ storage, now });
const controller = createController({
  api: { getForecast, getAirQuality },
  cache,
  storage,
  now,
  geolocate: browserGeolocate(navigator),
});

const doc = document;
const root = doc.getElementById("view");
const locBtn = doc.getElementById("loc-btn");

const picker = createPicker({
  dialog: doc.getElementById("picker"),
  storage,
  controller: {
    store: controller.store,
    selectCurrent: (id) => controller.selectCurrent(id),
  },
  search: (name) => searchPlaces(name, { cache, now, count: MAX_RESULTS }),
  onChange: () => render(),
  fallbackFocus: () => root,
});
const lightBtn = doc.querySelector('[data-action="light"]');
const navLinks = { today: doc.getElementById("nav-today"), outing: doc.getElementById("nav-outing") };
const themeMeta = doc.querySelector('meta[name="theme-color"]');
const live = doc.getElementById("live");

// Open-Meteo attribution (CC BY 4.0): one persistent footer link outside #view, so every screen
// and state shows it and no view re-render ever touches it.
const attributionLink = doc.getElementById("attribution");
attributionLink.textContent = ATTRIBUTION.text;
attributionLink.href = ATTRIBUTION.href;

const announcer = createAnnouncer();
const anim = createAnimTracker();
const outingAnnouncer = createOutingAnnouncer();
/** True while the hash is an Outing route (the debounced announcer must never speak elsewhere). */
const onOuting = () => parseRoute(location.hash, "commute").name === "outing";
const outingSay = createDebouncedAnnouncer({
  write: (m) => {
    if (onOuting()) live.textContent = m;
  },
  delay: 500,
});

/** Transient Outing UI state (not persisted): picked exercise hour, flip counter, current visit. */
const outingUi = { picked: null, flip: 0, visit: null };

/**
 * Apply the effective theme to <html> and the theme-color meta.
 * @param {object} state Controller state.
 * @returns {'day'|'night'}
 */
function applyTheme(state) {
  const last = readLast(storage);
  const theme = resolveTheme(readPref(storage), state.vm, now(), last);
  if (theme !== last) writeLast(storage, theme);
  doc.documentElement.dataset.theme = theme;
  if (themeMeta) themeMeta.setAttribute("content", THEME_COLORS[theme]);
  lightBtn.setAttribute("aria-pressed", String(theme === "night"));
  return theme;
}

/**
 * Location button: "定位中…" (busy, but still enabled: it opens the picker, so a slow or never-answering
 * position never locks the user out of choosing a saved place) while locating; the default-location
 * notice is exposed through the aria-label instead of a visible line.
 * @param {object} state Controller state.
 */
function renderLocation(state) {
  const locating = Boolean(state.locating);
  const name = locating || !state.location ? "定位中…" : state.location.name;
  locBtn.firstChild.nodeValue = `${name} `;
  locBtn.setAttribute("aria-label", locating || !state.location ? "定位中…" : `${name}，${state.notice ? `${state.notice}，` : ""}選擇地點`);
  locBtn.setAttribute("aria-busy", String(locating));
}

/** Re-render chrome and the active view. */
function render() {
  const state = controller.store.get();
  const stored = readOuting(storage); // ps:outing is read once per render
  const places = readPlaces(storage); // ps:places too
  const workPlace = places.saved.find((p) => p.id === places.workId) ?? null;
  const tripPlace = places.saved.find((p) => p.id === places.tripId) ?? null;
  const route = parseRoute(location.hash, stored.scenario); // `#outing` opens the last used scenario
  applyTheme(state);

  renderLocation(state);
  for (const [r, el] of Object.entries(navLinks)) {
    if (r === route.name) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }

  let outing = null;
  if (route.name === "outing") {
    outing = stored;
    if (outing.scenario !== route.scenario) {
      outing = { ...outing, scenario: route.scenario };
      writeOuting(storage, outing); // `#outing/exercise` becomes the scenario `#outing` reopens
    }
  }
  if (route.key !== outingUi.visit) Object.assign(outingUi, { visit: route.key, picked: null, flip: 0 }); // new visit: default selection

  const focus = focusKey(doc.activeElement);
  const hasData = Boolean(state.vm) && (state.status === "ready" || state.status === "stale");
  const flags = anim.next({
    route: route.key,
    hasData,
    alertId: route.name === "today" && state.alert && state.vm ? state.alert.id : null,
    continuation: Boolean(state.alert?.continuation),
  });

  // the exercise model is computed once per render and shared by the view and the announcer
  const exercise = outing?.scenario === "exercise" && hasData ? exerciseModel(state.vm, now(), outingUi.picked) : null;

  if (outing) renderOuting(root, state, { outing, nowMs: now(), picked: outingUi.picked, flip: outingUi.flip, exercise, work: workPlace, trip: tripPlace, saved: places.saved });
  else renderToday(root, state);

  // One-shot animations: `boot` once per route visit, shake when a new alert id appears.
  root.classList.toggle("boot", flags.boot);
  if (flags.restartShake) {
    root.removeAttribute("data-shake");
    void root.offsetWidth; // restart the animation for an element that is already in the DOM
  }
  root.toggleAttribute("data-shake", flags.shake);

  restoreFocus(focus);

  // Single persistent live region: written only when an announced condition changes.
  const message = announcer.next(state);
  if (message) live.textContent = message;

  // Outing: scenario change and the user-picked exercise hour, debounced 500 ms.
  const selection = exercise?.slot ? { key: exercise.slot.hourKey, text: slotLabel(exercise.slot), picked: exercise.picked } : null;
  if (!outing) outingSay.cancel(); // left Outing inside the quiet period: drop the pending message
  outingSay.say(outingAnnouncer.next({ scenario: outing ? outing.scenario : null, selection }));

  // Extra places are fetched lazily, when their view is shown (after this render: ensurePlace updates the store).
  const want = [];
  if (outing?.scenario === "commute" && workPlace) want.push(workPlace);
  if (outing?.scenario === "trip" && tripPlace) want.push(tripPlace);
  const keep = [workPlace, tripPlace].filter(Boolean).map(placeKey);
  viewPlaces = { wanted: want.map(placeKey), active: keep };
  const sig = `${route.key}|${want.map((p) => p.id).join(",")}`;
  if (sig !== ensured) {
    ensured = sig;
    for (const p of want) controller.ensurePlace(p, { keep });
  }
}

let ensured = null; // route + places last handed to `ensurePlace`
/** Extra places the visible view uses (`wanted`) and the work/trip places that are set (`active`), for `refreshIfStale`. */
let viewPlaces = { wanted: [], active: [] };

/**
 * Select an exercise hour (bar, slider, 最佳 key or arrow keys). Plays the one-shot digit flip
 * only when the selection actually changes.
 * @param {string|undefined} hourKey
 * @returns {boolean} true when the selection changed.
 */
function pickSlot(hourKey) {
  const state = controller.store.get();
  if (!hourKey || !state.vm) return false;
  const cur = exerciseModel(state.vm, now(), outingUi.picked);
  if (cur.slot?.hourKey === hourKey && outingUi.picked === hourKey) return false;
  if (cur.slot?.hourKey !== hourKey) outingUi.flip += 1;
  outingUi.picked = hourKey;
  render();
  return true;
}

/**
 * Stable identity of a focused element inside the view: `id`, else `data-action`, else `href`.
 * @param {Element|null} el
 * @returns {{attr: string, value: string}|null} null when nothing inside the view is focused.
 */
function focusKey(el) {
  if (!el || el === root || !root.contains(el)) return null;
  if (el.id) return { attr: "id", value: el.id };
  if (el.dataset?.action) return { attr: "data-action", value: el.dataset.action };
  const href = el.getAttribute("href");
  return href ? { attr: "href", value: href } : null;
}

/**
 * After a re-render, put focus back on the element with the same stable key (no-op when the
 * focused node survived; falls back to the view itself when its element is gone).
 * @param {{attr: string, value: string}|null} key
 */
function restoreFocus(key) {
  if (!key) return;
  const active = doc.activeElement;
  if (active && active !== root && root.contains(active)) return;
  const again = [...root.querySelectorAll("[id],[data-action],[href]")].find((el) => el.getAttribute(key.attr) === key.value);
  (again ?? root).focus({ preventScroll: true });
}

doc.getElementById("app").addEventListener("click", (e) => {
  const el = e.target instanceof Element ? e.target.closest("[data-action]") : null;
  if (!el) return;
  switch (el.dataset.action) {
    case "light": {
      const resolved = doc.documentElement.dataset.theme === "night" ? "night" : "day";
      writePref(storage, nextPref(resolved));
      render();
      break;
    }
    case "open-picker":
      picker.open(el.dataset.mode ?? "current", el);
      break;
    case "trip-pick": {
      writePlaces(storage, setTrip(readPlaces(storage), el.dataset.id));
      render();
      break;
    }
    case "retry-place": {
      const p = readPlaces(storage).saved.find((x) => x.id === el.dataset.id);
      if (p) controller.ensurePlace(p, { force: true, keep: [placeKey(p)] });
      break;
    }
    case "retry":
      controller.refresh();
      break;
    case "pick-slot":
      pickSlot(el.dataset.hk);
      break;
    case "pick-best": {
      const vm = controller.store.get().vm;
      pickSlot(vm ? exerciseModel(vm, now(), null).best?.hourKey : undefined);
      break;
    }
    case "dismiss-alert":
      controller.dismissAlert();
      break;
    default:
      break; // "more": not implemented yet
  }
});

// Commute and trip hour selectors (native <select>) persist to ps:outing.
doc.getElementById("app").addEventListener("change", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLSelectElement)) return;
  const o = readOuting(storage);
  if (el.dataset.field) writeOuting(storage, { ...o, commute: { ...o.commute, [el.dataset.field]: Number(el.value) } });
  else if (el.dataset.trip) writeOuting(storage, { ...o, trip: { ...o.trip, [el.dataset.trip]: Number(el.value) } });
  else return;
  render();
});

// Exercise range slider: one slot per step.
doc.getElementById("app").addEventListener("input", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.id !== "x-range") return;
  pickSlot([...root.querySelectorAll(".xbar")][Number(el.value)]?.dataset.hk);
});

// Exercise bars: Left/Right (and Home/End) move the selection and the focus.
doc.getElementById("app").addEventListener("keydown", (e) => {
  const el = e.target instanceof Element ? e.target.closest(".xbar") : null;
  if (!el || e.altKey || e.ctrlKey || e.metaKey) return;
  const bars = [...root.querySelectorAll(".xbar")];
  const next = stepIndex(e.key, bars.indexOf(el), bars.length);
  if (next === null) return;
  e.preventDefault();
  const target = bars[next];
  pickSlot(target.dataset.hk);
  target.focus({ preventScroll: true });
  revealBar(target.closest(".xbars"), target); // ring included; also covers an unchanged selection (no re-render)
});

// Tabbing onto any bar reveals it (and its ring) too.
doc.getElementById("app").addEventListener("focusin", (e) => {
  const el = e.target instanceof Element && e.target.classList.contains("xbar") ? e.target : null;
  if (el) revealBar(el.closest(".xbars"), el);
});

controller.store.subscribe(render);
window.addEventListener("hashchange", render);
doc.addEventListener("visibilitychange", () => {
  doc.documentElement.classList.toggle("is-hidden", doc.hidden);
  if (!doc.hidden) {
    controller.tick();
    controller.refreshIfStale(viewPlaces);
  }
});
setInterval(() => {
  if (!doc.hidden) controller.tick();
}, 20000);

doc.documentElement.classList.toggle("is-hidden", doc.hidden);
render();
controller.init();
registerSW(); // offline shell + update banner (no-op under ?nosw, __PS_NO_SW__ or without service worker support)
