/**
 * Synthetic-but-plausible fixtures for ONE day: Taichung, Sat 2026-11-21, thunderstorm afternoon.
 * Derived from the real captures in tests/fixtures (schema unchanged, values edited).
 *
 * Story of the day (everything in the promo agrees with this):
 *   14:20  Taichung 23 C, overcast. 14:00 is dry (rain 0 %), best exercise hour (score 93, AQI 84 = moderate).
 *   15-19  rain probability 60-90 % (thunderstorm 16-18), temperature falls 23 -> 17 C (jacket weather).
 *   work place  新竹: back-leg 18:00 rain 60 % (umbrella), feels 15 C (jacket)
 *   trip place  日月潭: 18 C now = -5 vs Taichung 23 C
 *   evening     20:30 night shot (LIGHT): 16 C, rain over (probability 30 %), air still moderate
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The app repo = parent of promo/ (override with POCKET_SKY_REPO). */
export const REPO = process.env.POCKET_SKY_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(REPO, "tests/fixtures", f), "utf8"));
const IDX = (h) => 24 + h; // 2026-11-21 HH:00 in the hourly arrays (past_days=1 -> index 0 = 11-20 00:00)

export const DAY_UTC = "2026-11-21T06:20:00Z"; // 14:20 Taipei
export const NIGHT_UTC = "2026-11-21T12:30:00Z"; // 20:30 Taipei

/** hour -> [temp, feels, humidity, rainProb, rain mm, weather_code, wind, gust, uv, visibility m] */
const TAICHUNG = {
  8: [16.5, 14.6, 61, 0, 0, 3, 10.9, 32.4, 0.6, 29680],
  9: [18.6, 16.1, 56, 0, 0, 3, 14.4, 36.4, 1.4, 32320],
  10: [20.7, 18.8, 52, 0, 0, 3, 11.2, 36.4, 2.4, 36000],
  11: [22.3, 21.0, 50, 0, 0, 3, 12.1, 33.1, 3.1, 35980],
  12: [23.0, 21.6, 52, 0, 0, 3, 13.6, 36.4, 3.4, 36000],
  13: [23.2, 21.8, 53, 0, 0, 3, 14.8, 38.9, 3.0, 36000],
  14: [23.0, 21.8, 55, 0, 0, 3, 15.2, 39.6, 2.6, 36000],
  15: [22.0, 20.4, 66, 60, 0.6, 80, 18.0, 41.0, 1.8, 20000],
  16: [20.0, 18.2, 80, 80, 3.2, 95, 26.0, 52.0, 0.8, 8000],
  17: [18.8, 16.6, 88, 90, 4.5, 95, 22.0, 48.0, 0.2, 5000],
  18: [18.0, 15.8, 85, 75, 2.1, 95, 18.0, 40.0, 0, 8000],
  19: [17.2, 15.0, 80, 60, 0.8, 80, 14.0, 34.0, 0, 14000],
  20: [16.5, 14.8, 75, 30, 0, 3, 11.0, 27.0, 0, 29700],
  21: [15.8, 14.4, 72, 20, 0, 3, 7.3, 21.6, 0, 29700],
  22: [15.2, 13.8, 70, 10, 0, 2, 6.8, 15.8, 0, 29700],
  23: [14.8, 13.4, 71, 5, 0, 2, 6.0, 14.8, 0, 29700],
};
/** 日月潭 (about 5 C cooler, afternoon rain starts at 17:00) */
const LAKE = {
  14: [18.0, 18.0, 62, 0, 0, 3, 8.0, 20.0, 2.0, 30000],
  15: [17.6, 17.2, 66, 10, 0, 3, 9.0, 22.0, 1.4, 26000],
  16: [16.8, 16.2, 72, 30, 0, 3, 10.0, 24.0, 0.8, 20000],
  17: [15.6, 14.6, 82, 60, 1.6, 95, 12.0, 30.0, 0.2, 9000],
  18: [14.8, 13.8, 88, 80, 3.0, 95, 12.0, 30.0, 0, 6000],
  19: [14.0, 13.0, 84, 70, 1.8, 80, 10.0, 26.0, 0, 8000],
  20: [13.3, 12.4, 80, 50, 0.6, 61, 8.0, 22.0, 0, 12000],
  21: [12.6, 11.8, 78, 30, 0, 3, 6.0, 16.0, 0, 20000],
};
/** 新竹 (work): evening commute 18:00-19:00 at 60 % rain, 0.8 mm, feels 15-14 C */
const WORK = {
  14: [22.0, 21.0, 60, 10, 0, 3, 14.0, 34.0, 2.0, 30000],
  15: [21.0, 19.6, 70, 40, 0.3, 61, 17.0, 40.0, 1.2, 18000],
  16: [19.6, 17.8, 78, 50, 1.2, 80, 20.0, 44.0, 0.6, 10000],
  17: [18.4, 16.4, 84, 60, 1.6, 80, 19.0, 42.0, 0.1, 8000],
  18: [17.0, 15.0, 86, 60, 0.8, 61, 18.0, 40.0, 0, 9000],
  19: [16.0, 14.0, 84, 60, 0.8, 61, 14.0, 34.0, 0, 12000],
  20: [15.4, 13.6, 80, 30, 0, 3, 11.0, 27.0, 0, 25000],
  21: [14.8, 13.2, 76, 20, 0, 3, 8.0, 22.0, 0, 29700],
};
const FIELDS = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation_probability", "precipitation", "weather_code", "wind_speed_10m", "wind_gusts_10m", "uv_index", "visibility"];

function apply(f, table) {
  for (const [h, row] of Object.entries(table)) FIELDS.forEach((k, j) => (f.hourly[k][IDX(+h)] = row[j]));
}
function setMinutely(f, table) {
  // minutely_15 = quarter-hour precipitation; spread each hour's mm over its 4 slots (index 0 = 11-20 00:00)
  for (const [h, row] of Object.entries(table)) for (let q = 0; q < 4; q++) f.minutely_15.precipitation[96 + +h * 4 + q] = +(row[4] / 4).toFixed(2);
}
function setCurrent(f, time, hour, over = {}) {
  const row = f.__row ?? null;
  const h = f.hourly;
  f.current = {
    ...f.current,
    time,
    interval: 900,
    temperature_2m: h.temperature_2m[IDX(hour)],
    apparent_temperature: h.apparent_temperature[IDX(hour)],
    relative_humidity_2m: h.relative_humidity_2m[IDX(hour)],
    weather_code: h.weather_code[IDX(hour)],
    wind_speed_10m: h.wind_speed_10m[IDX(hour)],
    wind_direction_10m: 225,
    is_day: hour < 17 ? 1 : 0,
    ...over,
  };
}

/** Taichung. `phase` "day" = observation 14:15 (clock 14:20); "night" = observation 20:15 (clock 20:30). */
export function taichung(phase = "day") {
  const f = read("forecast-taichung.json");
  apply(f, TAICHUNG);
  setMinutely(f, TAICHUNG);
  f.daily.temperature_2m_max[1] = 23.2;
  f.daily.temperature_2m_min[1] = 14.0;
  f.daily.uv_index_max[1] = 3.4;
  // yesterday (11-20) 14:00 was 21.5 C so the "Δ YDAY" reads +2 (not a heat story)
  f.hourly.temperature_2m[IDX(14) - 24] = 21.0;
  f.hourly.temperature_2m[IDX(20) - 24] = 15.0;
  if (phase === "day") setCurrent(f, "2026-11-21T14:15", 14, { temperature_2m: 23.0 });
  else setCurrent(f, "2026-11-21T20:15", 20);
  return f;
}
export function lake(phase = "day") {
  const f = read("forecast-multi.json")[1];
  apply(f, LAKE);
  setMinutely(f, LAKE);
  if (phase === "day") setCurrent(f, "2026-11-21T14:15", 14, { temperature_2m: 18.0, apparent_temperature: 18.0 });
  else setCurrent(f, "2026-11-21T20:15", 20);
  return f;
}
export function work(phase = "day") {
  const f = taichung(phase);
  f.latitude = 24.8;
  f.longitude = 120.97;
  f.elevation = 31;
  apply(f, WORK);
  setMinutely(f, WORK);
  if (phase === "day") setCurrent(f, "2026-11-21T14:15", 14);
  else setCurrent(f, "2026-11-21T20:15", 20);
  return f;
}
/** Air quality: AQI 84 ("moderate") through the afternoon, evening PM2.5 rises a little. */
export function air(phase = "day") {
  const a = read("air-taichung.json");
  const ix = phase === "day" ? 14 : 20;
  // PM2.5 stays in the "moderate" band all evening (the real capture climbs to 50 ug/m3, which would switch the mask on)
  a.hourly.pm2_5 = a.hourly.pm2_5.map((v, i) => (i >= 14 ? Math.min(v, 27 + (i % 3)) : v));
  a.current = { ...a.current, time: phase === "day" ? "2026-11-21T14:00" : "2026-11-21T20:00", interval: 3600, us_aqi: a.hourly.us_aqi[ix], pm2_5: a.hourly.pm2_5[ix] };
  return a;
}

export const PLACE = {
  LAKE: { id: "p:23.87,120.91", name: "日月潭", admin1: "南投縣", country: "臺灣", lat: 23.87, lon: 120.91, elevation: 748, timezone: "Asia/Taipei" },
  WORK: { id: "p:24.80,120.97", name: "新竹", admin1: "新竹縣", country: "臺灣", lat: 24.8, lon: 120.97, elevation: 31, timezone: "Asia/Taipei" },
  TAIPEI: { id: "p:25.04,121.53", name: "臺北", admin1: "臺北市", country: "臺灣", lat: 25.04, lon: 121.53, elevation: 9, timezone: "Asia/Taipei" },
};

/** Geocoding results for the picker (Open-Meteo `results` shape). */
export function geocode(name) {
  if (!/台中|臺中|taichung/i.test(name)) return [];
  const all = read("geocoding-taichung.json").results;
  return all.filter((r) => r.country_code === "TW").map((r) => ({ ...r, admin1: "臺中市", admin2: undefined, country: "臺灣" })); // 臺中市, 淸泉崗機場
}
