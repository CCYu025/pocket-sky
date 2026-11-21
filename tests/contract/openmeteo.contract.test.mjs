// Contract tests against the REAL Open-Meteo APIs. Run: npm run test:contract
// (On Node >= 22.21 behind an HTTPS proxy, set NODE_USE_ENV_PROXY=1.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_PARAMS, AIR_PARAMS, ApiError, fetchJson,
  buildForecastUrl, buildAirQualityUrl, buildGeocodingUrl,
  getForecast, getAirQuality, searchPlaces,
} from '../../js/api/openmeteo.js';

const TAICHUNG = { lat: 24.16, lon: 120.64 };
const SUN_MOON_LAKE = { lat: 23.86, lon: 120.91 };
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/; // no offset suffix
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // daily.time is date-only

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetchJson with retries (shared egress IPs can hit 429 / transient proxy errors). */
async function fj(url) {
  for (let i = 0; ; i++) {
    try {
      return await fetchJson(url, { timeoutMs: 20000 });
    } catch (err) {
      if (i >= 3 || !(err instanceof ApiError) || (err.status !== 0 && err.status !== 429 && err.status < 500)) throw err;
      await sleep(4000 * (i + 1));
    }
  }
}

/** Assert a section has `time` plus every requested field with equal-length arrays. */
function assertSection(obj, section, fields, label) {
  const s = obj[section];
  assert.ok(s, `${label}: missing "${section}" section in response`);
  assert.ok(Array.isArray(s.time), `${label}: ${section}.time must be an array`);
  for (const f of fields) {
    assert.ok(f in s, `${label}: field "${f}" missing from ${section} (got: ${Object.keys(s).join(', ')})`);
    assert.ok(Array.isArray(s[f]), `${label}: ${section}.${f} must be an array`);
    assert.equal(s[f].length, s.time.length, `${label}: ${section}.${f} length ${s[f].length} != ${section}.time length ${s.time.length}`);
  }
  const re = section === 'daily' ? DATE_RE : TIME_RE;
  for (const t of s.time) assert.match(t, re, `${label}: ${section}.time has unexpected format "${t}"`);
  if (section === 'daily') {
    for (const k of ['sunrise', 'sunset']) {
      for (const t of s[k]) assert.match(t, TIME_RE, `${label}: daily.${k} has unexpected format "${t}"`);
    }
  }
}

function assertForecastShape(f, label) {
  assert.equal(f.utc_offset_seconds, 28800, `${label}: utc_offset_seconds`);
  assert.equal(typeof f.elevation, 'number', `${label}: elevation must be a number`);
  // current is a scalar object, not arrays
  assert.ok(f.current, `${label}: missing current`);
  assert.match(f.current.time, TIME_RE, `${label}: current.time format`);
  for (const k of FORECAST_PARAMS.current) {
    assert.ok(k in f.current, `${label}: current.${k} missing (got: ${Object.keys(f.current).join(', ')})`);
  }
  assertSection(f, 'hourly', FORECAST_PARAMS.hourly, label);
  assertSection(f, 'daily', FORECAST_PARAMS.daily, label);
  assertSection(f, 'minutely_15', FORECAST_PARAMS.minutely_15, label);
  // past_days=1 + forecast_days=2 -> 3 days -> 72 hourly, 3 daily, 288 quarter-hours
  assert.equal(f.hourly.time.length, 72, `${label}: hourly.time length`);
  assert.equal(f.daily.time.length, 3, `${label}: daily.time length`);
  assert.equal(f.minutely_15.time.length, 288, `${label}: minutely_15.time length`);
}

test('forecast: single location has every requested field', async () => {
  const [f] = await getForecast([TAICHUNG], { fetchImpl: (u, o) => fetchWithRetry(u, o) });
  assertForecastShape(f, 'taichung');
});

test('forecast: multiple locations return an array of 2 with distinct elevations', async () => {
  const body = await fj(buildForecastUrl([TAICHUNG, SUN_MOON_LAKE]));
  assert.ok(Array.isArray(body), 'multi-location forecast must be an array');
  assert.equal(body.length, 2);
  assertForecastShape(body[0], 'multi[0]');
  assertForecastShape(body[1], 'multi[1]');
  assert.notEqual(body[0].elevation, body[1].elevation, 'elevations should differ');
});

test('probe: minutely_15 precipitation_probability support for Taiwan (informational)', async (t) => {
  const sp = new URLSearchParams({
    latitude: String(TAICHUNG.lat), longitude: String(TAICHUNG.lon),
    minutely_15: 'precipitation,precipitation_probability', timezone: 'auto', forecast_days: '1',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${sp}`;
  try {
    const body = await fj(url);
    const arr = body.minutely_15?.precipitation_probability;
    const nonNull = Array.isArray(arr) ? arr.filter((v) => v !== null).length : 0;
    t.diagnostic(`minutely_15.precipitation_probability present=${Array.isArray(arr)} nonNullCount=${nonNull}/${arr?.length ?? 0}`);
    console.log(`PROBE minutely_15 precipitation_probability: present=${Array.isArray(arr)} nonNull=${nonNull}/${arr?.length ?? 0}`);
  } catch (err) {
    t.diagnostic(`probe rejected: ${err.status} ${err.reason}`);
    console.log(`PROBE minutely_15 precipitation_probability: rejected status=${err.status} reason=${err.reason}`);
  }
});

function assertAirShape(a, label) {
  assert.equal(typeof a.elevation, 'number', `${label}: elevation`);
  assert.ok(a.current, `${label}: missing current`);
  for (const k of AIR_PARAMS.current) assert.ok(k in a.current, `${label}: current.${k} missing (got: ${Object.keys(a.current).join(', ')})`);
  assertSection(a, 'hourly', AIR_PARAMS.hourly, label);
}

test('air quality: single location shape', async () => {
  const body = await fj(buildAirQualityUrl([TAICHUNG]));
  assert.ok(!Array.isArray(body), 'single-location air quality is a plain object');
  assertAirShape(body, 'air');
});

test('air quality: multi-location behaviour and shape', async (t) => {
  const body = await fj(buildAirQualityUrl([TAICHUNG, SUN_MOON_LAKE]));
  console.log(`PROBE air multi-location returns array: ${Array.isArray(body)}${Array.isArray(body) ? ` (length ${body.length})` : ''}`);
  t.diagnostic(`air multi returns array: ${Array.isArray(body)}`);
  const items = Array.isArray(body) ? body : [body];
  assert.ok(items.length >= 1);
  for (const [i, a] of items.entries()) assertAirShape(a, `air multi[${i}]`);
  // getAirQuality must always normalise to an array of the requested length
  const viaClient = await getAirQuality([TAICHUNG, SUN_MOON_LAKE], { fetchImpl: (u, o) => fetchWithRetry(u, o) });
  assert.ok(Array.isArray(viaClient));
  assert.equal(viaClient.length, 2, 'getAirQuality should return one entry per location');
});

test('geocoding: Chinese and English search (informational counts)', async (t) => {
  const zh = await searchPlaces('台中', { fetchImpl: (u, o) => fetchWithRetry(u, o), language: 'zh' });
  console.log(`PROBE geocoding 台中 zh: ${zh.length} results: ${zh.map((p) => `${p.name}/${p.admin1}/${p.country}`).join(' ; ')}`);
  const en = await searchPlaces('Taichung', { fetchImpl: (u, o) => fetchWithRetry(u, o), language: 'zh' });
  console.log(`PROBE geocoding Taichung zh: ${en.length} results: ${en.map((p) => `${p.name}/${p.admin1}/${p.country}`).join(' ; ')}`);
  t.diagnostic(`台中: ${zh.length} results, Taichung: ${en.length} results`);
  assert.ok(en.length > 0, 'searching "Taichung" should return at least one place');
  for (const p of en) {
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.lat, 'number');
    assert.equal(typeof p.lon, 'number');
  }
  assert.ok(await fetchJson(buildGeocodingUrl('台中'), { timeoutMs: 20000 }).then(() => true), 'raw geocoding request succeeds');
});

test('error path: invalid parameter -> HTTP 400 with reason and ApiError', async () => {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=24.16&longitude=120.64&hourly=not_a_field`;
  const res = await fetch(url);
  assert.equal(res.status, 400, 'expected HTTP 400 for invalid hourly field');
  const body = await res.json();
  assert.equal(body.error, true);
  assert.equal(typeof body.reason, 'string');
  await assert.rejects(fetchJson(url, { timeoutMs: 20000 }), (err) => {
    assert.ok(err instanceof ApiError, 'must be ApiError');
    assert.equal(err.name, 'ApiError');
    assert.equal(err.status, 400);
    assert.equal(err.reason, body.reason);
    return true;
  });
});

/** fetch wrapper that retries on 429 / transient failures, for use as fetchImpl. */
async function fetchWithRetry(url, opts) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429 && i < 3) { await sleep(4000 * (i + 1)); continue; }
      return res;
    } catch (err) {
      if (i >= 3) throw err;
      await sleep(4000 * (i + 1));
    }
  }
}
