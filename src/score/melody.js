// The melody: one bar per hour, its register following the temperature, its rhythm
// the wind, with held notes in steady weather and glides when the temperature moves fast.

import * as M from "../mapping.js";
import { midiToNote } from "../theory.js";
import { clamp } from "../util.js";
import { melodyLift, melodyNotes, restChance, noteGate, melodyVel } from "./traits.js";

/**
 * The melody follows the temperature, one bar per hour, then steady hours tie repeated notes.
 * Returns { melody, held } (held: how many notes were tied).
 */
export function melodyLine(ctx) {
  const { H, A, stats, root, energy, gateFor, busierRow, T, rng, pick, day, stir, lift, evening, chordPcs, octave, pitchAt } = ctx;
  const D = M.DYNAMICS;
  const GL = M.GLIDE;
  const C = M.CALM_DETAIL;
  const R = M.ARC;
  const MEL = M.MELODY;
  const baseIdx = 0;

  const span = Math.max(stats.tMax - stats.tMin, MEL.minSpanC);
  const lo = stats.tMin - (span - (stats.tMax - stats.tMin)) / 2; // centre flat days
  const tempNorm = (t) => clamp((t - lo) / span, 0, 1);
  const tempIdx = (t) => baseIdx + A.registerOffset + Math.round(tempNorm(t) * MEL.spanSteps);

  // Nearest step whose pitch class is in `pcs` (searching 0, -1, +1, -2, +2, ...).
  // The last note: home when the evening settles; otherwise a chord tone that isn't home
  // (on an open ending, home if the chord holds it, so the tune rests while the chord asks).
  const endPcs = (b) => {
    const pcs = chordPcs(b);
    if (evening.kind === "settled") return [root];
    if (evening.kind === "open" && pcs.includes(root)) return [root];
    const away = pcs.filter((pc) => pc !== root && pc !== pcs[0]);
    return away.length ? away : pcs.filter((pc) => pc !== root);
  };
  const snapTo = (idx, pcs, b) => {
    for (let d = 0; d < octave * 2; d++) {
      for (const s of d === 0 ? [0] : [-d, d]) {
        const p = pitchAt(b, idx + s);
        if (p != null && pcs.includes(p % 12)) return idx + s;
      }
    }
    return idx;
  };
  const inRange = (idx, b) => {
    while (pitchAt(b, idx) < MEL.low) idx += octave;
    while (pitchAt(b, idx) > MEL.high) idx -= octave;
    return idx;
  };
  const tonicPcs = [root, (root + 7) % 12];

  const melody = [];
  let prev = null;
  let prevMidi = null;
  const anchors = H.map((h, b) => snapTo(inRange(tempIdx(h.temp) + lift(b) + melodyLift(T, b), b), chordPcs(b), b));

  for (let b = 0; b < M.BARS; b++) {
    const h = H[b];
    const last = b === M.BARS - 1;
    const row = M.DENSITY.findIndex((r) => h.gust < r.maxGust);
    // The release after a peak breathes out: one row sparser, never busier.
    let n = last ? 1
      : M.DENSITY[day.phases[b] === "release" ? Math.max(0, row - 1) : busierRow(M.DENSITY, row, b)].notes;
    if (!last) {
      const outlier = melodyNotes(T, b, n);
      if (outlier != null) n = outlier;
      else if (!day.dramatic) { // a calm day follows its small changes
        if (stir[b] >= C.busier) n = Math.max(n, Math.min(n + 1, C.maxNotes));
        else if (stir[b] <= C.sparser && n > 1) n -= 1;
      }
    }
    const rhythm = last ? [M.STEPS] : pick(M.RHYTHMS[n]);
    const anchor = anchors[b];
    const next = last ? anchor : anchors[b + 1];
    const sectionEnd = M.SECTIONS.some((s) => s.start === b + 1) || last;
    const vel = MEL.velLow + (MEL.velHigh - MEL.velLow) * tempNorm(h.temp) + D.velBoost * energy[b] + C.velBoost * stir[b];

    let pos = 0;
    rhythm.forEach((dur, k) => {
      let idx;
      if (k === 0) {
        idx = last ? snapTo(anchor, endPcs(b), b) : anchor;
        if (!last && sectionEnd && rhythm.length === 1) { // a one-note bar that ends a section still cadences
          const pcs = chordPcs(b).filter((pc) => tonicPcs.includes(pc));
          idx = snapTo(idx, pcs.length ? pcs : chordPcs(b), b);
        }
      } else if (rng() < restChance(T, b, M.REST_PER_CLOUD * (h.cloud / 100)) && !(sectionEnd && k === rhythm.length - 1)) {
        pos += dur;
        return; // rest
      } else {
        const target = anchor + Math.round(((next - anchor) * k) / rhythm.length);
        if (target === prev) {
          idx = rng() < M.NEIGHBOR_CHANCE ? prev + (rng() < 0.5 ? -1 : 1) : prev;
        } else {
          idx = prev + clamp(target - prev, -2, 2);
        }
        idx = inRange(idx, b);
        if (pos === M.STEPS / 2) idx = snapTo(idx, chordPcs(b), b); // the hour's second beat is a chord tone
        if (sectionEnd && k === rhythm.length - 1) {
          const pcs = chordPcs(b).filter((pc) => tonicPcs.includes(pc));
          // Root or fifth if the chord has one, otherwise any chord tone (a half cadence).
          idx = snapTo(idx, pcs.length ? pcs : chordPcs(b), b);
        }
      }
      // No leaps wider than a sixth: move the note an octave toward the last one.
      if (prevMidi != null) {
        while (pitchAt(b, idx) - prevMidi > MEL.maxLeap) idx -= octave;
        while (prevMidi - pitchAt(b, idx) > MEL.maxLeap) idx += octave;
      }
      const midi = pitchAt(b, idx);
      // A fast temperature change slides into the hour's first note (see GLIDE).
      const glide = k === 0 && !last && prevMidi != null && A.voices.melody.glide && Math.abs(midi - prevMidi) >= GL.minSemis
        ? clamp((Math.abs(h.temp - H[b - 1].temp) - GL.fromC) / (GL.fullC - GL.fromC), 0, 1) : 0;
      melody.push({
        ...(glide > 0 ? { from: prevMidi, glide: +Math.min(GL.minSteps + (GL.maxSteps - GL.minSteps) * glide, dur * 0.6).toFixed(2) } : {}),
        bar: b, pos, dur, midi, note: midiToNote(midi), gate: last ? 0.95 : Math.min(0.98, noteGate(T, b, gateFor(h) + (day.phases[b] === "release" ? R.releaseGate : 0))),
        vel: +melodyVel(T, b, Math.min(0.95, vel + (k === 0 ? MEL.accent : 0))).toFixed(3),
      });
      prev = idx;
      prevMidi = midi;
      pos += dur;
    });
  }

  const HD = M.HOLD;
  const steadyHour = (b) => {
    if (b === 0) return false;
    const a = H[b - 1], h = H[b];
    return Math.abs(h.gust - a.gust) < HD.gustKmh
      && Math.abs(h.cloud - a.cloud) < HD.cloud && Math.abs(h.pop - a.pop) < HD.pop
      && Math.abs(h.precip - a.precip) < HD.precipMm;
  };
  const sectionStart = (b) => M.SECTIONS.some((s) => s.start === b);
  const steady = H.map((_, b) => steadyHour(b));
  let held = 0;
  for (let i = 1; i < melody.length; i++) {
    const p = melody[i - 1], n = melody[i];
    const touching = p.bar * M.STEPS + p.pos + p.dur === n.bar * M.STEPS + n.pos;
    // Inside an hour the hour must be steady; across hours the new hour must be steady and not open a section.
    if (p.midi !== n.midi || !touching || !steady[n.bar] || (p.bar !== n.bar && sectionStart(n.bar))) continue;
    if (p.dur + n.dur > HD.maxSteps || n.bar === M.BARS - 1) continue;
    p.dur += n.dur;
    p.gate = Math.max(p.gate, n.gate);
    melody.splice(i--, 1);
    held++;
  }
  return { melody, held };
}
