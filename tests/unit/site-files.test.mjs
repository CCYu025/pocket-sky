import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collect, ROOT } from "../../scripts/gen-sw-assets.mjs";
import { siteFiles } from "../../scripts/site-files.mjs";
import { buildSite, stampSw } from "../../scripts/build-site.mjs";

const norm = (p) => path.posix.normalize(p.replace(/^\.\//, "").split(/[?#]/)[0]);

test("site files: runtime only, sorted, with the service worker", () => {
  const files = siteFiles();
  assert.deepEqual(files, [...files].sort());
  for (const f of ["index.html", "manifest.webmanifest", "sw.js", "sw-assets.js", "js/main.js", "css/app.css", "icons/icon-512.png"]) assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => /^(tests|docs|scripts|node_modules|\.github|_site|\.git)\//.test(f) || /^(package(-lock)?\.json|README\.md|\.gitignore)$/.test(f)), "no dev files");
  assert.ok(files.every((f) => /^(index\.html|manifest\.webmanifest|sw\.js|sw-assets\.js|robots\.txt|(css|js|icons)\/.+)$/.test(f)));
});

test("site files cover everything sw-assets, index.html and the manifest reference", () => {
  const files = new Set(siteFiles());
  for (const a of collect().assets) assert.ok(files.has(a), `sw asset missing: ${a}`);
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|#)/.test(u));
  assert.ok(refs.length >= 5);
  for (const r of refs) assert.ok(files.has(norm(r)), `index.html references ${r}`);
  const mf = JSON.parse(readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  for (const i of mf.icons) assert.ok(files.has(norm(i.src)), i.src);
  assert.match(readFileSync(path.join(ROOT, "sw.js"), "utf8"), /importScripts\("\.\/sw-assets\.js"\)/);
});

test("every static ES import inside js/ resolves to a site file", () => {
  const files = new Set(siteFiles());
  for (const f of files) {
    if (!f.startsWith("js/")) continue;
    const src = readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      assert.ok(files.has(target), `${f} imports ${m[1]}`);
    }
  }
});

test("buildSite writes exactly the listed files (and a fresh sw-assets.js)", () => {
  const out = mkdtempSync(path.join(tmpdir(), "ps-site-"));
  try {
    const written = buildSite(out);
    assert.deepEqual(written, siteFiles());
    const all = (d, rel = "") => readdirSync(path.join(d, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(d, `${rel}${e.name}/`) : [`${rel}${e.name}`]));
    assert.deepEqual(all(out).sort(), written);
    assert.ok(existsSync(path.join(out, "sw-assets.js")));
    assert.match(readFileSync(path.join(out, "sw-assets.js"), "utf8"), /SW_VERSION = "[0-9a-f]{12}"/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("buildSite stamps `// SW_VERSION <hash>` as the first line of _site/sw.js; the repo sw.js stays generic", () => {
  const out = mkdtempSync(path.join(tmpdir(), "ps-site-"));
  try {
    buildSite(out);
    const built = readFileSync(path.join(out, "sw.js"), "utf8");
    const src = readFileSync(path.join(ROOT, "sw.js"), "utf8");
    const { version } = collect();
    assert.equal(built.split("\n")[0], `// SW_VERSION ${version}`);
    assert.equal(built, `// SW_VERSION ${version}\n${src}`, "only the stamp differs");
    assert.doesNotMatch(src, /SW_VERSION [0-9a-f]{12}/, "repo sw.js has no stamp");
    assert.equal(stampSw("x\n", "abc"), "// SW_VERSION abc\nx\n");
    assert.equal(stampSw("// SW_VERSION old\nx\n", "abc"), "// SW_VERSION abc\nx\n", "re-stamping replaces");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a content change anywhere in the shell changes the built sw.js bytes", () => {
  const a = mkdtempSync(path.join(tmpdir(), "ps-a-"));
  const b = mkdtempSync(path.join(tmpdir(), "ps-b-"));
  try {
    buildSite(a);
    buildSite(b);
    assert.equal(readFileSync(path.join(a, "sw.js"), "utf8"), readFileSync(path.join(b, "sw.js"), "utf8"), "deterministic");
    assert.notEqual(stampSw("x", "1"), stampSw("x", "2"));
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});
