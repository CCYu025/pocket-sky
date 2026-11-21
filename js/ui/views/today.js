/**
 * Today view: pure HTML template plus a thin DOM renderer.
 * Every interpolated API/storage string goes through `escapeHtml`.
 * @module ui/views/today
 */
import { seg7Svg, escapeHtml as esc } from "../seg7.js";
import { headline } from "../../domain/summary.js";
import {
  compassZh, uvBand, aqiBand, humidityWord, intText, deltaText, dateLabel, clockOf, clockAt,
  daylightPercent, countdownText,
} from "../format.js";

const BAR_COUNT = 8;

/**
 * Build the five metric cards' content.
 * @param {object} vm View model.
 * @returns {Array<{k: string, v: string, s: string}>}
 */
export function metricItems(vm) {
  const hours = vm.hours ?? [];
  const rain = hours.slice(0, 4).map((h) => h.rainProb).filter((p) => typeof p === "number");
  const rainMax = rain.length ? Math.max(...rain) : null;
  const uv = hours[0]?.uv ?? null;
  const aqi = vm.air?.aqi ?? hours[0]?.aqi ?? null;
  const dir = compassZh(vm.now.windDir);
  const wind = vm.now.wind;
  return [
    { k: "降雨機率", v: rainMax === null ? "--" : `${intText(rainMax)}%`, s: rainMax === null ? "無資料" : "未來 3 小時" },
    { k: "濕度", v: vm.now.humidity === null ? "--" : `${intText(vm.now.humidity)}%`, s: humidityWord(vm.now.humidity) ?? "無資料" },
    { k: "風", v: intText(wind), s: wind === null ? "無資料" : `km/h ${dir ?? ""}`.trim() },
    { k: "紫外線", v: intText(uv), s: uvBand(uv) ?? "無資料" },
    { k: "空氣品質", v: intText(aqi), s: aqiBand(aqi) === null ? "無資料" : `AQI ${aqiBand(aqi)}` },
  ];
}

/**
 * Hero card with the inset LCD.
 * @param {object|null} vm View model, or null for the loading skeleton.
 * @param {number|null} fetchedAt Epoch ms of the fetch.
 * @returns {string} HTML.
 */
function hero(vm, fetchedAt) {
  const ready = Boolean(vm);
  const clock = ready ? clockOf(vm.now.minuteKey) : null;
  const temp = ready ? intText(vm.now.temp) : "--";
  const tempLabel = temp === "--" ? "氣溫 無資料" : `氣溫 ${temp} 度`;
  const upd = ready && typeof fetchedAt === "number" ? clockAt(fetchedAt, vm.location.utcOffsetSeconds) : "--:--";
  const max = ready ? intText(vm.today.max) : "--";
  const min = ready ? intText(vm.today.min) : "--";
  return `<section class="hero" aria-label="現在"><div class="lcd">
<div class="lcd-top"><span>${esc(ready ? dateLabel(vm.now.minuteKey) : "-- --")}</span><span class="clock">${seg7Svg(clock ?? "--:--", { height: 24, ghost: false, label: clock ? `時間 ${clock}` : "時間 無資料" })}</span></div>
<div class="lcd-main"><div class="temp">${seg7Svg(temp, { height: 96, label: tempLabel })}<span class="unit" aria-hidden="true">°C</span></div>
<div class="lcd-side"><span class="lcd-cond">${esc(ready ? vm.now.label ?? "--" : "--")}</span><span>體感 ${esc(ready ? intText(vm.now.feels) : "--")}°</span><span>${esc(max)}° / ${esc(min)}°</span></div></div>
<div class="lcd-foot"><span>Δ YDAY ${esc(ready ? deltaText(vm.yesterdayDelta) : "--")}</span><span>UPD ${esc(upd)}</span></div>
</div></section>`;
}

/**
 * Metric cards plus the "more" key.
 * @param {object|null} vm
 * @returns {string} HTML.
 */
function metrics(vm) {
  const items = vm
    ? metricItems(vm)
    : ["降雨機率", "濕度", "風", "紫外線", "空氣品質"].map((k) => ({ k, v: "--", s: "載入中" }));
  const cards = items
    .map((m) => `<div class="metric"><span class="k">${esc(m.k)}</span><span class="v">${esc(m.v)}</span><span class="s">${esc(m.s)}</span></div>`)
    .join("");
  return `<section class="metrics" aria-label="重點指標">${cards}<button type="button" class="more" data-action="more" aria-label="更多指標（即將推出）">更多 <span aria-hidden="true">›</span></button></section>`;
}

/**
 * Hourly rain bars (first 8 hours).
 * @param {object|null} vm
 * @returns {string} HTML.
 */
function rainBars(vm) {
  const hours = vm ? vm.hours.slice(0, BAR_COUNT) : [];
  const head = `<div class="card-head"><span>逐時降雨</span><span class="hint">高度 = 機率</span></div>`;
  if (vm && hours.length === 0) {
    return `<section class="card" aria-label="逐時降雨">${head}<p class="notice">沒有逐時資料</p></section>`;
  }
  const slots = vm ? hours : Array.from({ length: BAR_COUNT }, () => ({ rainProb: null, hour: null }));
  const probs = slots.map((h) => (typeof h.rainProb === "number" ? Math.max(0, Math.min(100, h.rainProb)) : 0));
  const bars = probs.map((p, i) => `<div class="bar" data-p="${Math.round(p)}" data-i="${i}"></div>`).join("");
  const labels = slots
    .map((h, i) => {
      const pct = typeof h.rainProb === "number" ? `${Math.round(h.rainProb)}%` : "--";
      const t = i === 0 ? "現在" : h.hour === null ? "--" : String(h.hour).padStart(2, "0");
      return `<span><b>${esc(pct)}</b><i>${esc(t)}</i></span>`;
    })
    .join("");
  const best = vm ? probs.indexOf(Math.max(...probs)) : -1;
  const desc = !vm
    ? "逐時降雨機率載入中"
    : probs[best] > 0
      ? `逐時降雨機率，${slots[best].hour === null ? "" : `${slots[best].hour} 時`}最高 ${Math.round(probs[best])}%`
      : "逐時降雨機率，未來 8 小時皆為 0%";
  return `<section class="card" aria-label="逐時降雨">${head}<div class="bars" role="img" aria-label="${esc(desc)}">${bars}</div><div class="bar-labels">${labels}</div></section>`;
}

/**
 * Sunrise / sunset row with the daylight progress bar.
 * @param {object|null} vm
 * @returns {string} HTML.
 */
function sun(vm) {
  const rise = vm ? clockOf(vm.today.sunrise) : null;
  const set = vm ? clockOf(vm.today.sunset) : null;
  const pct = vm ? daylightPercent(vm) : null;
  const text = vm ? countdownText(vm) : null;
  return `<section class="card sun" aria-label="日出日落"><div class="sun-row"><span>日出 ${esc(rise ?? "--:--")}</span><span>${esc(text ?? "--")}</span><span>日落 ${esc(set ?? "--:--")}</span></div>
<div class="daybar" role="progressbar" aria-label="日照已過" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct ?? 0}"${pct === null ? ' aria-valuetext="無資料"' : ""}><div data-pct="${pct ?? 0}"></div></div></section>`;
}

/**
 * Full Today view HTML for a controller state.
 * @param {object} state Controller state (see js/app/controller.js).
 * @param {{attribution: {text: string, href: string}}} ui
 * @returns {string} HTML.
 */
export function todayHtml(state, ui) {
  const { status, vm, alert } = state;
  const hasVm = Boolean(vm);
  let title;
  if (status === "loading") title = "載入天氣中…";
  else if (!hasVm) title = "資料暫時無法取得";
  else title = headline(vm, alert);

  const parts = [`<h1 class="headline">${esc(title)}</h1>`];
  if (alert && hasVm) {
    parts.push(
      `<div class="alert" role="status"><span class="alert-text">${esc(alert.title)}・${esc(alert.detail)}</span><button type="button" class="alert-close" data-action="dismiss-alert" aria-label="關閉提醒">×</button></div>`,
    );
  }
  if (status === "stale" && hasVm) {
    parts.push(`<p class="banner" role="status">資料時間 ${esc(clockAt(state.fetchedAt ?? 0, vm.location.utcOffsetSeconds))}・無法更新</p>`);
  }
  if (hasVm && vm.stale?.current) parts.push(`<p class="banner" role="status">觀測資料較舊，顯示預報值</p>`);
  if (status === "error") {
    parts.push(`<div class="error-card" role="alert"><p>無法取得天氣資料，請檢查網路後再試。</p><button type="button" class="key" data-action="retry">重試</button></div>`);
  }
  const show = status === "loading" || status === "error" ? null : vm;
  parts.push(hero(show, state.fetchedAt));
  if (status !== "error") parts.push(metrics(show), rainBars(show), sun(show));
  parts.push(`<a class="attribution" href="${esc(ui.attribution.href)}" rel="noopener" target="_blank">${esc(ui.attribution.text)}</a>`);
  return parts.join("\n");
}

/**
 * Set the numeric custom properties (`--p`, `--i`, `--pct`) from `data-*` attributes via
 * the CSSOM. Inline `style` attributes are blocked by the CSP (no 'unsafe-inline'),
 * `el.style.setProperty()` is not.
 * @param {ParentNode} root Container holding the rendered Today view.
 * @returns {void}
 */
export function applyDynamicStyles(root) {
  for (const el of root.querySelectorAll("[data-p]")) {
    el.style.setProperty("--p", el.dataset.p);
    el.style.setProperty("--i", el.dataset.i ?? "0");
  }
  for (const el of root.querySelectorAll("[data-pct]")) el.style.setProperty("--pct", el.dataset.pct);
}

/**
 * Render the Today view into `root`.
 * @param {HTMLElement} root The `<main>` element.
 * @param {object} state Controller state.
 * @param {{attribution: {text: string, href: string}, animate?: boolean}} ui
 * @returns {void}
 */
export function renderToday(root, state, ui) {
  root.setAttribute("aria-busy", state.status === "loading" ? "true" : "false");
  root.classList.toggle("anim", Boolean(ui.animate));
  root.innerHTML = todayHtml(state, ui);
  applyDynamicStyles(root);
}
