/**
 * One-line zh-Hant headline for the Today screen. Pure.
 * @module domain/summary
 */

const UNAVAILABLE = '資料暫時無法取得';
const RAIN_HEADLINE_MIN = 40;
const RAIN_LOOKAHEAD_HOURS = 6;
const DELTA_MIN = 4;

/**
 * Hour number (no zero padding) from an hourKey.
 * @param {string} hourKey
 * @returns {number}
 */
function hourOf(hourKey) {
  return Number(String(hourKey).slice(11, 13));
}

/**
 * Headline sentence. Priority: alert, rain within hours[1..6] (rainProb >= 40),
 * rounded |yesterdayDelta| >= 4, today's condition with max/min, unavailable.
 * @param {Object|null} vm View model.
 * @param {Object|null} [alert] Alert from `pickAlert`, or null.
 * @returns {string} Short zh-Hant sentence.
 */
export function headline(vm, alert = null) {
  if (!vm || vm.hoursAvailable === false || !vm.now) return UNAVAILABLE;

  if (alert) {
    if (alert.kind === 'rainJump') return `${hourOf(alert.startsAt)} 時起可能下雨，記得帶傘`;
    if (alert.kind === 'tempDrop') {
      const n = typeof alert.value === 'number' ? alert.value : Number((/\d+/.exec(alert.title) || [0])[0]);
      return `氣溫將下降 ${n}°，加件外套`;
    }
  }

  const rainy = (vm.hours || [])
    .slice(1, RAIN_LOOKAHEAD_HOURS + 1)
    .find((h) => typeof h.rainProb === 'number' && h.rainProb >= RAIN_HEADLINE_MIN);
  if (rainy) return `${hourOf(rainy.hourKey)} 時可能下雨，記得帶傘`;

  const d = vm.yesterdayDelta;
  // Threshold is applied to the rounded value so the sentence never says "0°-3°".
  const n = typeof d === 'number' ? Math.round(Math.abs(d)) : 0;
  if (n >= DELTA_MIN) {
    return d < 0 ? `比昨天冷 ${n}°，加件外套` : `比昨天熱 ${n}°，注意補水`;
  }

  const label = vm.now.label;
  if (typeof label !== 'string' || label === '') return UNAVAILABLE;
  const t = vm.today || {};
  if (typeof t.max === 'number' && typeof t.min === 'number') {
    return `今天${label}，${Math.round(t.max)}° / ${Math.round(t.min)}°`;
  }
  return `今天${label}`;
}
