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

// Non-text contrast: the daylight progress fill must read against its track (WCAG 1.4.11, >= 3:1).
const appCss = readFileSync(new URL("../../css/app.css", import.meta.url), "utf8");
function ruleBg(selector) {
  const m = new RegExp(`${selector.replace(/[>.]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(appCss);
  const bg = m && /background:\s*var\(--([\w-]+)\)/.exec(m[1]);
  return bg ? bg[1] : null;
}

for (const [name, t] of [["day", day], ["night", night]]) {
  test(`daylight bar fill vs track >= 3:1 (${name})`, () => {
    const track = ruleBg(".daybar");
    const fill = ruleBg(".daybar > div");
    assert.ok(track && fill, `daybar rules declare token backgrounds (track=${track}, fill=${fill})`);
    const r = ratio(t[fill], t[track]);
    assert.ok(r >= 3, `${name}: fill --${fill} on track --${track} = ${r.toFixed(2)}`);
  });
}

for (const [name, t] of [["day", day], ["night", night]]) {
  test(`night progress hatch stripes vs track >= 3:1 (${name})`, () => {
    const m = /\.daybar--night > div\s*\{([^}]*)\}/.exec(appCss);
    assert.ok(m, "night rule exists");
    const stripe = /repeating-linear-gradient\([^)]*var\(--([\w-]+)\)\s+0/.exec(m[1]);
    const track = ruleBg(".daybar");
    assert.ok(stripe && track);
    const r = ratio(t[stripe[1]], t[track]);
    assert.ok(r >= 3, `${name}: stripe --${stripe[1]} on track --${track} = ${r.toFixed(2)}`);
  });
}
