/** Pure theme helpers (no DOM access). */
import { localParts } from "../time.js";

export const THEME_KEY = "ps:theme";
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
 * @returns {'day'|'night'}
 */
export function resolveTheme(pref, vm, nowMs) {
  const p = normPref(pref);
  if (p !== "auto") return p;
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
