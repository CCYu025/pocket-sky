/**
 * Hash router (pure).
 * @module ui/route
 */

export const SCENARIOS = Object.freeze(["commute", "exercise"]);
export const SCENARIO_NAMES = Object.freeze({ commute: "通勤", exercise: "運動" });

/**
 * Parse `location.hash`.
 * `#outing` opens the last used scenario; `#outing/commute` and `#outing/exercise` open that
 * scenario; an unknown scenario falls back to the last used one; every other hash is Today.
 * @param {string} hash e.g. `"#outing/exercise"`.
 * @param {string} [lastScenario] Last persisted scenario (default `commute`).
 * @returns {{name: 'today'|'outing', scenario: (string|null), key: string}} `key` is a stable route
 *   identity for animation bookkeeping: `today`, `outing/commute` or `outing/exercise`.
 */
export function parseRoute(hash, lastScenario = "commute") {
  const m = /^#outing(?:\/([^/?]*))?\/?$/.exec(String(hash ?? ""));
  if (!m) return { name: "today", scenario: null, key: "today" };
  const last = SCENARIOS.includes(lastScenario) ? lastScenario : "commute";
  const scenario = SCENARIOS.includes(m[1]) ? m[1] : last;
  return { name: "outing", scenario, key: `outing/${scenario}` };
}

/**
 * Link target for a scenario chip.
 * @param {string} scenario `commute` or `exercise`.
 * @returns {string} e.g. `#outing/commute`.
 */
export function scenarioHref(scenario) {
  return `#outing/${scenario}`;
}
