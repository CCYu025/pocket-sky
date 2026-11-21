/** Pure theme helpers (no DOM access). */
import { localParts } from "../time.js";

export const THEME_KEY = "ps:theme";
/** Last resolved theme ('day'|'night'); read by js/theme-boot.js before first paint. */
export const THEME_LAST_KEY = "ps:theme-last";
export const THEME_COLORS = { day: "#FFF7D6", night: "#141414" };

const PREFS = ["auto", "day", "night"];

function normPref(pref) {
  return PREFS.includes(pref) ? pref : "auto";
}

/**
 * Decide the effective theme.
 * @param {string} pref 'auto' | 'day' | 'night' (anything else -> 'auto')
 * @param {object} vm View model with now / today / location.
 * @param {number} nowMs Injected epoch ms.
 * @param {'day'|'night'} [fallback] Used for `auto` when `vm` is null (loading/error): the last resolved theme.
 * @returns {'day'|'night'}
 */
export function resolveTheme(pref, vm, nowMs, fallback) {
  const p = normPref(pref);
  if (p !== "auto") return p;
  if (!vm) return fallback === "night" ? "night" : "day";
  const sunrise = vm?.today?.sunrise;
  const sunset = vm?.today?.sunset;
  if (sunrise && sunset) {
    let key = vm?.now?.minuteKey;
    if (!key) {
      const off = vm?.location?.utcOffsetSeconds;
      if (typeof off === "number" && typeof nowMs === "number") key = localParts(off, nowMs).minuteKey;
    }
    if (key) return key < sunrise || key >= sunset ? "night" : "day";
  }
  return vm?.now?.isDay === 0 ? "night" : "day";
}

/**
 * Explicit opposite theme, for the LIGHT key.
 * @param {'day'|'night'} currentResolved
 * @returns {'day'|'night'}
 */
export function nextPref(currentResolved) {
  return currentResolved === "night" ? "day" : "night";
}

/** @returns {'auto'|'day'|'night'} Never throws. */
export function readPref(storage) {
  try {
    return normPref(storage.getItem(THEME_KEY));
  } catch {
    return "auto";
  }
}

/** Persist a preference; swallows storage errors. */
export function writePref(storage, pref) {
  try {
    storage.setItem(THEME_KEY, normPref(pref));
  } catch {
    /* ignore */
  }
}

/** @returns {'day'|'night'|undefined} The last resolved theme; never throws. */
export function readLast(storage) {
  try {
    const v = storage.getItem(THEME_LAST_KEY);
    return v === "day" || v === "night" ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Persist the last resolved theme; swallows storage errors. */
export function writeLast(storage, theme) {
  try {
    storage.setItem(THEME_LAST_KEY, theme === "night" ? "night" : "day");
  } catch {
    /* ignore */
  }
}
