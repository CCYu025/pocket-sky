/**
 * App entry: wires storage, cache, API, controller and views.
 * @module main
 */
import { createCache } from "./cache.js";
import { getForecast, getAirQuality, ATTRIBUTION } from "./api/openmeteo.js";
import { createController } from "./app/controller.js";
import { browserGeolocate } from "./app/geolocate.js";
import { resolveTheme, nextPref, readPref, writePref, readLast, writeLast, THEME_COLORS } from "./ui/theme.js";
import { renderToday } from "./ui/views/today.js";
import { createAnnouncer } from "./ui/announce.js";
import { createAnimTracker } from "./ui/anim.js";
import { renderOuting } from "./ui/views/outing.js";

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
const lightBtn = doc.querySelector('[data-action="light"]');
const navLinks = { today: doc.getElementById("nav-today"), outing: doc.getElementById("nav-outing") };
const themeMeta = doc.querySelector('meta[name="theme-color"]');
const live = doc.getElementById("live");

const announcer = createAnnouncer();
const anim = createAnimTracker();

/** @returns {'today'|'outing'} Current route from the hash (default today). */
function currentRoute() {
  return location.hash === "#outing" ? "outing" : "today";
}

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

let refocusLoc = false;

/**
 * Location button: "定位中…" (busy, disabled) while locating; the default-location
 * notice is exposed through the aria-label instead of a visible line.
 * @param {object} state Controller state.
 */
function renderLocation(state) {
  const locating = Boolean(state.locating);
  const name = locating || !state.location ? "定位中…" : state.location.name;
  locBtn.firstChild.nodeValue = `${name} `;
  locBtn.setAttribute("aria-label", locating || !state.location ? "定位中…" : `${name}，${state.notice ? `${state.notice}，` : ""}重新定位`);
  locBtn.setAttribute("aria-busy", String(locating));
  locBtn.disabled = locating;
  if (!locating && refocusLoc) {
    refocusLoc = false;
    locBtn.focus({ preventScroll: true });
  }
}

/** Re-render chrome and the active view. */
function render() {
  const state = controller.store.get();
  const route = currentRoute();
  applyTheme(state);

  renderLocation(state);
  for (const [r, el] of Object.entries(navLinks)) {
    if (r === route) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }

  const focus = focusKey(doc.activeElement);
  const flags = anim.next({
    route,
    hasData: route === "today" && Boolean(state.vm) && (state.status === "ready" || state.status === "stale"),
    alertId: state.alert && state.vm ? state.alert.id : null,
  });

  if (route === "outing") renderOuting(root);
  else renderToday(root, state, { attribution: ATTRIBUTION });

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
    case "locate":
      refocusLoc = true; // a disabled button drops focus; give it back when locating ends
      controller.refresh({ relocate: true });
      break;
    case "retry":
      controller.refresh();
      break;
    case "dismiss-alert":
      controller.dismissAlert();
      break;
    default:
      break; // "more": not implemented yet
  }
});

controller.store.subscribe(render);
window.addEventListener("hashchange", render);
doc.addEventListener("visibilitychange", () => {
  doc.documentElement.classList.toggle("is-hidden", doc.hidden);
  if (!doc.hidden) {
    controller.tick();
    controller.refreshIfStale();
  }
});
setInterval(() => {
  if (!doc.hidden) controller.tick();
}, 20000);

doc.documentElement.classList.toggle("is-hidden", doc.hidden);
render();
controller.init();
