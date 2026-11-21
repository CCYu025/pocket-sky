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

export const UPDATE_TEXT = "有新版本";
export const UPDATED_TEXT = "已更新，重新整理以載入新版";

/**
 * Render the update banner (once) above the sticky nav. It is inserted empty and its text is set on the next tick
 * (a `role="status"` region only announces changes after it exists); `say` is also called so the page's own
 * live region can speak it.
 * @param {Document} doc
 * @param {() => void} onReload Called when the key is pressed.
 * @param {{text?: string, say?: (text: string) => void}} [o] Initial text (default `有新版本`) and announcer.
 * @returns {HTMLElement}
 */
export function showBanner(doc, onReload, { text = UPDATE_TEXT, say = () => {} } = {}) {
  const existing = doc.getElementById("update-banner");
  if (existing) return existing;
  const bar = doc.createElement("div");
  bar.id = "update-banner";
  bar.className = "update-banner";
  bar.setAttribute("role", "status");
  const label = doc.createElement("span");
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "key";
  btn.textContent = "重新整理";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    onReload();
  });
  bar.append(label, btn);
  const nav = doc.querySelector(".nav");
  if (nav?.parentNode) nav.parentNode.insertBefore(bar, nav);
  else doc.body.append(bar);
  setBannerText(bar, text, say);
  return bar;
}

/**
 * Set the banner text on the next tick and announce it.
 * @param {HTMLElement} bar
 * @param {string} text
 * @param {(text: string) => void} [say]
 * @returns {void}
 */
export function setBannerText(bar, text, say = () => {}) {
  setTimeout(() => {
    bar.children[0].textContent = text;
    say(text);
  }, 0);
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

  const say = (text) => {
    try {
      win.dispatchEvent?.(new CustomEvent("ps:announce", { detail: text })); // main.js forwards it to the #live region
    } catch {
      /* announcing is best effort */
    }
  };
  const hadController = Boolean(sw.controller); // first install also fires controllerchange (clients.claim)
  let reg = null;
  let reloaded = false;
  let asked = false; // this tab pressed the key and is waiting for the new worker to take over
  /** The key: activate the waiting worker (the reload follows on controllerchange), or reload when it is already active. */
  const press = () => {
    if (reg?.waiting) {
      asked = true;
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } else loc.reload();
  };
  sw.addEventListener("controllerchange", () => {
    if (asked) {
      if (reloaded) return;
      reloaded = true;
      loc.reload();
    } else if (hadController) {
      // another tab pressed the key: the new worker controls this tab, whose page is still the old one
      const bar = doc.getElementById("update-banner");
      if (bar) setBannerText(bar, UPDATED_TEXT, say);
      else showBanner(doc, press, { text: UPDATED_TEXT, say });
    }
  });

  const offer = () => {
    if (!reg.waiting || !sw.controller) return; // no old worker controlling the page: nothing to update
    showBanner(doc, press, { say });
  };

  try {
    reg = await sw.register("./sw.js", { scope: "./", updateViaCache: "none" });
    offer();
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener("statechange", () => {
        if (w.state === "installed") offer();
      });
    });
    return true;
  } catch {
    return false; // the offline shell is an enhancement; never break the app
  }
}
