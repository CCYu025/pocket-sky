# Lighthouse report (m5-before)

Lighthouse 13.6.0, mobile preset, 3 runs, median. Target: `_site/` served locally. Open-Meteo: **test fixtures (live forecast API unavailable: daily limit)**. Regenerate with `npm run lighthouse`.

| Category | Score | Target | |
|---|---|---|---|
| performance | 97 (runs: 84, 97, 98) | ≥ 90 | pass |
| accessibility | 100 (runs: 100, 100, 100) | ≥ 95 | pass |
| best-practices | 100 (runs: 100, 100, 100) | ≥ 95 | pass |
| seo | 82 (runs: 82, 82, 82) | ≥ 90 | **below target** |

| Metric | Median |
|---|---|
| first-contentful-paint | 2.1 s |
| largest-contentful-paint | 2.1 s |
| total-blocking-time | 10 ms |
| cumulative-layout-shift | 0 |
| speed-index | 2.1 s |
| interactive | 2.1 s |

Installability (Chrome `Page.getInstallabilityErrors`; Lighthouse 13 no longer has PWA audits): no errors, installable.

## Notable audits (score < 0.9)

- `first-contentful-paint` (0.82): First Contentful Paint — 2.1 s
- `unminified-css` (0): Minify CSS — Est savings of 12 KiB
- `unminified-javascript` (0.5): Minify JavaScript — Est savings of 96 KiB
- `unused-css-rules` (0): Reduce unused CSS — Est savings of 75 KiB
- `meta-description` (0): Document does not have a meta description
- `robots-txt` (0): robots.txt is not valid
- `bf-cache` (0): Page prevented back/forward cache restoration — 2 failure reasons
- `document-latency-insight` (0.5): Document request latency — Est savings of 2 KiB
- `network-dependency-tree-insight` (0): Network dependency tree
- `render-blocking-insight` (0): Render-blocking requests — Est savings of 1,450 ms
