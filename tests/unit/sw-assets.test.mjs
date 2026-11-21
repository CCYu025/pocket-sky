import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { render, collect, ROOT } from "../../scripts/gen-sw-assets.mjs";

const listJs = (dir) =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listJs(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : [],
  );

test("collect()/render() are deterministic and agree", () => {
  assert.deepEqual(collect(), collect());
  assert.equal(render(), render());
  const { assets, version } = collect();
  const out = render();
  assert.ok(out.includes(`self.SW_ASSETS = ${JSON.stringify(assets, null, 2)};`));
  assert.ok(out.includes(`self.SW_VERSION = "${version}";`));
});

test("version changes with content, not with an unrelated file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ps-sw-"));
  try {
    for (const d of ["css", "js", "icons"]) mkdirSync(path.join(dir, d));
    writeFileSync(path.join(dir, "index.html"), "a");
    writeFileSync(path.join(dir, "manifest.webmanifest"), "{}");
    writeFileSync(path.join(dir, "js/a.js"), "1");
    writeFileSync(path.join(dir, "js/a.test.txt"), "ignored");
    const v1 = collect(dir).version;
    writeFileSync(path.join(dir, "README.md"), "x");
    assert.equal(collect(dir).version, v1);
    writeFileSync(path.join(dir, "js/a.js"), "2");
    assert.notEqual(collect(dir).version, v1);
    assert.deepEqual(collect(dir).assets, ["index.html", "js/a.js", "manifest.webmanifest"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("asset list: sorted, every runtime js file, shell files, no tests/docs/sw", () => {
  const { assets, version } = collect();
  assert.deepEqual(assets, [...assets].sort());
  for (const f of listJs("js")) assert.ok(assets.includes(f), `missing ${f}`);
  for (const f of ["index.html", "manifest.webmanifest", "css/app.css", "css/tokens.css", "icons/icon-192.png"]) assert.ok(assets.includes(f), `missing ${f}`);
  assert.ok(!assets.some((a) => /^(tests|docs|scripts|node_modules|\.github)\//.test(a) || a === "sw.js" || a === "sw-assets.js" || a.endsWith(".md")));
  assert.match(version, /^[0-9a-f]{12}$/);
});

test("sw.js wires the spec'd behaviour", () => {
  const src = readFileSync(path.join(ROOT, "sw.js"), "utf8");
  for (const s of ['importScripts("./sw-assets.js")', "ps-shell-", "ps-fonts-v1", "SKIP_WAITING", "open-meteo.com", "3000"]) assert.ok(src.includes(s), s);
});
