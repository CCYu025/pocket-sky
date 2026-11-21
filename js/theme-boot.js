/*
 * Classic (non-module) script, loaded in <head> before the stylesheets so the
 * first paint already has the right theme (no day flash at night, and the
 * error/loading states, which have no view model, keep the last theme).
 *
 * data-theme = ps:theme when it is 'day' or 'night'; when it is 'auto' (or
 * missing) day/night is computed from the most recent cached forecast
 * (om:v1:forecast:*, latest savedAt: today's sunrise/sunset at the cached
 * utc offset, else current.is_day), and only without a usable cache the last
 * resolved theme (ps:theme-last, written by the app) is used.
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
    // Day/night from the newest cached forecast; null when nothing usable.
    var fromCache = function () {
      var ls = window.localStorage;
      var best = null;
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (typeof k !== "string" || k.indexOf("om:v1:forecast:") !== 0) continue;
        try {
          var e = JSON.parse(ls.getItem(k));
          if (e && typeof e.savedAt === "number" && e.value && typeof e.value === "object" && (!best || e.savedAt > best.savedAt)) best = e;
        } catch (err) {
          /* corrupt entry: skip */
        }
      }
      if (!best) return null;
      var f = Array.isArray(best.value) ? best.value[0] : best.value;
      if (!f || typeof f !== "object") return null;
      var off = typeof f.utc_offset_seconds === "number" ? f.utc_offset_seconds : 0;
      var iso = new Date(Date.now() + off * 1000).toISOString();
      var date = iso.slice(0, 10);
      var d = f.daily;
      if (d && Array.isArray(d.time) && Array.isArray(d.sunrise) && Array.isArray(d.sunset)) {
        var di = d.time.indexOf(date);
        var rise = d.sunrise[di];
        var set = d.sunset[di];
        if (di >= 0 && typeof rise === "string" && typeof set === "string") {
          var key = iso.slice(0, 16);
          return key < rise || key >= set ? "night" : "day";
        }
      }
      var isDay = f.current && f.current.is_day;
      return isDay === 0 ? "night" : isDay === 1 ? "day" : null;
    };
    var computed = null;
    if (!valid(pref)) {
      try {
        computed = fromCache();
      } catch (e) {
        computed = null;
      }
    }
    var theme = valid(pref) ? pref : computed ? computed : valid(last) ? last : null;
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors[theme]);
  } catch (e) {
    /* never block rendering */
  }
})();
