/**
 * Render `icons/icon.svg` to the PNG icons with the preinstalled Playwright Chromium:
 * `icons/icon-192.png`, `icons/icon-512.png` and `icons/icon-maskable-512.png`.
 * Run: `node scripts/gen-icons.mjs` (the PNGs are committed; this is only needed after editing the SVG).
 * The SVG is full-bleed with all content inside the maskable safe zone (central 80% circle), so
 * the same artwork serves the `any` and `maskable` purposes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../tests/e2e/helpers.mjs"; // same resolution as the e2e tests: createRequire, project dependency first, then the preinstalled tools dir

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const svg = readFileSync(path.join(ROOT, "icons/icon.svg"), "utf8");
const TARGETS = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
];

const browser = await loadPlaywright().chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const [file, size] of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#ffd23f}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    writeFileSync(path.join(ROOT, "icons", file), await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
    await page.close();
    console.log(`icons/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
