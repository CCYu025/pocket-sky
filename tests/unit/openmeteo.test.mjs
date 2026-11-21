import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_PARAMS, AIR_PARAMS, ATTRIBUTION, ApiError, fetchJson,
  buildForecastUrl, buildAirQualityUrl, buildGeocodingUrl,
  getForecast, getAirQuality, searchPlaces, __resetInflight,
} from '../../js/api/openmeteo.js';
import { cacheKey, TTL } from '../../js/cache.js';

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

beforeEach(() => __resetInflight());

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
  const out = await getForecast([A], { fetchImpl: f, cache, now: () => 1000, onUpdate: (v) => updates.push(v) });
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
      now: () => 1000,
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
  const out = await getForecast([A], { fetchImpl: async () => { throw new Error('x'); }, cache, now: () => 1000 });
  assert.deepEqual(out, [1]);
  await tick();
});

test('SWR: miss with fetch failure throws ApiError', async () => {
  await assert.rejects(
    getForecast([A], { fetchImpl: async () => { throw new Error('offline'); }, cache: fakeCache() }),
    (e) => e instanceof ApiError && e.status === 0,
  );
});

test('searchPlaces builds the URL from the trimmed name (original case); key is trimmed + lowercased', async () => {
  const cache = fakeCache();
  const f = fakeFetch({ results: [] });
  await searchPlaces('TAICHUNG ', { fetchImpl: f, cache });
  assert.equal(new URL(f.calls[0].url).searchParams.get('name'), 'TAICHUNG');
  assert.ok(f.calls[0].url.includes('name=TAICHUNG&'));
  assert.equal(cache.sets[0].k, 'om:v1:geocoding:zh:5:taichung');
});

test('searchPlaces uses cache key with language/count/name', async () => {
  const cache = fakeCache();
  await searchPlaces(' Taichung ', { fetchImpl: fakeFetch({ results: [] }), cache });
  assert.equal(cache.sets[0].k, 'om:v1:geocoding:zh:5:taichung');
  assert.equal(cache.sets[0].ttlMs, 30 * 24 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------- SWR dedupe / ordering

const KEY_A = 'om:v1:forecast:24.16,120.64';

/** Cache whose entry stays stale (fresh:false, savedAt 1000) after every set. */
function staleCache(value) {
  const store = new Map([[KEY_A, { value, savedAt: 1000, fresh: false }]]);
  const sets = [];
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, v, ttlMs) => { sets.push({ k, value: v, ttlMs }); store.set(k, { value: v, savedAt: 1000, fresh: false }); },
    sets,
    store,
  };
}

/** Fetch whose responses are released manually, in call order. */
function gatedFetch() {
  const calls = [];
  const impl = (url) => new Promise((resolve) => {
    calls.push({ url, release: (body) => resolve({ ok: true, status: 200, json: async () => body }) });
  });
  impl.calls = calls;
  return impl;
}

test('SWR dedupe: two concurrent stale calls share one fetch; onUpdate gets the fresh value and { key }', async () => {
  const cache = staleCache([{ v: 'old' }]);
  const f = gatedFetch();
  const u1 = [];
  const u2 = [];
  const r1 = await getForecast([A], { fetchImpl: f, cache, now: () => 2000, onUpdate: (v, meta) => u1.push([v, meta]) });
  const r2 = await getForecast([A], { fetchImpl: f, cache, now: () => 2000, onUpdate: (v, meta) => u2.push([v, meta]) });
  assert.deepEqual(r1, [{ v: 'old' }]);
  assert.deepEqual(r2, [{ v: 'old' }]);
  await tick();
  assert.equal(f.calls.length, 1, 'exactly one network request');
  f.calls[0].release({ v: 'new' });
  await tick();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(u1, [[[{ v: 'new' }], { key: KEY_A }]]);
  assert.deepEqual(u2, [[[{ v: 'new' }], { key: KEY_A }]]);
  assert.equal(cache.sets.length, 1);
  assert.deepEqual(cache.store.get(KEY_A).value, [{ v: 'new' }]);
});

test('SWR dedupe: in-flight entry is removed afterwards so a later stale call refetches', async () => {
  const cache = staleCache([1]);
  const f = fakeFetch({ n: 1 });
  await getForecast([A], { fetchImpl: f, cache, now: () => 2000 });
  await tick();
  await getForecast([A], { fetchImpl: f, cache, now: () => 2000 });
  await tick();
  assert.equal(f.calls.length, 2);
});

test('SWR dedupe: concurrent misses share one fetch and the same value', async () => {
  const cache = fakeCache();
  const f = gatedFetch();
  const p1 = getForecast([A], { fetchImpl: f, cache });
  const p2 = getForecast([A], { fetchImpl: f, cache });
  await tick();
  assert.equal(f.calls.length, 1);
  f.calls[0].release({ elevation: 7 });
  const [v1, v2] = await Promise.all([p1, p2]);
  assert.deepEqual(v1, [{ elevation: 7 }]);
  assert.equal(v1, v2, 'same value instance');
  assert.equal(cache.sets.length, 1);
});

test('SWR dedupe: a failed shared load is removed from in-flight and reaches every caller', async () => {
  const cache = fakeCache();
  const bad = async () => { throw new Error('offline'); };
  const results = await Promise.allSettled([
    getForecast([A], { fetchImpl: bad, cache }),
    getForecast([A], { fetchImpl: bad, cache }),
  ]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
  const f = fakeFetch({ ok: 1 });
  assert.deepEqual(await getForecast([A], { fetchImpl: f, cache }), [{ ok: 1 }]);
});

test('SWR ordering: a load that finishes after a newer write (savedAt) is discarded', async () => {
  const cache = staleCache([{ v: 'cached' }]);
  const slow = gatedFetch();
  const updates = [];
  const onUpdate = (v) => updates.push(v);
  await getForecast([A], { fetchImpl: slow, cache, now: () => 2000, onUpdate });
  await tick();
  // Another writer (e.g. another tab) lands a newer entry while the load is pending.
  cache.store.set(KEY_A, { value: [{ v: 'newer' }], savedAt: Date.now() + 1000, fresh: true });
  slow.calls[0].release({ v: 'older' });
  await tick();
  assert.deepEqual(cache.store.get(KEY_A).value, [{ v: 'newer' }], 'pending load must not overwrite');
  assert.equal(cache.sets.length, 0);
  assert.deepEqual(updates, [], 'pending load must not reach onUpdate');
});

test('in-flight is scoped per cache instance: different caches both fetch and both get written', async () => {
  const c1 = fakeCache();
  const c2 = fakeCache();
  const f = gatedFetch();
  const p1 = getForecast([A], { fetchImpl: f, cache: c1 });
  const p2 = getForecast([A], { fetchImpl: f, cache: c2 });
  await tick();
  assert.equal(f.calls.length, 2);
  f.calls[0].release({ n: 1 });
  f.calls[1].release({ n: 2 });
  await Promise.all([p1, p2]);
  assert.equal(c1.sets.length, 1);
  assert.equal(c2.sets.length, 1);
});

test('in-flight: same cache instance shares one fetch', async () => {
  const c1 = fakeCache();
  const f = gatedFetch();
  const p1 = getForecast([A], { fetchImpl: f, cache: c1 });
  const p2 = getForecast([A], { fetchImpl: f, cache: c1 });
  await tick();
  assert.equal(f.calls.length, 1);
  f.calls[0].release({ n: 1 });
  await Promise.all([p1, p2]);
  assert.equal(c1.sets.length, 1);
});

test('SWR onUpdate throwing: reported as phase "onUpdate", not a refresh failure; cache keeps fresh value', async () => {
  const cache = staleCache([{ v: 'old' }]);
  const errors = [];
  const boom = new Error('ui broke');
  await getForecast([A], {
    fetchImpl: fakeFetch({ v: 'new' }), cache, now: () => 2000,
    onUpdate: () => { throw boom; },
    onError: (e) => errors.push(e),
  });
  await tick();
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0], { phase: 'onUpdate', error: boom });
  assert.deepEqual(cache.store.get(KEY_A).value, [{ v: 'new' }]);
});

// ---------------------------------------------------------------- maxStaleMs

const DAY = 24 * 60 * 60 * 1000;

test('maxStaleMs: entry older than the limit is a miss and the network result is awaited', async () => {
  const cache = fakeCache({ [KEY_A]: { value: [{ v: 'ancient' }], savedAt: 0, fresh: false } });
  const f = fakeFetch({ v: 'new' });
  const out = await getForecast([A], { fetchImpl: f, cache, now: () => DAY + 1 });
  assert.deepEqual(out, [{ v: 'new' }]);
  assert.equal(f.calls.length, 1);
});

test('maxStaleMs: entry within the limit is still served stale-while-revalidate', async () => {
  const cache = fakeCache({ [KEY_A]: { value: [{ v: 'ok' }], savedAt: 0, fresh: false } });
  const out = await getForecast([A], { fetchImpl: fakeFetch({ v: 'new' }), cache, now: () => DAY });
  assert.deepEqual(out, [{ v: 'ok' }]);
});

test('maxStaleMs: custom limit via deps', async () => {
  const cache = fakeCache({ [KEY_A]: { value: [{ v: 'old' }], savedAt: 0, fresh: false } });
  const out = await getForecast([A], { fetchImpl: fakeFetch({ v: 'new' }), cache, now: () => 5000, maxStaleMs: 1000 });
  assert.deepEqual(out, [{ v: 'new' }]);
});

test('maxStaleMs: over-limit entry + network failure returns the old value and calls onError', async () => {
  const cache = fakeCache({ [KEY_A]: { value: [{ v: 'ancient' }], savedAt: 0, fresh: false } });
  const errors = [];
  const out = await getForecast([A], {
    fetchImpl: async () => { throw new Error('offline'); }, cache, now: () => 3 * DAY,
    onError: (e) => errors.push(e),
  });
  assert.deepEqual(out, [{ v: 'ancient' }]);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof ApiError);
});

test('maxStaleMs: no cached value + network failure throws', async () => {
  await assert.rejects(
    getForecast([A], { fetchImpl: async () => { throw new Error('offline'); }, cache: fakeCache(), now: () => 3 * DAY }),
    (e) => e instanceof ApiError,
  );
});

test('maxStaleMs does not expire fresh entries (e.g. 30-day geocoding)', async () => {
  const cache = fakeCache({ 'om:v1:geocoding:zh:5:taichung': { value: [{ name: 'x' }], savedAt: 0, fresh: true } });
  const f = fakeFetch({ results: [] });
  const out = await searchPlaces('Taichung', { fetchImpl: f, cache, now: () => 10 * DAY });
  assert.deepEqual(out, [{ name: 'x' }]);
  assert.equal(f.calls.length, 0);
});

// ---------------------------------------------------------------- privacy / keys / shapes

test('coordinates are rounded to 2 dp in every outgoing URL', () => {
  const loc = { lat: 24.1612345, lon: 120.6487654 };
  for (const build of [buildForecastUrl, buildAirQualityUrl]) {
    const u = new URL(build([loc, { lat: 23.8599999, lon: 120.9100001 }]));
    assert.equal(u.searchParams.get('latitude'), '24.16,23.86');
    assert.equal(u.searchParams.get('longitude'), '120.65,120.91');
  }
});

test('-0 coordinates normalise to 0.00 in URLs and cache keys', () => {
  const loc = { lat: -0.001, lon: -0 };
  const u = new URL(buildForecastUrl([loc]));
  assert.equal(u.searchParams.get('latitude'), '0.00');
  assert.equal(u.searchParams.get('longitude'), '0.00');
  const cache = fakeCache();
  return getForecast([loc], { fetchImpl: fakeFetch({}), cache }).then(() => {
    assert.equal(cache.sets[0].k, 'om:v1:forecast:0.00,0.00');
  });
});

test('cache keys and default TTLs match cache.js', async () => {
  const cache = fakeCache();
  await getForecast([{ lat: 24.1612345, lon: 120.6487654 }], { fetchImpl: fakeFetch({}), cache });
  assert.equal(cache.sets[0].k, cacheKey('forecast', 24.1612345, 120.6487654));
  assert.equal(cache.sets[0].ttlMs, TTL.forecast);
  const air = fakeCache();
  await getAirQuality([A], { fetchImpl: fakeFetch({}), cache: air });
  assert.equal(air.sets[0].k, cacheKey('air', A.lat, A.lon));
  assert.equal(air.sets[0].ttlMs, TTL.air);
  const geo = fakeCache();
  await searchPlaces('x', { fetchImpl: fakeFetch({ results: [] }), cache: geo });
  assert.equal(geo.sets[0].ttlMs, TTL.geocoding);
  const neg = fakeCache();
  await getForecast([{ lat: -0.001, lon: 5 }], { fetchImpl: fakeFetch({}), cache: neg });
  assert.equal(neg.sets[0].k, cacheKey('forecast', -0.001, 5));
});

test('searchPlaces: missing fields map to null (never undefined)', async () => {
  const out = await searchPlaces('x', { fetchImpl: fakeFetch({ results: [{ latitude: 1, longitude: 2 }] }) });
  assert.deepEqual(out, [{ name: null, admin1: null, country: null, lat: 1, lon: 2, elevation: null, timezone: null }]);
  const bare = await searchPlaces('x', { fetchImpl: fakeFetch({ results: [{}] }) });
  assert.ok(Object.values(bare[0]).every((v) => v === null));
});
