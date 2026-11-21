import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toViewModel } from '../../js/domain/derive.js';

const load = (n) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8'));
const forecast = load('forecast-taichung.json');
const air = load('air-taichung.json');
const multi = load('forecast-multi.json');

const NOW = Date.UTC(2026, 10, 21, 6, 20); // 14:20 Taipei
const H14 = '2026-11-21T14:00';

function assertClean(v, path = 'vm') {
  assert.notEqual(v, undefined, `${path} is undefined`);
  if (typeof v === 'number') assert.ok(!Number.isNaN(v), `${path} is NaN`);
  else if (Array.isArray(v)) v.forEach((x, i) => assertClean(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) assertClean(v[k], `${path}.${k}`);
}

test('hourKey floors to the hour and now fields come from current', () => {
  const vm = toViewModel({ forecast, air, nowMs: NOW });
  assert.equal(vm.now.hourKey, H14);
  assert.equal(vm.now.minuteKey, '2026-11-21T14:20');
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
