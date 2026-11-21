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
  - `set` evicts the oldest entries so at most `maxLocationsPerApi` keys remain per `api`. If `setItem` fails with a **quota error** (`name` `QuotaExceededError` or `NS_ERROR_DOM_QUOTA_REACHED`, or `code` 22 or 1014), it evicts the oldest *other* entry in the same api namespace and retries, at most `maxLocationsPerApi` times, then gives up silently. Any other error (e.g. `SecurityError`) gives up immediately and evicts nothing. A serialized payload longer than `MAX_ENTRY_CHARS = 1_500_000` (~3 MB UTF-16) is never written and evicts nothing. Once every other entry in the namespace has been evicted and the write still fails, nothing further is evicted.
  - Storage failures (quota, private mode, `storage` undefined) never throw; cache degrades to a no-op.
- TTLs (ms) exported as `TTL = { forecast: 15 min, air: 30 min, geocoding: 30 days }`.

### `js/store.js`
- `createStore(initial, { onError })` → `{ get(), set(partial), subscribe(fn) → unsubscribe }`; `set` shallow-merges and notifies subscribers synchronously. Each subscriber call is wrapped in try/catch: a throwing subscriber does not stop the others and `set` never throws; the error goes to `onError(e)` (default: `queueMicrotask(() => { throw e; })`, i.e. rethrown asynchronously so it still surfaces).

### `js/api/openmeteo.js`
- `buildForecastUrl(locations)` / `buildAirQualityUrl(locations)` / `buildGeocodingUrl(name, { count = 5, language = "zh" })` — `locations` is `[{ lat, lon }]`; multiple locations are comma-joined. **Coordinates are rounded to 2 dp (~1 km) before leaving the device and in cache keys** (`toFixed(2)`, `-0.00` → `0.00`).
- `fetchJson(url, { fetchImpl = fetch, timeoutMs = 8000 })` → parsed JSON; throws `ApiError` (`{ name: "ApiError", status, reason }`) on HTTP error, Open-Meteo `{ error: true, reason }`, timeout (`status: 0, reason: "timeout"`) or network failure (`status: 0`).
- `getForecast(locations, deps)` / `getAirQuality(locations, deps)` / `searchPlaces(name, deps)` — always return an **array** (one entry per location) even when Open-Meteo returns a single object. `searchPlaces` trims the name; the request URL uses the trimmed name in its original case, the cache key `om:v1:geocoding:{language}:{count}:{trimmed lowercased}` lowercases it (the API is case-insensitive). It maps every field with `?? null` (`{ name, admin1, country, lat, lon, elevation, timezone }`, never `undefined`). `deps = { fetchImpl, cache, now, ttlMs, timeoutMs, maxStaleMs, onUpdate, onError }`; when `cache` is given, use `TTL` and stale-while-revalidate:
  - fresh entry: returned, no network.
  - stale entry younger than `maxStaleMs` (default 24 h, measured with `deps.now ?? Date.now`; applies to non-fresh entries only): returned immediately and refreshed in the background; `onUpdate(freshValue, { key })` is called when the refresh lands.
  - stale entry older than `maxStaleMs`: treated as a miss, the network is awaited. If that fails, the old value is returned and `onError(err)` is called (offline degradation); the error is thrown only when nothing is cached.
  - **Dedupe**: in-flight loads live in a `WeakMap<cacheObject, Map<key, Promise>>`, so one request is shared per (cache instance, key) for misses and background refreshes. Concurrent callers sharing the same cache share one request and the **first caller's `fetchImpl`/`timeoutMs` are used**; a caller with a different cache instance makes its own request and its cache is written. Each caller's `onUpdate` fires. The entry is removed in `finally`. (Calls without a cache never dedupe.)
  - **Ordering guard**: `startedAt = now()` (`deps.now ?? Date.now`) is recorded when a load starts; at completion, if `cache.get(key)?.savedAt > startedAt` (a newer write landed, e.g. from another tab) the result is neither cached nor passed to `onUpdate`.
  - If `onUpdate` throws, the cache already holds the fresh value and `onError({ phase: 'onUpdate', error })` is called (never reported as a failed refresh). Plain refresh failures call `onError(err)` with the `ApiError`.
  - `__resetInflight()` is **internal, for tests only**: forgets all in-flight loads.
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

## Known limitations

- Entries older than maxStaleMs wait up to timeoutMs for the network before the stale fallback is shown; M2 UI shows a loading state.

## M2 — Today screen (UI)

### Design system (direction A: "digital-watch shell × inset LCD")
Tokens live in `css/tokens.css` as CSS custom properties; `[data-theme="night"]` on `<html>` overrides them.

| token | day | night |
|---|---|---|
| `--shell` (page bg) | `#FFF7D6` | `#141414` |
| `--ink` (text) | `#000000` | `#F5F0E0` |
| `--sub` (secondary text) | `#3D3A33` | `#C9C2B0` |
| `--card` | `#FFFFFF` | `#1F1F1F` |
| `--line` (borders, hard shadows) | `#000000` | `#FFD23F` |
| `--lcd` (LCD glass) | `#B7C3A3` | `#8FE3CC` (backlight) |
| `--lcd-glow` | `inset 0 3px 0 rgba(0,0,0,.22)` | `0 0 22px rgba(143,227,204,.45), inset 0 3px 0 rgba(0,0,0,.22)` |
| `--lcd-ink` / `--lcd-ghost` | `#1E2618` / `rgba(30,38,24,.09)` | same |
| `--accent` (primary) | `#FFD23F` | same |
| `--alert` | `#FF6B9A` (text on it is `#000`) | same |
| `--rain` (functional) | `#7DD3FC` | same |

- Borders 3px solid `--line`; hard shadows only two levels: `4px 4px 0` (rest) and `6px 6px 0` (hero); pressed = translate(4px,4px) + no shadow. Radius 0 (LCD inner glass 4px).
- Fonts (Google Fonts): Noto Sans TC 500/900 for all Chinese text; Share Tech Mono for system labels (`LIGHT`, `SA 11-21`, `UPD 14:15`). 7-segment digits ONLY for primary values (time, current temperature), height ≥ 32px (time may be 24px inside LCD as secondary).
- Motion: at most ONE infinite animation per screen (Today: the clock colon blink, 1s steps). One-shot entry animations: LCD boot flicker (0.9s), alert shake (0.5s, once), rain bars grow (0.6s, staggered 80ms). Only `transform`/`opacity` are animated. `prefers-reduced-motion: reduce` disables all of them. Pause infinite animations when `document.hidden`.
- Touch targets ≥ 44px. Text contrast ≥ 4.5:1 in both themes.
- Visual reference: the approved wireframe "A1 今天" (structure: top bar with brand + location button → one-line headline → alert bar (only when an alert exists) → hero LCD (date, clock, big temp, condition / feels / max-min, Δ yesterday, updated time) → 5 metric cards + "更多" → hourly rain bars (8) → sunrise/sunset with daylight progress → attribution link → bottom keys LIGHT / 今天 / 外出).

### `js/ui/seg7.js`
- `SEGMENTS`: `{ '0':'abcdef', '1':'bc', '2':'abdeg', '3':'abcdg', '4':'bcfg', '5':'acdfg', '6':'acdefg', '7':'abc', '8':'abcdefg', '9':'abcdfg', '-':'g', ' ':'' }`.
- `seg7Svg(text, { height = 48, label })` → HTML string: `<span class="seg7" role="img" aria-label="{label ?? text}">` + one `<svg class="seg7-digit" viewBox="0 0 56 100" width="{round(height*0.56)}" height="{height}" aria-hidden="true">` per char with seven `<polygon class="seg seg-{a..g} {on|off}">`; `:` renders `<span class="seg7-colon" aria-hidden="true"><i></i><i></i></span>`; unknown chars render as blank digits. Label is HTML-escaped. Pure; no DOM access.
- Polygon points (viewBox 56×100): a `10,6 16,0 40,0 46,6 40,12 16,12`; b `50,10 56,16 56,40 50,46 44,40 44,16`; c `50,54 56,60 56,84 50,90 44,84 44,60`; d `10,94 16,88 40,88 46,94 40,100 16,100`; e `6,54 12,60 12,84 6,90 0,84 0,60`; f `6,10 12,16 12,40 6,46 0,40 0,16`; g `10,50 16,44 40,44 46,50 40,56 16,56`.
- CSS: `.seg.on{fill:var(--lcd-ink)} .seg.off{fill:var(--lcd-ghost)}`; `.seg7{display:inline-flex;gap:…;transform:skewX(-6deg)}`.

### `js/rules/alerts.js` (pure)
- `ALERT_RULES = { rainJump: { windowHours: 3, fromMax: 30, toMin: 60 }, tempDrop: { windowHours: 3, minDrop: 4 }, cooldownHours: 3 }`.
- `evaluateAlerts(vm, { dismissed = {}, lastShown = {}, lastShownId = {}, nowMs })` → array of `{ id, kind, startsAt, title, detail, priority, value }` (`value` = rounded rain % or rounded temperature drop), highest priority first. "Next windowHours" = `hours[1..windowHours]`; null values never trigger:
  - `rainJump`: current hour rainProb ≤ fromMax AND some hour within the next `windowHours` has rainProb ≥ toMin → `startsAt` = first such hourKey; title e.g. `15:00 起可能下雨`, detail `降雨機率 70%`.
  - `tempDrop`: `hours[0].temp − min(temp over next windowHours) ≥ minDrop` → title `氣溫將下降 5°`, detail `{HH}:00 降至 18°`.
  - `id` = `${kind}:${startsAt}` (e.g. `rainJump:2026-11-21T16:00`): **one id per event**, not per day. Drop alerts whose id is in `dismissed` (dismissing hides only that event). Drop alerts whose `lastShown[kind]` (epoch ms) is within `cooldownHours` of `nowMs` **unless** `lastShownId[kind] === id`: the 3 h cooldown applies between *different* events of the same kind, while the same event is exempt so re-renders keep showing it.
  - Returns `[]` when `vm.hoursAvailable` is false.
- `pickAlert(alerts)` → first or `null` (at most one alert shown).

### `ps:alerts` (`js/app/alert-state.js`)
`{ dismissed: {id: true}, lastShown: {kind: ms}, lastShownId: {kind: id} }`. `readAlertState(storage, date, nowMs)` prunes on read: ids of events that started before the local `date` and ids not in the per-event format `^kind:YYYY-MM-DDTHH:MM$` (the former `kind:date` ids) are ignored and dropped on the next write; `lastShown` entries older than 24 h are dropped. Old-format data therefore never throws and never hides a new event.

### `js/domain/summary.js` (pure)
- `headline(vm, alert)` → short zh-Hant sentence, priority: (1) alert → e.g. `15 時起可能下雨，記得帶傘` / `氣溫將下降 5°，加件外套`; (2) any of `hours[1..6]` rainProb ≥ 40 → `{H} 時可能下雨，記得帶傘` (hour not zero-padded); (3) `|round(yesterdayDelta)| ≥ 4` → `比昨天冷 4°，加件外套` / `比昨天熱 4°，注意補水`; (4) `今天{label}，{max}° / {min}°` (numbers omitted when null; missing label → branch 5); (5) data unavailable → `資料暫時無法取得`. Numbers rounded to integers.

### App shell
- `index.html` (lang zh-Hant, viewport, theme-color, Google Fonts preconnect, `<link rel="stylesheet">` to `css/tokens.css` + `css/app.css`, `<script type="module" src="js/main.js">`), all paths relative (GitHub Pages sub-path).
- `js/main.js`: wires store + cache(localStorage) + api + derive + view. Location: `navigator.geolocation` (timeout 8s, maximumAge 10 min); on denial/unavailable use default Taichung (24.16, 120.64) and show a small notice "使用預設地點：臺中". Hash router: `#today` (default) and `#outing` (placeholder "外出規劃：M3 開發中"). Refresh on load, on the location button, and on `visibilitychange` → visible if the forecast is not fresh. Handles `onUpdate(fresh, { key })` by ignoring keys that are not the current location's key.
- States the Today view must render: `loading` (LCD shows `--` digits, metrics skeleton; also used for N6 waits), `ready`, `stale` (banner `資料時間 HH:MM・無法更新`), `error` with no data (message + 重試 button).
- Theme: `localStorage['ps:theme']` ∈ `auto|day|night` (default `auto`). `auto` = night when local time is before today's sunrise or after sunset (from vm.today). LIGHT key toggles day/night explicitly (stored); long-press is not required. Apply via `document.documentElement.dataset.theme` and update `<meta name="theme-color">`.
- Rendering: views are functions `(root, vm, uiState) → void` that set `innerHTML` from template strings built with an `esc()` helper for every interpolated API string; event handling via delegation on the root. No framework.

### Testing (M2)
- Unit (node --test): seg7 (segment map for every char, markup structure, escaping, colon), alerts (each rule boundary, cooldown, dismissed, same-id re-render, hoursAvailable=false), summary (each priority branch), theme decision (pure helper `resolveTheme(pref, vm, nowMs)` in `js/ui/theme.js`).
- E2E (Playwright library + node --test, no @playwright/test): `tests/e2e/*.e2e.mjs`, run via `npm run test:e2e`; tiny static server `tests/e2e/server.mjs`; intercept Open-Meteo with fixtures (plus synthetic rainy/cold scenarios derived in-test); fixed clock via `page.clock`; geolocation granted/denied via context options. Viewport 390×844. Screenshots to `docs/screenshots/m2/` (day, night, reduced-motion, loading, error, stale). axe-core (devDependency) injected per state: 0 serious/critical violations. No console errors.
