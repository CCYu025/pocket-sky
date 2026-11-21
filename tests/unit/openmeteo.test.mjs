import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_PARAMS, AIR_PARAMS, ATTRIBUTION, ApiError, fetchJson,
  buildForecastUrl, buildAirQualityUrl, buildGeocodingUrl,
  getForecast, getAirQuality, searchPlaces,
} from '../../js/api/openmeteo.js';

const A = { lat: 24.16, lon: 120.64 };
const B = { lat: 23.86, lon: 120.91 };

/** Fake fetch returning a JSON response; records URLs. */
function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

/** Fake duck-typed cache. */
function fakeCache(entries = {}) {
  const store = new Map(Object.entries(entries));
  const sets = [];
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, value, ttlMs) => { sets.push({ k, value, ttlMs }); store.set(k, { value, savedAt: 0, fresh: true }); },
    sets,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('ATTRIBUTION constant', () => {
  assert.deepEqual({ ...ATTRIBUTION }, { text: 'Weather data by Open-Meteo.com', href: 'https://open-meteo.com/' });
});

test('buildForecastUrl: exact params, comma-joined multi-location', () => {
  const u = new URL(buildForecastUrl([A, B]));
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  const p = u.searchParams;
  assert.equal(p.get('latitude'), '24.16,23.86');
  assert.equal(p.get('longitude'), '120.64,120.91');
  assert.equal(p.get('current'), FORECAST_PARAMS.current.join(','));
  assert.equal(p.get('current'), 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day');
  assert.equal(p.get('hourly'), 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,visibility');
  assert.equal(p.get('daily'), 'temperature_2m_max,temperature_2m_min,sunrise,sunset,daylight_duration,uv_index_max');
  assert.equal(p.get('minutely_15'), 'precipitation');
  assert.equal(p.get('past_days'), '1');
  assert.equal(p.get('forecast_days'), '2');
  assert.equal(p.get('timezone'), 'auto');
});

test('buildForecastUrl: rejects empty locations', () => {
  assert.throws(() => buildForecastUrl([]), TypeError);
});

test('buildAirQualityUrl: exact params', () => {
  const u = new URL(buildAirQualityUrl([A, B]));
  assert.equal(u.origin + u.pathname, 'https://air-quality-api.open-meteo.com/v1/air-quality');
  assert.equal(u.searchParams.get('latitude'), '24.16,23.86');
  assert.equal(u.searchParams.get('longitude'), '120.64,120.91');
  assert.equal(u.searchParams.get('current'), 'us_aqi,pm2_5');
  assert.equal(u.searchParams.get('hourly'), AIR_PARAMS.hourly.join(','));
  assert.equal(u.searchParams.get('timezone'), 'auto');
});

test('buildGeocodingUrl: defaults and encoding', () => {
  const u = new URL(buildGeocodingUrl('台中'));
  assert.equal(u.origin + u.pathname, 'https://geocoding-api.open-meteo.com/v1/search');
  assert.equal(u.searchParams.get('name'), '台中');
  assert.equal(u.searchParams.get('count'), '5');
  assert.equal(u.searchParams.get('language'), 'zh');
  assert.equal(u.searchParams.get('format'), 'json');
  const v = new URL(buildGeocodingUrl('a b', { count: 10, language: 'en' }));
  assert.equal(v.searchParams.get('count'), '10');
  assert.equal(v.searchParams.get('language'), 'en');
  assert.equal(v.searchParams.get('name'), 'a b');
});

test('getForecast: single object response becomes a one-element array', async () => {
  const f = fakeFetch({ elevation: 83 });
  const out = await getForecast([A], { fetchImpl: f });
  assert.deepEqual(out, [{ elevation: 83 }]);
  assert.equal(f.calls.length, 1);
});

test('getForecast: array response is preserved', async () => {
  const out = await getForecast([A, B], { fetchImpl: fakeFetch([{ elevation: 1 }, { elevation: 2 }]) });
  assert.equal(out.length, 2);
});

test('getAirQuality: normalises single object to array', async () => {
  const out = await getAirQuality([A], { fetchImpl: fakeFetch({ current: { us_aqi: 50 } }) });
  assert.deepEqual(out, [{ current: { us_aqi: 50 } }]);
});

test('searchPlaces: maps results, empty when missing', async () => {
  const body = { results: [{ name: '臺中市', admin1: '臺灣省', country: '台湾', latitude: 24.14, longitude: 120.68, elevation: 80, timezone: 'Asia/Taipei', id: 1 }] };
  const out = await searchPlaces('Taichung', { fetchImpl: fakeFetch(body) });
  assert.deepEqual(out, [{ name: '臺中市', admin1: '臺灣省', country: '台湾', lat: 24.14, lon: 120.68, elevation: 80, timezone: 'Asia/Taipei' }]);
  assert.deepEqual(await searchPlaces('zzz', { fetchImpl: fakeFetch({ generationtime_ms: 1 }) }), []);
});

test('fetchJson: HTTP 400 with reason', async () => {
  await assert.rejects(
    fetchJson('http://x', { fetchImpl: fakeFetch({ error: true, reason: 'bad field' }, { status: 400 }) }),
    (e) => e instanceof ApiError && e.name === 'ApiError' && e.status === 400 && e.reason === 'bad field',
  );
});

test('fetchJson: HTTP error without JSON body falls back to status text', async () => {
  const f = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
  await assert.rejects(fetchJson('http://x', { fetchImpl: f }), (e) => e.status === 502 && e.reason === 'HTTP 502');
});

test('fetchJson: {error:true} body on HTTP 200', async () => {
  await assert.rejects(
    fetchJson('http://x', { fetchImpl: fakeFetch({ error: true, reason: 'oops' }) }),
    (e) => e instanceof ApiError && e.reason === 'oops',
  );
});

test('fetchJson: timeout aborts the request signal', async () => {
  let signal;
  const f = (url, opts) => { signal = opts.signal; return new Promise(() => {}); };
  await assert.rejects(
    fetchJson('http://x', { fetchImpl: f, timeoutMs: 20 }),
    (e) => e instanceof ApiError && e.status === 0 && e.reason === 'timeout',
  );
  assert.equal(signal.aborted, true);
});

test('fetchJson: timeout with fetch that rejects on abort', async () => {
  const f = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(fetchJson('http://x', { fetchImpl: f, timeoutMs: 20 }), (e) => e.status === 0 && e.reason === 'timeout');
});

test('fetchJson: network failure', async () => {
  const f = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    fetchJson('http://x', { fetchImpl: f }),
    (e) => e instanceof ApiError && e.status === 0 && e.reason === 'fetch failed',
  );
});

test('fetchJson: returns parsed body on success', async () => {
  assert.deepEqual(await fetchJson('http://x', { fetchImpl: fakeFetch({ a: 1 }) }), { a: 1 });
});

test('SWR: miss fetches and stores with contract key and TTL', async () => {
  const cache = fakeCache();
  const f = fakeFetch({ elevation: 1 });
  const out = await getForecast([A, B], { fetchImpl: f, cache });
  assert.deepEqual(out, [{ elevation: 1 }]);
  assert.equal(f.calls.length, 1);
  assert.equal(cache.sets.length, 1);
  assert.equal(cache.sets[0].k, 'om:v1:forecast:24.16,120.64|23.86,120.91');
  assert.equal(cache.sets[0].ttlMs, 15 * 60 * 1000);
  const air = fakeCache();
  await getAirQuality([A], { fetchImpl: fakeFetch({}), cache: air });
  assert.equal(air.sets[0].k, 'om:v1:air:24.16,120.64');
  assert.equal(air.sets[0].ttlMs, 30 * 60 * 1000);
});

test('SWR: ttlMs override', async () => {
  const cache = fakeCache();
  await getForecast([A], { fetchImpl: fakeFetch({}), cache, ttlMs: 1234 });
  assert.equal(cache.sets[0].ttlMs, 1234);
});

test('SWR: fresh hit returns cached without fetching', async () => {
  const cache = fakeCache({ 'om:v1:forecast:24.16,120.64': { value: [{ cached: true }], savedAt: 0, fresh: true } });
  const f = fakeFetch({ fresh: true });
  let updated = false;
  const out = await getForecast([A], { fetchImpl: f, cache, onUpdate: () => { updated = true; } });
  assert.deepEqual(out, [{ cached: true }]);
  assert.equal(f.calls.length, 0);
  await tick();
  assert.equal(updated, false);
});

test('SWR: stale hit returns cached then onUpdate with fresh data', async () => {
  const cache = fakeCache({ 'om:v1:forecast:24.16,120.64': { value: [{ cached: true }], savedAt: 0, fresh: false } });
  const f = fakeFetch({ fresh: true });
  const updates = [];
  const out = await getForecast([A], { fetchImpl: f, cache, onUpdate: (v) => updates.push(v) });
  assert.deepEqual(out, [{ cached: true }]);
  await tick();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(updates, [[{ fresh: true }]]);
  assert.equal(cache.sets.length, 1);
});

test('SWR: background error goes to onError and does not throw', async () => {
  const cache = fakeCache({ 'om:v1:forecast:24.16,120.64': { value: [{ cached: true }], savedAt: 0, fresh: false } });
  const errors = [];
  const rejections = [];
  const handler = (r) => rejections.push(r);
  process.on('unhandledRejection', handler);
  try {
    const out = await getForecast([A], {
      fetchImpl: fakeFetch({ error: true, reason: 'down' }, { status: 500 }),
      cache,
      onError: (e) => errors.push(e),
    });
    assert.deepEqual(out, [{ cached: true }]);
    await tick();
    await tick();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].reason, 'down');
    assert.equal(rejections.length, 0);
  } finally {
    process.off('unhandledRejection', handler);
  }
});

test('SWR: background error without onError is swallowed', async () => {
  const cache = fakeCache({ 'om:v1:forecast:24.16,120.64': { value: [1], savedAt: 0, fresh: false } });
  const out = await getForecast([A], { fetchImpl: async () => { throw new Error('x'); }, cache });
  assert.deepEqual(out, [1]);
  await tick();
});

test('SWR: miss with fetch failure throws ApiError', async () => {
  await assert.rejects(
    getForecast([A], { fetchImpl: async () => { throw new Error('offline'); }, cache: fakeCache() }),
    (e) => e instanceof ApiError && e.status === 0,
  );
});

test('searchPlaces uses cache key with language/count/name', async () => {
  const cache = fakeCache();
  await searchPlaces(' Taichung ', { fetchImpl: fakeFetch({ results: [] }), cache });
  assert.equal(cache.sets[0].k, 'om:v1:geocoding:zh:5:taichung');
  assert.equal(cache.sets[0].ttlMs, 30 * 24 * 60 * 60 * 1000);
});
