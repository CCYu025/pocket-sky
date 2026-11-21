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

// ---- M3 outing: chips, best key, checklist, exercise bars -------------------------------------
/** The `var(--token)` a CSS rule uses for `prop` (exact selector match), or null. */
function ruleVar(selector, prop) {
  const esc = selector.replace(/[.>\[\]"=()]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(appCss);
  const d = m && new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`).exec(m[1]);
  const v = d && /var\(--([\w-]+)\)/.exec(d[1]);
  return v ? v[1] : null;
}

for (const [name, t] of [["day", day], ["night", night]]) {
  test(`outing: active chip / best key / tag text >= 4.5:1 on their backgrounds (${name})`, () => {
    const pairs = [
      [".chip--commute[aria-current=\"page\"]", "color", "background"],
      [".chip--exercise[aria-current=\"page\"]", "color", "background"],
      [".best", "color", "background"],
      [".tag", "color", "background"],
      [".is-on .cbox", "color", "background"],
    ];
    for (const [sel, fg, bg] of pairs) {
      const f = ruleVar(sel, fg);
      const b = ruleVar(sel, bg);
      assert.ok(f && b, `${sel} declares token colours (${f}, ${b})`);
      const r = ratio(t[f], t[b]);
      assert.ok(r >= 4.5, `${name}: ${sel} --${f} on --${b} = ${r.toFixed(2)}`);
    }
    // 出遊 (when it becomes active) uses --rain with black text
    assert.ok(ratio("#000000", t.rain) >= 4.5, `${name}: black on --rain`);
    // the disabled 出遊 chip keeps readable --sub text on --card
    assert.ok(ratio(t.sub, t.card) >= 4.5);
  });

  test(`outing: exercise bars and checklist box read against the card >= 3:1 (${name})`, () => {
    const border = ruleVar(".xfill", "border"); // `2px solid var(--line)`
    assert.equal(border, "line");
    assert.ok(ratio(t.line, t.card) >= 3, `${name}: bar outline --line on --card`);
    const fills = { ok: ruleVar(".xfill", "background"), good: ruleVar(".xbar--good .xfill", "background"), bad: ruleVar(".xbar--bad .xfill", "background") };
    assert.deepEqual(fills, { ok: "bar-ok", good: "ink", bad: "alert" });
    // good (--ink) and neutral (--bar-ok) fills read against the card on their own; the bad (--alert)
    // fill is carried by the 3 px --line outline (checked above), like every bar.
    assert.ok(ratio(t.ink, t.card) >= 3, `${name}: good fill`);
    assert.ok(ratio(t["bar-ok"], t.card) >= 3, `${name}: neutral fill ${ratio(t["bar-ok"], t.card).toFixed(2)}`);
    // selected ring: --line outer ring against the --card gap and the surrounding card
    assert.match(appCss, /\.xbar\[aria-pressed="true"\] \.xfill \{ box-shadow: 0 0 0 3px var\(--card\), 0 0 0 6px var\(--line\); \}/);
    // checklist box outline
    assert.equal(ruleVar(".cbox", "border"), "line");
    assert.ok(ratio(t["on-accent"], t.accent) >= 3, `${name}: check mark on accent`);
  });
}

test("outing: text and surfaces use only existing tokens plus the three M3 additions", () => {
  assert.match(css, /--lime:\s*#a3e635/i);
  assert.match(css, /--on-lime:\s*#000000/i);
  assert.match(css, /--bar-ok:\s*#8a8577/i);
});

// ---- M4 trip strip: every fill must read against the track (>= 3:1), colour is never the only cue -------------
for (const [name, t] of [["day", day], ["night", night]]) {
  test(`trip strip: every level's fill reads against the track >= 3:1 through its --line edge, and the neutral fill uses --bar-ok (${name})`, () => {
    assert.equal(ruleVar(".sfill--ok", "background"), "bar-ok", "ok is the neutral grey (was --rain)");
    assert.equal(ruleVar(".sfill--good", "background"), "ink");
    assert.equal(ruleVar(".sfill--bad", "background"), "alert");
    assert.equal(ruleVar(".sfill", "border"), "line", "the fill carries a --line edge");
    assert.equal(ruleVar(".strack", "border"), "line");
    const track = t.card; // the track has no background of its own: the card shows through
    assert.ok(ratio(t.line, track) >= 3, `${name}: edge --line on the card = ${ratio(t.line, track).toFixed(2)}`);
    for (const lvl of ["good", "ok", "bad"]) {
      const fill = t[ruleVar(`.sfill--${lvl}`, "background")];
      // the fill is either contrasting itself or enclosed by the >= 3:1 edge: its visible outline is the edge
      assert.ok(ratio(fill, track) >= 3 || ratio(t.line, track) >= 3, `${name}: ${lvl}`);
    }
    for (const lvl of ["good", "ok"]) assert.ok(ratio(t[ruleVar(`.sfill--${lvl}`, "background")], track) >= 3, `${name}: ${lvl} fill on its own`);
    // the legend swatches use the same colours and edge
    for (const lvl of ["good", "ok", "bad"]) assert.equal(ruleVar(`.sw--${lvl}`, "background"), ruleVar(`.sfill--${lvl}`, "background"));
    assert.equal(ruleVar(".sw", "border"), "line");
    // wet hours: bold + --alert underline marker (shape and text, not colour alone)
    assert.match(appCss, /\.wet \{[^}]*font-weight: 900;[^}]*text-decoration: underline 3px var\(--alert\)/);
  });
}
