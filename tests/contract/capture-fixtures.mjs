// Fetches real Open-Meteo responses and writes them (unaltered, pretty-printed)
// to tests/fixtures/. Run with `npm run fixtures`.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildForecastUrl, buildAirQualityUrl, buildGeocodingUrl } from '../../js/api/openmeteo.js';

const TAICHUNG = { lat: 24.16, lon: 120.64 };
const SUN_MOON_LAKE = { lat: 23.86, lon: 120.91 };

const outDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Fetch raw JSON, retrying (shared proxies can be rate limited with 429). */
async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
}

const jobs = [
  ['forecast-taichung.json', buildForecastUrl([TAICHUNG])],
  ['forecast-multi.json', buildForecastUrl([TAICHUNG, SUN_MOON_LAKE])],
  ['air-taichung.json', buildAirQualityUrl([TAICHUNG])],
  ['geocoding-taichung.json', buildGeocodingUrl('Taichung', { count: 5, language: 'zh' })],
];

await mkdir(outDir, { recursive: true });
const capturedAt = new Date().toISOString();
const lines = [];
for (const [file, url] of jobs) {
  const body = await getJson(url);
  await writeFile(outDir + file, JSON.stringify(body, null, 2) + '\n');
  lines.push(`- \`${file}\`: ${url}`);
  console.log(`wrote ${file}`);
}
await writeFile(
  outDir + 'README.md',
  `# Fixtures\n\nCaptured from the live Open-Meteo APIs by \`npm run fixtures\` (payloads unaltered).\n\nCaptured at (UTC): ${capturedAt}\n\nURLs used:\n\n${lines.join('\n')}\n`,
);
