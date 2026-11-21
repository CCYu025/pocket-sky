/**
 * Saved places (`ps:places`) and the current place (`ps:current`).
 * Pure helpers over a plain state object plus storage helpers that never throw.
 * `ps:places` = `{ v: 1, saved: Place[], workId: string|null, tripId: string|null }`.
 * @module app/places-state
 */

export const PLACES_KEY = "ps:places";
export const CURRENT_KEY = "ps:current";
/** Maximum number of saved places. */
export const MAX_PLACES = 5;

/**
 * @typedef {{ id: string, name: string, admin1: string|null, country: string|null,
 *   lat: number, lon: number, elevation: number|null, timezone: string|null }} Place
 * @typedef {{ v: 1, saved: Place[], workId: string|null, tripId: string|null }} PlacesState
 */

const ID_RE = /^p:-?\d+\.\d{2},-?\d+\.\d{2}$/;
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const strOrNull = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);
/** 2-dp rounding as a number; `-0` becomes `0`. */
const round2 = (n) => {
  const r = Number(n.toFixed(2));
  return r === 0 ? 0 : r;
};
/** 2-dp string with the same `-0.00` rule as `cacheKey`. */
const fmt = (n) => {
  const s = n.toFixed(2);
  return s === "-0.00" ? "0.00" : s;
};

/**
 * Place id: `"p:" + lat.toFixed(2) + "," + lon.toFixed(2)` (`-0.00` becomes `0.00`).
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function placeId(lat, lon) {
  return `p:${fmt(lat)},${fmt(lon)}`;
}

/**
 * Normalise a Place-like or `searchPlaces` result into a Place (coordinates rounded to 2 dp,
 * id recomputed from them, missing optional fields `null`).
 * @param {object} r Object with `name`, `lat`, `lon` and optionally `admin1`, `country`, `elevation`, `timezone`.
 * @returns {Place|null} `null` when name or coordinates are invalid.
 */
export function placeFromSearchResult(r) {
  if (!r || typeof r !== "object") return null;
  const name = strOrNull(r.name);
  if (name === null || !fin(r.lat) || !fin(r.lon) || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) return null;
  const lat = round2(r.lat);
  const lon = round2(r.lon);
  return {
    id: placeId(lat, lon),
    name,
    admin1: strOrNull(r.admin1),
    country: strOrNull(r.country),
    lat,
    lon,
    elevation: fin(r.elevation) ? r.elevation : null,
    timezone: strOrNull(r.timezone),
  };
}

/**
 * Display label: `name`, plus `・admin1` when admin1 is present and differs from the name.
 * @param {Place} place
 * @returns {string}
 */
export function placeLabel(place) {
  const name = place?.name ?? "";
  const a = place?.admin1;
  return a && a !== name ? `${name}・${a}` : name;
}

/**
 * A fresh empty state.
 * @returns {PlacesState}
 */
export function emptyPlaces() {
  return { v: 1, saved: [], workId: null, tripId: null };
}

/**
 * Validate a raw value into a state: invalid places dropped, duplicates (by id) dropped,
 * at most `MAX_PLACES` kept, dangling `workId`/`tripId` set to `null`.
 * @param {*} raw
 * @returns {PlacesState}
 */
function normalize(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const saved = [];
  for (const r of Array.isArray(o.saved) ? o.saved : []) {
    const p = placeFromSearchResult(r);
    if (p && !saved.some((s) => s.id === p.id) && saved.length < MAX_PLACES) saved.push(p);
  }
  const ref = (id) => (typeof id === "string" && saved.some((s) => s.id === id) ? id : null);
  return { v: 1, saved, workId: ref(o.workId), tripId: ref(o.tripId) };
}

/**
 * Read `ps:places`. Never throws.
 * @param {Storage|undefined} storage
 * @returns {PlacesState}
 */
export function readPlaces(storage) {
  try {
    return normalize(JSON.parse(storage.getItem(PLACES_KEY)));
  } catch {
    return emptyPlaces();
  }
}

/**
 * Persist `ps:places` (validated first). Never throws.
 * @param {Storage|undefined} storage
 * @param {PlacesState} state
 * @returns {boolean} `true` when written.
 */
export function writePlaces(storage, state) {
  try {
    storage.setItem(PLACES_KEY, JSON.stringify(normalize(state)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Save a place: dedupe by id (the existing entry is replaced, so its name updates), newest first,
 * at most `MAX_PLACES`. Eviction removes the oldest place that is not the work or trip place.
 * @param {PlacesState} state
 * @param {object} place Place or `searchPlaces` result.
 * @returns {{ state: PlacesState, error: null|'full'|'invalid' }} `full` when every other place is
 *   pinned (state unchanged); `invalid` for a place without name or valid coordinates.
 */
export function addPlace(state, place) {
  const p = placeFromSearchResult(place);
  if (!p) return { state, error: "invalid" };
  let saved = [p, ...state.saved.filter((s) => s.id !== p.id)];
  while (saved.length > MAX_PLACES) {
    let i = saved.length - 1;
    while (i > 0 && (saved[i].id === state.workId || saved[i].id === state.tripId)) i--;
    if (i === 0) return { state, error: "full" }; // index 0 is the new place
    saved = saved.filter((_, k) => k !== i);
  }
  return { state: { ...state, saved }, error: null };
}

/**
 * Remove a place; clears `workId` / `tripId` when they referenced it.
 * @param {PlacesState} state
 * @param {string} id
 * @returns {PlacesState}
 */
export function removePlace(state, id) {
  return {
    ...state,
    saved: state.saved.filter((s) => s.id !== id),
    workId: state.workId === id ? null : state.workId,
    tripId: state.tripId === id ? null : state.tripId,
  };
}

/**
 * Set the work place (`null` clears; an id that is not saved also gives `null`).
 * @param {PlacesState} state
 * @param {string|null} id
 * @returns {PlacesState}
 */
export function setWork(state, id) {
  return { ...state, workId: state.saved.some((s) => s.id === id) ? id : null };
}

/**
 * Set the trip destination (`null` clears; an id that is not saved also gives `null`).
 * @param {PlacesState} state
 * @param {string|null} id
 * @returns {PlacesState}
 */
export function setTrip(state, id) {
  return { ...state, tripId: state.saved.some((s) => s.id === id) ? id : null };
}

/**
 * Read `ps:current`: a place id or `'gps'` (default and fallback for invalid values). Never throws.
 * @param {Storage|undefined} storage
 * @returns {string}
 */
export function readCurrent(storage) {
  try {
    const v = storage.getItem(CURRENT_KEY);
    return typeof v === "string" && ID_RE.test(v) ? v : "gps";
  } catch {
    return "gps";
  }
}

/**
 * Persist `ps:current` (an invalid value is stored as `'gps'`). Never throws.
 * @param {Storage|undefined} storage
 * @param {string} id Place id or `'gps'`.
 * @returns {void}
 */
export function writeCurrent(storage, id) {
  try {
    storage.setItem(CURRENT_KEY, typeof id === "string" && ID_RE.test(id) ? id : "gps");
  } catch {
    /* ignore */
  }
}
