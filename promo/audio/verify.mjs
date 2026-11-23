// usage: node audio/verify.mjs [--sheet out/contact-beat-B.png] [--json out/events-beat-B.json]
import { createRequire } from "node:module"; import http from "node:http"; import { readFile, writeFile, mkdir } from "node:fs/promises"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { spawnSync } from "node:child_process"; import crypto from "node:crypto";
const require = createRequire(import.meta.url); const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
const server = http.createServer(async (q, r) => { try { const f = path.join(HERE, decodeURIComponent(new URL(q.url, "http://x").pathname).slice(1) || "render.html"); r.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); r.end(await readFile(f)); } catch { r.writeHead(404); r.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const { chromium } = require("playwright"); const br = await chromium.launch({ args: ["--no-sandbox", "--force-color-profile=srgb"] });
const page = await br.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`http://127.0.0.1:${server.address().port}/render.html`);
const info = await page.evaluate(() => window.setup({ width: 960, height: 540, variant: "06" }));
const D = await page.evaluate(() => ({ tl: window.__eng.timeline, beats: window.BeatGrid.film, cfg: window.__eng.config }));
const TLn = D.tl, B = D.beats, cfg = D.cfg, F = 1 / 60;
const grid = (sub) => { const g = []; for (let i = 0; i < B.length - 1; i++) for (let k = 0; k < sub; k++) g.push([B[i] + (B[i + 1] - B[i]) * k / sub, i * sub + k]); return g; };
const G1 = grid(1), G2 = grid(2), G4 = grid(4);
const near = (t, g) => g.reduce((b, x) => Math.abs(x[0] - t) < Math.abs(b[0] - t) ? x : b);
const rows = [];
function ev(name, t, kind = "beat") { const g = kind === "16th" ? G4 : kind === "8th" ? G2 : G1, n = near(t, g), per = kind === "16th" ? 4 : kind === "8th" ? 2 : 1; const bi = n[1] / per; const down = Number.isInteger(bi) && bi % 4 === 0; const fq = Math.round(t * 60) / 60; rows.push({ name, t, grid: kind, nearest: n[0], beatIdx: bi, err_ms: (t - n[0]) * 1000, down, frame_err_ms: (fq - n[0]) * 1000 }); }
ev("sign on", 0); ev("benefit line", cfg.open.benefitAt); ev("pulse departs", TLn.open.dep); ev("LCD arrive", TLn.today.arr);
cfg.today.countSteps.forEach((s, k) => ev(`LCD count step ${k + 1} (=${s.n})`, s.t, "8th"));
ev("LCD hold end / morph start", TLn.today.closeE); ev("Today copy line", D.tl.today.copyS); ev("Today morph end", TLn.today.morphE); ev("Today deal start", TLn.today.dealS); ev("Today deal end = hop start", TLn.today.dep);
TLn.stations.forEach(s => { ev(`${s.label}: hop start`, s.hopS); ev(`${s.label}: arrival`, s.arrive); ev(`${s.label}: caption in`, s.arrive + cfg.caption.in); ev(`${s.label}: TAP`, s.steps[0].tap); ev(`${s.label}: result line`, s.steps[0].tap + cfg.caption.res); if (s.id !== "light") { ev(`${s.label}: deal start`, s.holdE); ev(`${s.label}: deal end`, s.dealE); } });
ev("arc reveal (fan)", TLn.fanS); ev("fold", TLn.foldS); ev("park slide start", TLn.foldS + cfg.timeline.finale.parkAt); ev("title typing start", TLn.titleS); ev("tagline", TLn.titleS + cfg.timeline.finale.tagAt); ev("URL box sweep", TLn.titleS + cfg.timeline.finale.urlAt, "8th");
cfg.outro.urlSteps.forEach((t, k) => ev(`URL chars step ${k + 1}`, t, "16th")); ev("credit line", TLn.titleS + cfg.timeline.finale.urlDone); ev("end of film", TLn.duration);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("event", 34) + pad("film s", 9) + pad("grid", 6) + pad("nearest", 9) + pad("beat#", 7) + pad("err ms", 8) + pad("downbeat", 9) + "60fps-frame err");
rows.forEach(r => console.log(pad(r.name, 34) + pad(r.t.toFixed(3), 9) + pad(r.grid, 6) + pad(r.nearest.toFixed(3), 9) + pad(r.beatIdx, 7) + pad(r.err_ms.toFixed(1), 8) + pad(r.down ? "YES" : "no", 9) + r.frame_err_ms.toFixed(1)));
await writeFile(path.join(HERE, arg("json", "out/events-beat-B.json")), JSON.stringify(rows, null, 1));
// constraints
console.log("\nfilm duration", TLn.duration.toFixed(4), "s =", (TLn.duration / (B[4] - B[0]) * 1).toFixed(2), "bars of the first bar length; bars by beats:", B.findIndex(b => Math.abs(b - TLn.duration) < 1e-6) / 4);
TLn.stations.forEach(s => console.log(`${pad(s.label, 6)} hold(arr->holdE) ${(s.holdE - s.arrive).toFixed(3)} s  (>=2.8: ${s.holdE - s.arrive >= 2.8 ? "ok" : "FAIL"})  tap-after-arrival ${(s.steps[0].tap - s.arrive).toFixed(3)}  hop ${(s.arrive - s.hopS).toFixed(3)}  period ${(s.dep - s.hopS).toFixed(3)} s = ${((s.dep - s.hopS) / ((B[16 + 8] - B[16]) / 8)).toFixed(2)} beats`));
const sp = await page.evaluate((dur) => { let mx = 0, at = 0, holdMax = 0; const e = window.__eng, tl = e.timeline; for (let t = 0; t <= dur; t += 1 / 120) { const v = e.cameraSpeed(t); if (v > mx) { mx = v; at = t; } } tl.stations.forEach(s => { for (let t = s.arrive + .3; t < s.holdE; t += 1 / 60) holdMax = Math.max(holdMax, e.cameraSpeed(t)); }); return { mx, at, holdMax }; }, TLn.duration);
console.log(`camera speed max ${sp.mx.toFixed(1)} px/s at t=${sp.at.toFixed(2)} (limit 700); max during station holds ${sp.holdMax.toFixed(2)} px/s`);
// determinism: render a set of times in two different orders, compare hashes
const ts = [0.5, 4.526, 5.4, 9.1, 11.308, 13.9, 22.615, 29.397, 31.7, 33.9, 36.5, 40.0];
const hash = async (t) => crypto.createHash("md5").update(await page.evaluate((t) => { window.drawAt(t); return window.frameDataURL(); }, t)).digest("hex");
const h1 = []; for (const t of ts) h1.push(await hash(t)); const h2 = []; for (const t of [...ts].reverse()) h2.push(await hash(t)); h2.reverse();
console.log("determinism (12 frames, forward vs reverse order):", h1.every((h, i) => h === h2[i]) ? "IDENTICAL" : "MISMATCH");
// contact sheet
const sheet = arg("sheet", "out/contact-beat-B.png"); const tmp = path.join(HERE, "out", "sheet-frames"); await mkdir(tmp, { recursive: true });
const st = TLn.stations, T2 = [0.4, TLn.open.dep + .5, TLn.today.arr + .3, cfg.today.countSteps[3].t + .1, TLn.today.closeE + .5, TLn.today.copyS + .5];
st.forEach(s => { T2.push(s.arrive + .5, s.steps[0].tap + .15, s.steps[0].tap + 1.2); });
T2.push(TLn.fanS + .9, TLn.foldS + .3, TLn.foldS + 1.5, TLn.titleS + .5, TLn.titleS + cfg.timeline.finale.urlDone - .2, TLn.titleS + cfg.timeline.finale.urlDone + 1.5, TLn.duration - .05);
for (let i = 0; i < T2.length; i++) { const u = await page.evaluate((t) => { window.drawAt(t); return window.frameDataURL(); }, T2[i]); await writeFile(path.join(tmp, `f${String(i).padStart(2, "0")}.png`), Buffer.from(u.split(",")[1], "base64")); }
console.log("sheet times:", T2.map(x => x.toFixed(2)).join(" "));
const cols = 6, rowsN = Math.ceil(T2.length / cols);
spawnSync("/usr/bin/ffmpeg", ["-y", "-loglevel", "error", "-framerate", "1", "-i", path.join(tmp, "f%02d.png"), "-vf", `scale=480:270,tile=${cols}x${rowsN}:padding=3:color=0x222222`, "-frames:v", "1", path.join(HERE, sheet)]);
await br.close(); server.close();
