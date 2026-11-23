import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { siteFiles } from "../../scripts/site-files.mjs";

/** Integrity of the committed promo-video timing data (pure JSON; no ffmpeg / Playwright / music file needed). */
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../promo");
const json = (f) => JSON.parse(readFileSync(path.join(P, f), "utf8"));
const grid = json("reports/beats-B.json");
const events = json("reports/events-beat-B.json");
const FILM = 40.693; // seconds, 18 bars = 72 beats
const beats = grid.beats;

test("promo beat grid: 72-beat film (+3 spare beats), monotone, bar lines every 4th beat", () => {
  assert.ok(beats.length >= 73);
  beats.forEach((b, i) => { assert.equal(b.m, i); assert.equal(b.down, i % 4 === 0); });
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i].film - beats[i - 1].film;
    assert.ok(d > 0.5 && d < 0.6, `beat ${i} interval ${d}`); // ~108 BPM
  }
  assert.equal(beats[0].film, 0);
  assert.ok(Math.abs(beats[72].film - FILM) < 0.001, "film length = beat 72 = 40.693 s");
  assert.ok(Math.abs(grid.S - 86.858) < 0.001, "segment starts at song 86.858 s");
  for (const b of beats) assert.ok(Math.abs(b.song - grid.S - b.film) < 0.0006, "song time = S + film time");
});

test("variants/beatgrid-B.js is the same grid as reports/beats-B.json", () => {
  const src = readFileSync(path.join(P, "variants/beatgrid-B.js"), "utf8");
  const g = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
  assert.equal(g.film.length, beats.length);
  assert.ok(Math.abs(g.S - grid.S) < 0.0001);
  g.film.forEach((t, i) => assert.ok(Math.abs(t - beats[i].film) < 0.00006, `beat ${i}`));
});

test("promo events land on the beat grid within 1 ms as recorded", () => {
  assert.ok(events.length >= 60);
  const g = { beat: 1, "8th": 2, "16th": 4 };
  for (const e of events) {
    assert.ok(Math.abs(e.err_ms) <= 1, `${e.name}: ${e.err_ms} ms`);
    assert.ok(e.t >= 0 && e.t <= FILM + 0.001, e.name);
    assert.ok(e.grid in g, e.name);
    if (e.grid === "beat") { // recorded beat index must match the grid time
      assert.ok(Math.abs(beats[e.beatIdx].film - e.t) <= 0.001, `${e.name}: beat ${e.beatIdx}`);
      assert.equal(e.down, e.beatIdx % 4 === 0, e.name);
    }
  }
  const end = events.find((e) => e.name === "end of film");
  assert.ok(Math.abs(end.t - FILM) < 0.001);
  // the headline events sit on bar lines
  for (const n of ["pulse departs", "通勤: TAP", "運動: TAP", "出遊: TAP", "地點: TAP", "LIGHT: TAP", "arc reveal (fan)", "fold", "title typing start"]) {
    assert.equal(events.find((e) => e.name === n)?.down, true, n);
  }
});

test("promo is never part of the deployed site", () => {
  assert.ok(!siteFiles().some((f) => f.startsWith("promo/")));
});
