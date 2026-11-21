/**
 * Place search helpers: query variants, fallback search, result ordering (pure; the search
 * function is injected).
 * @module domain/place-search
 */
import { placeFromSearchResult } from "../app/places-state.js";

/** Maximum number of results returned. */
export const MAX_RESULTS = 8;
/** UI hint when a CJK query finds nothing (no dictionary is used to invent an English query). */
export const SEARCH_HINT = "試試英文名稱，例如 Taichung";
/** Second hint line for the empty result state. */
export const SEARCH_HINT_SUFFIX = "或加上「市」，例如 花蓮市";

const TAIWAN = new Set(["臺灣", "台灣", "台湾", "Taiwan"]);

/**
 * True when a geocoding result is in Taiwan.
 * @param {{country?: string|null}} r
 * @returns {boolean}
 */
export function isTaiwan(r) {
  return TAIWAN.has(r?.country);
}

/** Maximum number of query variants tried. */
export const MAX_VARIANTS = 4;
const CJK_RE = /[\u3400-\u9fff]/;
const ADMIN_SUFFIX_RE = /[市縣鄉鎮區]$/;

/**
 * Swap the 台/臺 spelling: a query containing `台` gets `臺`, otherwise `臺` becomes `台`
 * (the geocoder matches only one spelling per city: `臺中市` but `台北市`).
 * @param {string} t
 * @returns {string}
 */
function swapTai(t) {
  return t.includes("台") ? t.replaceAll("台", "臺") : t.replaceAll("臺", "台");
}

/**
 * Ordered unique query variants, at most `MAX_VARIANTS`: the trimmed input, its 台/臺-swapped
 * spelling and, for a CJK query that does not already end in 市/縣/鄉/鎮/區, both of those with
 * `市` appended (`台中` → `台中`, `臺中`, `台中市`, `臺中市`). The live geocoder only matches full
 * names with their administrative suffix, so a bare city name needs the `市` variants.
 * @param {string} q
 * @returns {string[]} `[]` for an empty or whitespace query.
 */
export function searchVariants(q) {
  const t = typeof q === "string" ? q.trim() : "";
  if (!t) return [];
  const sw = swapTai(t);
  const out = [t, sw];
  if (CJK_RE.test(t) && !ADMIN_SUFFIX_RE.test(t)) out.push(`${t}市`, `${sw}市`);
  return [...new Set(out)].slice(0, MAX_VARIANTS);
}

/**
 * Search with variants in order until one gives at least one usable result. Results are deduped
 * by 2-dp place id (first wins), Taiwan results come first (stable), at most `MAX_RESULTS`.
 * A rejection of `search` propagates (the UI shows the error).
 * @param {string} q
 * @param {(name: string) => Promise<object[]>} search E.g. `searchPlaces` with deps bound.
 * @returns {Promise<{ results: object[], usedQuery: string }>} `results` are the raw search
 *   results; `usedQuery` is the last variant tried (`''` without calling `search` for an empty query).
 */
export async function searchWithFallback(q, search) {
  let usedQuery = "";
  for (const v of searchVariants(q)) {
    usedQuery = v;
    const raw = await search(v);
    const seen = new Set();
    const results = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const p = placeFromSearchResult(r);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      results.push(r);
    }
    if (results.length > 0) {
      const ordered = [...results.filter(isTaiwan), ...results.filter((r) => !isTaiwan(r))];
      return { results: ordered.slice(0, MAX_RESULTS), usedQuery };
    }
  }
  return { results: [], usedQuery };
}
