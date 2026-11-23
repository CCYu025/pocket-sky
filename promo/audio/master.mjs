/**
 * Audio mastering for the promo: segment -> two-pass linear loudnorm -> fades -> true-peak-safe limiter -> AAC.
 *
 * Why the loop: loudnorm's TP target is checked on its own float output; AAC encoding then adds inter-sample overshoot
 * (measured +0.2 dB on this film: target -1.5 dBTP came out at -1.3 dBTP). So after encoding we re-measure the *decoded AAC*
 * with ebur128 (true peak) and, if it is above the ceiling, lower the internal ceiling by the overshoot and encode again.
 * The result is guaranteed <= `ceiling` dBTP (default -1.5) and within `tolI` LU of the target loudness, or it throws.
 *
 * Library:  import { masterAudio } from "./audio/master.mjs"
 * CLI:      node promo/audio/master.mjs --audio song.m4a --audio-start 86.858 --len 40.693 --out out/master.m4a
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const run = (args) => spawnSync(FFMPEG, ["-hide_banner", "-nostats", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });

/** @returns {{I:number, tp:number}} integrated loudness (LUFS) and true peak (dBTP) of a file's audio (ebur128 peak=true). */
export function measure(file) {
  const r = run(["-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const s = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(s), P = /Peak:\s+(-?[\d.]+) dBFS/.exec(s);
  if (!I || !P) throw new Error("ebur128 measurement failed:\n" + r.stderr.slice(-400));
  return { I: Number(I[1]), tp: Number(P[1]) };
}

/**
 * @param {object} o
 * @param {string} o.audio source file  @param {number} o.start segment start in the source (s)  @param {number} o.len segment length (s)
 * @param {string} o.out output .m4a  @param {number} [o.filmFrom=0] / [o.filmDur=o.len] position of the segment on the film timeline (fades are film-relative)
 * @param {number} [o.lufs=-14] @param {number} [o.ceiling=-1.5] @param {number} [o.fadeIn=1] @param {number} [o.fadeOut=1] @param {number} [o.tolI=0.3]
 */
export function masterAudio(o) {
  const { audio, start, len, out } = o, lufs = o.lufs ?? -14, ceiling = o.ceiling ?? -1.5, fadeIn = o.fadeIn ?? 1, fadeOut = o.fadeOut ?? 1;
  const from = o.filmFrom ?? 0, filmDur = o.filmDur ?? len, tolI = o.tolI ?? 0.3;
  const seg = ["-ss", String(start), "-t", String(len), "-i", audio];
  const log = (m) => console.log("audio: " + m);

  /* pass 1: measure the (unprocessed) segment against the loudnorm target */
  const first = (tp) => `loudnorm=I=${lufs}:TP=${tp}:LRA=11`;
  const m = run([...seg, "-af", first(ceiling) + ":print_format=json", "-f", "null", "-"]);
  const j = JSON.parse(m.stderr.slice(m.stderr.lastIndexOf("{"), m.stderr.lastIndexOf("}") + 1));
  log(`input ${j.input_i} LUFS / ${j.input_tp} dBTP -> target ${lufs} LUFS, ceiling ${ceiling} dBTP`);

  let tpTarget = Math.min(ceiling, -1.5) - 0.2; /* first guess: leave room for the AAC overshoot */
  for (let attempt = 1; attempt <= 5; attempt++) {
    /* pass 2: linear gain (+ true-peak-aware limiting inside loudnorm), fades on the film timeline, sample-peak safety limiter */
    const f = [`${first(tpTarget.toFixed(2))}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`, "apad=whole_dur=" + len];
    if (fadeIn > 0 && from < fadeIn) f.push(`afade=t=in:st=0:d=${(fadeIn - from).toFixed(3)}`);
    if (fadeOut > 0 && from + len > filmDur - fadeOut) { const st = Math.max(0, filmDur - fadeOut - from); f.push(`afade=t=out:st=${st.toFixed(3)}:d=${Math.min(fadeOut, len - st).toFixed(3)}`); }
    f.push(`alimiter=limit=${(10 ** ((tpTarget - 0.1) / 20)).toFixed(4)}:attack=2:release=50:level=false`);
    const r = run(["-y", ...seg, "-af", f.join(","), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out]);
    if (r.status !== 0) throw new Error("ffmpeg audio encode failed:\n" + r.stderr.slice(-500));
    const got = measure(out);
    log(`attempt ${attempt}: internal TP ${tpTarget.toFixed(2)} -> encoded ${got.I} LUFS / ${got.tp} dBTP`);
    if (got.tp <= ceiling && Math.abs(got.I - lufs) <= tolI) return { ...got, chain: f.join(","), file: out };
    if (got.tp > ceiling) tpTarget -= got.tp - ceiling + 0.1;
    else throw new Error(`loudness ${got.I} LUFS is more than ${tolI} LU from ${lufs}`);
  }
  throw new Error(`could not bring the true peak under ${ceiling} dBTP`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
  const audio = arg("audio");
  if (!audio) { console.error("usage: master.mjs --audio <file> --audio-start <s> --len <s> --out <file.m4a> [--lufs -14] [--ceiling -1.5] [--fade-in 1] [--fade-out 1]"); process.exit(1); }
  const r = masterAudio({ audio, start: Number(arg("audio-start", 0)), len: Number(arg("len", 40.693)), out: arg("out", "out/master.m4a"), lufs: Number(arg("lufs", -14)), ceiling: Number(arg("ceiling", -1.5)), fadeIn: Number(arg("fade-in", 1)), fadeOut: Number(arg("fade-out", 1)) });
  console.log(`done: ${r.I} LUFS / ${r.tp} dBTP -> ${r.file}`);
}
