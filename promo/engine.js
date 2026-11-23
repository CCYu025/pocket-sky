/* Pocket Sky promo engine v3 - configurable, deterministic Canvas 2D renderer.
   window.PromoEngine = { create(config) -> {duration, render(ctx,t), W, H, beats, ready, audio, timeline, cameraSpeed}, DEFAULTS, FEATURES, helpers }
   render(ctx,t) is a pure function of t (no Date / Math.random). See ENGINE.md. */
(function () {
  'use strict';
  const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","WenQuanYi Zen Hei",sans-serif';
  const MONO = '"Share Tech Mono",ui-monospace,"DejaVu Sans Mono",monospace';

  /* ---------- math helpers ---------- */
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    outC: p => 1 - Math.pow(1 - p, 3),
    ioC: p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
    outX: p => p >= 1 ? 1 : 1 - Math.pow(2, -10 * p),
    outB: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    outB2: p => { const c1 = .8, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    ioS: p => -(Math.cos(Math.PI * p) - 1) / 2,
    /* trapezoid-velocity ease: accelerate for fraction a, cruise, decelerate. peak speed = 1/(1-a) x average */
    trap: (p, a) => { a = a == null ? .22 : a; const k = 1 / (1 - a); if (p <= 0) return 0; if (p >= 1) return 1; if (p < a) return k * p * p / (2 * a); if (p < 1 - a) return k * (a / 2 + (p - a)); const q = 1 - p; return 1 - k * q * q / (2 * a); },
  };
  function hash(n) { let x = (n | 0) + 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
  function mixc(hex, p) { const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; return `rgb(${Math.round(lerp(r, 255, p))},${Math.round(lerp(g, 255, p))},${Math.round(lerp(b, 255, p))})`; }
  function rr(c, x, y, w, h, r, keep) { if (!keep) c.beginPath(); r = Math.min(r, w / 2, h / 2); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function merge(a, b) { const o = Object.assign({}, a); for (const k in b) { o[k] = isObj(b[k]) && isObj(a[k]) ? merge(a[k], b[k]) : b[k]; } return o; }

  /* ---------- 7-segment ---------- */
  const SEG = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
  const POLY = { a: [[10, 6], [16, 0], [40, 0], [46, 6], [40, 12], [16, 12]], b: [[50, 10], [56, 16], [56, 40], [50, 46], [44, 40], [44, 16]], c: [[50, 54], [56, 60], [56, 84], [50, 90], [44, 84], [44, 60]], d: [[10, 94], [16, 88], [40, 88], [46, 94], [40, 100], [16, 100]], e: [[6, 54], [12, 60], [12, 84], [6, 90], [0, 84], [0, 60]], f: [[6, 10], [12, 16], [12, 40], [6, 46], [0, 40], [0, 16]], g: [[10, 50], [16, 44], [40, 44], [46, 50], [40, 56], [16, 56]] };
  function seg7(c, str, x, y, h, ink, ghost, gap) {
    const s = h / 100, w = h * .56; let cx = x; gap = gap == null ? h * .1 : gap;
    for (const ch of str) {
      if (ch === ':' || ch === ';') { if (ch === ':') { c.fillStyle = ink; const d = h * .09; c.fillRect(cx, y + h * .28, d, d); c.fillRect(cx, y + h * .66, d, d); } cx += h * .09 + gap; continue; }
      const on = SEG[ch] || '';
      for (const k of 'abcdefg') {
        c.beginPath(); POLY[k].forEach(([px, py], j) => { const X = cx + px * s + (100 - py) * s * .1, Y = y + py * s; j ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath();
        if (ghost && !on.includes(k)) { c.fillStyle = ghost; c.fill(); }
        if (on.includes(k)) { c.fillStyle = ink; c.fill(); }
      }
      cx += w + gap;
    }
    return cx - x;
  }

  /* ---------- neon primitives ---------- */
  function ntext(c, s, x, y, size, col, o) {
    o = o || {}; const a = o.a == null ? 1 : o.a; if (a <= .01) return;
    c.save(); c.globalAlpha *= a; c.font = `${o.w || 900} ${size}px ${o.mono ? MONO : FONT}`; c.textAlign = o.align || 'center'; c.textBaseline = 'middle';
    if ('letterSpacing' in c) c.letterSpacing = (o.ls || 0) + 'px';
    const g = o.glow == null ? 1 : o.glow;
    if (o.flat) { c.fillStyle = col; c.fillText(s, x, y); c.restore(); return; }
    c.shadowColor = col; c.shadowBlur = 26 * g; c.fillStyle = col; c.fillText(s, x, y);
    c.shadowBlur = 9 * g; c.fillText(s, x, y); c.shadowBlur = 0;
    c.fillStyle = mixc(col, .8); c.fillText(s, x, y); c.restore();
  }
  function glowStroke(c, col, lw, blur, pathFn, a) {
    c.save(); if (a != null) c.globalAlpha *= a; c.strokeStyle = col; c.lineWidth = lw; c.lineJoin = c.lineCap = 'round';
    c.shadowColor = col; c.shadowBlur = blur; pathFn(); c.stroke(); c.shadowBlur = blur / 2.5; c.stroke();
    c.shadowBlur = 0; c.strokeStyle = mixc(col, .85); c.lineWidth = Math.max(1, lw * .35); c.stroke(); c.restore();
  }

  /* ---------- default feature definitions ----------
     All coordinates are "shot units": the 780 px wide space of the screenshots (CSS px x 2). The 3x captures are
     1170 px wide and are scaled by 780/naturalWidth on draw, so one unit is always 1/780 of the shot width.
     The numbers come from the measured element rectangles in shots/regions.js (window.PromoShots, written by
     capture-shots.mjs), so the promo follows the real layout of the app. */
  const COL = { CY: '#22E5FF', YL: '#FFD23F', PK: '#FF6B9A', MT: '#8FE3CC' };
  const cx = r => r[0] + r[2] / 2, cy = r => r[1] + r[3] / 2;
  const infl = (r, d) => [r[0] - d, r[1] - d, r[0] + r[2] + d, r[1] + r[3] + d];            /* [x,y,w,h] -> hl [x0,y0,x1,y1] */
  function buildFeatures(PS) {
    const R = (PS && PS.regions) || {};
    if (!R.today) return {};
    const C = R.commute, X = R.exercise, T = R.trip, P = R.picker, PA = R['picker-after'], D = R.today, TB = R['trip-before'], CB = R['commute-before'];
    return {
      commute: { label: '通勤', col: COL.PK, steps: [{ img: 'commute', v: 860, hl: [32, C.selBack[1] - 8, 748, C.umbrella[1] + C.umbrella[3] + 6], tp: [C.selBack[0] + C.selBack[2] * .55, cy(C.selBack)], action: 'swap',
        swap: { from: 'commute-before', fromRect: [32, C.hero[1], 716, CB.checklist[1] + CB.checklist[3] - C.hero[1] + 12], bgRect: [32, C.hero[1], 716, C.checklist[1] + C.checklist[3] - C.hero[1] + 8], bg: '#FFF7D6', fade: .35, pop: C.umbrella, col: COL.YL },
        tag: 'COMMUTE 通勤', cap: '帶不帶傘，幫你判斷', result: '勾選雨傘，傍晚 60% 有雨' }] },
      exercise: { label: '運動', col: COL.YL, steps: [{ img: 'exercise', v: 780, hl: [32, 690, 748, 1140], tp: [cx(X.bar14), cy(X.bar14)], action: 'swap',
        swap: { from: 'exercise-before', fromRect: [32, X.hero[1], 716, X.picker[1] + X.picker[3] - X.hero[1]], fade: .3, pop: X.bar14, col: COL.YL },
        tag: 'EXERCISE 運動', cap: '最佳運動時段', result: '點 14:00，最適合，分數 93' }] },
      trip: { label: '出遊', col: COL.CY, steps: [{ img: 'trip', v: 700, hl: infl([32, T.dests[1], 716, T.lcd[1] + T.lcd[3] - T.dests[1]], 6), tp: [cx(T.destLake), cy(T.destLake)], action: 'swap',
        swap: { from: 'trip-before', fromRect: [32, T.dests[1], 716, T.lcd[1] + T.lcd[3] - T.dests[1]], fade: .5, pop: T.destLake, col: COL.CY },
        tag: 'TRIP 出遊', cap: '目的地溫差一眼看', result: '日月潭比目前位置低 5°' }] },
      picker: { label: '地點', col: COL.MT, steps: [{ img: 'picker', v: 700, hl: [50, P.input[1] + P.input[3] + 60, 730, P.count[1] + P.count[3] + 14], tp: [cx(P.addBtn), cy(P.addBtn)], action: 'swap',
        swap: { to: 'picker-after', toRect: [20, P.resultRow[1] - 6, 740, P.dialog[1] + P.dialog[3] - P.resultRow[1] + 6], bgRect: [34, P.resultRow[1] - 6, 712, P.dialog[1] + P.dialog[3] - P.resultRow[1] - 8], bg: '#FFF7D6', fade: .4, pop: PA.done.map((v, i) => i < 2 ? v - 10 : v + 20), col: COL.MT, popImg: 'picker-after' },
        tag: 'PICKER 地點搜尋', cap: '台中、日月潭，一搜就到', result: '已加入台中，4 / 5' }] },
      light: { label: 'LIGHT', col: COL.MT, whole: true, bloom: true, deal: 0, hold: 3.1, steps: [{ img: 'today', after: 'night', v: D.size.h / 2, hl: infl(D.light, 6), tp: [cx(D.light), cy(D.light)], action: 'light', tag: 'LIGHT 夜間模式', cap: '晚上，按 LIGHT', result: '夜間背光，護眼又好看', tapAt: .9 }] },
    };
  }
  const FEATURES = {};

  /* ---------- defaults ---------- */
  const DEFAULTS = {
    W: 960, H: 540, imgBase: 'shots/',
    style: { bg: '#07080C', cy: '#22E5FF', yl: '#FFD23F', pk: '#FF6B9A', mt: '#8FE3CC', ink: '#1E2618', lcdBg: '#B7C3A3', lcdGhost: '#A9B496', dim: .6, grid: true, stars: true },
    features: ['commute', 'exercise', 'trip', 'picker', 'light'],
    todayLabel: '今天',
    timeline: {
      open: { dep: 1.4, arrive: 2.4 },                                    /* pulse departs the API sign / arrives at Today */
      today: { closeup: 1.8, morph: 1.2, hold: .7, deal: .5 },
      station: { hop: .6, rise: .3, hold: 2.8, deal: .5, tapAt: 1.1 },    /* per-feature overrides: feature.hop/hold/deal/tapAt */
      finale: { fan: .5, arc: 1.8, collapse: .8, type: .8, final: 2.0 },
    },
    route: { start: [0, 0], heading: -12, hops: [{ len: 520, turn: 34 }, { len: 320, turn: -50 }, { len: 320, turn: 50 }, { len: 320, turn: -50 }, { len: 320, turn: 50 }, { len: 320, turn: -40 }], tail: { len: 800, turn: 25 }, points: null, stationIdx: null },
    camera: { mode: 'follow', zoom: [.72, .92], intro: .24, bank: .12, speedRef: 500, lead: 0, anchor: [.5, .5], hopEase: .22 },
    card: { style: 'neon', glow: 24, shadow: 8, stackOffset: 7, strip: 9 },
    caption: { mode: 'frame', timing: 'before', in: .15, size: 36, resultSize: 26, tagSize: 18 },
    marker: 'neon',
    open: { benefit: '出門前，先問天氣', benefitAt: .3, sign: 'Open-Meteo API', sub: '天氣資料起點站' },
    outro: { title: 'Pocket Sky', tag: '出門前，一眼看懂天氣', url: 'ccyu025.github.io/pocket-sky', credit: 'Weather data by Open-Meteo' },
    finale: { overview: false, arc: 'auto', dim: .72, bloomPeak: .5, bloomResidual: .12 },
    today: { lcdTag: 'TEMPERATURE', copy: 'TODAY', sub: '今天，一眼看完' },
    actions: {}, hooks: {}, audio: [],
  };

  /* ---------- images ---------- */
  const IMGS = {};
  /* draw an image in shot units (780 wide): optional source rect [sx,sy,sw,sh] in shot units */
  function dI(c, im, src, dst) { const f = im.naturalWidth / 780; if (!src) c.drawImage(im, 0, 0, 780, im.naturalHeight / f); else c.drawImage(im, src[0] * f, src[1] * f, src[2] * f, src[3] * f, dst[0], dst[1], dst[2], dst[3]); }
  function getImg(base, k) { const key = base + k; if (!IMGS[key]) { const im = new Image(); im.src = base + k + '.png'; IMGS[key] = { im, p: new Promise(r => { im.onload = im.onerror = () => r(); }) }; } return IMGS[key]; }
  const imgOK = im => im && im.complete && im.naturalWidth > 0;

  /* ===================================================================== */
  function create(user) {
    const cfg = merge(DEFAULTS, user || {});
    const W = cfg.W, H = cfg.H, S = cfg.style, HK = cfg.hooks || {}, TLc = cfg.timeline, CAM = cfg.camera, CAP = cfg.caption, CARD = cfg.card;
    const CY = S.cy, YL = S.yl, PK = S.pk, MT = S.mt, BG = S.bg, INK = S.ink, LCDBG = S.lcdBg, LCDGH = S.lcdGhost;
    const port = H > W * 1.15;
    const zk = Math.sqrt(W * H / (960 * 540));
    const PSH = cfg.shots || window.PromoShots || {}, RG = PSH.regions || {}, FEAT = buildFeatures(PSH);
    if (!RG.today) throw new Error('shots/regions.js (window.PromoShots) missing: run capture-shots.mjs and load shots/regions.js before engine.create');
    const imgNames = ['today', 'night', 'commute', 'exercise', 'trip', 'picker', 'commute-before', 'exercise-before', 'trip-before', 'picker-after'];
    const IMG = {}; const ps = imgNames.map(k => { const g = getImg(cfg.imgBase, k); IMG[k] = g.im; return g.p; });

    /* ---------- features ---------- */
    function normFeature(def) {
      if (typeof def === 'string') def = { id: def };
      const base = Object.assign({}, FEAT[def.id] || {}, def);
      let steps;
      if (def.merge) {
        steps = def.merge.map(id => Object.assign({}, FEAT[id].steps[0]));
        base.col = def.col || FEAT[def.merge[0]].col; base.label = def.label || def.merge.map(id => FEAT[id].label).join('+');
        base.whole = false; base.id = def.id || def.merge.join('+');
      } else steps = (def.steps || base.steps).map(s => Object.assign({}, s));
      ['cap', 'result', 'tag', 'tapAt', 'hold', 'action'].forEach(k => { if (def[k] != null && !def.merge) steps[0][k] = def[k]; });
      if (def.stepOver) def.stepOver.forEach((o, i) => Object.assign(steps[i], o));
      base.steps = steps; return base;
    }
    const feats = cfg.features.map(normFeature);
    const NF = feats.length, NS = NF + 2, NC = NF + 1;                    /* stations incl. start & today; cards incl. today */

    /* ---------- timeline ---------- */
    const TL = (function () {
      const T = TLc, o = { st: [] };
      const st0 = { i: 0, dep: T.open.dep }; o.st.push(st0);
      const td = { i: 1, name: cfg.todayLabel, arr: T.open.arrive };
      td.riseS = td.arr - (T.station.rise || .3); td.closeE = td.arr + T.today.closeup; td.morphE = td.closeE + T.today.morph; td.holdE = td.morphE + T.today.hold; td.dealS = td.holdE; td.dealE = td.dealS + T.today.deal; td.dep = td.dealE; td.copyS = td.closeE + T.today.morph * (T.today.copyFrac != null ? T.today.copyFrac : .75);
      o.st.push(td); o.today = td; let prev = td;
      feats.forEach((f, k) => {
        const hop = f.hop != null ? f.hop : T.station.hop, rise = f.rise != null ? f.rise : T.station.rise;
        f.arr = prev.dep + hop; f.riseS = f.arr - rise; f.i = k + 2; f.hopS = prev.dep;
        let h = 0; f.steps.forEach(s => { s.holdD = s.hold != null ? s.hold : (f.hold != null && f.steps.length === 1 ? f.hold : T.station.hold); s.hs = f.arr + h; h += s.holdD; s.he = f.arr + h; s.tapT = s.hs + (s.tapAt != null ? s.tapAt : (f.tapAt != null ? f.tapAt : T.station.tapAt)); });
        f.holdE = f.arr + h; f.dealS = f.holdE; const dl = f.deal != null ? f.deal : T.station.deal; f.dealD = dl; f.dealE = f.dealS + dl; f.dep = f.dealE; f.name = f.label; f.slot = k + 1;
        o.st.push(f); prev = f;
      });
      const Fi = T.finale; o.fanS = prev.dep; o.fanE = o.fanS + Fi.fan; o.arcE = o.fanE + Fi.arc; o.foldS = o.arcE; o.foldE = o.foldS + .5; o.parkS = o.foldS + (Fi.parkAt != null ? Fi.parkAt : .35); o.parkE = o.foldS + Fi.collapse;
      o.titleS = o.parkE; o.tagS = o.titleS + (Fi.tagAt != null ? Fi.tagAt : .4); o.urlS = o.titleS + (Fi.urlAt != null ? Fi.urlAt : .5); o.urlE = Fi.urlDone != null ? o.titleS + Fi.urlDone : o.urlS + .3; o.typeE = o.titleS + Fi.type; o.finalS = Math.max(o.typeE, o.urlE + .1); o.dur = Fi.dur != null ? Fi.dur : o.finalS + Fi.final;
      return o;
    })();
    const DUR = TL.dur;

    /* ---------- layout (all derived from W,H) ---------- */
    const Lay = (function () {
      const L = { port };
      if (!port) {
        L.rest = { cx: W * .26, cy: H * .5, vw: 340 * zk, vh: 440 * zk }; L.restW = { cx: W * .26, cy: H * .485, vw: 190 * zk, vh: 464 * zk };
        L.cap = { x: W * .5, w: W * .475, cy: H * .5 };
        L.whole = { cx: W / 2, cy: H / 2, vw: 205 * zk, vh: 500 * zk }; L.copy = { x: W * .719, y: H * .485, align: 'left' };
        L.lcd = { cx: W / 2, cy: H / 2, vw: 640 * zk, vh: 384 * zk };
        L.stack = { cx: W - 66 * zk, vw: 70 * zk, vh: 160 * zk };
        L.park = { cx: W * .214, cy: H * .5, vw: 205 * zk, vh: 500 * zk };
        L.out = { x: W * .415, align: 'left', title: H * .35, tag: H * .51, url: H * .625, credit: H * .76, titleSize: 82, tagSize: 46, urlW: 500, urlSize: 28 };
      } else {
        L.rest = { cx: W / 2, cy: H * .35, vw: 350 * zk, vh: 450 * zk }; L.restW = { cx: W / 2, cy: H * .345, vw: 200 * zk, vh: 490 * zk };
        L.cap = { x: 30, w: W - 60, cy: H * .35 + 225 * zk + 24 + 78 };
        L.whole = { cx: W / 2, cy: H * .39, vw: 205 * zk, vh: 500 * zk }; L.copy = { x: W / 2, y: H * .39 + 250 * zk + 84, align: 'center' };
        L.lcd = { cx: W / 2, cy: H / 2, vw: W - 40, vh: (W - 40) * .6 };
        L.stack = { cx: W - 56, vw: 70, vh: 160 };
        L.park = { cx: W / 2, cy: H * .25, vw: 170, vh: 415 };
        L.out = { x: W / 2, align: 'center', title: H * .56, tag: H * .64, url: H * .72, credit: H * .82, titleSize: 62, tagSize: 36, urlW: W - 60, urlSize: 24 };
      }
      L.stack.top = H - 16 - (NC - 1) * CARD.stackOffset - L.stack.vh;
      if (user && user.layout) Object.assign(L, user.layout);
      return L;
    })();

    /* ---------- route ---------- */
    const DS = 5, RX = [], RY = []; let RL = 0; const STS = [];
    (function build() {
      const R = cfg.route, nHops = NS - 1;
      if (R.points) {
        const CP = R.points, n = CP.length, raw = [], cum = [], q = i => CP[clamp(i, 0, n - 1)];
        for (let i = 0; i < n - 1; i++) { const p0 = q(i - 1), p1 = q(i), p2 = q(i + 1), p3 = q(i + 2); for (let k = 0; k < 40; k++) { const u = k / 40, u2 = u * u, u3 = u2 * u; const f = (a, b, c2, d) => .5 * ((2 * b) + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u2 + (-a + 3 * b - 3 * c2 + d) * u3); raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]); } }
        raw.push(CP[n - 1].slice()); let acc = 0; cum.push(0);
        for (let i = 1; i < raw.length; i++) { acc += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]); cum.push(acc); }
        RL = acc; (R.stationIdx || []).forEach(ci => STS.push(cum[ci * 40]));
        let j = 0; for (let s = 0; s <= RL; s += DS) { while (j < cum.length - 2 && cum[j + 1] < s) j++; const p = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]); RX.push(lerp(raw[j][0], raw[j + 1][0], p)); RY.push(lerp(raw[j][1], raw[j + 1][1], p)); }
      } else {
        const hops = R.hops.slice(); while (hops.length < nHops) { const l = hops[hops.length - 1]; hops.push({ len: l.len, turn: -l.turn }); }
        const segs = hops.slice(0, nHops).concat([R.tail]); let s0 = 0; const starts = [];
        segs.forEach(h => { starts.push(s0); s0 += h.len; }); RL = s0; for (let i = 0; i < nHops; i++) STS.push(starts[i + 1]); STS.unshift(0); STS.length = NS;
        let x = R.start[0], y = R.start[1], th = R.heading * Math.PI / 180, si = 0, hd = [];
        // heading at start of each seg
        let ths = []; { let a = th; segs.forEach(h => { ths.push(a); a += h.turn * Math.PI / 180; }); }
        for (let s = 0; s <= RL + 1e-6; s += DS) {
          RX.push(x); RY.push(y);
          while (si < segs.length - 1 && s + DS / 2 >= starts[si + 1]) si++;
          const h = segs[si], a = ths[si] + h.turn * Math.PI / 180 * clamp((s + DS / 2 - starts[si]) / h.len);
          x += Math.cos(a) * DS; y += Math.sin(a) * DS;
        }
      }
    })();
    function pt(s) { s = clamp(s, 0, RL); const f = s / DS, i = Math.min(RX.length - 2, Math.floor(f)), p = f - i; return [lerp(RX[i], RX[i + 1], p), lerp(RY[i], RY[i + 1], p)]; }
    function ang(s) { const a = pt(s - 10), b = pt(s + 10); return Math.atan2(b[1] - a[1], b[0] - a[0]); }
    const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const SPOS = STS.map(s => pt(s));
    const SCOL = [CY, CY].concat(feats.map(f => f.col));
    const SNAME = ['起點', cfg.todayLabel].concat(feats.map(f => f.label));

    /* pulse position along the route */
    const depT = [TL.st[0].dep, TL.today.dep].concat(feats.map(f => f.dep)), arrT = [0, TL.today.arr].concat(feats.map(f => f.arr));
    function Ps(t) {
      if (t <= depT[0]) return STS[0];
      for (let k = 0; k < NS - 1; k++) { if (t < depT[k] ) break; if (t < arrT[k + 1]) return lerp(STS[k], STS[k + 1], E.trap(seg(t, depT[k], arrT[k + 1]), CAM.hopEase)); if (t < depT[k + 1]) return STS[k + 1]; }
      const last = NS - 1; if (t < depT[last]) return STS[last];
      return lerp(STS[last], RL, E.ioS(seg(t, depT[last], DUR + 3)));
    }
    function speed(t) { return Math.abs(Ps(t + .04) - Ps(t - .04)) / .08; }

    /* bounding box of the whole route (for overview) */
    const BB = (function () { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let i = 0; i < RX.length; i += 4) { x0 = Math.min(x0, RX[i]); x1 = Math.max(x1, RX[i]); y0 = Math.min(y0, RY[i]); y1 = Math.max(y1, RY[i]); } return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }; })();

    /* camera */
    const AX = CAM.anchor[0] * W, AY = CAM.anchor[1] * H;
    function camAt(t) {
      const s = Ps(t + (CAM.lead || 0)), c = pt(s);
      let f = 0; [-.4, -.2, 0, .2, .4].forEach(o => f += speed(t + o)); f = clamp(f / 5 / CAM.speedRef * 1.0);
      let z, rot = 0;
      if (CAM.mode === 'static') z = (CAM.zoom[1]) * zk;
      else { const m = 1 + CAM.intro * (1 - E.outC(seg(t, 0, 2.0))); z = lerp(CAM.zoom[1], CAM.zoom[0], E.ioS(f)) * m * zk; const bank = clamp(wrapA(ang(s + 170) - ang(s - 170)) * -CAM.bank, -.09, .09); rot = bank * (.3 + .4 * clamp(f * 2)) + Math.sin(t * .6) * .006; }
      const cm = { x: c[0], y: c[1], z, rot, f };
      if (cfg.finale.overview) { const ov = E.ioC(seg(t, TL.fanS, TL.fanS + 1.2)); if (ov > 0) { const fit = Math.min(W * .86 / BB.w, H * .78 / BB.h); cm.x = lerp(cm.x, BB.cx, ov); cm.y = lerp(cm.y, BB.cy, ov); cm.z = lerp(cm.z, fit, ov); cm.rot *= 1 - ov; } }
      return cm;
    }
    function w2s(cm, x, y) { const dx = (x - cm.x) * cm.z, dy = (y - cm.y) * cm.z, co = Math.cos(cm.rot), si = Math.sin(cm.rot); return [AX + dx * co - dy * si, AY + dx * si + dy * co]; }
    function cameraSpeed(t) { const a = camAt(t - .02), b = camAt(t + .02); return Math.hypot(b.x - a.x, b.y - a.y) / .04; }
    function stationNormal(i) { const a = ang(STS[i]); let nx = -Math.sin(a), ny = Math.cos(a); if (ny < 0) { nx = -nx; ny = -ny; } return [nx, ny]; }

    /* ---------- opening ignition (<= ~2 flashes / s) ---------- */
    function neon(t) { const base = .4 + .6 * E.outC(seg(t, .15, 1.0)); const dip = seg(t, .5, .55) * (1 - seg(t, .6, .7)) * .3 + seg(t, 1.05, 1.1) * (1 - seg(t, 1.15, 1.25)) * .2; return clamp(base - dip); }

    /* ---------- feature timing helpers ---------- */
    function capEnv(f, s, t, last) {
      const cs = CAP.timing === 'afterTap' ? s.tapT + .1 : s.hs + CAP.in, ce = s.he - .05;
      const inP = E.outX(seg(t, cs, cs + .35)), outP = seg(t, ce - .2, ce);
      return { a: inP * (1 - outP), inP, cs, ce };
    }
    function labelFade(f, t) { // 0..1 remaining label visibility for feature station
      const s0 = f.steps[0]; const start = port ? f.riseS : s0.hs + (CAP.timing === 'afterTap' ? s0.tapT : CAP.in);
      return 1 - seg(t, start, start + .25);
    }
    const stepAt = (f, t) => { let k = 0; f.steps.forEach((s, i) => { if (t >= s.hs) k = i; }); return k; };

    /* ---------- cards ---------- */
    function mixP(a, b, p) { return { cx: lerp(a.cx, b.cx, p), cy: lerp(a.cy, b.cy, p), rot: lerp(a.rot || 0, b.rot || 0, p), vw: lerp(a.vw, b.vw, p), vh: lerp(a.vh, b.vh, p), u: lerp(a.u, b.u, p), v: lerp(a.v, b.v, p), sc: a.sc * Math.pow(b.sc / a.sc, p), a: lerp(a.a == null ? 1 : a.a, b.a == null ? 1 : b.a, p) }; }
    const fw = q => { q.sc = q.vw / 780; return q; };
    const view = (vw, vh, v, cx, cy, rot) => ({ cx: cx || 0, cy: cy || 0, rot: rot || 0, vw, vh, u: 390, v, sc: vw / 780, a: 1 });
    const IMG_H = RG.today.size.h;
    const wholeP = (B, a) => { const q = view(B.vw, B.vh, IMG_H / 2, B.cx, B.cy, 0); q.a = a == null ? 1 : a; return q; };
    const LCD_V = RG.today.lcd[1] + RG.today.lcd[3] / 2;
    const V_LCD = Object.assign({ cx: Lay.lcd.cx, cy: Lay.lcd.cy, rot: 0, vw: Lay.lcd.vw, vh: Lay.lcd.vh, u: 390, v: LCD_V, a: 1 }, { sc: Lay.lcd.vw / 696 });
    const SLOT = j => { const st = Lay.stack, sc = st.vw / 780; return { cx: st.cx, cy: st.top + st.vh / 2 + j * CARD.stackOffset, rot: (j % 2 ? .02 : -.02), vw: st.vw, vh: st.vh, u: 390, v: st.vh / 2 / sc, sc, a: 1 }; };
    const ARC = i => {
      const N = NC; if ((cfg.finale.arc === 'auto' ? port : cfg.finale.arc === 'grid')) {
        const cols = Math.ceil(N / 2), rows = 2, gw = (W - 40) / cols, vw = Math.min(150, gw - 14), vh = Math.min(330, (H * .3)), r = Math.floor(i / cols), c = i % cols, inRow = r === 0 ? cols : N - cols;
        const cx = W / 2 + (c - (inRow - 1) / 2) * gw, cy = H * (.3 + .36 * r); return view(vw, vh, vh / 2 / (vw / 780), cx, cy, 0);
      }
      const d = i - (N - 1) / 2, sp = Math.min(150 * zk, (W - 150 * zk) / Math.max(1, N - 1)), vw = 132 * zk, vh = 300 * zk;
      return view(vw, vh, 887 * zk / zk * 1, W / 2 + d * sp, H * .485 + Math.pow(d / (N / 2), 2) * 26 * zk, d * .06);
    };
    function cardCol(i) { return i === 0 ? CY : feats[i - 1].col; }
    function cardImg(i) { if (i === 0) return 'today'; const f = feats[i - 1], s = f.steps[f.steps.length - 1]; return s.after || s.img; }

    function drawCard(c, imgs, P, col, o) {
      o = o || {}; const a = clamp(P.a == null ? 1 : P.a); if (a <= .005 || P.vw < 1) return;
      if (HK.drawCard) { if (HK.drawCard(c, imgs, P, col, o, { drawDefault: drawCardDefault }) !== false) return; }
      drawCardDefault(c, imgs, P, col, o);
    }
    function drawCardDefault(c, imgs, P, col, o) {
      o = o || {}; const a = clamp(P.a == null ? 1 : P.a); if (a <= .005 || P.vw < 1) return;
      const w = P.vw, h = P.vh, brutal = CARD.style === 'brutal', pad = brutal ? clamp(w * .02, 2, 6) : clamp(w * .022, 2, 7), r = brutal ? clamp(w * .012, 1, 4) : clamp(w * .05, 3, 17), glow = o.glow == null ? CARD.glow : o.glow;
      c.save(); c.globalAlpha *= a; c.translate(P.cx, P.cy); c.rotate(P.rot || 0);
      if (brutal) {
        const so = (o.small ? CARD.shadow * .5 : CARD.shadow); c.fillStyle = CARD.shadowColor || '#000'; c.fillRect(-w / 2 - pad + so, -h / 2 - pad + so, w + 2 * pad, h + 2 * pad);
        c.fillStyle = CARD.paper || '#FFF7D6'; c.fillRect(-w / 2 - pad, -h / 2 - pad, w + 2 * pad, h + 2 * pad); c.strokeStyle = '#000'; c.lineWidth = clamp(w * .02, 2, 5); c.strokeRect(-w / 2 - pad, -h / 2 - pad, w + 2 * pad, h + 2 * pad);
      } else {
        c.fillStyle = 'rgba(10,14,26,.94)'; c.shadowColor = col; c.shadowBlur = glow; rr(c, -w / 2 - pad, -h / 2 - pad, w + 2 * pad, h + 2 * pad, r + pad); c.fill(); c.shadowBlur = 0;
        c.save(); c.strokeStyle = col; c.lineWidth = clamp(w * .011, 1.5, 3); c.shadowColor = col; c.shadowBlur = glow; rr(c, -w / 2 - pad, -h / 2 - pad, w + 2 * pad, h + 2 * pad, r + pad); c.stroke(); c.shadowBlur = glow * .4; c.stroke(); c.restore();
      }
      c.save(); rr(c, -w / 2, -h / 2, w, h, r); c.clip();
      c.fillStyle = '#0B0F1C'; c.fillRect(-w / 2, -h / 2, w, h);
      c.save(); c.translate(-P.u * P.sc, -P.v * P.sc); c.scale(P.sc, P.sc);
      imgs.forEach(([im, al]) => { if (al > .002 && imgOK(im)) { c.globalAlpha = al; dI(c, im); c.globalAlpha = 1; } });
      if (o.inner) o.inner(c);
      c.restore();
      if (!brutal) {
        c.fillStyle = 'rgba(7,10,22,.1)'; c.fillRect(-w / 2, -h / 2, w, h);
        const rg = c.createLinearGradient(-w / 2, -h / 2, w * .1, -h / 2 + h * .45); rg.addColorStop(0, 'rgba(255,255,255,.13)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = rg; c.fillRect(-w / 2, -h / 2, w, h);
        if (o.sweep != null && o.sweep > 0 && o.sweep < 1) { const gx = -w * .9 + w * 2.2 * o.sweep, sg = c.createLinearGradient(gx, -h / 2, gx + w * .5, -h / 2 + w * .25); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(255,255,255,.2)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = sg; c.fillRect(-w / 2, -h / 2, w, h); }
      }
      if (o.strip) { c.fillStyle = col; c.fillRect(-w / 2, -h / 2, w, CARD.strip); }
      c.restore(); c.restore();
    }

    /* ---------- Today LCD redraw (image coords) ---------- */
    function todayLCD(c, t) {
      const a = TL.today.arr, cs = cfg.today.countSteps, n = cs ? cs.reduce((v, st) => t >= st.t ? st.n : v, 0) : Math.round(23 * E.outC(seg(t, a + .2, a + 1.2))), tp = RG.today.temp, ck = RG.today.clock, TT = cfg.today.temp != null ? cfg.today.temp : 23;
      c.fillStyle = LCDBG; c.fillRect(tp[0] - 8, tp[1] - 12, tp[2] + 14, tp[3] + 24);
      seg7(c, String(Math.floor(n * TT / 23 / 10)) + String(Math.round(n * TT / 23) % 10), tp[0] + (cfg.today.dx || 0), tp[1], tp[3], INK, LCDGH, cfg.today.gap == null ? 13 : cfg.today.gap);
      c.fillStyle = LCDBG; c.fillRect(ck[0] - 14, ck[1] - 8, ck[2] + 24, ck[3] + 16);
      const on = Math.floor(t * 2) % 2 === 0; seg7(c, on ? cfg.today.clock || '14:20' : (cfg.today.clock || '14:20').replace(':', ';'), ck[0] + (cfg.today.cdx || 0), ck[1], ck[3], INK, null, 5);
    }

    /* ---------- tap actions (drawn in image coords) ---------- */
    function popS(k) { return 1 + .15 * E.outC(seg(k, 0, .12)) * (1 - E.ioC(seg(k, .9, 1.5))); }
    function popDraw(cc, rect, k, fn, col) {
      const [x, y, w, h] = rect, s = popS(k), ox = x + w / 2, oy = y + h / 2;
      cc.save(); cc.translate(ox, oy); cc.scale(s, s); cc.translate(-ox, -oy); fn(cc);
      const al = 1 - seg(k, 1.3, 2.1); if (al > 0) { cc.globalAlpha = al; cc.strokeStyle = col || YL; cc.lineWidth = 6; cc.shadowColor = col || YL; cc.shadowBlur = 16; cc.strokeRect(x - 3, y - 3, w + 6, h + 6); }
      cc.restore();
    }
    const popImg = (cc, im, rect, k, col) => popDraw(cc, rect, k, c2 => { if (imgOK(im)) dI(c2, im, rect, rect); }, col);
    const AH = { IMG, E, seg, clamp, lerp, rr, seg7, popDraw, popImg, popS, FONT, MONO, S, imgOK };
    /* swap: the screenshot is captured in ONE state; the other state of the same app screen is a second real capture
       (commute-before, exercise-before, trip-before, picker-after). Around the tap the region is cross-faded between the two
       real captures and the changed element gets the 1.15x pop + outline. step.swap = {from|to, fromRect|toRect, bgRect, bg, fade, pop, col, popImg} */
    const ACTIONS = Object.assign({
      swap(cc, k, h) {
        const sw = h.step.swap, fade = sw.fade || .3, p = E.ioS(seg(k, 0, fade));
        const crop = (name, r, al) => { const im = IMG[name]; if (!imgOK(im) || al <= .003) return; cc.save(); cc.globalAlpha = al; if (sw.bgRect) { cc.fillStyle = sw.bg || '#FFF7D6'; const b = sw.bgRect; cc.fillRect(b[0], b[1], b[2], b[3]); } cc.beginPath(); cc.rect(r[0], r[1], r[2], r[3]); cc.clip(); dI(cc, im, r, r); cc.restore(); };
        if (sw.from) crop(sw.from, sw.fromRect, 1 - p);          /* base = state after the tap: show the earlier state until the tap */
        if (sw.to) crop(sw.to, sw.toRect, p);                    /* base = state before the tap: bring in the later state after it */
        if (k >= 0) popImg(cc, IMG[sw.popImg || h.step.img], sw.pop, k, sw.col || YL);
      },
      light(cc, k, h) { if (k >= 0.05) popImg(cc, IMG.night, infl(RG.today.light, 0).slice(0, 2).concat(RG.today.light.slice(2)), k - .05, MT); },
    }, cfg.actions || {});

    /* ---------- UI decoration ---------- */
    function spotlight(c, x, y, w, h, a, r, col) {
      if (a <= .01) return;
      c.save(); c.fillStyle = `rgba(3,4,10,${.55 * a})`; c.beginPath(); c.rect(0, 0, W, H); rr(c, x, y, w, h, r, true); c.fill('evenodd');
      glowStroke(c, col, 2.5, 14, () => rr(c, x, y, w, h, r), a); c.restore();
    }
    function finger(c, x, y, k, ap) {
      if (HK.finger) { if (HK.finger(c, x, y, k, ap) !== false) return; }
      const lift = seg(k, 0, .15), a = ap * (1 - lift); const rip = k > 0 && k < .5;
      if (a > .01 || rip) {
        if (rip) { const p = k / .5; c.save(); c.globalAlpha = (1 - p) * .55; c.strokeStyle = '#fff'; c.lineWidth = 3; c.shadowColor = '#fff'; c.shadowBlur = 12; c.beginPath(); c.arc(x, y, 12 + 38 * E.outC(p), 0, 7); c.stroke(); c.restore(); }
      }
      if (a <= .01) return;
      const press = k > -.12 && k <= 0 ? seg(k, -.12, 0) * .18 : 0, hov = (1 - ap) * 24;
      const px = x + hov * .6 + lift * 36, py = y + hov + lift * 42;
      c.save(); c.globalAlpha *= a;
      c.fillStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.ellipse(px + 15, py + 36, 13, 31, .5, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.ellipse(px + 18, py + 52, 17, 34, .5, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.92)'; c.shadowColor = '#fff'; c.shadowBlur = 18; c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(px, py, 15 * (1 - press), 0, 7); c.fill(); c.shadowBlur = 0; c.stroke(); c.restore();
    }
    function drawCaption(c, f, t) {
      f.steps.forEach((s, i) => {
        const e = capEnv(f, s, t); if (e.a <= .01) return;
        const L = Lay.cap, x = L.x, w = L.w, h = 156, y0 = L.cy - h / 2, sx = port ? 0 : (1 - e.inP) * 50, sy = port ? (1 - e.inP) * 24 : 0;
        if (HK.caption) { if (HK.caption(c, f, s, t, e, { box: [x, y0, w, h] }) !== false) return; }
        c.save(); c.translate(sx, sy);
        const frame = CAP.mode === 'frame';
        if (frame) { c.save(); c.globalAlpha = e.a; if (CARD.style === 'brutal') { c.fillStyle = '#000'; c.fillRect(x + 7, y0 + 7, w, h); c.fillStyle = CARD.paper || '#FFF7D6'; c.fillRect(x, y0, w, h); c.strokeStyle = '#000'; c.lineWidth = 4; c.strokeRect(x, y0, w, h); } else { c.fillStyle = 'rgba(6,8,16,.7)'; rr(c, x, y0, w, h, 18); c.fill(); } c.restore(); if (CARD.style !== 'brutal') glowStroke(c, f.col, 2, 14, () => rr(c, x, y0, w, h, 18), e.a * .7); }
        const br = CARD.style === 'brutal', tx = x + (frame ? 26 : 0), tc = br && frame ? '#000' : f.col, flat = br;
        c.save(); c.globalAlpha *= e.a;
        if (!frame) { c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 12; }
        ntext(c, s.tag, tx, y0 + 26, CAP.tagSize, br && frame ? '#000' : f.col, { align: 'left', mono: 1, w: 400, ls: 3, glow: .5, flat });
        ntext(c, s.cap, tx, y0 + 68, CAP.size, tc, { align: 'left', glow: 1, flat });
        const rs0 = CAP.res != null ? CAP.res : .12, ra = E.outC(seg(t, s.tapT + rs0, s.tapT + rs0 + .33)); if (ra > .01 && s.result) { ntext(c, s.result, tx, y0 + 112, CAP.resultSize, br && frame ? '#000' : '#E8F4FF', { align: 'left', glow: .3, w: 700, a: ra, flat: flat || true }); }
        c.restore();
        const lw = (w - (frame ? 52 : 0)) * E.outX(seg(t, e.cs + .1, e.cs + .6));
        if (!br) glowStroke(c, f.col, 3, 12, () => { c.beginPath(); c.moveTo(tx, y0 + h - 14); c.lineTo(tx + lw, y0 + h - 14); }, e.a); else { c.save(); c.globalAlpha = e.a; c.fillStyle = f.col; c.fillRect(tx, y0 + h - 18, lw, 8); c.restore(); }
        c.restore();
      });
    }

    /* ---------- feature pose + rendering ---------- */
    function restPose(f, t) {
      const B = f.whole ? Lay.restW : Lay.rest; const k = stepAt(f, t); const s = f.steps[k], pv = f.steps[Math.max(0, k - 1)];
      const x = k > 0 ? E.ioC(seg(t, s.hs, s.hs + .3)) : 1; const v = k > 0 ? lerp(pv.v, s.v, x) : s.v;
      return Object.assign(view(B.vw, B.vh, v, B.cx, B.cy, 0), { stepK: k, x });
    }
    function featPose(f, t, cm) {
      if (t < f.riseS) return null;
      const rest = restPose(f, Math.max(t, f.arr));
      if (t < f.arr) {
        const sp = w2s(cm, SPOS[f.i][0], SPOS[f.i][1]), p = seg(t, f.riseS, f.arr), s0 = Object.assign({}, rest, { cx: sp[0], cy: sp[1], rot: -.4, vw: rest.vw * .06, vh: rest.vh * .06, sc: rest.sc * .06, a: 0 });
        const q = fw(mixP(s0, rest, E.outB2(p))); q.a = E.outC(seg(p, 0, .35)); q.rot = lerp(-.4, 0, E.outC(p)); q.stepK = 0; q.x = 1; return q;
      }
      if (t < f.holdE) return rest;
      if (f.dealD > 0 && t < f.dealE) {
        const slot = SLOT(f.slot), p = E.ioC(seg(t, f.dealS, f.dealE)), q = fw(mixP(rest, slot, p)); q.cy -= Math.sin(p * Math.PI) * 46 * zk; q.rot = lerp(0, slot.rot, p) + Math.sin(p * Math.PI) * .35; return q;
      }
      if (f.dealD === 0 && t < TL.fanS) return rest;
      return null;
    }
    function renderFeature(c, f, t, cm) {
      const P = featPose(f, t, cm); if (!P) return null;
      const rested = t >= f.arr && t < f.holdE, k0 = P.stepK || 0, s = f.steps[k0];
      let imgs, inner = null; const tk = t - s.tapT;
      const prevS = f.steps[Math.max(0, k0 - 1)];
      if (P.x < 1 && k0 > 0) imgs = [[IMG[prevS.after || prevS.img], 1 - P.x], [IMG[s.img], P.x]];
      else imgs = [[IMG[s.img], 1]];
      if (s.after) { const d = E.ioC(seg(tk, .05, .45)); imgs = [[IMG[s.img], 1], [IMG[s.after], d]]; }
      if (t >= (f.riseS != null ? f.riseS : f.arr) - .02) {   /* inner (before-state crop) from the first visible frame, so the card never flashes the after state */
        const useS = (P.x < .5 && k0 > 0) ? prevS : s, kk = (P.x < .5 && k0 > 0) ? 9 : tk, act = ACTIONS[useS.action];
        if (act) inner = cc => act(cc, kk, Object.assign({}, AH, { step: useS }));
      }
      drawCard(c, imgs, P, f.col, { inner, sweep: rested ? seg(t, f.arr, f.arr + .9) : null });
      if (rested) {
        const X = px => P.cx + (px - P.u) * P.sc, Y = py => P.cy + (py - P.v) * P.sc;
        const sa = E.outC(seg(t, s.hs + .3, s.hs + .6)) * (1 - seg(t, s.tapT + .35, s.tapT + .8)) * (1 - seg(t, s.he - .25, s.he - .05)) * (P.x >= 1 ? 1 : 0);
        const [hx0, hy0, hx1, hy1] = s.hl, pd = 5 + 8 * (1 - sa); spotlight(c, X(hx0) - pd, Y(hy0) - pd, X(hx1) - X(hx0) + 2 * pd, Y(hy1) - Y(hy0) + 2 * pd, sa, 9, YL);
        const ap = E.outC(seg(t, s.tapT - .55, s.tapT - .08)) * (1 - seg(t, s.he - .2, s.he - .05)); if (P.x >= 1 || tk > -.6) finger(c, X(s.tp[0]), Y(s.tp[1]), tk, ap);
      }
      return P;
    }

    /* dim */
    function dimAt(t) {
      let d = 0; const V = S.dim;
      const win = (a, b) => { d = Math.max(d, V * Math.min(seg(t, a, a + .3), 1 - seg(t, b - .3, b))); };
      win(TL.today.arr - .2, TL.today.dealE);
      feats.forEach(f => win(f.riseS - .1, f.dealD > 0 ? f.dealE : TL.fanS + .3));
      d = Math.max(d, cfg.finale.dim * seg(t, TL.fanS - .1, TL.fanS + .4));
      return d;
    }

    /* late poses (all-cards arc + fold + park) */
    function preFanPose(i, t) { if (i === 0) return SLOT(0); const f = feats[i - 1]; return f.dealD > 0 ? SLOT(f.slot) : restPose(f, f.holdE - .01); }
    function latePose(i, t) {
      const from = preFanPose(i, t), arc = ARC(i), d = (NC - 1 - i) * .04, pr = seg(t, TL.fanS + d, TL.fanS + d + .5);
      const q = fw(mixP(from, arc, E.outB2(pr))); q.rot = lerp(from.rot || 0, arc.rot, E.outC(pr)) + Math.sin(pr * Math.PI) * -.25; q.cy -= Math.sin(pr * Math.PI) * 30 * zk; q.a = 1;
      if (t >= TL.foldS) {
        const wl = Lay.park;
        if (i === 0) {
          const p1 = E.outC(seg(t, TL.foldS, TL.foldS + .45)), cen = wholeP({ cx: W / 2, cy: H / 2, vw: wl.vw, vh: wl.vh });
          const m = mixP(arc, cen, p1); m.sc = m.vw / 780; m.v = lerp(arc.v, IMG_H / 2, p1); m.rot = lerp(arc.rot, -.07, p1);
          const p2 = E.ioC(seg(t, TL.parkS, TL.parkE)); m.cx = lerp(m.cx, wl.cx, p2); m.cy = lerp(m.cy, wl.cy, p2); m.rot = lerp(m.rot, 0, E.outC(seg(t, TL.parkS, TL.parkE))); m.a = 1; return m;
        }
        const s0 = TL.foldS + (i - 1) * .05, pf = E.ioC(seg(t, s0, s0 + .5)), tgt = wholeP({ cx: W / 2, cy: H / 2, vw: wl.vw * .95, vh: wl.vh * .95 });
        const m = fw(mixP(arc, tgt, pf)); m.a = 1 - seg(pf, .5, 1); m.rot = lerp(arc.rot, (i % 2 ? .05 : -.05), pf); return m;
      }
      return q;
    }
    function mainCenter(t) { // where the glow sits
      if (t < TL.fanS) { const f = feats[NF - 1]; return t >= f.arr ? [Lay.restW.cx, Lay.restW.cy] : [Lay.restW.cx, Lay.restW.cy]; }
      if (t < TL.parkS) return [lerp(Lay.restW.cx, W / 2, E.ioC(seg(t, TL.fanS, TL.fanS + .6))), lerp(Lay.restW.cy, H / 2, E.ioC(seg(t, TL.fanS, TL.fanS + .6)))];
      const p = E.ioC(seg(t, TL.parkS, TL.parkE)); return [lerp(W / 2, Lay.park.cx, p), lerp(H / 2, Lay.park.cy, p)];
    }

    /* ---------- world ---------- */
    function markerDefault(c, i, x, y, col, lit) {
      c.save(); c.globalAlpha = lit;
      if (cfg.marker === 'solid') { c.fillStyle = '#000'; c.beginPath(); c.arc(x + 4, y + 4, 24, 0, 7); c.fill(); c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 5; c.beginPath(); c.arc(x, y, 24, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); }
      else { c.fillStyle = BG; c.beginPath(); c.arc(x, y, 26, 0, 7); c.fill(); glowStroke(c, col, 7, 24 * lit, () => { c.beginPath(); c.arc(x, y, 24, 0, 7); }); c.fillStyle = '#fff'; c.shadowColor = col; c.shadowBlur = 10; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); }
      c.restore();
    }
    function startSignDefault(c, t, x, y, ctx) {
      const O = cfg.open, sy = y - 150, bo = neon(t - .05), fade = 1 - seg(t, TL.st[0].dep, TL.st[0].dep + .9);
      c.save(); c.globalAlpha *= fade;
      glowStroke(c, CY, 5, 26, () => rr(c, x - 232, sy - 48, 464, 96, 20), bo);
      glowStroke(c, CY, 2, 8, () => rr(c, x - 220, sy - 38, 440, 76, 14), bo * .55);
      c.save(); c.font = `400 46px ${MONO}`; const tw = c.measureText(O.sign).width; c.restore(); let cx0 = x - tw / 2;
      for (let i = 0; i < O.sign.length; i++) { c.save(); c.font = `400 46px ${MONO}`; const cw = c.measureText(O.sign[i]).width; c.restore(); ntext(c, O.sign[i], cx0 + cw / 2, sy + 2, 46, CY, { a: neon(t - i * .02), mono: 1, w: 400, glow: 1.1 }); cx0 += cw; }
      const sub = E.outC(seg(t, .6, 1.1)); ntext(c, O.sub, x, y - 72 + (1 - sub) * 8, 22, MT, { a: sub, glow: .7, ls: 4, w: 500 });
      c.save(); c.globalAlpha *= bo * .7; c.strokeStyle = 'rgba(34,229,255,.5)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 160, sy + 48); c.lineTo(x - 160, y - 90); c.moveTo(x + 160, sy + 48); c.lineTo(x + 160, y - 90); c.stroke(); c.restore();
      c.restore();
    }
    function drawWorld(c, t, cm, ctx) {
      c.fillStyle = BG; c.fillRect(0, 0, W, H);
      const g = c.createRadialGradient(AX, AY, 40, AX, AY, Math.max(W, H) * .65); g.addColorStop(0, '#101830'); g.addColorStop(1, BG); c.fillStyle = g; c.fillRect(0, 0, W, H);
      if (HK.background) HK.background(c, t, ctx);
      c.save(); c.translate(AX, AY); c.rotate(cm.rot); c.scale(cm.z, cm.z); c.translate(-cm.x, -cm.y);
      const co = Math.cos(cm.rot), si = Math.sin(cm.rot); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      [[0, 0], [W, 0], [0, H], [W, H]].forEach(([sx, sy]) => { const dx = (sx - AX) / cm.z, dy = (sy - AY) / cm.z; const wx = cm.x + dx * co + dy * si, wy = cm.y - dx * si + dy * co; x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy); });
      x0 -= 60; y0 -= 60; x1 += 60; y1 += 60;
      if (S.grid) { c.lineWidth = 1 / cm.z; c.strokeStyle = 'rgba(34,229,255,.07)'; c.beginPath(); const GS = 150; for (let x = Math.floor(x0 / GS) * GS; x <= x1; x += GS) { c.moveTo(x, y0); c.lineTo(x, y1); } for (let y = Math.floor(y0 / GS) * GS; y <= y1; y += GS) { c.moveTo(x0, y); c.lineTo(x1, y); } c.stroke(); }
      if (S.stars) { const CS = 130; for (let ci = Math.floor(x0 / CS); ci <= x1 / CS; ci++) for (let cj = Math.floor(y0 / CS); cj <= y1 / CS; cj++) { const n = (ci * 73856093) ^ (cj * 19349663); for (let k = 0; k < 3; k++) { const h = hash(n + k * 101); if (h < .4) continue; const sx = ci * CS + hash(n + k * 13 + 1) * CS, sy = cj * CS + hash(n + k * 17 + 2) * CS, hh = hash(n + k * 29 + 3); const tw = .45 + .55 * Math.sin(t * (.8 + hh * 1.6) + hh * 40), r = (.6 + hh * 1.3) / cm.z * (hh > .93 ? 1.9 : 1); c.fillStyle = hh > .85 ? `rgba(255,107,154,${.5 * tw})` : hh > .7 ? `rgba(34,229,255,${.55 * tw})` : `rgba(210,225,255,${.6 * tw})`; c.beginPath(); c.arc(sx, sy, r, 0, 7); c.fill(); } } }
      const sP = Ps(t), sS1 = STS[0];
      const path = (s0, s1) => { c.beginPath(); const p = pt(s0); c.moveTo(p[0], p[1]); for (let i = Math.ceil(s0 / DS); i <= Math.floor(s1 / DS); i++) c.lineTo(RX[i], RY[i]); const q = pt(s1); c.lineTo(q[0], q[1]); };
      c.lineJoin = c.lineCap = 'round';
      path(0, RL); c.strokeStyle = 'rgba(34,229,255,.13)'; c.lineWidth = 8; c.stroke(); c.strokeStyle = 'rgba(70,160,190,.45)'; c.lineWidth = 2.5; c.stroke();
      if (sP > sS1 + 1) glowStroke(c, CY, 7, 20, () => path(sS1, sP), .95);
      for (let i = 0; i < NS; i++) {
        const [x, y] = SPOS[i]; const dn = clamp(ctx.dim / .6), lit0 = i === 0 ? neon(t - .15) : .3 + .7 * seg(t, arrT[i] - .35, arrT[i]);
        const lit = lit0 * (1 - .97 * dn), col = SCOL[i];
        if (HK.stationMarker) { if (HK.stationMarker(c, i, x, y, col, lit, ctx) === false) markerDefault(c, i, x, y, col, lit); } else markerDefault(c, i, x, y, col, lit);
        if (i > 0) { const pr = seg(t, arrT[i], arrT[i] + .8); if (pr > 0 && pr < 1) { c.save(); c.globalAlpha = (1 - pr) * .9; glowStroke(c, col, 5, 18, () => { c.beginPath(); c.arc(x, y, 26 + 120 * E.outX(pr), 0, 7); }); c.restore(); } }
        let lab = 1 - dn; if (i >= 2) lab *= labelFade(feats[i - 2], t); else if (i === 1) lab *= 1 - seg(t, TL.today.arr - .2, TL.today.arr);
        const n = stationNormal(i); let lx = x + n[0] * 66, ly = y + n[1] * 66, al = 'center';
        if (Math.abs(n[0]) > .6) { lx = x + Math.sign(n[0]) * 48; ly = y + n[1] * 20; al = n[0] > 0 ? 'left' : 'right'; }
        ntext(c, SNAME[i], lx, ly, 30, col, { a: lit * lab, align: al, glow: .8 });
        ntext(c, 'STATION 0' + (i + 1), lx, ly + 26, 18, '#9FB8D8', { a: lit * .8 * lab, align: al, mono: 1, w: 400, glow: .2, ls: 2 });
      }
      if (HK.startSign) { if (HK.startSign(c, t, SPOS[0][0], SPOS[0][1], ctx) === false) startSignDefault(c, t, SPOS[0][0], SPOS[0][1], ctx); } else startSignDefault(c, t, SPOS[0][0], SPOS[0][1], ctx);
      const a0 = seg(t, .8, 1.15);
      { const sp = speed(t), tl = clamp(40 + sp * .11, 40, 460); const N = 30; c.save(); c.lineCap = 'round';
        for (let k = 0; k < N; k++) { const s0 = sP - tl * k / N, s1 = sP - tl * (k + 1) / N; if (s1 < 0) break; const a = Math.pow(1 - k / N, 1.6), p0 = pt(s0), p1 = pt(s1); c.strokeStyle = `rgba(120,240,255,${a * .85 * a0})`; c.lineWidth = 3 + 11 * a; c.shadowColor = CY; c.shadowBlur = 16 * a; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); }
        const hp = pt(sP), br = 9 + Math.sin(t * 9) * 1.2; c.shadowColor = CY; c.shadowBlur = 34; c.fillStyle = `rgba(255,255,255,${a0})`; c.beginPath(); c.arc(hp[0], hp[1], br, 0, 7); c.fill(); c.shadowBlur = 14; c.fill(); c.restore(); }
      c.restore();
    }

    /* ---------- render ---------- */
    const TD = TL.today;
    function render(c, t) {
      t = clamp(t, 0, DUR);
      c.save(); c.setLineDash([]); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0; c.textAlign = 'left'; if ('letterSpacing' in c) c.letterSpacing = '0px';
      const cm = camAt(t), dim = dimAt(t), ctx = { t, cm, dim, W, H, L: Lay, TL, cfg, w2s: (x, y) => w2s(cm, x, y), station: SPOS, stationScreen: i => w2s(cm, SPOS[i][0], SPOS[i][1]) };
      drawWorld(c, t, cm, ctx);
      if (HK.hop) { for (let k = 0; k < NS - 1; k++) if (t >= depT[k] && t < arrT[k + 1]) HK.hop(c, t, { from: k, to: k + 1, p: seg(t, depT[k], arrT[k + 1]), fromPos: ctx.stationScreen(k), toPos: ctx.stationScreen(k + 1) }, ctx); }
      if (dim > 0) { c.fillStyle = `rgba(5,6,12,${dim})`; c.fillRect(0, 0, W, H); }

      // opening benefit line
      { const O = cfg.open, a = E.outC(seg(t, O.benefitAt, O.benefitAt + .35)) * (1 - seg(t, TL.st[0].dep + .1, TL.st[0].dep + .5)); if (a > .01) ntext(c, O.benefit, W / 2, H * (port ? .72 : .8), port ? 40 : 44, MT, { a, glow: .9, w: 900 }); }

      // mint bloom (LIGHT)
      const lf = feats.find(f => f.bloom);
      if (lf) {
        const s = lf.steps[lf.steps.length - 1], tapL = s.tapT; if (t > tapL) {
          const [bx, by] = mainCenter(t), CF = cfg.finale, pk = CF.bloomPeak, rs = CF.bloomResidual, dec = E.outC(seg(t, tapL + .1, tapL + 1.3));
          const r = lerp(1500 * E.outX(seg(t, tapL, tapL + .9)) + 200, 430, dec), al = lerp(pk, rs, dec) * seg(t, tapL, tapL + .12);
          c.save(); c.globalCompositeOperation = 'screen'; const g = c.createRadialGradient(bx, by, 0, bx, by, r);
          g.addColorStop(0, `rgba(143,227,204,${al})`); g.addColorStop(.35, `rgba(143,227,204,${al * .45})`); g.addColorStop(1, 'rgba(143,227,204,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
          const rp = seg(t, tapL, tapL + 1.0); if (rp < 1) { c.globalAlpha = (1 - rp) * .5; c.strokeStyle = MT; c.lineWidth = 3; c.shadowColor = MT; c.shadowBlur = 20; c.beginPath(); c.arc(bx, by, 1300 * E.outX(rp) + 40, 0, 7); c.stroke(); }
          c.restore();
        }
      }

      // stack
      if (t < TL.fanS + .01) {
        for (let j = 0; j < NC; j++) {
          const doneT = j === 0 ? TD.dealE : (feats[j - 1].dealD > 0 ? feats[j - 1].dealE : 1e9); if (t < doneT) continue;
          drawCard(c, [[IMG[cardImg(j)], 1]], SLOT(j), cardCol(j), { glow: 8, strip: true, small: true });
        }
      }

      // Today station
      if (t >= TD.riseS && t < TD.dealE) {
        let P; const sp = w2s(cm, SPOS[1][0], SPOS[1][1]), a = TD.arr, W0 = Lay.whole;
        if (t < a) { const p = seg(t, TD.riseS, a), s0 = Object.assign({}, V_LCD, { cx: sp[0], cy: sp[1], vw: 30, vh: 18, sc: V_LCD.sc * .05, a: 0 }); P = mixP(s0, V_LCD, E.outX(p)); P.sc = P.vw * V_LCD.sc / V_LCD.vw; P.a = E.outC(seg(p, 0, .3)); }
        else if (t < TD.closeE) { const d = 1 + .035 * seg(t, a, TD.closeE); P = Object.assign({}, V_LCD, { vw: V_LCD.vw * d, vh: V_LCD.vh * d, sc: V_LCD.sc * d }); }
        else if (t < TD.morphE) {
          const p = E.ioC(seg(t, TD.closeE, TD.morphE)), sc = Math.exp(lerp(Math.log(V_LCD.sc), Math.log(W0.vw / 780), p));
          const vw = Math.min(lerp(V_LCD.vw, W0.vw, p), 780 * sc), vh = Math.min(lerp(V_LCD.vh, W0.vh, p), IMG_H * sc); let v = lerp(LCD_V, IMG_H / 2, p); const hh = vh / sc / 2; v = clamp(v, hh, IMG_H - hh);
          P = { cx: lerp(V_LCD.cx, W0.cx, p), cy: lerp(V_LCD.cy, W0.cy, p), rot: 0, vw, vh, u: 390, v, sc, a: 1 };
        } else if (t < TD.dealS) P = wholeP(W0);
        else { const slot = SLOT(0), p = E.ioC(seg(t, TD.dealS, TD.dealE)); P = fw(mixP(wholeP(W0), slot, p)); P.cy -= Math.sin(p * Math.PI) * 46 * zk; P.rot = lerp(0, slot.rot, p) + Math.sin(p * Math.PI) * .35; }
        const cardG = t < TD.closeE ? MT : CY;
        drawCard(c, [[IMG.today, 1]], P, cardG, { inner: t < TD.morphE ? (cc => todayLCD(cc, t)) : null, sweep: t > TD.morphE - .5 && t < TD.morphE + .7 ? seg(t, TD.morphE - .5, TD.morphE + .7) : null });
        if (t >= a + .3 && t < TD.closeE) { const al = E.outC(seg(t, a + .3, a + .6)) * (1 - seg(t, TD.closeE - .25, TD.closeE)); ntext(c, cfg.today.lcdTag, W / 2, port ? H / 2 - V_LCD.vh / 2 - 36 : 48, 22, MT, { a: al, mono: 1, w: 400, ls: 6, glow: .7 }); }
        if (t >= TD.copyS && t < TD.dealS) {
          const al = E.outC(seg(t, TD.copyS, TD.copyS + .3)) * (1 - seg(t, TD.dealS - .2, TD.dealS)), C = Lay.copy;
          ntext(c, cfg.today.copy, C.x, C.y - 30, 56, CY, { a: al, mono: 1, w: 400, ls: 8, align: C.align }); ntext(c, cfg.today.sub, C.x, C.y + 30, 28, MT, { a: al, align: C.align, w: 500, glow: .7 });
        }
      }

      // features + captions
      feats.forEach(f => { if (t >= f.riseS && t < (f.dealD > 0 ? f.dealE + .02 : TL.fanS)) renderFeature(c, f, t, cm); });
      feats.forEach(f => { if (t >= f.arr && t < f.holdE) drawCaption(c, f, t); });

      // all-cards arc / fold / park
      if (t >= TL.fanS) {
        const pulse = t > TL.fanE - .1 && t < TL.fanE + .5 ? Math.sin(seg(t, TL.fanE - .1, TL.fanE + .5) * Math.PI) : 0;
        const order = []; for (let i = 1; i < NC; i++) order.push(i); order.push(0);
        for (const i of order) {
          const P = latePose(i, t);
          drawCard(c, [[IMG[cardImg(i)], 1]], P, cardCol(i), { glow: 18 + 34 * pulse, sweep: i === 0 && t > TL.parkE + .2 && t < TL.parkE + 1.2 ? seg(t, TL.parkE + .2, TL.parkE + 1.2) : null });
          if (t < TL.foldS + .1 && P.a > .5) { const la = seg(t, TL.fanS + .35, TL.fanS + .65) * (1 - seg(t, TL.foldS - .05, TL.foldS + .15)); const nm = i === 0 ? cfg.todayLabel : feats[i - 1].label; ntext(c, nm, P.cx, P.cy + P.vh / 2 + 30, 22, cardCol(i), { a: la, glow: .7, w: 900 }); }
        }
      }

      // outro
      if (t >= TL.titleS) {
        const O = cfg.outro, Lo = Lay.out, x0 = Lo.x, txt = O.title, al = Lo.align;
        c.save(); c.font = `400 ${Lo.titleSize}px ${MONO}`; const adv = []; let tw = 0; for (const ch of txt) { const w = c.measureText(ch).width; adv.push(w); tw += w; } c.restore();
        let cx = al === 'center' ? x0 - tw / 2 : x0;
        for (let i = 0; i < txt.length; i++) {
          const t0 = TL.titleS + i * .035, on = t < t0 ? 0 : (t < t0 + .12 ? .6 : 1);
          ntext(c, txt[i], cx + adv[i] / 2, Lo.title, Lo.titleSize, i >= 7 ? YL : CY, { a: on, mono: 1, w: 400, glow: 1.2 }); cx += adv[i];
        }
        const tp = E.outX(seg(t, TL.tagS, TL.tagS + .3)); ntext(c, O.tag, x0 + (al === 'left' ? 2 : 0), Lo.tag + (1 - tp) * 18, Lo.tagSize, MT, { a: tp, align: al, glow: .9 });
        const sp = E.outX(seg(t, TL.urlS, TL.urlS + .25)), sw = Lo.urlW * sp, sh = 58, sx = al === 'center' ? x0 - Lo.urlW / 2 : x0, sy = Lo.url;
        if (sp > .01) {
          c.save(); c.globalAlpha = Math.min(1, sp * 2); c.shadowColor = MT; c.shadowBlur = 22; c.fillStyle = LCDBG; rr(c, sx, sy, sw, sh, 8); c.fill(); c.shadowBlur = 0;
          c.save(); rr(c, sx, sy, sw, sh, 8); c.clip();
          const url = O.url, us = O.urlSteps, n = us ? Math.min(url.length, Math.ceil(url.length * us.filter(x => t >= x).length / us.length)) : Math.floor(clamp((t - TL.urlS - .1) / .3) * url.length);
          c.font = `400 ${Lo.urlSize}px ${MONO}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = INK; c.fillText(url.slice(0, n), sx + 18, sy + sh / 2 + 1);
          if (n < url.length) { const cw = c.measureText(url.slice(0, n)).width; c.fillRect(sx + 20 + cw, sy + 12, 14, 32); }
          c.restore(); c.strokeStyle = '#111'; c.lineWidth = 3; rr(c, sx, sy, sw, sh, 8); c.stroke(); c.restore();
        }
        const wa = E.outC(seg(t, TL.urlE, TL.urlE + .25)); ntext(c, O.credit, x0 + (al === 'left' ? 2 : 0), Lo.credit, 18, '#9FB8D8', { a: wa * .85, align: al, mono: 1, w: 400, glow: .15 });
      }
      if (HK.overlay) HK.overlay(c, t, ctx);
      c.restore();
    }

    /* ---------- beats + audio ---------- */
    const beats = [['API 起點', 0], ['出發', TL.st[0].dep], ['今天 LCD', TD.arr], ['今天卡片', TD.closeE], ['入疊', TD.dealS]];
    feats.forEach(f => beats.push([f.label, f.riseS]));
    beats.push(['全部卡片', TL.fanS], ['收攏', TL.foldS], ['結語', TL.parkE], ['定格', TL.finalS]);
    const audio = [{ t: 0, cue: 'open_ignite' }, { t: TL.st[0].dep, cue: 'pulse_depart' }, { t: TD.arr, cue: 'arrive' }, { t: TD.closeE, cue: 'card_morph' }, { t: TD.dealS, cue: 'deal' }];
    feats.forEach(f => { audio.push({ t: f.hopS, cue: 'pulse_depart' }, { t: f.arr, cue: 'arrive' }); f.steps.forEach(s => audio.push({ t: s.tapT, cue: f.bloom ? 'tap_light' : 'tap', feature: f.id })); if (f.dealD > 0) audio.push({ t: f.dealS, cue: 'deal' }); });
    audio.push({ t: TL.fanS, cue: 'arc_fan' }, { t: TL.foldS, cue: 'collapse' }, { t: TL.parkS, cue: 'park' }, { t: TL.titleS, cue: 'title_type' }, { t: TL.urlS, cue: 'url_type' }, { t: TL.finalS, cue: 'final_hold' });
    (cfg.audio || []).forEach(a => audio.push(a)); audio.sort((a, b) => a.t - b.t);

    const timeline = { duration: DUR, today: TD, stations: feats.map(f => ({ id: f.id, label: f.label, hopS: f.hopS, riseS: f.riseS, arrive: f.arr, steps: f.steps.map(s => ({ hs: s.hs, he: s.he, tap: s.tapT })), holdE: f.holdE, dealE: f.dealE, dep: f.dep })), fanS: TL.fanS, fanE: TL.fanE, arcE: TL.arcE, foldS: TL.foldS, parkE: TL.parkE, titleS: TL.titleS, finalS: TL.finalS, open: TL.st[0], routeLen: RL, stationS: STS.slice() };
    return { duration: DUR, render, W, H, beats, ready: Promise.all(ps), audio, timeline, cameraSpeed, config: cfg, layout: Lay, camAt };
  }

  window.PromoEngine = { create, DEFAULTS, FEATURES, helpers: { clamp, seg, lerp, E, hash, mixc, rr, ntext, glowStroke, seg7, merge, FONT, MONO } };
})();
