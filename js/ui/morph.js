/**
 * Minimal keyed DOM reconciler: updates `parent`'s children in place to match
 * the nodes of `next`, so unchanged nodes keep their identity (focus, running
 * CSS animations, text selection) and live regions are not recreated.
 *
 * Top-level nodes carry a stable key in `data-k`; nodes without a key are
 * matched by position and tag name. The `style` attribute is owned by the
 * CSSOM (`el.style.setProperty`) and is never touched.
 * @module ui/morph
 */

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute("data-k") : null);

/**
 * Sync the attributes of `a` to those of `b` (except `style`).
 * @param {Element} a Live element.
 * @param {Element} b Desired element.
 * @returns {void}
 */
function syncAttrs(a, b) {
  for (const { name } of [...a.attributes]) {
    if (name !== "style" && !b.hasAttribute(name)) a.removeAttribute(name);
  }
  for (const { name, value } of [...b.attributes]) {
    if (name !== "style" && a.getAttribute(name) !== value) a.setAttribute(name, value);
  }
}

/**
 * Make `a` (live) look like `b` (desired), recursively.
 * @param {Node} a
 * @param {Node} b
 * @returns {void}
 */
function morphNode(a, b) {
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  syncAttrs(a, b);
  reconcile(a, b);
}

/**
 * Reconcile the children of `parent` with those of `next` (see module doc).
 * @param {Element} parent Live element.
 * @param {Element|DocumentFragment} next Desired children container (from another document is fine).
 * @returns {void}
 */
export function reconcile(parent, next) {
  const olds = [...parent.childNodes];
  const byKey = new Map();
  for (const o of olds) {
    const k = keyOf(o);
    if (k) byKey.set(k, o);
  }
  const used = new Set();
  let ref = parent.firstChild;
  for (const n of [...next.childNodes]) {
    const k = keyOf(n);
    let match = null;
    if (k) match = byKey.get(k) ?? null;
    else if (ref && !used.has(ref) && !keyOf(ref) && ref.nodeType === n.nodeType && ref.nodeName === n.nodeName) match = ref;
    if (match && !used.has(match)) {
      if (match !== ref) parent.insertBefore(match, ref);
      used.add(match);
      morphNode(match, n);
      ref = match.nextSibling;
    } else {
      const fresh = parent.ownerDocument.importNode(n, true);
      parent.insertBefore(fresh, ref);
      used.add(fresh);
    }
  }
  for (const o of olds) if (!used.has(o)) o.remove();
}

/**
 * Reconcile `root` with an HTML string.
 * @param {Element} root
 * @param {string} html
 * @returns {void}
 */
export function morphHtml(root, html) {
  const tpl = root.ownerDocument.createElement("template");
  tpl.innerHTML = html;
  reconcile(root, tpl.content);
}
