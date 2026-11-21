import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { render, collect, ROOT } from "../../scripts/gen-sw-assets.mjs";

const listJs = (dir) =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listJs(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : [],
  );

test("sw-assets.js is up to date (run `npm run sw`)", () => {
  assert.equal(readFileSync(path.join(ROOT, "sw-assets.js"), "utf8"), render());
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
