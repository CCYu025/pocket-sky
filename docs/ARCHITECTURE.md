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
- `exerciseWindow(utcOffsetSeconds, nowMs, lookAheadHours = 12)` → a constant look-ahead: `lookAheadHours` consecutive hourKeys starting at the current floored hour (the current hour is included) and crossing midnight as needed (14:20 → `14:00 … 01:00` tomorrow; 22:30 → `22:00 … 09:00` tomorrow). Pure; the length never depends on the time of day
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
- Motion: at most ONE infinite animation per screen (Today: the clock colon blink, 1s steps). One-shot entry animations: LCD boot flicker (0.9s), alert shake (0.5s, once), rain bars grow (0.6s, staggered 80ms). Only `transform`/`opacity` are animated **or transitioned**: there are no paint-property transitions (`body`/`.lcd` background, color, box-shadow), and the e2e test checks every running `CSSAnimation` and `CSSTransition` plus all declared transitions. `prefers-reduced-motion: reduce` disables all of them. Pause infinite animations when `document.hidden`. (One-shot animations: see Rendering.)
- Touch targets ≥ 44px (including the attribution link: `min-height: 44px`, inline-flex, centered). Text contrast ≥ 4.5:1 in both themes; non-text contrast ≥ 3:1: the daylight progress fill is `--ink` on a `--card` track inside a `--line` border, and the night-progress fill is `--ink` hatched stripes (`repeating-linear-gradient`, `--ink`/`--card`) on the same track (checked in `tests/unit/contrast.test.mjs` and e2e).
- **Bottom nav** (`.nav`: LIGHT / 今天 / 外出) is `position: sticky; bottom: 0` with `background: var(--shell)`, a `--border` top rule, full column width and `padding-bottom: max(12px, env(safe-area-inset-bottom))`. At 390×844 the three keys are inside the viewport on load in every state (ready, alert, error, loading, outing) without scrolling; because it is in normal flow the last content is never hidden behind it, and `html { scroll-padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)) }` keeps focused elements clear of it, including on devices with a home indicator (the nav grows by the same inset).
- Visual reference: the approved wireframe "A1 今天" (structure: top bar with brand + location button → one-line headline → alert bar (only when an alert exists) → hero LCD (date, clock, big temp, condition / feels / max-min, Δ yesterday, updated time) → 5 metric cards + "更多" → hourly rain bars (8) → sunrise/sunset with daylight progress (by day `日照已過 N%` = elapsed fraction of sunrise→sunset; after sunset or before sunrise the bar shows night progress, class `daybar--night`, hatched, `aria-label` `夜間已過 N%` = elapsed fraction from sunset to the next sunrise, where next sunrise = today's sunrise + 24 h after sunset, and before sunrise the previous sunset = today's sunset − 24 h; `daylightProgress(vm)` in `js/ui/format.js` → `{phase, pct}`) → attribution link → bottom keys LIGHT / 今天 / 外出).

### `js/ui/seg7.js`
- `SEGMENTS`: `{ '0':'abcdef', '1':'bc', '2':'abdeg', '3':'abcdg', '4':'bcfg', '5':'acdfg', '6':'acdefg', '7':'abc', '8':'abcdefg', '9':'abcdfg', '-':'g', ' ':'' }`.
- `seg7Svg(text, { height = 48, label, ghost = true })` → HTML string: `<span class="seg7" role="img" aria-label="{label ?? text}">` (with `ghost: false` the class is `seg7 seg7--noghost`, and CSS hides the `.seg.off` ghost segments; the 24px LCD clock uses it so "14:20" reads cleanly, the big temperature keeps its ghosts) + one `<svg class="seg7-digit" viewBox="0 0 56 100" width="{round(height*0.56)}" height="{height}" aria-hidden="true">` per char with seven `<polygon class="seg seg-{a..g} {on|off}">`; `:` renders `<span class="seg7-colon" aria-hidden="true"><i></i><i></i></span>`; unknown chars render as blank digits. Label is HTML-escaped. Pure; no DOM access.
- Polygon points (viewBox 56×100): a `10,6 16,0 40,0 46,6 40,12 16,12`; b `50,10 56,16 56,40 50,46 44,40 44,16`; c `50,54 56,60 56,84 50,90 44,84 44,60`; d `10,94 16,88 40,88 46,94 40,100 16,100`; e `6,54 12,60 12,84 6,90 0,84 0,60`; f `6,10 12,16 12,40 6,46 0,40 0,16`; g `10,50 16,44 40,44 46,50 40,56 16,56`.
- CSS: `.seg.on{fill:var(--lcd-ink)} .seg.off{fill:var(--lcd-ghost)}`; `.seg7{display:inline-flex;gap:…;transform:skewX(-6deg)}`.

### `js/rules/alerts.js` (pure)
- `ALERT_RULES = { rainJump: { windowHours: 3, fromMax: 30, toMin: 60 }, tempDrop: { windowHours: 3, minDrop: 4 }, cooldownHours: 3 }`.
- `evaluateAlerts(vm, { dismissed = {}, lastShown = {}, lastShownId = {}, nowMs })` → array of `{ id, kind, startsAt, title, detail, priority, value }` (`value` = rounded rain % or rounded temperature drop), highest priority first. "Next windowHours" = `hours[1..windowHours]`; null values never trigger:
  - `rainJump`: current hour rainProb ≤ fromMax AND some hour within the next `windowHours` has rainProb ≥ toMin → `startsAt` = first such hourKey; title e.g. `15:00 起可能下雨`, detail `降雨機率 70%`.
  - `tempDrop`: `hours[0].temp − min(temp over next windowHours) ≥ minDrop` → title `氣溫將下降 5°`, detail `{HH}:00 降至 18°`.
  - `id` = `${kind}:${startsAt}` (e.g. `rainJump:2026-11-21T16:00`): **one id per event**, not per day. Drop alerts whose id is in `dismissed` (dismissing hides only that event). Drop alerts whose `lastShown[kind]` (epoch ms) is within `cooldownHours` of `nowMs` **unless** `lastShownId[kind] === id`: the 3 h cooldown applies between *different* events of the same kind, while the same event is exempt so re-renders keep showing it. **Continuation:** an alert of kind K whose id differs from `lastShownId[K]` is a *continuation* (the same event, its start hour shifted by a sliding temperature minimum or a revised rain forecast) when the previous event has not ended, i.e. the `startsAt` hourKey of `lastShownId[K]` is ≥ the current hourKey − `windowHours` (still ongoing or upcoming). A continuation is shown regardless of cooldown, carries `continuation: true` and `continues: <previous id>`, and inherits dismissal: if the previous id is in `dismissed` it is hidden, and `evaluateAlertsDetailed(vm, opts)` (→ `{ alerts, inherited }`; `evaluateAlerts` returns just `alerts`) reports it in `inherited` so the controller can record the new id as dismissed. The cooldown therefore applies only to a genuinely new event after the previous one ended. Pure: state is passed in; `alert-state.js` records it.
  - Returns `[]` when `vm.hoursAvailable` is false.
- `pickAlert(alerts)` → first or `null` (at most one alert shown).

### `ps:alerts` (`js/app/alert-state.js`)
`{ dismissed: {id: true}, lastShown: {kind: ms}, lastShownId: {kind: id} }`. `readAlertState(storage, date, nowMs)` prunes on read: ids of events that started before the local `date` and ids not in the per-event format `^kind:YYYY-MM-DDTHH:MM$` (the former `kind:date` ids) are ignored and dropped on the next write; `lastShown` entries older than 24 h are dropped. Old-format data therefore never throws and never hides a new event. `recordShown` of a continuation replaces `lastShownId[kind]` but leaves `lastShown[kind]` (cooldown start) untouched; `recordInheritedDismissal` marks the new id dismissed and makes it `lastShownId`. Migration note: dismissals recorded under the old per-day ids (`kind:date`) are not carried over after the upgrade (they are ignored and dropped), so an alert dismissed before upgrading may show once more.

### `js/app/controller.js`
`createController({ api, cache, storage, now, geolocate, ... })` → `{ store, init, refresh({relocate}), refreshIfStale, tick, dismissAlert }`. State: `{ status: loading|ready|stale|error, vm, alert, fetchedAt, notice, error, location, locating }`.
- **Load order.** The forecast is loaded alone and rendered as soon as it arrives; the air request runs in parallel but independently: it never delays the first render, `vm.air` is `null` until it arrives (then the view is rebuilt in place, keeping `ready`/`stale`) and air errors are non-fatal. A cached forecast returned by stale-while-revalidate is applied only if the background `onUpdate` has not already applied newer data (a per-load flag), so an old cache can never overwrite a fresh refresh. Results of a superseded load (generation counter) are ignored.
- **Stale banner.** `stale` is kept while a refresh of the same cache key is in flight (visibility refresh over a stale entry); it is cleared only by a successful `onUpdate` or a fresh load, never by the interim cached render.
- **Locating.** `locating` is `true` from the moment the position is requested until it resolves (GPS or default fallback). Overlapping requests are guarded by a generation counter: the last request wins, earlier results are ignored. A new location equals the current one when their forecast `cacheKey`s (2 dp) are equal; then no `loading` state is shown and the data stays on screen (GPS jitter). `notice` is `"使用預設地點：臺中"` when the default location is in use; the UI exposes it through the location button's `aria-label` rather than a visible line.
- `dismissAlert()` records only the current alert id (event), for the vm's local date.

### `js/domain/summary.js` (pure)
- `headline(vm, alert)` → short zh-Hant sentence, priority: (1) alert → e.g. `15 時起可能下雨，記得帶傘` / `氣溫將下降 5°，加件外套`; (2) any of `hours[1..6]` rainProb ≥ 40 → `{H} 時可能下雨，記得帶傘` (hour not zero-padded); (3) `|round(yesterdayDelta)| ≥ 4` → `比昨天冷 4°，加件外套` / `比昨天熱 4°，注意補水`; (4) `今天{label}，{max}° / {min}°` (numbers omitted when null; missing label → branch 5); (5) data unavailable → `資料暫時無法取得`. Numbers rounded to integers.

### App shell
- `index.html` (lang zh-Hant, viewport, theme-color, Google Fonts preconnect, `<link rel="stylesheet">` to `css/tokens.css` + `css/app.css`, `<script type="module" src="js/main.js">`), all paths relative (GitHub Pages sub-path).
- `js/main.js`: wires store + cache(localStorage) + api + derive + view. Location: `navigator.geolocation` (timeout 8s, maximumAge 10 min); on denial/unavailable use default Taichung (24.16, 120.64); the location button then reads "臺中（預設）" and its `aria-label` includes "使用預設地點：臺中" (no separate visible notice line). While locating the button shows "定位中…", has `aria-busy="true"` and is disabled. Hash router: `#today` (default) and `#outing` (placeholder "外出規劃：M3 開發中"). Refresh on load, on the location button, and on `visibilitychange` → visible if the forecast is not fresh. Handles `onUpdate(fresh, { key })` by ignoring keys that are not the current location's key.
- States the Today view must render: `loading` (LCD shows `--` digits, metrics skeleton; also used for N6 waits), `ready`, `stale` (banner `資料時間 HH:MM・無法更新`), `error` with no data (message + 重試 button).
- Theme: `localStorage['ps:theme']` ∈ `auto|day|night` (default `auto`). `auto` = night when local time is before today's sunrise or after sunset (from vm.today). LIGHT key toggles day/night explicitly (stored); long-press is not required. Apply via `document.documentElement.dataset.theme` and update `<meta name="theme-color">`. `resolveTheme(pref, vm, nowMs, fallback)`: for `auto` with no view model (loading / error) it returns `fallback` (the last resolved theme, default `day`). The app writes every resolved theme to `ps:theme-last`.
- **First paint.** `js/theme-boot.js` is a classic script in `<head>` *before* the stylesheets (allowed by `script-src 'self'`). It sets `data-theme` and the `theme-color` meta from `ps:theme` (`day`/`night`), or for `auto` the day/night decision is computed from the most recent cached forecast (`om:v1:forecast:*` with the latest `savedAt`: today's local date from `utc_offset_seconds` + `Date.now()`, compared with that day's `daily.sunrise/sunset`; if today's date is absent, `current.is_day`), so a morning after a night session is not painted night; only with no usable cache (none, or corrupt/unparseable) does it use `ps:theme-last`; with neither it leaves the default. It never throws (blocked storage, missing meta/document). Its colors duplicate `THEME_COLORS` (a unit test keeps them equal). There is therefore no day flash at night and the error/loading states keep the last theme. Theme switches are instant: no color/background transitions exist (see Motion).
- **CSP** (meta tag): `default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src` only the two Open-Meteo hosts. No `'unsafe-inline'`: templates emit no `style` attributes; numeric values (`--p`, `--i` of the rain bars, `--pct` of the daylight fill) are emitted as `data-p`/`data-i`/`data-pct` and applied after each render with `el.style.setProperty()` (`applyDynamicStyles` in `js/ui/views/today.js`; CSSOM is not subject to CSP). Google Fonts hosts are needed only for style-src/font-src, not connect-src. (axe-core fetches cross-origin stylesheets itself, so the a11y e2e tolerates that one blocked request.)
- Rendering: views are functions `(root, state, ui) → void`; HTML comes from template strings built with an `esc()` helper for every interpolated API string; event handling via delegation on `#app`. No framework. The Today view is **reconciled, not replaced**: `js/ui/morph.js` diffs the new template against the live DOM (top-level blocks keyed by `data-k`, attributes/text synced in place, `style` left to the CSSOM), so unchanged nodes keep their identity. Consequences: a minute tick (same hour, same data) mutates only the clock seg7 digits, the countdown text and the daylight bar; focus, running animations and the colon blink survive every refresh; air arriving after the forecast changes only the AQI card. When a focused element does get replaced, `main.js` restores focus by a stable key (`id`, else `data-action`, else `href`), falling back to `<main>`.
- **Live region.** `index.html` has one persistent `<div id="live" class="sr-only" aria-live="polite" aria-atomic="true">` *outside* `#view`. `js/ui/announce.js` (`createAnnouncer().next(state)`) returns a message only when a condition *changes*: a new alert id that is not a continuation of the shown event (`alert.continuation`) → the alert title; a continuation updates the bar text silently (e.g. `16:00 起可能下雨`); entering `stale` → `資料已過期`; entering `error` → the error text. Ticks, refreshes and dismissals are silent. Re-rendered nodes carry no `role="status"`/`role="alert"`.
- **One-shot animations** (`js/ui/anim.js`, state in `main.js`): the LCD boot flicker and rain-bar growth are enabled by a `boot` class on `<main>` set at the first render that has data in a route visit (and left alone afterwards; leaving the route and coming back is a new visit). The alert shake is enabled by a `data-shake` attribute on `<main>` that is (re)started only when a new `alert.id` appears that is not a continuation; refreshes (`onUpdate`) and re-renders never replay either, and a revisit never shakes for an id that already shook.

### Testing (M2)
- Unit (node --test): seg7 (segment map for every char, markup structure, escaping, colon), alerts (each rule boundary, cooldown, dismissed, same-id re-render, hoursAvailable=false), summary (each priority branch), theme decision (pure helper `resolveTheme(pref, vm, nowMs)` in `js/ui/theme.js`).
- E2E (Playwright library + node --test, no @playwright/test): `tests/e2e/*.e2e.mjs`, run via `npm run test:e2e`; tiny static server `tests/e2e/server.mjs`; intercept Open-Meteo with fixtures (plus synthetic rainy/cold scenarios derived in-test); fixed clock via `page.clock`; geolocation granted/denied via context options. Viewport 390×844. Screenshots are written to `docs/screenshots/m2/` (day, day-viewport (390×844 above the fold), night, alert, reduced-motion, loading, error, stale) **only** when `E2E_SCREENSHOTS=1`; a default run writes no files. `E2E_REAL_FONTS=1` loads the real Google Fonts (default: fonts are stubbed so the run is hermetic), and the whole suite, including the overflow/layout assertions, then runs with them. Regenerate: `E2E_SCREENSHOTS=1 E2E_REAL_FONTS=1 npm run test:e2e`. axe-core (devDependency) injected per state: 0 serious/critical violations. No console errors.

## M3 — Outing screen (commute & exercise)

Scope: `#outing` with scenario chips 通勤 / 運動 / 出遊 (出遊 disabled, labelled `v2`, `aria-disabled="true"`). Both scenarios use the current location (separate work location and destinations arrive with geocoding search in M4). Visual references (approved wireframes): "A2 外出：通勤" and "A3 外出：運動".

### Routing & persistence
- Hash routes: `#outing` (opens the last used scenario, default commute), `#outing/commute`, `#outing/exercise`. Bottom key 外出 stays `aria-current` for all of them.
- `localStorage['ps:outing']` = `{ scenario: 'commute'|'exercise', commute: { out: 0-23, back: 0-23 } }`, defaults `{ scenario:'commute', commute:{ out: 8, back: 18 } }`; invalid values fall back to defaults; never throws.

### `js/rules/config.js` (data only)
```js
export const CHECKLIST_RULES = [
  { id: 'umbrella',  label: '雨傘',  any: [{ field: 'rainProb', op: '>=', value: 40 }, { field: 'rain', op: '>=', value: 0.5 }], why: ... },
  { id: 'jacket',    label: '外套',  any: [{ agg: 'min', field: 'feels', op: '<=', value: 18 }, { agg: 'range', field: 'temp', op: '>=', value: 6 }], why: ... },
  { id: 'sunscreen', label: '防曬',  any: [{ field: 'uv', op: '>=', value: 6, hours: [10, 15] }], why: ... },
  { id: 'mask',      label: '口罩',  any: [{ field: 'aqi', op: '>=', value: 100 }, { field: 'pm25', op: '>=', value: 35 }], why: ... },
];
export const EXERCISE_SCORING = { factors: { temp: [[5,20],[12,70],[18,100],[24,100],[30,40],[35,0]], feelsDelta?: …, humidity: [[30,100],[60,100],[85,40],[100,20]], rainProb: [[0,100],[20,90],[50,30],[80,0]], wind: [[0,100],[20,90],[35,40],[50,0]], aqi: [[0,100],[50,100],[100,50],[150,0]], uv: [[0,100],[5,100],[8,50],[11,20]] }, weights: { temp: 3, humidity: 1, rainProb: 3, wind: 1, aqi: 2, uv: 1 }, levels: { good: 75, ok: 50 } };
```
- Default `agg` is "any entry matches" (hit = the strongest entry, earliest on ties). `agg: 'range'` = max − min, `'min'`/`'max'` over the entries; `hours: [10, 15]` restricts a condition to entries with `hour` in that inclusive range. `feelsDelta` is **not** implemented (exactly six scoring factors). Thresholds live only here (`T`, `EXERCISE_ADVICE`).
- **`why` representation**: a function `(ctx) => string` (zh-Hant), not a string template. `ctx = { on, hit, max(f), min(f), range(f) }`, `hit = { field, agg, value, hour } | null`; the function formats the on case (`18:00 降雨機率 60%（≥ 40% 建議）`, hour as `HH:00`, values rounded to integers, rain in mm to 1 dp) and the off case (`降雨機率低（最高 25%）`). `NO_DATA_TEXT = '資料不足'` is applied by the evaluator.
- Piecewise-linear curves: points `[x, score]`, clamped at both ends. A factor whose value is `null` is skipped and the weights renormalised; if all factors are null the score is `null`.

### `js/rules/checklist.js` (pure)
- `evaluateChecklist(hours, rules = CHECKLIST_RULES, { today } = {})` → `[{ id, label, on, why, hourKey, field, agg, value }]` in rule order; `why` explains the trigger when `on`, or the reassuring reason when off (e.g. `通勤時段紫外線低`, `空氣品質良好 AQI 42`). `hourKey` is the triggering entry's hour (`null` when off or for `range`) so views can show which leg triggered; `field`/`agg`/`value` describe the triggering condition (`{ field: 'feels', agg: 'min', value: 16 }`; all `null` when off) so views can show each leg's own value and the headline can tell AQI from PM2.5. When `today` (local `YYYY-MM-DD`) is given, a triggering hour on another date is written `明日 HH:00` in `why` (`明日 08:00 降雨機率 60%（≥ 40% 建議）`). Null values are skipped; a rule is `on: false` with `資料不足` when `hours` is empty or all its values are null. A condition whose `hours` window contains none of the entries is simply not triggered (not "no data"). The sunscreen off reason tells the two cases apart: no leg hour in 10–15 → `通勤時段不在 10–15 時` (an 08:00/18:00 commute); hours in the window but UV < 6 → `通勤時段紫外線低`.
- **Mask split** (one rule, two conditions, AQI first): AQI ≥ 100 → on with `空氣品質差（AQI N）`; PM2.5 ≥ 35 with AQI < 100 → on with `PM2.5 偏高（N µg/m³），敏感族群建議戴口罩`. The item is on in both cases; only the AQI case drives the commute headline (Today's headline only reacts to AQI too, so the two screens do not contradict each other).
- `legHours(vmHours, hour, span = 2)` → up to `span` consecutive `vm.hours` entries starting at the next occurrence of `hour`: today's if `hour >= vmHours[0].hour` (the current hour counts), else tomorrow's; `[]` if absent from `vm.hours`. Entries that do not exist are not invented (hour 23 at the end of the horizon returns 1 entry); a span may cross midnight.

### `js/rules/exercise.js` (pure)
- `scoreHour(h, cfg = EXERCISE_SCORING)` → integer 0–100 or `null`. A perfect hour scores 100; the worst possible hour scores 4, not 0, because the humidity and UV curves floor at 20.
- `exerciseSlots(vm, nowMs)` → for each hourKey in `exerciseWindow(utcOffsetSeconds, nowMs, EXERCISE_LOOKAHEAD_HOURS)` (12, from `js/rules/config.js`) that exists in `vm.hours` (missing hours are omitted): `level` is `good` for score ≥ `levels.good`, `ok` for ≥ `levels.ok`, else `bad`, `null` for a null score; `isTomorrow` = the slot's date differs from `vm.now.hourKey`'s date (such slots carry the `明日` marker in the UI): `{ hourKey, hour, score, level: 'good'|'ok'|'bad'|null, isTomorrow, metrics: { temp, feels, humidity, rainProb, wind, uv, aqi } }`.
- `bestSlot(slots)` → highest score (earliest on ties) or `null`.
- `exerciseAdvice(slot)` → one short zh-Hant line: rain ≥ 50 → `降雨機率 X%，建議改室內`; feels ≥ 30 → `偏熱，多補水`; aqi ≥ 100 → `空氣品質差，建議室內`; level good → `涼爽少雨，適合慢跑或騎車`; else `留意天氣變化`.

### `js/domain/outing-summary.js` (pure)
- `commuteHeadline(outItems, backItems, outHours, backHours, { combined, tomorrow: { out, back } } = {})`: the rain branches use the checklist evaluated **per leg**, hours are the `legHours` results; the mask and jacket branches use `combined` (the checklist over both legs together — the very items the list shows, so the headline can never say `來回都舒適` while the list ticks 外套; defaults to the per-leg items). Priority: both hour lists empty → `資料不足`; umbrella on both legs → `來回都可能下雨`; back only → `{傍晚}回家會遇到雨`; out only → `{早上}出門可能下雨` (period word from the leg's first hour: 凌晨 <6, 早上 <12, 下午 <18, 傍晚 <20, else 晚上; for a **tomorrow** leg `明天凌晨`, `明早`, `明天下午`, `明天傍晚`, `明晚`, e.g. `明早出門可能下雨`); mask (AQI ≥ 100 only; a PM2.5-only item does not change the headline) → `空氣品質差，記得戴口罩`; jacket → `氣溫偏低，記得帶外套`; else `來回都舒適` (sunscreen alone, and a PM2.5-only mask item, do not change it).

### Views
- Commute (`js/ui/views/commute.js`): hero LCD with two legs (OUT / BACK, seg7 HH:00, condition, temp, `雨 X%・風 Y km/h`, a blinking `!RAIN` only on a leg whose rainProb ≥ 40 — this is the screen's one infinite animation), legs shown in **chronological order** (today's BACK before tomorrow's OUT; labels stay OUT / BACK), hour selectors for 出門 / 回家 (native `<select>` 00–23 with visible labels, ≥ 44 px), headline, checklist (combined over both legs; each item shows which leg triggered it and that leg's own value), staggered one-shot pop-in of checklist items.
- Exercise (`js/ui/views/exercise.js`): hero LCD with selected TIME (seg7 HH:00, no ghosts) and SCORE (seg7), verdict + advice; score bars for every slot (tap target ≥ 44 px tall area; bar colour by level: good `--ink`, ok neutral, bad `--alert`; selected bar outlined; `明日` marker on tomorrow slots); a `最佳 HH:00` key; an `<input type="range">` (step 1 over slot indices) as secondary control with visible label; 6 metric cards for the selected hour. Selecting updates in place (no full re-render; the time/score digits play a one-shot flip). Default selection: best slot.
- Both: use the same controller/view-model as Today (no extra network requests), states loading / stale / error handled like Today, live region announces scenario change and the selected exercise hour (debounced 500 ms), no horizontal overflow at 390 px, sticky bottom nav.

### Testing (M3)
- Unit: every checklist rule boundary (39/40, 0.49/0.5, feels 18/18.1, range 5.9/6, UV 6 inside vs outside 10–15, AQI 99/100, PM2.5 34.9/35), null handling, `legHours` today/tomorrow/out-of-horizon; scoring curves (clamping, interpolation, null renormalisation), slots over the constant 12-hour look-ahead (14:20 → 14..01, 22:30 → 22..09 tomorrow, identical length at every hour), bestSlot ties, advice branches; commute headline branches (combined items, mask AQI vs PM2.5, day words); tags with per-leg values; tomorrow reason prefix; sunscreen off reasons; `ps:outing` storage.
- E2E: route + chip navigation and persistence; commute selectors change legs and checklist; rainy evening fixture → umbrella on + `!RAIN` on BACK; exercise default selects best, tapping a bar / slider / best key updates LCD and metrics; 22:30 clock shows tomorrow slots to 09:00; the picker note reads `現在 14:20・從 14:00 起算・未來 12 小時`; axe 0 serious/critical on both scenarios (day + night); no console errors; screenshots `docs/screenshots/m3/` (`commute-day.png`, `commute-rain.png`, `exercise-day.png`, `exercise-night.png`, `exercise-late.png`, `*-viewport.png` for both) gated by `E2E_SCREENSHOTS=1`.

### M3 implementation notes and decisions

- **Router** (`js/ui/route.js`, pure): `parseRoute(hash, lastScenario)` → `{ name, scenario, key }` with `key` ∈ `today | outing/commute | outing/exercise`. `#outing` resolves to the persisted scenario but the URL is left as typed (the chips/`aria-current` show the resolved one); an unknown `#outing/xyz` also falls back to the last scenario; every other hash is Today. `main.js` writes the resolved scenario to `ps:outing` on each outing render. The animation tracker is keyed by `key`, so a chip switch is a new visit: the LCD boot flicker, checklist pop-in and bar growth run once per scenario visit and never again on selector changes, selection changes or refreshes.
- **Chips**: `<a class="key chip" href="#outing/commute|exercise">` with `aria-current="page"`; 出遊 is `<span role="link" aria-disabled="true">` (no `href`, not focusable, `role="link"` only so `aria-disabled` is a valid attribute for axe) with a `v2` badge and a dashed border. Accent colours only on the active chip: 通勤 `--accent`, 運動 `--lime`, 出遊 `--rain` (rule present for v2, never active now). New tokens in `css/tokens.css`: `--lime #a3e635`, `--on-lime #000`, `--bar-ok #8a8577` (neutral bar fill); identical in both themes.
- **Files**: `js/ui/views/outing.js` (chips, shared stale/error/no-hours blocks, `renderOuting` = morph + CSSOM styles + control sync), `commute.js` and `exercise.js` (pure model + template; no DOM), `js/ui/announce.js` (+ `createDebouncedAnnouncer`, `createOutingAnnouncer`). Top-level blocks are keyed per scenario (`c-*`, `x-*`) so a scenario switch builds fresh nodes (replaying the one-shot entry animations) while the chips node is shared and keeps focus.
- **Commute**: the leg shows the first hour's condition/temperature/wind; the rain figure (and `!RAIN`, `rainProb ≥ 40`) is the **peak over the leg's two hours**, because the checklist evaluates both (`legHours(…, 2)`), so `!RAIN` and the umbrella row never disagree. A leg whose hour is earlier than the current hour is tomorrow's and is marked `明日` (`OUT 明日`; aria `明日 出門 08:00`). Checklist rows evaluate the combined hours for the reason text (tomorrow hours read `明日 08:00 …`) and per leg for attribution tags that carry the leg's own value: `出門 08:00・體感 16°`, `回家 18:00・降雨 60%` (also `雨量 0.8 mm`, `溫差 7°`, `UV 8`, `AQI 120`, `PM2.5 41`); both tags (each with its own value) when both legs trigger; `來回` (no value) when only the two legs together trigger, i.e. a large temperature range across the legs. `commuteModel` returns `legs` as `[out, back]` and `ordered` for display. Off rows use `--sub` text (no opacity, to keep contrast) and an sr-only `，不需要`; on rows `，建議攜帶`. The hour selectors are native `<select>`s (visible label above, ≥ 44 px) wired by `change` delegation; the DOM property is re-synced after each reconcile.
- **Exercise**: selection is transient UI state (`picked` hourKey, not persisted; reset on every scenario visit; a pick whose hour leaves the window falls back to the best slot). `resolveSelection` and `stepIndex` are pure and unit-tested. Bars live in one horizontally scrollable grid (`.xbars`, columns `minmax(26px, 1fr)`, so the 12-slot window keeps ≥ 24 px targets without page overflow; the selected bar is scrolled into view) with the time label (and `明日` for tomorrow's slots) inside each column. Bar names read `21:00，評分 84，適合` (`明日 00:00，…` for tomorrow). Keyboard: Left/Right (also Home/End) on a focused bar move the selection and the focus, clamped at the ends. The one-shot digit flip is the classes `flip-a`/`flip-b` on the TIME and SCORE wrappers, alternated on each selection *change* (alternating animation names restart the animation; `rotateX`+`opacity` only); refreshes and re-picking the same hour never flip. The range input's `value` property is re-synced after each reconcile (the attribute stops mattering once the user has dragged it).
- **Live region**: one region as in M2. Outing messages go through `createDebouncedAnnouncer` (500 ms trailing edge): `外出：運動` / `外出：通勤` on a scenario change, and the slot name for a *user-picked* exercise hour (dragging the slider announces only where it stops). Page load, refreshes, ticks and a default-selection change caused by new data are silent. Stale/error announcements are still the immediate M2 ones.
- **Contrast**: active chip, best key, tag and checkbox use fixed black on `--accent`/`--lime` (≥ 4.5:1, checked in `tests/unit/contrast.test.mjs` for both themes). Bar fills: good `--ink` and neutral `--bar-ok` read ≥ 3:1 against `--card` themselves; the bad fill `--alert` does not (2.7:1 on the white card), so every bar carries a 2 px `--line` outline (≥ 3:1) and the level is also in the accessible name and the verdict text, i.e. colour is never the only signal.
- **Screenshots** (`docs/screenshots/m3/`, `E2E_SCREENSHOTS=1`): `commute-day` (real fixture), `commute-rain` (synthetic rainy evening built in-test: 18–19 h rainProb 60 / 0.8 mm / feels ≤ 15), `exercise-day` (real fixture plus showers 15–17 h so all three bar levels show), `exercise-night` (night theme at 14:20), `exercise-late` (22:30), `commute-viewport`, `exercise-viewport`. Helpers: `rainyEveningForecast`, `showersForecast`, `lateForecast`, `LATE_UTC` in `tests/e2e/helpers.mjs`; `shot(page, name, { dir: SHOTS_M3 })`.
- **Deviations from the wireframes**: no 家/公司 location selectors (a `--sub` note instead, per spec); the hour selectors are labelled selects, not "出門 08:00 ▾" buttons; each checklist row also shows its trigger text and leg tags; the exercise bars scroll horizontally when there are many slots; the exercise advice line is the shared `exerciseAdvice` text (not the wireframe's shorter strings); `薄外套` is `外套` (rule label).
