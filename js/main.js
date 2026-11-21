/**
 * App entry: wires storage, cache, API, controller and views.
 * @module main
 */
import { createCache } from "./cache.js";
import { getForecast, getAirQuality, ATTRIBUTION } from "./api/openmeteo.js";
import { createController } from "./app/controller.js";
import { browserGeolocate } from "./app/geolocate.js";
import { resolveTheme, nextPref, readPref, writePref, THEME_COLORS } from "./ui/theme.js";
import { renderToday } from "./ui/views/today.js";
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

let lastAnimKey = null;

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
  const theme = resolveTheme(readPref(storage), state.vm, now());
  doc.documentElement.dataset.theme = theme;
  if (themeMeta) themeMeta.setAttribute("content", THEME_COLORS[theme]);
  lightBtn.setAttribute("aria-pressed", String(theme === "night"));
  return theme;
}

/** Re-render chrome and the active view. */
function render() {
  const state = controller.store.get();
  const route = currentRoute();
  applyTheme(state);

  const name = state.location?.name ?? "定位中";
  locBtn.firstChild.nodeValue = `${name} `;
  locBtn.setAttribute("aria-label", `${name}，重新定位`);
  for (const [r, el] of Object.entries(navLinks)) {
    if (r === route) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }

  const activeAction = root.contains(doc.activeElement) ? doc.activeElement.dataset?.action : null;
  const animKey = `${route}|${state.status === "loading" || state.status === "error" ? state.status : state.fetchedAt}`;
  const animate = animKey !== lastAnimKey;
  lastAnimKey = animKey;

  if (route === "outing") renderOuting(root);
  else renderToday(root, state, { attribution: ATTRIBUTION, animate });

  if (activeAction) {
    const again = root.querySelector(`[data-action="${activeAction}"]`);
    (again ?? root).focus({ preventScroll: true });
  }
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
