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

const TAIWAN = new Set(["臺灣", "台灣", "台湾", "Taiwan"]);

/**
 * True when a geocoding result is in Taiwan.
 * @param {{country?: string|null}} r
 * @returns {boolean}
 */
export function isTaiwan(r) {
  return TAIWAN.has(r?.country);
}

/**
 * Ordered unique query variants: the input with `台` replaced by `臺` first (when it contains
 * `台`), then the trimmed input.
 * @param {string} q
 * @returns {string[]} `[]` for an empty or whitespace query.
 */
export function searchVariants(q) {
  const t = typeof q === "string" ? q.trim() : "";
  if (!t) return [];
  const out = t.includes("台") ? [t.replaceAll("台", "臺"), t] : [t];
  return [...new Set(out)];
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
