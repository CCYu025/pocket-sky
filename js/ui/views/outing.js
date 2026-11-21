/**
 * Outing planner placeholder (implemented in M3).
 * @module ui/views/outing
 */

/**
 * Render the placeholder into `root`.
 * @param {HTMLElement} root The `<main>` element.
 * @returns {void}
 */
export function renderOuting(root) {
  root.setAttribute("aria-busy", "false");
  root.innerHTML = `<h1 class="headline">外出規劃</h1>\n<div class="placeholder">外出規劃：M3 開發中</div>`;
}
