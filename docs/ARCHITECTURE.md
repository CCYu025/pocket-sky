# Pocket Sky — Architecture & module contracts

Mobile-first weather web app. Vanilla HTML/CSS/JS with native ES modules, no
bundler, no runtime dependencies. Deployed as static files to GitHub Pages.

## Ground rules

- Runtime code lives in `js/`, uses only browser APIs, relative imports with
  explicit `.js` extensions, and must also import cleanly in Node 20+ (no DOM
  access at module top level) so it can be unit-tested with `node --test`.
- Domain logic (time, rules, scoring, derive) is **pure**: inputs in, value out,
  no `Date.now()`, `fetch` or storage inside — those are injected.
- Every exported function has a JSDoc comment describing params and return.
- Tests: `tests/unit/*.test.mjs` (offline, deterministic, use fixtures),
  `tests/contract/*.test.mjs` (call the real Open-Meteo APIs).
- Data attribution: UI footer must link "Weather data by Open-Meteo.com" (CC BY 4.0).

## Time model

Requests use `timezone=auto`. Open-Meteo returns local times as ISO strings
**without offset** (`"2026-11-21T14:00"`) plus `utc_offset_seconds`. Never parse
these with `new Date(str)` (that applies the device time zone). Treat them as
opaque local keys and compute "now" as:

```js
const localMs = nowMs + utcOffsetSeconds * 1000;  // then read with getUTC*()
```

"Current hour" is the local time **floored** to the hour, e.g. 14:20 → `"…T14:00"`.

## Module contracts (M1)

### `js/time.js`
- `localParts(utcOffsetSeconds, nowMs)` → `{ date: "YYYY-MM-DD", hourKey: "YYYY-MM-DDTHH:00", minuteKey: "YYYY-MM-DDTHH:MM", hour: 0-23, minute: 0-59 }`
- `addHours(hourKey, n)` → hourKey shifted by n hours (pure string/UTC arithmetic, handles day/month/year rollover)
- `indexOfHour(times, hourKey)` → index in `hourly.time`, or `-1`
- `exerciseWindow(utcOffsetSeconds, nowMs)` → array of hourKeys from the current floored hour through 23:00 today; if the current hour is ≥ 22, extend through 06:00 the next day
- `minutesUntil(fromMinuteKey, toMinuteKey)` → integer minutes (may be negative)

### `js/cache.js`
- `cacheKey(api, lat, lon)` → `"om:v1:{api}:{lat.toFixed(2)},{lon.toFixed(2)}"`; `-0.00` is normalised to `0.00`. Coordinates are rounded to 2 dp (~1 km) before leaving the device and in cache keys.
- `createCache({ storage, now, maxLocationsPerApi = 5 })` → `{ get(key), set(key, value, ttlMs), remove(key) }`
  - `get` returns `null` or `{ value, savedAt, fresh }` (`fresh` = `0 <= age <= ttlMs`; an entry whose `savedAt` is in the future, e.g. after the clock moved back, is never fresh). Stale entries are still returned (stale-while-revalidate).
  - `set` evicts the oldest entries so at most `maxLocationsPerApi` keys remain per `api`. If `setItem` fails (e.g. quota), it evicts the oldest *other* entry in the same api namespace and retries, at most `maxLocationsPerApi` times, then gives up silently.
  - Storage failures (quota, private mode, `storage` undefined) never throw; cache degrades to a no-op.
- TTLs (ms) exported as `TTL = { forecast: 15 min, air: 30 min, geocoding: 30 days }`.

### `js/store.js`
- `createStore(initial, { onError })` → `{ get(), set(partial), subscribe(fn) → unsubscribe }`; `set` shallow-merges and notifies subscribers synchronously. Each subscriber call is wrapped in try/catch: a throwing subscriber does not stop the others and `set` never throws; the error goes to `onError(e)` (default: `queueMicrotask(() => { throw e; })`, i.e. rethrown asynchronously so it still surfaces).

### `js/api/openmeteo.js`
- `buildForecastUrl(locations)` / `buildAirQualityUrl(locations)` / `buildGeocodingUrl(name, { count = 5, language = "zh" })` — `locations` is `[{ lat, lon }]`; multiple locations are comma-joined. **Coordinates are rounded to 2 dp (~1 km) before leaving the device and in cache keys** (`toFixed(2)`, `-0.00` → `0.00`).
- `fetchJson(url, { fetchImpl = fetch, timeoutMs = 8000 })` → parsed JSON; throws `ApiError` (`{ name: "ApiError", status, reason }`) on HTTP error, Open-Meteo `{ error: true, reason }`, timeout (`status: 0, reason: "timeout"`) or network failure (`status: 0`).
- `getForecast(locations, deps)` / `getAirQuality(locations, deps)` / `searchPlaces(name, deps)` — always return an **array** (one entry per location) even when Open-Meteo returns a single object. `searchPlaces` maps every field with `?? null` (`{ name, admin1, country, lat, lon, elevation, timezone }`, never `undefined`). `deps = { fetchImpl, cache, now, ttlMs, timeoutMs, maxStaleMs, onUpdate, onError }`; when `cache` is given, use `TTL` and stale-while-revalidate:
  - fresh entry: returned, no network.
  - stale entry younger than `maxStaleMs` (default 24 h, measured with `deps.now ?? Date.now`; applies to non-fresh entries only): returned immediately and refreshed in the background; `onUpdate(freshValue, { key })` is called when the refresh lands.
  - stale entry older than `maxStaleMs`: treated as a miss, the network is awaited. If that fails, the old value is returned and `onError(err)` is called (offline degradation); the error is thrown only when nothing is cached.
  - **Dedupe**: a module-level `Map<key, Promise>` shares one in-flight load per cache key (misses and background refreshes); concurrent callers get the same value, and each caller's `onUpdate` fires. The entry is removed in `finally`.
  - **Ordering guard**: a per-key write sequence number is captured when a load starts; if a newer write landed for the key by completion, the result is neither cached nor passed to `onUpdate`.
  - If `onUpdate` throws, the cache already holds the fresh value and `onError({ phase: 'onUpdate', error })` is called (never reported as a failed refresh). Plain refresh failures call `onError(err)` with the `ApiError`.
  - `__resetInflight({ keepSequences = false })` is **internal, for tests only**: clears the in-flight map (and sequence numbers unless `keepSequences`).
- `ATTRIBUTION = { text: "Weather data by Open-Meteo.com", href: "https://open-meteo.com/" }`

Forecast query (single source of truth, exported as `FORECAST_PARAMS`):
- `current`: temperature_2m, apparent_temperature, relative_humidity_2m, weather_code, wind_speed_10m, wind_direction_10m, is_day
- `hourly`: temperature_2m, apparent_temperature, relative_humidity_2m, precipitation_probability, precipitation, weather_code, wind_speed_10m, wind_gusts_10m, uv_index, visibility
- `daily`: temperature_2m_max, temperature_2m_min, sunrise, sunset, daylight_duration, uv_index_max
- `minutely_15`: precipitation
- `past_days=1`, `forecast_days=2`, `timezone=auto`

Air quality query (`AIR_PARAMS`): `current=us_aqi,pm2_5`, `hourly=us_aqi,pm2_5`, `timezone=auto`.

### Verified API behaviour (contract tests, 2026-11-21)
- `hourly.time` = 72 entries starting at 00:00 yesterday; `minutely_15.time` = 288; `daily.time` = 3 and is **date-only** (`YYYY-MM-DD`); `sunrise`/`sunset` are `YYYY-MM-DDTHH:MM`.
- Multi-location forecast and air quality both return arrays; single location returns an object (client normalizes to array).
- Air quality `hourly` defaults to 120 entries and is **not** aligned with forecast (it starts at 00:00 today, forecast at 00:00 yesterday) — always join by `hourKey`, never by index (48 hourKeys overlap with the 72-entry forecast).
- Forecast `hourly.time[0]` is 00:00 of the local day before `current.time`'s date.
- `minutely_15.precipitation_probability` is supported for Taiwan (not requested yet).
- Geocoding with `language=zh`: `台中` → 0 results, `Taichung` → `臺中市`. UI search should retry with `台`→`臺` substitution, then fall back to the raw input in English.
- Locally behind the session proxy, run contract tests with `NODE_USE_ENV_PROXY=1` (not needed on GitHub Actions).

### `js/domain/weathercode.js`
- `describeWeather(code, isDay = true)` → `{ label: "多雲", icon: "cloud" }` (zh-Hant labels for every WMO code Open-Meteo documents; unknown → `{ label: "未知", icon: "unknown" }`).

### `js/domain/derive.js`
- `toViewModel({ forecast, air = null, nowMs })` → plain object:
  ```
  {
    location: { lat, lon, elevation, utcOffsetSeconds },
    now: { hourKey, minuteKey, observedAt, temp, feels, humidity, code, label, wind, windDir, isDay },
    stale: { current, ageMinutes },   // see below
    hoursAvailable,                   // hours.length > 0
    today: { max, min, sunrise, sunset, daylightSeconds, uvMax },
    yesterdayDelta,          // temp now − temp same hour yesterday (rounded 1 dp) or null; never -0
    hours: [ { hourKey, hour, temp, feels, humidity, rainProb, rain, code, wind, gust, uv, visibility, aqi, pm25 } ],  // from current floored hour, next 24 entries
    minutely15: [ { minuteKey, rain } ],  // from current 15-min slot onward, next 8 entries
    air: { aqi, pm25 } | null,
  }
  ```
  Missing values are `null`, never `undefined`/`NaN`.

**Staleness of `current`.** `now.observedAt` is `forecast.current.time` (or `null`). `stale.ageMinutes = minutesUntil(observedAt, minuteKey)` (`null` when `observedAt` is missing) and `stale.current` is `true` when `ageMinutes` is `null` or `|ageMinutes| > 90`. When `stale.current` is true, `now.temp/feels/humidity/code/label/wind` are taken from the `hourly` entry at `hourKey` (each `null` if that entry or field is absent, e.g. when the data is weeks old). Hourly has no wind direction or day/night flag, so `now.windDir` and `now.isDay` are `null` in that case (the stale observation is not reused); the label then uses the daytime wording. `hoursAvailable` is `false` when `hourKey` is outside `hourly.time`, so the UI can show an "outdated data" state.
