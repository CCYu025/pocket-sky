/**
 * Service worker registration and the non-blocking "new version" banner.
 * @module app/sw-register
 */

/**
 * @param {{search?: string, flag?: boolean}} env URL query string and the `__PS_NO_SW__` opt-out flag.
 * @param {object|undefined} sw `navigator.serviceWorker`
 * @returns {boolean} Whether registration should be attempted.
 */
export function shouldRegister({ search = "", flag = false }, sw) {
  if (!sw || flag) return false;
  return !new URLSearchParams(search).has("nosw");
}

/**
 * Render the update banner (once) above the sticky nav.
 * @param {Document} doc
 * @param {() => void} onReload Called when the key is pressed.
 * @returns {HTMLElement}
 */
export function showBanner(doc, onReload) {
  const existing = doc.getElementById("update-banner");
  if (existing) return existing;
  const bar = doc.createElement("div");
  bar.id = "update-banner";
  bar.className = "update-banner";
  bar.setAttribute("role", "status"); // announced once, when inserted (announce.js is off limits for M5-sw)
  const text = doc.createElement("span");
  text.textContent = "有新版本";
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "key";
  btn.textContent = "重新整理";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    onReload();
  });
  bar.append(text, btn);
  const nav = doc.querySelector(".nav");
  if (nav?.parentNode) nav.parentNode.insertBefore(bar, nav);
  else doc.body.append(bar);
  return bar;
}

/**
 * Register `./sw.js` and wire the update flow.
 * @param {object} [o] Injection points for tests.
 * @param {Navigator} [o.navigator]
 * @param {Document} [o.document]
 * @param {Location} [o.location]
 * @param {object} [o.win] Window-like (reads `__PS_NO_SW__`).
 * @returns {Promise<boolean>} true when a registration was made.
 */
export async function registerSW({ navigator: nav = globalThis.navigator, document: doc = globalThis.document, location: loc = globalThis.location, win = globalThis } = {}) {
  const sw = nav?.serviceWorker;
  if (!shouldRegister({ search: loc?.search ?? "", flag: Boolean(win.__PS_NO_SW__) }, sw)) return false;

  let reloaded = false;
  let asked = false; // reload only after the user pressed the key (first install also fires controllerchange via clients.claim)
  sw.addEventListener("controllerchange", () => {
    if (!asked || reloaded) return;
    reloaded = true;
    loc.reload();
  });

  const offer = (reg) => {
    if (!reg.waiting || !sw.controller) return; // no old worker controlling the page: nothing to update
    showBanner(doc, () => {
      asked = true;
      reg.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
  };

  try {
    const reg = await sw.register("./sw.js", { scope: "./" });
    offer(reg);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener("statechange", () => {
        if (w.state === "installed") offer(reg);
      });
    });
    return true;
  } catch {
    return false; // the offline shell is an enhancement; never break the app
  }
}
