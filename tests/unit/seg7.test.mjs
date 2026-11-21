import { test } from "node:test";
import assert from "node:assert/strict";
import { SEGMENTS, seg7Svg, escapeHtml } from "../../js/ui/seg7.js";

const digits = (html) => html.match(/<svg [\s\S]*?<\/svg>/g) ?? [];
const lit = (svg) =>
  [...svg.matchAll(/class="seg seg-([a-g]) (on|off)"/g)].filter((m) => m[2] === "on").map((m) => m[1]).join("");

test("every SEGMENTS char lights exactly its segments", () => {
  for (const [ch, segs] of Object.entries(SEGMENTS)) {
    const svgs = digits(seg7Svg(ch));
    assert.equal(svgs.length, 1, ch);
    const on = (svgs[0].match(/ on"/g) ?? []).length;
    const off = (svgs[0].match(/ off"/g) ?? []).length;
    assert.equal(on, segs.length, `on count for '${ch}'`);
    assert.equal(off, 7 - segs.length, `off count for '${ch}'`);
    assert.equal(lit(svgs[0]), segs, `segments for '${ch}'`);
  }
});

test("'14:20' renders 4 digits and 1 colon", () => {
  const html = seg7Svg("14:20");
  assert.equal(digits(html).length, 4);
  assert.equal((html.match(/class="seg7-colon" aria-hidden="true"><i><\/i><i><\/i><\/span>/g) ?? []).length, 1);
});

test("'-6' renders minus then six", () => {
  const svgs = digits(seg7Svg("-6"));
  assert.equal(svgs.length, 2);
  assert.equal(lit(svgs[0]), "g");
  assert.equal(lit(svgs[1]), "acdefg");
});

test("unknown char renders a blank digit", () => {
  const svgs = digits(seg7Svg("x"));
  assert.equal(svgs.length, 1);
  assert.equal(lit(svgs[0]), "");
  assert.equal((svgs[0].match(/ off"/g) ?? []).length, 7);
});

test("label is escaped; default label is the text", () => {
  const html = seg7Svg("8", { label: `<b>&"'` });
  assert.match(html, /aria-label="&lt;b&gt;&amp;&quot;&#39;"/);
  assert.match(seg7Svg("14:20"), /aria-label="14:20"/);
});

test("dimensions, aria-hidden and role", () => {
  const html = seg7Svg("8", { height: 96 });
  assert.match(html, /width="54" height="96"/);
  assert.match(html, /viewBox="0 0 56 100"/);
  for (const svg of digits(seg7Svg("12"))) assert.match(svg, /aria-hidden="true"/);
  assert.match(html, /^<span class="seg7" role="img"/);
  assert.match(seg7Svg("8"), /width="27" height="48"/);
});

test("polygon points follow the contract", () => {
  const html = seg7Svg("8");
  assert.match(html, /seg-a on" points="10,6 16,0 40,0 46,6 40,12 16,12"/);
  assert.match(html, /seg-g on" points="10,50 16,44 40,44 46,50 40,56 16,56"/);
});

test("escapeHtml handles all five chars and non-strings", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(42), "42");
});
