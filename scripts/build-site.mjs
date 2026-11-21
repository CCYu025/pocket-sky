/**
 * Assemble `_site/` with only the runtime files. Usage: `node scripts/build-site.mjs [outDir]`.
 * Regenerates `sw-assets.js` into the output, so it also works without a prior `npm run sw`.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, render } from "./gen-sw-assets.mjs";
import { siteFiles } from "./site-files.mjs";

/**
 * @param {string} [out] Output directory (default `<root>/_site`).
 * @returns {string[]} Files written, relative to `out`.
 */
export function buildSite(out = path.join(ROOT, "_site")) {
  rmSync(out, { recursive: true, force: true });
  const files = siteFiles();
  for (const f of files) {
    const dest = path.join(out, f);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (f === "sw-assets.js") writeFileSync(dest, render());
    else cpSync(path.join(ROOT, f), dest);
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const files = buildSite(out);
  console.log(`site built: ${files.length} files`);
}
