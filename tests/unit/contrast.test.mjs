import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../css/tokens.css", import.meta.url), "utf8");

/** Parse `--name: #hex;` declarations inside the block that starts with `selector`. */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start);
  const out = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const day = tokens(":root");
const night = { ...day, ...tokens('[data-theme="night"]') };

for (const [name, t] of [["day", day], ["night", night]]) {
  test(`text contrast >= 4.5:1 (${name})`, () => {
    const pairs = [
      ["ink", "shell"], ["sub", "shell"], ["ink", "card"], ["sub", "card"],
      ["lcd-ink", "lcd"], ["on-alert", "alert"], ["on-accent", "accent"],
    ];
    for (const [fg, bg] of pairs) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${name}: --${fg} on --${bg} = ${r.toFixed(2)}`);
    }
  });
}
