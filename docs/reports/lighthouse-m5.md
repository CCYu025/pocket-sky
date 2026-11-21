# Lighthouse report (m5)

Lighthouse 13.6.0, mobile preset, 3 runs, median. Target: `_site/` served locally. Open-Meteo: **test fixtures (live forecast API unavailable: daily limit)**. Regenerate with `npm run lighthouse`.

| Category | Score | Target | |
|---|---|---|---|
| performance | 98 (runs: 97, 98, 98) | ≥ 90 | pass |
| accessibility | 100 (runs: 100, 100, 100) | ≥ 95 | pass |
| best-practices | 100 (runs: 100, 100, 100) | ≥ 95 | pass |
| seo | 91 (runs: 91, 91, 91) | ≥ 90 | pass |

| Metric | Median |
|---|---|
| first-contentful-paint | 2.0 s |
| largest-contentful-paint | 2.0 s |
| total-blocking-time | 10 ms |
| cumulative-layout-shift | 0 |
| speed-index | 2.0 s |
| interactive | 2.1 s |

Installability (Chrome `Page.getInstallabilityErrors`; Lighthouse 13 no longer has PWA audits): no errors, installable.

## Notable audits (score < 0.9)

- `first-contentful-paint` (0.84): First Contentful Paint — 2.0 s
- `unminified-css` (0): Minify CSS — Est savings of 12 KiB
- `unminified-javascript` (0.5): Minify JavaScript — Est savings of 96 KiB
- `unused-css-rules` (0): Reduce unused CSS — Est savings of 75 KiB
- `robots-txt` (0): robots.txt is not valid — Fetch of robots.txt failed: Protocol error (Network.loadNetworkResource): Protocol error (Network.loadNetworkResource): CSP violation
- `bf-cache` (0): Page prevented back/forward cache restoration — 2 failure reasons
- `document-latency-insight` (0.5): Document request latency — Est savings of 2 KiB
- `network-dependency-tree-insight` (0): Network dependency tree
- `render-blocking-insight` (0): Render-blocking requests — Est savings of 1,380 ms

## Before the fixes

Baseline (`lighthouse-m5-before.json`): performance 97, accessibility 100, best-practices 100, seo 82. SEO was missing a meta description and a robots.txt.

## Known artifact

`robots-txt` fails in this harness with `Network.loadNetworkResource: CSP violation`: Lighthouse fetches `/robots.txt` under the page's strict CSP (`default-src 'none'`, no `connect-src 'self'`). The file itself is served (200, `User-agent: *` / `Allow: /`) and crawlers are not bound by the page CSP; the CSP was deliberately not loosened. Lighthouse's own SEO score is 91 with this audit failing.
