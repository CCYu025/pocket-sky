/**
 * WMO weather interpretation codes as used by Open-Meteo, with zh-Hant labels
 * and icon slugs. Pure module, no side effects.
 * @module domain/weathercode
 */

/** @type {Record<number, { label: string, icon: string, night?: { label: string, icon: string } }>} */
const CODES = {
  0: { label: '晴朗', icon: 'clear-day', night: { label: '晴朗', icon: 'clear-night' } },
  1: { label: '大致晴朗', icon: 'mostly-clear-day', night: { label: '大致晴朗', icon: 'mostly-clear-night' } },
  2: { label: '多雲', icon: 'partly-cloudy-day', night: { label: '多雲', icon: 'partly-cloudy-night' } },
  3: { label: '陰天', icon: 'overcast' },
  45: { label: '霧', icon: 'fog' },
  48: { label: '霧凇', icon: 'fog' },
  51: { label: '毛毛雨（輕）', icon: 'drizzle' },
  53: { label: '毛毛雨', icon: 'drizzle' },
  55: { label: '毛毛雨（強）', icon: 'drizzle' },
  56: { label: '凍毛毛雨（輕）', icon: 'freezing-drizzle' },
  57: { label: '凍毛毛雨（強）', icon: 'freezing-drizzle' },
  61: { label: '小雨', icon: 'rain' },
  63: { label: '中雨', icon: 'rain' },
  65: { label: '大雨', icon: 'heavy-rain' },
  66: { label: '凍雨（輕）', icon: 'freezing-rain' },
  67: { label: '凍雨（強）', icon: 'freezing-rain' },
  71: { label: '小雪', icon: 'snow' },
  73: { label: '中雪', icon: 'snow' },
  75: { label: '大雪', icon: 'heavy-snow' },
  77: { label: '雪粒', icon: 'snow-grains' },
  80: { label: '陣雨（輕）', icon: 'showers' },
  81: { label: '陣雨', icon: 'showers' },
  82: { label: '強陣雨', icon: 'heavy-showers' },
  85: { label: '陣雪（輕）', icon: 'snow-showers' },
  86: { label: '陣雪（強）', icon: 'snow-showers' },
  95: { label: '雷雨', icon: 'thunderstorm' },
  96: { label: '雷雨伴小冰雹', icon: 'thunderstorm-hail' },
  99: { label: '雷雨伴大冰雹', icon: 'thunderstorm-hail' },
};

/**
 * Describe a WMO weather code.
 * @param {number} code WMO weather code from Open-Meteo.
 * @param {boolean} [isDay=true] Whether it is daytime; selects night icon variants for codes 0-2.
 * @returns {{ label: string, icon: string }} zh-Hant label and icon slug; unknown codes give `{ label: "未知", icon: "unknown" }`.
 */
export function describeWeather(code, isDay = true) {
  const entry = CODES[code];
  if (!entry) return { label: '未知', icon: 'unknown' };
  const v = !isDay && entry.night ? entry.night : entry;
  return { label: v.label, icon: v.icon };
}

/**
 * List all WMO codes with a known description.
 * @returns {number[]} Sorted list of supported codes.
 */
export function knownWeatherCodes() {
  return Object.keys(CODES).map(Number).sort((a, b) => a - b);
}
