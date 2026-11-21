import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../css/app.css", import.meta.url), "utf8");

test("scroll-padding-bottom clears the sticky nav including the home-indicator inset", () => {
  const m = /html\s*\{[^}]*scroll-padding-bottom:\s*([^;]+);/.exec(css);
  assert.ok(m, "html declares scroll-padding-bottom");
  assert.match(m[1], /env\(safe-area-inset-bottom/);
  assert.match(m[1], /\b(9[6-9]|1\d\d)px/);
});
