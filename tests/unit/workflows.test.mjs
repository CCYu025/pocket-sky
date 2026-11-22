import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../../.github/workflows/", import.meta.url);

/** Split a workflow into `{name: text}` per job (simple text check, no YAML parser). */
function jobs(text) {
  const body = text.split(/^jobs:\s*$/m)[1] ?? "";
  const out = {};
  for (const part of body.split(/^(?=  [A-Za-z0-9_-]+:\s*$)/m)) {
    const m = part.match(/^  ([A-Za-z0-9_-]+):\s*$/m);
    if (m) out[m[1]] = part;
  }
  return out;
}

test("every job with `cache: npm` also runs `npm ci`", () => {
  let seen = 0;
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const [name, text] of Object.entries(jobs(readFileSync(new URL(f, dir), "utf8")))) {
      if (!/cache:\s*npm/.test(text)) continue;
      seen++;
      assert.match(text, /run:\s*npm ci\b/, `${f}:${name} caches npm without npm ci`);
    }
  }
  assert.ok(seen >= 2);
});

test("pages.yml: deploy needs unit and e2e", () => {
  const j = jobs(readFileSync(new URL("pages.yml", dir), "utf8"));
  assert.match(j.deploy, /needs:\s*\[\s*unit\s*,\s*e2e\s*\]/);
});
