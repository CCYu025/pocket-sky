/* 方案 06：數字母題 - LCD 七段數字當轉場載體：每段行駛中一組大型讀數逐段（segment-by-segment）變形，隨光點前進，最後落入下一張卡片的關鍵數值。 */
(function () {
  'use strict';
  window.PromoVariants = window.PromoVariants || [];
  const H = PromoEngine.helpers, { seg, clamp, lerp, E, ntext, rr, seg7, MONO, FONT } = H;

  /* 七段幾何（與引擎 seg7 相同，用於逐段 alpha） */
  const SEG = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
  const POLY = { a: [[10, 6], [16, 0], [40, 0], [46, 6], [40, 12], [16, 12]], b: [[50, 10], [56, 16], [56, 40], [50, 46], [44, 40], [44, 16]], c: [[50, 54], [56, 60], [56, 84], [50, 90], [44, 84], [44, 60]], d: [[10, 94], [16, 88], [40, 88], [46, 94], [40, 100], [16, 100]], e: [[6, 54], [12, 60], [12, 84], [6, 90], [0, 84], [0, 60]], f: [[6, 10], [12, 16], [12, 40], [6, 46], [0, 40], [0, 16]], g: [[10, 50], [16, 44], [40, 44], [46, 50], [40, 56], [16, 56]] };
  const KEYS = 'abcdefg';

  /* 六格版面：[數位, 數位, 中間符號, 數位, 數位, 尾符號]；' ' = 該格不存在 */
  const VAL = {
    '--': [' ', ' ', ' ', '-', '-', ' '],
    '23°': [' ', ' ', ' ', '2', '3', '°'],
    '18:00': ['1', '8', ':', '0', '0', ' '],
    '14:00': ['1', '4', ':', '0', '0', ' '],
    '-5°': [' ', ' ', ' ', '-', '5', '°'],
    '4/5': [' ', '4', '/', '5', ' ', ' '],
    '20:30': ['2', '0', ':', '3', '0', ' '],
  };
  /* 每段行駛：從 → 到、目的站色、標籤 */
  const HOPS = [null,
    { a: '--', b: '23°', col: '#22E5FF', lab: '今天' },
    { a: '23°', b: '18:00', col: '#FF6B9A', lab: '通勤' },
    { a: '18:00', b: '14:00', col: '#FFD23F', lab: '運動' },
    { a: '14:00', b: '-5°', col: '#22E5FF', lab: '出遊' },
    { a: '-5°', b: '4/5', col: '#8FE3CC', lab: '地點' },
    { a: '4/5', b: '20:30', col: '#8FE3CC', lab: 'LIGHT' },
  ];
  /* 落點：下一張卡片關鍵數值的位置，取自 shots/regions.js 量測到的 DOM 方塊（shot units = 780 px 寬座標）。
     [rect, 取哪個截圖區域]；pose / v 由引擎的功能卡定義取得（TL.st[j].steps[0].v），所以與卡片實際顯示的裁切一致。 */
  const RG = (window.PromoShots || {}).regions || {};
  const mid = r => ({ ix: r[0] + r[2] / 2, iy: r[1] + r[3] / 2, h: r[3] });
  const LAND = RG.today ? [null,
    Object.assign({ lcd: true }, mid(RG.today.temp)),                       /* 今天 LCD：氣溫 23 */
    Object.assign({ pose: 'rest' }, mid(RG.commute.legDigits)),             /* 通勤：BACK 18:00 */
    Object.assign({ pose: 'rest' }, mid(RG.exercise.timeDigits)),           /* 運動：14:00 */
    Object.assign({ pose: 'rest' }, mid(RG.trip.diffDigits)),               /* 出遊：-5 */
    Object.assign({ pose: 'rest' }, mid(RG.picker.countSpan)),              /* 地點：已儲存 4 / 5 */
    Object.assign({ pose: 'restW' }, mid(RG.today.clock)),                  /* LIGHT：時鐘 20:30 */
  ] : [];
  /* 今天與夜間截圖比舊版高：whole / park / restW 視窗依實際截圖長寬比重算（高度不變，寬度縮小） */
  const IH = RG.today ? RG.today.size.h : 1902, asp = IH / 780;
  const LAYOUT = { whole: { cx: 480, cy: 270, vw: 500 / asp, vh: 500 }, restW: { cx: 480 * 0.52, cy: 262, vw: 464 / asp, vh: 464 }, park: { cx: 960 * .214, cy: 270, vw: 500 / asp, vh: 500 } };

  const mine = {
    layout: LAYOUT,
    hooks: {},
  };

  /* ---- beat-locked timeline (music candidate B, see audio/beatgrid.py + audio/finalize.py) ----
     window.BeatGrid.film[m] = measured film time of beat m (m % 4 == 0 = bar line); m = 0 is the downbeat the audio segment starts on,
     m = 8 is the chorus-lift downbeat. p(x) interpolates between measured beats (x = 4.5 -> 8th note, 4.25 -> 16th), so tempo drift never accumulates.
     Layout (beats): 0 sign | 1 benefit | 4 pulse departs | 7 LCD arrives | 8 count-up (8th-note steps to 11) | 12 morph | 15 deal | 16 first hop
     station k (k = 0..4, d = 16 + 8k): d hop (downbeat) | d+1 arrive, caption | d+4 TAP (downbeat) + result | d+7 deal | d+8 next hop
     52 LIGHT tap | 56 arc reveal | 60 fold | 64 title | 65 tag | 65.5 URL box | 66..67.75 URL on 16ths | 68 credit | 72 end (bar line). */
  const BG = window.BeatGrid;
  if (BG) {
    const B = BG.film, p = x => { const i = Math.floor(x + 1e-9), f = x - i; return f < 1e-9 ? B[i] : B[i] + (B[i + 1] - B[i]) * f; };
    const FEAT_IDS = ['commute', 'exercise', 'trip', 'picker', 'light'];
    mine.features = FEAT_IDS.map((id, k) => { const d = 16 + 8 * k, o = { id, hop: p(d + 1) - p(d), tapAt: p(d + 4) - p(d + 1), hold: p(d + 7) - p(d + 1) }; if (id !== 'light') o.deal = p(d + 8) - p(d + 7); else o.hold = p(d + 8) - p(d + 1); return o; });
    mine.timeline = {
      open: { dep: p(4), arrive: p(7) },
      today: { closeup: p(12) - p(7), morph: p(14) - p(12), hold: p(15) - p(14), deal: p(16) - p(15), copyFrac: (p(13) - p(12)) / (p(14) - p(12)) },
      finale: { fan: p(57) - p(56), arc: p(60) - p(57), collapse: p(64) - p(60), parkAt: p(62) - p(60), tagAt: p(65) - p(64), urlAt: p(65.5) - p(64), urlDone: p(68) - p(64), dur: p(72) },
    };
    mine.open = { benefitAt: p(1) };
    mine.caption = { in: 0, res: 0 };
    mine.camera = { hopEase: .15 };            /* 1-beat hops (0.55 s) are a little shorter than the old 0.6 s: gentler ease keeps the camera <= 700 px/s */
    mine.today = { countSteps: [3, 7, 10, 14, 17, 20, 23].map((n, k) => ({ t: p(8 + k / 2), n })) };
    mine.outro = { urlSteps: [0, 1, 2, 3, 4, 5, 6, 7].map(k => p(66 + k / 4)) };
  }

  function cellW(i, ch, h) { if (i === 2) return ch === '/' ? h * .3 : h * .2; if (i === 5) return h * .3; return h * .66; }
  function present(ch) { return ch === ' ' ? 0 : 1; }

  /* 畫一組讀數：A→B 以 e（0..1）逐段切換 */
  function readout(c, cx, cy, h, A, B, e, alpha, col, S) {
    const a = VAL[A], b = VAL[B];
    const pr = [], w = [];
    for (let i = 0; i < 6; i++) { const wa = present(a[i]) ? cellW(i, a[i], h) : 0, wb = present(b[i]) ? cellW(i, b[i], h) : 0; const ww = lerp(wa, wb, E.ioS(clamp(e * 1.15 - i * .04))); w.push(ww); }
    const tw = w.reduce((s, v) => s + v, 0), padX = h * .34, padY = h * .26, pw = tw + padX * 2, ph = h + padY * 2;
    c.save(); c.globalAlpha *= alpha;
    c.shadowColor = col; c.shadowBlur = 30 * h / 150; c.fillStyle = S.lcdBg; rr(c, cx - pw / 2, cy - ph / 2, pw, ph, h * .1); c.fill(); c.shadowBlur = 0;
    c.strokeStyle = '#111'; c.lineWidth = Math.max(2, h * .03); rr(c, cx - pw / 2, cy - ph / 2, pw, ph, h * .1); c.stroke();
    let x = cx - tw / 2; const y = cy - h / 2, sc = h / 100;
    for (let i = 0; i < 6; i++) {
      const ww = w[i]; if (ww < 1) { continue; }
      if (i === 2) {                                     /* 中間：冒號 / 斜線 */
        const colon = lerp(a[2] === ':' ? 1 : 0, b[2] === ':' ? 1 : 0, clamp(e * 1.4 - .15)), slash = lerp(a[2] === '/' ? 1 : 0, b[2] === '/' ? 1 : 0, clamp(e * 1.4 - .15));
        c.fillStyle = S.ink; const d = h * .09;
        if (colon > .02) { c.globalAlpha = alpha * colon; c.fillRect(x + ww / 2 - d / 2, y + h * .28, d, d); c.fillRect(x + ww / 2 - d / 2, y + h * .66, d, d); }
        if (slash > .02) { c.globalAlpha = alpha * slash; c.beginPath(); c.moveTo(x + ww * .15, y + h * .92); c.lineTo(x + ww * .45, y + h * .92); c.lineTo(x + ww * .95, y + h * .08); c.lineTo(x + ww * .65, y + h * .08); c.closePath(); c.fill(); }
        c.globalAlpha = alpha; x += ww; continue;
      }
      if (i === 5) {                                     /* 尾符號 ° */
        const deg = lerp(a[5] === '°' ? 1 : 0, b[5] === '°' ? 1 : 0, clamp(e * 1.4 - .15)); c.globalAlpha = alpha * deg; c.strokeStyle = S.ink; c.lineWidth = h * .06; c.beginPath(); c.arc(x + ww * .45, y + h * .12, h * .08, 0, 7); c.stroke(); c.globalAlpha = alpha; x += ww; continue;
      }
      /* 數位：ghost 用引擎 seg7，亮段逐段以 alpha 切換 */
      const vis = clamp(ww / (h * .66));
      c.save(); c.globalAlpha = alpha * Math.max(vis, .0); seg7(c, ' ', x, y, h, S.ink, S.lcdGhost, 0); c.restore();
      const sa = SEG[a[i]] || '', sb = SEG[b[i]] || '';
      KEYS.split('').forEach((k, si) => {
        const oa = sa.includes(k) ? 1 : 0, ob = sb.includes(k) ? 1 : 0; if (!oa && !ob) return;
        const loc = clamp((e - (i * .05 + si * .06)) / .26), al = oa === ob ? 1 : lerp(oa, ob, E.ioS(loc));
        if (al < .02) return;
        c.globalAlpha = alpha * al * vis; c.fillStyle = S.ink; c.beginPath();
        POLY[k].forEach(([px, py], j) => { const X = x + px * sc + (100 - py) * sc * .1, Y = y + py * sc; j ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); c.fill();
        /* 正在切換的線段帶一點站色高光 */
        if (oa !== ob && loc > 0 && loc < 1) { c.save(); c.globalCompositeOperation = 'source-over'; c.shadowColor = col; c.shadowBlur = 14; c.globalAlpha = alpha * (1 - Math.abs(loc - .5) * 2) * .8 * vis; c.fillStyle = col; c.fill(); c.restore(); }
      });
      c.globalAlpha = alpha; x += ww;
    }
    c.restore();
    return ph;
  }

  function landing(j, ctx) {
    const Lg = LAND[j], L = ctx.L;
    if (Lg.lcd) { const r = RG.today.lcd, sc = L.lcd.vw / 696; return { x: L.lcd.cx + (Lg.ix - 390) * sc, y: L.lcd.cy + (Lg.iy - (r[1] + r[3] / 2)) * sc, h: Lg.h * sc }; }
    const B = L[Lg.pose], sc = B.vw / 780, v = Lg.pose === 'restW' ? IH / 2 : ctx.TL.st[j].steps[0].v; return { x: B.cx + (Lg.ix - 390) * sc, y: B.cy + (Lg.iy - v) * sc, h: Lg.h * sc };
  }

  /* 行駛中壓暗世界（含光點拖尾），只留數字一個焦點 */
  mine.hooks.hop = function (c, t, hp, ctx) {
    const a = .5 * seg(hp.p, 0, .1) * (1 - seg(hp.p, .9, 1));
    c.fillStyle = `rgba(4,5,10,${a})`; c.fillRect(0, 0, ctx.W, ctx.H);
  };

  mine.hooks.overlay = function (c, t, ctx) {
    c.globalAlpha = 1; const TL = ctx.TL, W = ctx.W, Hh = ctx.H, S = ctx.cfg.style;
    /* 結尾字卡：音樂致謝（與「Weather data by Open-Meteo」同樣式、同時淡入，置於其正下方 26 px） */
    if (t >= TL.urlE) {
      const Lo = ctx.L.out, wa = E.outC(seg(t, TL.urlE, TL.urlE + .25));
      ntext(c, 'Music: "A Pretty Good Day" \u2013 One More Lawn (Superdou)', Lo.x + (Lo.align === 'left' ? 2 : 0), Lo.credit + 26, 18, '#9FB8D8', { a: wa * .85, align: Lo.align, mono: 1, w: 400, glow: .15 });
    }
    for (let j = 1; j <= 6; j++) {
      const t0 = TL.st[j - 1].dep, arr = TL.st[j].arr, hd = arr - t0; if (t < t0 || t > arr + .4) continue;
      const hp = HOPS[j], tg = landing(j, ctx), p = (t - t0) / hd;
      const e = E.ioS(seg(p, .03, .58)), f = E.ioC(seg(p, .52, 1)), H0 = 150;
      const x = lerp(W / 2, tg.x, f), y = lerp(Hh / 2 - 96, tg.y, f), h = lerp(H0, Math.max(tg.h, 10), E.outC(f));
      let alpha = E.outC(seg(p, 0, .1)); if (t > arr) alpha *= 1 - seg(t, arr + .05, arr + .4);
      if (alpha <= .01) continue;
      const ph = readout(c, x, y, h, hp.a, hp.b, e, alpha, hp.col, S);
      /* 目的地標籤（飛行時淡出） */
      const la = E.outC(seg(p, .08, .25)) * (1 - seg(p, .5, .7)); if (la > .01) ntext(c, '→ ' + hp.lab, x, y + ph / 2 + 30, 28, hp.col, { a: la, glow: .9 });
      /* 光點落點的小光環 */
      const rp = seg(t, arr, arr + .4); if (rp > 0 && rp < 1) { c.save(); c.globalAlpha = (1 - rp) * .8; c.strokeStyle = hp.col; c.lineWidth = 3; c.shadowColor = hp.col; c.shadowBlur = 12; c.beginPath(); c.arc(tg.x, tg.y, 20 + 60 * E.outX(rp), 0, 7); c.stroke(); c.restore(); }
    }
  };

  const V = {
    id: '06',
    name: '數字母題',
    summary: '以 LCD 七段數字當轉場載體：每段行駛中，一組大型七段讀數隨光點前進並「逐段」變形（--→23°→18:00→14:00→−5°→4/5→20:30），行駛尾聲縮小飛入下一張卡片的關鍵數值，再由卡片接手。行駛時世界與光點拖尾被壓暗，畫面只剩數字一個焦點。',
    diffs: [
      '新增 hop 轉場載體：LCD 底板 + 七段讀數，以引擎 seg7 畫 ghost 底、逐段 alpha 切換亮段（每段錯開 0.06 單位、每格錯開 0.05），切換中的線段帶站色高光',
      '數值串：--→23°（今天）→18:00（通勤）→14:00（運動）→−5°（出遊）→4/5（地點）→20:30（LIGHT），冒號、斜線、度符號也跟著淡入淡出，版面隨之置中',
      '行駛後段讀數縮小並飛到下一張卡片的實際數值位置（今天 LCD、18:00、14:00、−5°、4 / 5、20:30），落下時有一圈光環並在 0.4 秒內交棒給卡片',
      '行駛期間（hop hook）整個世界壓暗 50%，光點拖尾退到背景，只留一個焦點；時序、停留、鏡頭速度與基準版相同',
    ],
  };
  Object.defineProperty(V, 'config', { enumerable: true, get() { const b = (PromoVariants.find(v => v.id === '01') || {}).config || {}; return H.merge(b, mine); } });
  PromoVariants.push(V);
})();
