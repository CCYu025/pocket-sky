/** Pure 7-segment SVG renderer (no DOM access). */

export const SEGMENTS = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
  " ": "",
};

const POINTS = {
  a: "10,6 16,0 40,0 46,6 40,12 16,12",
  b: "50,10 56,16 56,40 50,46 44,40 44,16",
  c: "50,54 56,60 56,84 50,90 44,84 44,60",
  d: "10,94 16,88 40,88 46,94 40,100 16,100",
  e: "6,54 12,60 12,84 6,90 0,84 0,60",
  f: "6,10 12,16 12,40 6,46 0,40 0,16",
  g: "10,50 16,44 40,44 46,50 40,56 16,56",
};

const ORDER = ["a", "b", "c", "d", "e", "f", "g"];

/**
 * Escape a value for safe interpolation into HTML text or attributes.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render text as 7-segment digits.
 * @param {string} text Characters from SEGMENTS plus ":"; others render blank.
 * @param {{height?: number, label?: string}} [opts]
 * @returns {string} HTML string.
 */
export function seg7Svg(text, { height = 48, label } = {}) {
  const str = String(text ?? "");
  const width = Math.round(height * 0.56);
  let body = "";
  for (const ch of str) {
    if (ch === ":") {
      body += '<span class="seg7-colon" aria-hidden="true"><i></i><i></i></span>';
      continue;
    }
    const lit = Object.hasOwn(SEGMENTS, ch) ? SEGMENTS[ch] : "";
    const polys = ORDER.map(
      (k) => `<polygon class="seg seg-${k} ${lit.includes(k) ? "on" : "off"}" points="${POINTS[k]}"/>`,
    ).join("");
    body += `<svg class="seg7-digit" viewBox="0 0 56 100" width="${width}" height="${height}" aria-hidden="true">${polys}</svg>`;
  }
  return `<span class="seg7" role="img" aria-label="${escapeHtml(label ?? str)}">${body}</span>`;
}
