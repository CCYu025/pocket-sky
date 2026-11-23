#!/usr/bin/env node
/**
 * Deterministic film renderer for the Pocket Sky promo (variant 06 "數字母題").
 *
 *   node promo/render.mjs [--out promo/out/pocket-sky-promo-1080p60.mp4] [--width 1920] [--height 1080] [--fps 60]
 *                   [--from 0] [--to <film end>] [--crf 16] [--preset medium] [--variant 06]
 *                   [--audio promo/audio/song.m4a [--audio-start 86.8582] [--fade-in 1] [--fade-out 1] [--lufs -14] [--tp -1.5]]
 *                   [--no-audio]                        (silent film; default is to add the music when the audio file exists)
 *                   [--remux <video.mp4> --out <new.mp4>]  (keep the video stream as is (-c:v copy), only replace the audio track)
 *                   [--still 12.5 --out frame.png]      (single PNG of one instant)
 *                   [--info]                            (print duration / beats / fonts and exit)
 *
 * How: Chromium (Playwright) loads render.html (engine + variant + shots), the page exposes drawAt(t) which seeks the
 * pure render(ctx, t) on a canvas of the output size; every frame is PNG-encoded and piped straight into ffmpeg
 * (image2pipe, no frame files on disk) -> H.264 (-crf 16, yuv420p, +faststart). The film is laid out on a fixed 960x540
 * logical stage and scaled to --width/--height (other aspect ratios are letterboxed).
 * Fonts: the real Google fonts (Noto Sans TC 500/900 + Share Tech Mono) are loaded from fonts.googleapis.com; if they cannot be
 * loaded the script prints "FALLBACK FONTS" (CJK text would then be tofu: no CJK system font is installed here) and exits
 * non-zero unless --allow-fallback is given.
 * Audio (audio/master.mjs): trimmed to the film length from --audio-start (default: the song time of beat 0 in variants/beatgrid-B.js,
 * 86.858 s), two-pass linear loudnorm to --lufs (default -14 LUFS), fade in/out, a limiter, AAC 192k; the encoded result is re-measured
 * (ebur128 true peak) and re-encoded with more headroom until it is <= --tp (default -1.5 dBTP). Film length always wins (no -shortest).
 */
import { createRequire } from "node:module";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { masterAudio, measure } from "./audio/master.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (k) => argv.includes("--" + k);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const num = (k, d) => (arg(k) == null ? d : Number(arg(k)));

const width = num("width", 1920), height = num("height", 1080), fps = num("fps", 60), crf = num("crf", 16);
const out = path.resolve(arg("out", path.join(HERE, "out", `pocket-sky-promo-${height}p${fps}.mp4`)));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
/* beat 0 of the film = this song time (written by audio/finalize.py as BeatGrid.S) */
const gridS = Number(/"S":\s*([\d.]+)/.exec(readFileSync(path.join(HERE, "variants/beatgrid-B.js"), "utf8"))?.[1] ?? 0);
const audioFile = path.resolve(arg("audio", path.join(HERE, "audio", "song.m4a")));
const audio = has("no-audio") ? null : (existsSync(audioFile) ? audioFile : (arg("audio") ? (console.error(`audio file not found: ${audioFile}`), process.exit(1)) : null));
const audioStart = num("audio-start", gridS), fadeIn = num("fade-in", 1), fadeOut = num("fade-out", 1), lufs = num("lufs", -14), tp = num("tp", -1.5);
const variant = arg("variant", "06");

/* ---------------------------------------------------------------- static server for render.html (needed: canvas + images over http) */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png" };
async function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "render.html";
      const file = path.join(HERE, rel);
      if (!file.startsWith(HERE + path.sep)) throw new Error("outside");
      await stat(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end("nf"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/render.html`, close: () => new Promise((r) => server.close(r)) };
}

/* ---------------------------------------------------------------- audio (true-peak-safe master, see audio/master.mjs) */
function masterFor(len, from, filmDur) {
  const tmp = out.replace(/\.[^.]+$/, "") + ".audio.m4a";
  const r = masterAudio({ audio, start: audioStart + from, len, out: tmp, filmFrom: from, filmDur, lufs, ceiling: tp, fadeIn, fadeOut });
  console.log(`audio master: ${r.I} LUFS / ${r.tp} dBTP`);
  return tmp;
}

/* ---------------------------------------------------------------- main */
if (has("remux")) {
  /* keep the video stream, replace the audio: no frames are rendered, no browser is started */
  const src = path.resolve(arg("remux"));
  const probe = spawnSync(FFMPEG.replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", src], { encoding: "utf8" });
  const dur = num("duration", Number(probe.stdout.trim())); /* default: the video's own length */
  if (!audio) { console.error("--remux needs the music (--audio <file>)"); process.exit(1); }
  await mkdir(path.dirname(out), { recursive: true });
  const m4a = masterFor(dur, 0, dur);
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-i", m4a, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", out], { stdio: "inherit" });
  rmSync(m4a, { force: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
  const f = measure(out);
  console.log(`remuxed ${out}: ${f.I} LUFS / ${f.tp} dBTP`);
  process.exit(0);
}
const { chromium } = require("playwright");
const srv = await serve();
const browser = await chromium.launch({ args: ["--no-sandbox", "--force-color-profile=srgb"] });
try {
  const page = await browser.newPage({ viewport: { width: Math.min(width, 1920), height: Math.min(height, 1080) }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  await page.goto(srv.url);
  const info = await page.evaluate((o) => window.setup(o), { width, height, variant });
  console.log(`film ${info.duration.toFixed(3)} s, fonts: ${info.fonts}`);
  if (info.fonts !== "google-fonts") {
    console.error("FALLBACK FONTS: Google fonts could not be loaded; CJK text will not render correctly.");
    if (!has("allow-fallback")) process.exit(2);
  }
  if (has("info")) { console.log(JSON.stringify(info.beats)); process.exit(0); }
  await mkdir(path.dirname(out), { recursive: true });

  if (has("still")) {
    const t = num("still", 0);
    await page.evaluate((t) => window.drawAt(t), t);
    const url = await page.evaluate(() => window.frameDataURL());
    await writeFile(out.endsWith(".png") ? out : out + ".png", Buffer.from(url.split(",")[1], "base64"));
    console.log("wrote still", out, "t =", t);
  } else {
    const from = num("from", 0), to = Math.min(num("to", info.duration), info.duration), len = to - from;
    const N = Math.round(len * fps);
    const ff = ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-"];
    let a = null;
    if (audio) { a = masterFor(len, from, info.duration); ff.push("-i", a); }
    ff.push("-map", "0:v");
    if (a) ff.push("-map", "1:a", "-c:a", "copy");
    ff.push("-c:v", "libx264", "-preset", arg("preset", "medium"), "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", "-t", len.toFixed(4), out);
    const proc = spawn(FFMPEG, ff, { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((res, rej) => { proc.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exit " + c)))); proc.stdin.on("error", () => {}); });
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const t = from + i / fps;
      const url = await page.evaluate((t) => { window.drawAt(t); return window.frameDataURL(); }, t);
      const buf = Buffer.from(url.slice(22), "base64");
      if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once("drain", r));
      if (i % Math.max(1, Math.round(fps * 2)) === 0) process.stdout.write(`\r  frame ${i + 1}/${N}  t=${t.toFixed(2)}s  ${((Date.now() - t0) / 1000).toFixed(0)}s elapsed   `);
    }
    proc.stdin.end();
    await done;
    if (a) rmSync(a, { force: true });
    console.log(`\nwrote ${out}  (${N} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
} finally {
  await browser.close();
  await srv.close();
}
