/**
 * Alert rules for the Today screen. Pure: "now" is injected as `nowMs`.
 * @module rules/alerts
 */

/** Thresholds for every alert rule (single source of truth). */
export const ALERT_RULES = {
  rainJump: { windowHours: 3, fromMax: 30, toMin: 60 },
  tempDrop: { windowHours: 3, minDrop: 4 },
  cooldownHours: 3,
};

const PRIORITY = { rainJump: 2, tempDrop: 1 };
const HOUR_MS = 3600e3;

/**
 * Alert identity: one id per event (kind + the hour the event starts).
 * @param {string} kind
 * @param {string} startsAt hourKey ("YYYY-MM-DDTHH:00")
 * @returns {string} `${kind}:${startsAt}`
 */
function eventId(kind, startsAt) {
  return `${kind}:${startsAt}`;
}

/**
 * "HH:00" from an hourKey ("YYYY-MM-DDTHH:00").
 * @param {string} hourKey
 * @returns {string}
 */
function clock(hourKey) {
  return `${String(hourKey).slice(11, 13)}:00`;
}

/**
 * Evaluate the rain-jump rule.
 * @param {Object} vm View model.
 * @returns {Object|null} Alert or null.
 */
function rainJump(vm) {
  const { windowHours, fromMax, toMin } = ALERT_RULES.rainJump;
  const cur = vm.hours[0] && vm.hours[0].rainProb;
  if (typeof cur !== 'number' || cur > fromMax) return null;
  const hit = vm.hours
    .slice(1, windowHours + 1)
    .find((h) => typeof h.rainProb === 'number' && h.rainProb >= toMin);
  if (!hit) return null;
  return {
    id: eventId('rainJump', hit.hourKey),
    kind: 'rainJump',
    startsAt: hit.hourKey,
    title: `${clock(hit.hourKey)} 起可能下雨`,
    detail: `降雨機率 ${Math.round(hit.rainProb)}%`,
    priority: PRIORITY.rainJump,
    value: Math.round(hit.rainProb),
  };
}

/**
 * Evaluate the temperature-drop rule.
 * @param {Object} vm View model.
 * @returns {Object|null} Alert or null.
 */
function tempDrop(vm) {
  const { windowHours, minDrop } = ALERT_RULES.tempDrop;
  const cur = vm.hours[0] && vm.hours[0].temp;
  if (typeof cur !== 'number') return null;
  let low = null;
  for (const h of vm.hours.slice(1, windowHours + 1)) {
    if (typeof h.temp === 'number' && (low === null || h.temp < low.temp)) low = h;
  }
  if (!low || cur - low.temp < minDrop) return null;
  const drop = Math.round(cur - low.temp);
  return {
    id: eventId('tempDrop', low.hourKey),
    kind: 'tempDrop',
    startsAt: low.hourKey,
    title: `氣溫將下降 ${drop}°`,
    detail: `${clock(low.hourKey)} 降至 ${Math.round(low.temp)}°`,
    priority: PRIORITY.tempDrop,
    value: drop,
  };
}

/**
 * Evaluate all alert rules against a view model.
 * Extra field beyond the documented contract: `value` (rounded rain % or
 * temperature drop), used by `headline`.
 * @param {Object|null} vm View model from `toViewModel`.
 * @param {Object} opts
 * @param {Object<string, string>} [opts.dismissed={}] Dismissed alert ids (id -> truthy).
 * @param {Object<string, number>} [opts.lastShown={}] kind -> epoch ms the kind was last shown.
 * @param {Object<string, string>} [opts.lastShownId={}] Addition to the contract:
 *   kind -> alert id (event) that was last shown. A kind inside its cooldown is
 *   suppressed for a *different* event of that kind, but the same id
 *   (`lastShownId[kind] === id`) is exempt, so re-renders keep showing it.
 * @param {number} opts.nowMs Current epoch ms (injected).
 * @returns {Array<{id: string, kind: string, startsAt: string, title: string, detail: string, priority: number, value: number}>}
 *   Alerts, highest priority first.
 */
export function evaluateAlerts(vm, { dismissed = {}, lastShown = {}, lastShownId = {}, nowMs } = {}) {
  if (!vm || !vm.hoursAvailable || !Array.isArray(vm.hours) || vm.hours.length === 0) return [];
  const out = [];
  for (const [kind, fn] of [['rainJump', rainJump], ['tempDrop', tempDrop]]) {
    const alert = fn(vm);
    if (!alert) continue;
    const { id } = alert;
    if (dismissed && dismissed[id]) continue;
    const shownAt = lastShown ? lastShown[kind] : undefined;
    const inCooldown =
      typeof shownAt === 'number' && nowMs - shownAt < ALERT_RULES.cooldownHours * HOUR_MS;
    if (inCooldown && !(lastShownId && lastShownId[kind] === id)) continue;
    out.push(alert);
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/**
 * Choose the single alert to display.
 * @param {Array<Object>} alerts Output of `evaluateAlerts`.
 * @returns {Object|null} First alert or null.
 */
export function pickAlert(alerts) {
  return Array.isArray(alerts) && alerts.length > 0 ? alerts[0] : null;
}
