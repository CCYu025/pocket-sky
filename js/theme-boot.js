/*
 * Classic (non-module) script, loaded in <head> before the stylesheets so the
 * first paint already has the right theme (no day flash at night, and the
 * error/loading states, which have no view model, keep the last theme).
 *
 * data-theme = ps:theme when it is 'day' or 'night'; when it is 'auto' (or
 * missing) the last resolved theme (ps:theme-last, written by the app) is used.
 * Must never throw: storage can be blocked or missing. Keep THEME_COLORS in
 * js/ui/theme.js in sync (a unit test checks it).
 */
(function () {
  try {
    var colors = { day: "#FFF7D6", night: "#141414" };
    var pref = null;
    var last = null;
    try {
      pref = window.localStorage.getItem("ps:theme");
      last = window.localStorage.getItem("ps:theme-last");
    } catch (e) {
      /* storage unavailable: fall through */
    }
    var valid = function (v) {
      return v === "day" || v === "night";
    };
    var theme = valid(pref) ? pref : valid(last) ? last : null;
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors[theme]);
  } catch (e) {
    /* never block rendering */
  }
})();
