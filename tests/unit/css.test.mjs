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

const rule = (sel) => new RegExp(`(?:^|\\n)${sel.replace(/[.>\[\]"=()]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

test("picker keys never shrink or wrap (no vertical 加/入)", () => {
  const r = rule(".pk-btn");
  assert.match(r, /flex:\s*none/);
  assert.match(r, /white-space:\s*nowrap/);
});

test("location key: label/arrow gap and padding beat the generic .key rule (same specificity, later wins)", () => {
  const r = rule(".key.loc-btn");
  assert.match(r, /padding:\s*0 1[4-9]px/);
  assert.match(rule(".loc-btn > span"), /margin-left:\s*[4-9]px/);
});
