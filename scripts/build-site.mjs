/**
 * Assemble `_site/` with only the runtime files. Usage: `node scripts/build-site.mjs [outDir]`.
 * Regenerates `sw-assets.js` into the output, so it also works without a prior `npm run sw`, and stamps
 * `// SW_VERSION <hash>` as the first line of the built `sw.js` so every deploy changes its bytes (the browser
 * only looks for a new worker when `sw.js` itself differs; `sw-assets.js` is merely imported by it).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, collect, render } from "./gen-sw-assets.mjs";
import { siteFiles } from "./site-files.mjs";

/**
 * @param {string} src Contents of `sw.js`.
 * @param {string} version Shell content hash.
 * @returns {string} `src` with the stamp line first (an earlier stamp is replaced).
 */
export function stampSw(src, version) {
  return `// SW_VERSION ${version}\n${src.replace(/^\/\/ SW_VERSION [^\n]*\n/, "")}`;
}

/**
 * @param {string} [out] Output directory (default `<root>/_site`).
 * @returns {string[]} Files written, relative to `out`.
 */
export function buildSite(out = path.join(ROOT, "_site")) {
  rmSync(out, { recursive: true, force: true });
  const files = siteFiles();
  const { version } = collect();
  for (const f of files) {
    const dest = path.join(out, f);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (f === "sw-assets.js") writeFileSync(dest, render());
    else if (f === "sw.js") writeFileSync(dest, stampSw(readFileSync(path.join(ROOT, f), "utf8"), version));
    else cpSync(path.join(ROOT, f), dest);
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const files = buildSite(out);
  console.log(`site built: ${files.length} files`);
}
