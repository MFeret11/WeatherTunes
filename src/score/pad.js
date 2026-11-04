// The pad (one voice-led chord per chord change) and the daylight arpeggio.

import * as M from "../mapping.js";
import { MODES, midiToNote } from "../theory.js";
import { clamp, mean, mulberry32 } from "../util.js";
import { arpRun, voiceChord } from "./harmony.js";
import { padVel, arpAmount } from "./traits.js";

/**
 * The pad: one voice-led chord per chord change, with its colour notes.
 */
export function padChords(ctx) {
  const { H, energy, T, modeAt, chordDeg, rootAt, colourAt, chordPcs } = ctx;
  const D = M.DYNAMICS;
  // Voice-led: each note moves as little as it can from the last chord.
  // Colour notes (7th, 9th) sit just above the chord, as loud as the weather makes them.
  const pad = [];
  const K = M.CHORD_COLOUR;
  let prevVoicing = null;
  for (let b = 0; b < M.BARS; b += M.BARS_PER_CHORD) {
    const cloud = mean(H.slice(b, b + M.BARS_PER_CHORD).map((h) => h.cloud)) / 100;
    const col = colourAt(b);
    const midis = voiceChord(chordPcs(b), prevVoicing, col.open);
    prevVoicing = midis;
    const vel = +padVel(T, b, Math.min(0.95, M.PAD.velMin + M.PAD.velPerCloud * cloud
      + D.velBoost * Math.max(energy[b], energy[b + 1] ?? 0))).toFixed(3);
    const top = Math.max(...midis);
    const above = (pc) => top + 1 + ((((pc - top - 1) % 12) + 12) % 12); // the first pc above the chord
    const colour = [];
    const deg = chordDeg(b);
    for (const [kind, k, amount] of [["7th", 6, col.seventh], ["9th", 1, col.ninth]]) {
      if (amount < K.min) continue;
      const midi = above((rootAt(b) + MODES[modeAt(b)][(deg + k) % 7]) % 12);
      colour.push({ kind, midi, note: midiToNote(midi), vel: +(vel * K.vel * amount).toFixed(3) });
    }
    pad.push({ bar: b, pos: 0, dur: M.STEPS * M.BARS_PER_CHORD, midis, notes: midis.map(midiToNote), vel, colour });
  }
  return pad;
}

/**
 * The arpeggio: clear daylight runs up and down the chord (see ARP).
 */
export function arpeggio(ctx) {
  const { H, A, stats, T, seed, day, modeAt, chordDeg, rootAt, colourAt, chordPcs } = ctx;
  const K = M.CHORD_COLOUR;
  const AR = M.ARP;
  const arp = [];
  // The day's shape (pressure trend + seed), reach (temperature swing) and lilt (dew point).
  const arng = mulberry32((seed ^ 0xa7b) >>> 0);
  const shapes = AR.shape[A.trend];
  const shape = shapes[Math.floor(arng() * shapes.length)];
  const reach = Math.round(AR.reach.notes[0] + (AR.reach.notes[1] - AR.reach.notes[0])
    * clamp((stats.tMax - stats.tMin - AR.reach.fromC) / (AR.reach.fullC - AR.reach.fromC), 0, 1));
  const lilt = mean(H.map((h) => h.dew ?? -99)) >= AR.lilt.dew;
  let step = 0;
  for (let b = 0; b < M.BARS - 1; b++) {
    const h = H[b];
    const amount = arpAmount(T, b, clamp(((1 - h.cloud / 100) * (h.isDay ? 1 : 0) - AR.from) / (AR.full - AR.from), 0, 1));
    if (b % M.BARS_PER_CHORD === 0) step = 0; // each chord starts its run from the bottom (or top)
    if (amount <= 0 || h.precip >= 0.1 || M.SNOW_CODES.includes(h.code)) continue;
    if (day.stormy && (day.phases[b] === "build" || day.phases[b] === "peak")) continue;
    const pcs = chordPcs(b).slice();
    if (colourAt(b).seventh >= K.min) pcs.push((rootAt(b) + MODES[modeAt(b)][(chordDeg(b) + 6) % 7]) % 12);
    const lowest = AR.low + ((((pcs[0] - AR.low) % 12) + 12) % 12); // start on the chord's root
    const ladder = [];
    for (let m = lowest; m <= AR.high && ladder.length < reach; m++) if (pcs.includes(m % 12)) ladder.push(m);
    const run = arpRun(ladder, shape);
    const every = AR.rate.find((r) => h.wind < r.maxWind).every;
    const steps = lilt ? AR.lilt.steps : Array.from({ length: Math.ceil(M.STEPS / every) }, (_, i) => i * every);
    for (const [i, pos] of steps.entries()) {
      const dur = (steps[i + 1] ?? M.STEPS) - pos;
      const midi = run[step++ % run.length];
      arp.push({ bar: b, pos, dur, midi, note: midiToNote(midi),
        vel: +(AR.vel * amount + (pos % 4 === 0 ? AR.accent * amount : 0)).toFixed(3) });
    }
  }
  return arp;
}
