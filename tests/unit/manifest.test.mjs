import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.webmanifest"));

test('manifest has a stable identity: "id": "./" (not derived from start_url, which carries the #today hash)', () => {
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./#today");
  assert.equal(manifest.scope, "./");
});

test("scripts/gen-icons.mjs resolves Playwright through the e2e helpers (createRequire + fallback), with no hard-coded path of its own", () => {
  const src = read("scripts/gen-icons.mjs");
  assert.match(src, /import \{ loadPlaywright \} from "\.\.\/tests\/e2e\/helpers\.mjs"/);
  assert.doesNotMatch(src, /\/opt\/|node_modules/);
  assert.match(read("tests/e2e/helpers.mjs"), /createRequire/);
});
