# Fixtures

Captured from the live Open-Meteo APIs by `npm run fixtures` (payloads unaltered).

Captured at (UTC): 2026-11-21T12:12:40.897Z

URLs used:

- `forecast-taichung.json`: https://api.open-meteo.com/v1/forecast?latitude=24.16&longitude=120.64&current=temperature_2m%2Capparent_temperature%2Crelative_humidity_2m%2Cweather_code%2Cwind_speed_10m%2Cwind_direction_10m%2Cis_day&hourly=temperature_2m%2Capparent_temperature%2Crelative_humidity_2m%2Cprecipitation_probability%2Cprecipitation%2Cweather_code%2Cwind_speed_10m%2Cwind_gusts_10m%2Cuv_index%2Cvisibility&daily=temperature_2m_max%2Ctemperature_2m_min%2Csunrise%2Csunset%2Cdaylight_duration%2Cuv_index_max&minutely_15=precipitation&past_days=1&forecast_days=2&timezone=auto
- `forecast-multi.json`: https://api.open-meteo.com/v1/forecast?latitude=24.16%2C23.86&longitude=120.64%2C120.91&current=temperature_2m%2Capparent_temperature%2Crelative_humidity_2m%2Cweather_code%2Cwind_speed_10m%2Cwind_direction_10m%2Cis_day&hourly=temperature_2m%2Capparent_temperature%2Crelative_humidity_2m%2Cprecipitation_probability%2Cprecipitation%2Cweather_code%2Cwind_speed_10m%2Cwind_gusts_10m%2Cuv_index%2Cvisibility&daily=temperature_2m_max%2Ctemperature_2m_min%2Csunrise%2Csunset%2Cdaylight_duration%2Cuv_index_max&minutely_15=precipitation&past_days=1&forecast_days=2&timezone=auto
- `air-taichung.json`: https://air-quality-api.open-meteo.com/v1/air-quality?latitude=24.16&longitude=120.64&current=us_aqi%2Cpm2_5&hourly=us_aqi%2Cpm2_5&timezone=auto
- `geocoding-taichung.json`: https://geocoding-api.open-meteo.com/v1/search?name=Taichung&count=5&language=zh&format=json
