#!/usr/bin/env python3
"""Suggest the best start times for a music segment of a given length (e.g. the 31.9 s film).

    python3 pick-segment.py music.mp3 31.9 [--top 3] [--step 0.25] [--fade 2.5] [--json]

How it works (ffmpeg decodes to mono 22.05 kHz PCM; numpy is used if available, otherwise a pure-python RMS-only path):
  * short-time energy (dB) and an onset envelope (spectral flux with numpy, positive energy difference without)
  * a tempo estimate (autocorrelation of the onset envelope, 70-170 BPM) -> beat grid anchored on the strongest onsets
  * every candidate start (every --step seconds) is scored on
      - START  : a low-energy point just before the start followed by a rise (phrase boundary / section entry), a real onset right at
                 the start (we snap the start to it), and closeness to the beat grid (a bar line is better than a random beat)
      - BODY   : the segment should not be a quiet passage (mean energy vs the track)
      - END    : the energy over the last 2 s should be falling (natural decay) or at least low enough to hide a --fade second fade-out
  * the best 3 non-overlapping candidates (>= 8 s apart) are printed with start / end and a one-line reason.
Returns exit code 0 and prints nothing but the suggestions on stdout (diagnostics go to stderr).
"""
import argparse, json, math, subprocess, sys

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

SR = 22050


def decode(path):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True)
    if p.returncode != 0 or not p.stdout:
        sys.exit("ffmpeg could not decode %s: %s" % (path, p.stderr.decode(errors="replace")[:300]))
    return p.stdout


def envelopes(raw):
    """-> (hop seconds, energy dB list, onset list)"""
    HOP = 512
    if np is not None:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        n = (len(x) - 2 * HOP) // HOP
        if n < 8:
            sys.exit("audio too short")
        win = np.hanning(2 * HOP).astype(np.float32)
        frames = np.lib.stride_tricks.as_strided(x, shape=(n, 2 * HOP), strides=(x.strides[0] * HOP, x.strides[0]))
        spec = np.abs(np.fft.rfft(frames * win, axis=1))
        e = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-6)
        mag = np.log1p(30 * spec)
        flux = np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)
        onset = np.concatenate([[0], flux])
        return HOP / SR, e, onset
    import array
    a = array.array("h"); a.frombytes(raw)
    n = (len(a) - 2 * HOP) // HOP
    e = []
    for i in range(n):
        seg = a[i * HOP:i * HOP + 2 * HOP]
        e.append(20 * math.log10(math.sqrt(sum(s * s for s in seg) / len(seg)) / 32768.0 + 1e-6))
    onset = [0] + [max(0.0, e[i] - e[i - 1]) for i in range(1, n)]
    return HOP / SR, e, onset


def smooth(v, k):
    if np is not None:
        return np.convolve(v, np.ones(k) / k, mode="same")
    h = k // 2
    return [sum(v[max(0, i - h):i + h + 1]) / len(v[max(0, i - h):i + h + 1]) for i in range(len(v))]


def tempo(onset, hop):
    if np is None:
        return None
    o = np.asarray(onset) - np.mean(onset)
    ac = np.correlate(o, o, mode="full")[len(o) - 1:]
    lo, hi = int(60 / 170 / hop), int(60 / 70 / hop)
    lag = lo + int(np.argmax(ac[lo:hi]))
    return lag * hop  # seconds per beat


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio"); ap.add_argument("duration", type=float, help="segment length in seconds")
    ap.add_argument("--top", type=int, default=3); ap.add_argument("--step", type=float, default=0.25)
    ap.add_argument("--fade", type=float, default=2.5, help="fade-out length you plan to use (s)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    hop, e, onset = envelopes(decode(a.audio))
    n = len(e); total = n * hop
    L = a.duration
    if total <= L + 0.5:
        print("track is only %.1f s, not longer than the %.1f s segment: use start 0.0 (end %.1f)" % (total, L, min(total, L)))
        return
    es = smooth(e, int(0.25 / hop) | 1)
    fi = lambda t: min(n - 1, max(0, int(t / hop)))
    mean = lambda arr, t0, t1: float(sum(arr[fi(t0):max(fi(t0) + 1, fi(t1))]) / max(1, fi(t1) - fi(t0))) if np is None else float(np.mean(arr[fi(t0):max(fi(t0) + 1, fi(t1))]))
    track_mean = float(sum(es) / n) if np is None else float(np.mean(es))
    beat = tempo(onset, hop)
    on_thr = (sorted(onset)[int(n * 0.9)]) if np is None else float(np.percentile(onset, 90))
    peaks = [i for i in range(2, n - 2) if onset[i] >= on_thr and onset[i] >= onset[i - 1] and onset[i] > onset[i + 1]]
    anchor = None
    if peaks:
        anchor = max(peaks, key=lambda i: onset[i]) * hop

    cands = []
    t = 0.0
    while t + L <= total + 1e-6:
        # snap the start to the nearest strong onset within 0.2 s (cut right on the hit, not just before it)
        near = [p * hop for p in peaks if abs(p * hop - t) <= 0.2]
        s = min(near, key=lambda q: abs(q - t)) if near else t
        s = max(0.0, min(s, total - L))
        pre, post = mean(es, s - 0.5, s - 0.05), mean(es, s + 0.1, s + 2.0)
        before = mean(es, s - 3.0, s - 0.5)
        rise = post - pre                                   # dB step into the segment
        dip = before - pre                                  # low point right before the start
        on_hit = 1.0 if near else 0.0
        grid = 0.0
        if beat and anchor is not None:
            ph = ((s - anchor) / beat) % 4.0                # position inside a 4-beat bar
            d = min(ph, 4.0 - ph)
            grid = max(0.0, 1.0 - d / 0.15) * 1.0 if d < 0.15 else 0.0
        start_sc = 0.55 * min(max(rise, 0), 20) + 0.25 * min(max(dip, 0), 12) + 4 * on_hit + 5 * grid
        body = mean(es, s, s + L)
        body_sc = 0.3 * (body - track_mean)
        end_in, end_prev = mean(es, s + L - 1.5, s + L), mean(es, s + L - 6.0, s + L - 2.0)
        decay = end_prev - end_in                           # falling energy at the end
        fade_ok = end_in - track_mean                       # a loud end needs the fade; quiet ends are free
        end_sc = 0.6 * min(max(decay, -6), 12) - 0.25 * max(0.0, fade_ok) + (2.0 if decay > 3 else 0)
        cands.append((start_sc + body_sc + end_sc, s, dict(rise=rise, dip=dip, on=bool(near), grid=grid > 0, decay=decay, end_db=end_in - track_mean, body=body - track_mean)))
        t += a.step
    cands.sort(key=lambda c: -c[0])
    chosen = []
    for sc, s, d in cands:
        if all(abs(s - c[1]) >= 8.0 for c in chosen):
            chosen.append((sc, s, d))
        if len(chosen) == a.top:
            break

    def reason(d):
        r = []
        r.append("starts on a %.0f dB rise" % d["rise"] if d["rise"] > 3 else "starts without a clear rise")
        if d["dip"] > 3: r.append("after a quiet point")
        if d["on"]: r.append("on an onset")
        if d["grid"]: r.append("on a bar line (~%.0f BPM)" % (60 / beat))
        if d["decay"] > 3: r.append("ends in a natural decay")
        elif d["end_db"] < -3: r.append("ends in a quiet passage")
        else: r.append("ends loud: use the %.1f s fade-out" % a.fade)
        return ", ".join(r)

    out = [dict(rank=i + 1, start=round(s, 2), end=round(s + L, 2), score=round(sc, 2), reason=reason(d)) for i, (sc, s, d) in enumerate(chosen)]
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1)); return
    print("track %.1f s, segment %.1f s%s" % (total, L, (", tempo ~%.0f BPM" % (60 / beat)) if beat else ""))
    for o in out:
        print("#%d  start %7.2f s  end %7.2f s   %s" % (o["rank"], o["start"], o["end"], o["reason"]))
    print("use:  node render.mjs --audio %s --audio-start %.2f --fade-in 1 --fade-out %.1f" % (a.audio, out[0]["start"], a.fade))


if __name__ == "__main__":
    main()
