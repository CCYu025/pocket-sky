import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toViewModel, computeYesterdayDelta } from '../../js/domain/derive.js';
import { localParts, addHours } from '../../js/time.js';

const load = (n) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8'));
const forecast = load('forecast-taichung.json');
const air = load('air-taichung.json');
const multi = load('forecast-multi.json');

const NOW = Date.UTC(2026, 10, 21, 6, 20); // 14:20 Taipei
const H14 = '2026-11-21T14:00';
const NOW_OBS = Date.UTC(2026, 10, 21, 12, 10); // 20:10 Taipei: 10 min after the fixture's current.time (20:00)

function assertClean(v, path = 'vm') {
  assert.notEqual(v, undefined, `${path} is undefined`);
  if (typeof v === 'number') assert.ok(!Number.isNaN(v), `${path} is NaN`);
  else if (Array.isArray(v)) v.forEach((x, i) => assertClean(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) assertClean(v[k], `${path}.${k}`);
}

test('hourKey floors to the hour', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW });
  assert.equal(vm.now.hourKey, H14);
  assert.equal(vm.now.minuteKey, '2026-11-21T14:20');
  assert.equal(vm.location.elevation, forecast.elevation);
  assert.equal(vm.location.utcOffsetSeconds, 28800);
});

test('fresh current: now fields come from current', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW_OBS });
  assert.equal(vm.now.hourKey, '2026-11-21T20:00');
  assert.equal(vm.now.temp, forecast.current.temperature_2m);
  assert.equal(vm.now.isDay, forecast.current.is_day);
  assert.equal(typeof vm.now.label, 'string');
  assert.equal(vm.location.elevation, forecast.elevation);
  assert.equal(vm.location.utcOffsetSeconds, 28800);
});

test('hours: 24 entries starting at the current hour', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW });
  const i = forecast.hourly.time.indexOf(H14);
  assert.equal(vm.hours.length, 24);
  assert.equal(vm.hours[0].hourKey, H14);
  assert.equal(vm.hours[0].hour, 14);
  assert.equal(vm.hours[0].temp, forecast.hourly.temperature_2m[i]);
  assert.equal(vm.hours[0].gust, forecast.hourly.wind_gusts_10m[i]);
  assert.equal(vm.hours[23].hourKey, forecast.hourly.time[i + 23]);
  assert.equal(vm.hours[10].hour, 0);
});

test('yesterdayDelta equals hand-computed hourly difference', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW });
  const i = forecast.hourly.time.indexOf(H14);
  const j = forecast.hourly.time.indexOf('2026-11-20T14:00');
  const expected = Math.round((forecast.hourly.temperature_2m[i] - forecast.hourly.temperature_2m[j]) * 10) / 10;
  assert.equal(vm.yesterdayDelta, expected);
});

test('minutely15 starts at the current 15-minute slot', () => {
  const a = toViewModel({ forecast, nowMs: NOW });
  assert.equal(a.minutely15.length, 8);
  assert.equal(a.minutely15[0].minuteKey, '2026-11-21T14:15');
  const i = forecast.minutely_15.time.indexOf('2026-11-21T14:15');
  assert.equal(a.minutely15[0].rain, forecast.minutely_15.precipitation[i]);
  assert.equal(a.minutely15[7].minuteKey, forecast.minutely_15.time[i + 7]);
  const b = toViewModel({ forecast, nowMs: Date.UTC(2026, 10, 21, 6, 44) }); // 14:44
  assert.equal(b.minutely15[0].minuteKey, '2026-11-21T14:30');
});

test('today matches the daily entry for the local date', () => {
  const vm = toViewModel({ forecast, nowMs: NOW });
  const d = forecast.daily.time.indexOf('2026-11-21');
  assert.equal(vm.today.max, forecast.daily.temperature_2m_max[d]);
  assert.equal(vm.today.min, forecast.daily.temperature_2m_min[d]);
  assert.equal(vm.today.sunrise, forecast.daily.sunrise[d]);
  assert.equal(vm.today.sunset, forecast.daily.sunset[d]);
  assert.equal(vm.today.daylightSeconds, forecast.daily.daylight_duration[d]);
  assert.equal(vm.today.uvMax, forecast.daily.uv_index_max[d]);
});

test('air quality joins by hourKey, not index', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW });
  const ai = air.hourly.time.indexOf(H14);
  assert.notEqual(ai, forecast.hourly.time.indexOf(H14)); // fixture is offset: index join would be wrong
  assert.equal(vm.hours[0].aqi, air.hourly.us_aqi[ai]);
  assert.equal(vm.hours[0].pm25, air.hourly.pm2_5[ai]);
  assert.deepEqual(vm.air, { aqi: air.current.us_aqi, pm25: air.current.pm2_5 });

  // Synthetic: air hourly out of order / shifted relative to forecast.
  const shifted = {
    current: { us_aqi: 1, pm2_5: 2 },
    hourly: { time: ['2026-11-21T17:00', '2026-11-21T16:00'], us_aqi: [170, 160], pm2_5: [17, 16] },
  };
  const s = toViewModel({ forecast, air: shifted, nowMs: NOW });
  assert.equal(s.hours[0].aqi, null);
  assert.equal(s.hours[2].aqi, 160); // 16:00
  assert.equal(s.hours[3].aqi, 170); // 17:00
  assert.equal(s.hours[3].pm25, 17);
});

test('air null gives null aqi everywhere', () => {
  const vm = toViewModel({ forecast, air: null, nowMs: NOW });
  assert.equal(vm.air, null);
  assert.ok(vm.hours.every((h) => h.aqi === null && h.pm25 === null));
});

test('near the end of data, hours are shorter than 24 and nothing throws', () => {
  const last = forecast.hourly.time.length - 1;
  const [d, t] = forecast.hourly.time[last].split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const nowMs = Date.UTC(y, mo - 1, da, Number(t.slice(0, 2)) - 8 - 5, 10); // 5 hours before the end
  const vm = toViewModel({ forecast, air, nowMs });
  assert.equal(vm.hours.length, 6);
  assert.equal(vm.hours.at(-1).hourKey, forecast.hourly.time[last]);
  assertClean(vm);
});

test('now outside the data window yields empty arrays', () => {
  const vm = toViewModel({ forecast, air, nowMs: Date.UTC(2030, 0, 1) });
  assert.deepEqual(vm.hours, []);
  assert.deepEqual(vm.minutely15, []);
  assert.equal(vm.yesterdayDelta, null);
  assert.equal(vm.today.max, null);
});

test('missing minutely_15 and daily give empty array / nulls', () => {
  const { minutely_15, daily, ...rest } = forecast;
  const vm = toViewModel({ forecast: rest, air, nowMs: NOW });
  assert.deepEqual(vm.minutely15, []);
  assert.deepEqual(vm.today, { max: null, min: null, sunrise: null, sunset: null, daylightSeconds: null, uvMax: null });
  assert.equal(vm.hours.length, 24);
  assertClean(vm);
});

test('minimal forecast object does not throw and has no undefined/NaN', () => {
  const vm = toViewModel({ forecast: { utc_offset_seconds: 0 }, nowMs: NOW });
  assert.deepEqual(vm.hours, []);
  assert.equal(vm.now.label, null);
  assertClean(vm);
});

test('no undefined or NaN anywhere in a full output', () => {
  assertClean(toViewModel({ forecast, air, nowMs: NOW }));
  assertClean(toViewModel({ forecast, air: null, nowMs: NOW }));
  const holey = structuredClone(forecast);
  holey.hourly.temperature_2m[forecast.hourly.time.indexOf(H14)] = null;
  holey.hourly.uv_index.length = 10;
  const vm = toViewModel({ forecast: holey, air, nowMs: NOW });
  assert.equal(vm.yesterdayDelta, null);
  assertClean(vm);
});

test('multi-location fixture: each element works and elevations differ', () => {
  assert.equal(multi.length, 2);
  const vms = multi.map((f) => toViewModel({ forecast: f, nowMs: NOW }));
  assert.notEqual(vms[0].location.elevation, vms[1].location.elevation);
  for (const vm of vms) {
    assert.equal(vm.hours.length, 24);
    assertClean(vm);
  }
});

// ---------------------------------------------------------------- staleness

test('stale current (observed 20:00, now 14:20): now.* falls back to the hourly entry', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW });
  const i = forecast.hourly.time.indexOf(H14);
  const h = forecast.hourly;
  assert.equal(vm.now.observedAt, '2026-11-21T20:00');
  assert.deepEqual(vm.stale, { current: true, ageMinutes: -340 });
  assert.equal(vm.now.temp, h.temperature_2m[i]);
  assert.equal(vm.now.feels, h.apparent_temperature[i]);
  assert.equal(vm.now.humidity, h.relative_humidity_2m[i]);
  assert.equal(vm.now.code, h.weather_code[i]);
  assert.equal(vm.now.wind, h.wind_speed_10m[i]);
  assert.equal(typeof vm.now.label, 'string');
  assert.equal(vm.now.windDir, null, 'hourly has no wind direction');
  assert.equal(vm.now.isDay, null, 'hourly has no is_day');
  assert.equal(vm.hoursAvailable, true);
  assertClean(vm);
});

test('fresh current (now 20:10): stale false and now comes from current', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW_OBS });
  assert.deepEqual(vm.stale, { current: false, ageMinutes: 10 });
  assert.equal(vm.now.observedAt, '2026-11-21T20:00');
  assert.equal(vm.now.temp, forecast.current.temperature_2m);
  assert.equal(vm.now.windDir, forecast.current.wind_direction_10m);
  assert.equal(vm.now.isDay, forecast.current.is_day);
});

test('stale boundary is 90 minutes either side', () => {
  const at = (min) => toViewModel({ forecast, nowMs: Date.UTC(2026, 10, 21, 12, 0) + min * 60000 }).stale;
  assert.equal(at(90).current, false);
  assert.equal(at(91).current, true);
  assert.equal(at(-90).current, false);
  assert.equal(at(-91).current, true);
});

test('two weeks later: stale, no hours, now.* all null', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW_OBS + 14 * 86400000 });
  assert.equal(vm.stale.current, true);
  assert.ok(vm.stale.ageMinutes > 90);
  assert.deepEqual(vm.hours, []);
  assert.equal(vm.hoursAvailable, false);
  for (const k of ['temp', 'feels', 'humidity', 'code', 'label', 'wind', 'windDir', 'isDay']) {
    assert.equal(vm.now[k], null, `now.${k}`);
  }
  assertClean(vm);
});

test('missing current.time: observedAt null, stale with ageMinutes null', () => {
  const f = structuredClone(forecast);
  delete f.current.time;
  const vm = toViewModel({ forecast: f, nowMs: NOW });
  assert.equal(vm.now.observedAt, null);
  assert.deepEqual(vm.stale, { current: true, ageMinutes: null });
  assertClean(vm);
});

// ---------------------------------------------------------------- yesterdayDelta -0

test('yesterdayDelta is never -0, and stays null when data is missing', () => {
  const hourly = { time: ['2026-11-20T14:00', '2026-11-21T14:00'], temperature_2m: [20.04, 20] };
  const d = computeYesterdayDelta(hourly, '2026-11-21T14:00');
  assert.ok(Object.is(d, 0), `expected +0, got ${Object.is(d, -0) ? '-0' : d}`);
  assert.equal(computeYesterdayDelta(null, '2026-11-21T14:00'), null);
  assert.equal(computeYesterdayDelta({ time: ['2026-11-21T14:00'], temperature_2m: [20] }, '2026-11-21T14:00'), null);
  const vm = toViewModel({ forecast: { utc_offset_seconds: 28800, hourly }, nowMs: NOW });
  assert.ok(Object.is(vm.yesterdayDelta, 0));
});

// ---------------------------------------------------------------- unusual offsets (synthetic)

/** Minimal forecast covering local date-1 .. date+1 for the given offset, temp = hour index. */
function synthetic(offset, nowMs) {
  const p = localParts(offset, nowMs);
  const first = addHours(`${p.date}T00:00`, -24);
  const time = Array.from({ length: 72 }, (_, i) => addHours(first, i));
  const dates = [-24, 0, 24].map((n) => addHours(`${p.date}T00:00`, n).slice(0, 10));
  return {
    p,
    forecast: {
      utc_offset_seconds: offset,
      current: { time: p.hourKey, temperature_2m: 99, weather_code: 0, is_day: 1 },
      hourly: { time, temperature_2m: time.map((_, i) => i) },
      daily: { time: dates, temperature_2m_max: [1, 2, 3], temperature_2m_min: [0, 1, 2], sunrise: dates.map((d) => `${d}T06:00`), sunset: dates.map((d) => `${d}T18:00`) },
    },
    time,
  };
}

test('offset -36000 (UTC-10): local date differs from the UTC date', () => {
  const nowMs = Date.UTC(2026, 10, 21, 5, 30); // 19:30 on 2026-11-20 local
  const { forecast: f, time } = synthetic(-36000, nowMs);
  const vm = toViewModel({ forecast: f, nowMs });
  assert.equal(vm.now.hourKey, '2026-11-20T19:00');
  assert.equal(vm.now.minuteKey, '2026-11-20T19:30');
  assert.equal(vm.stale.current, false);
  assert.equal(vm.now.temp, 99);
  assert.equal(vm.hours.length, 24);
  assert.equal(vm.hours[0].hourKey, '2026-11-20T19:00');
  assert.equal(vm.hours[5].hourKey, '2026-11-21T00:00');
  assert.equal(vm.hours[5].hour, 0);
  assert.equal(vm.yesterdayDelta, 24);
  assert.equal(vm.today.max, 2);
  assert.equal(vm.today.sunrise, '2026-11-20T06:00');
  assert.equal(vm.hours[0].temp, time.indexOf('2026-11-20T19:00'));
});

test('offset +20700 (+05:45): minutes offset and day rollover', () => {
  const nowMs = Date.UTC(2026, 10, 21, 18, 20); // 00:05 on 2026-11-22 local
  const { forecast: f } = synthetic(20700, nowMs);
  const vm = toViewModel({ forecast: f, nowMs });
  assert.equal(vm.now.hourKey, '2026-11-22T00:00');
  assert.equal(vm.now.minuteKey, '2026-11-22T00:05');
  assert.equal(vm.hours[0].hourKey, '2026-11-22T00:00');
  assert.equal(vm.hours[0].hour, 0);
  assert.equal(vm.hours.length, 24);
  assert.equal(vm.yesterdayDelta, 24);
  assert.equal(vm.today.max, 2);
  assert.equal(vm.today.sunset, '2026-11-22T18:00');
  assert.equal(vm.location.utcOffsetSeconds, 20700);
  const later = toViewModel({ forecast: f, nowMs: Date.UTC(2026, 10, 21, 18, 50) }); // 00:35 local
  assert.equal(later.now.hourKey, '2026-11-22T00:00');
});
