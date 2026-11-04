// Harmony: twists outside the mode, the pedal bass, chord colour and voicing,
// the evening ending, and arpeggio shapes.

import * as M from "../mapping.js";
import { MODES, stepAbove } from "../theory.js";
import { clamp, mean, mulberry32 } from "../util.js";

/**
 * Twists (see TWISTS): swap a few chords in `bars` (from storyChords) for chords
 * outside the mode, in place. A twisted bar gets { mode, deg, shift, twist }, where
 * shift moves the chord's tonic in semitones. Returns [{ chord, bar, kind, why }].
 */
export function twistChords(H, A, arc, bars, { day, deep, front, seed }) {
  const TW = M.TWISTS;
  const BPC = M.BARS_PER_CHORD;
  const n = M.BARS / BPC;
  const rng = mulberry32((seed ^ 0x7157) >>> 0); // its own stream, so the other parts stay as they were
  const starts = new Set(arc.chapters.map((c) => c.chord));
  const sectionEnds = new Set(M.SECTIONS.map((x) => x.start / BPC - 1));
  const used = { borrow: 0, mediant: 0, dominant: 0 };
  const out = [];
  const cloudOf = (c) => mean(H.slice(c * BPC, (c + 1) * BPC).map((h) => h.cloud));
  const pcOf = (bar) => (A.root + (bar.shift ?? 0) + MODES[bar.mode][bar.deg]) % 12;
  for (let c = 1; c < n - 2 && out.length < TW.maxPerDay; c++) {
    const b = c * BPC;
    const hrs = H.slice(b, b + BPC);
    if (starts.has(c) || starts.has(c + 1) || sectionEnds.has(c)) continue;
    if (out.some((t) => c - t.chord <= 1)) continue;
    if (front != null && b + BPC > front) continue;
    if (hrs.some((_, i) => day.stormy && (day.phases[b + i] === "build" || day.phases[b + i] === "peak"))) continue;
    if (mean(deep.slice(b, b + BPC)) >= M.DEEP_COLD.hollowFrom) continue;
    const { mode } = bars[b];
    let tw = null;
    const gust = hrs.some((h, i) => h.gust - H[b + i - 1].gust >= TW.mediant.gustJump);
    const sun = A.harsh < TW.mediant.sunMaxHarsh && hrs.some((h, i) => h.isDay && H[b + i - 1].cloud - h.cloud >= TW.mediant.clearDrop);
    if (used.mediant < TW.mediant.max && (sun || gust)) {
      const shift = sun ? 4 : MODES[mode][5] === 8 ? 1 : 8;
      tw = { kind: "mediant", why: sun ? "sun" : "gust", mode: "ionian", deg: 0, shift };
    }
    const next = bars[b + BPC];
    const rise = (H[b + BPC]?.pressure ?? hrs[BPC - 1].pressure) - hrs[0].pressure;
    if (!tw && used.dominant < TW.dominant.max && rise >= TW.dominant.riseHpa
      && (MODES[next.mode][(next.deg + 4) % 7] - MODES[next.mode][next.deg] + 12) % 12 === 7) {
      const dom = (pcOf(next) + 7) % 12;
      const diatonic = [0, 1, 2, 3, 4, 5, 6].some((d) => (A.root + MODES[mode][d]) % 12 === dom
        && (MODES[mode][(d + 2) % 7] - MODES[mode][d] + 12) % 12 === 4);
      if (!diatonic) tw = { kind: "dominant", why: "pressure", mode: "mixolydian", deg: 0, shift: (dom - A.root + 12) % 12 };
    }
    if (!tw && used.borrow < TW.borrow.max && TW.borrow.brightModes.includes(mode)) {
      const around = (cloudOf(c - 1) + cloudOf(c + 1)) / 2;
      const passing = hrs.some((h) => h.cloud - around >= TW.borrow.cloudJump);
      const shower = hrs.some((h) => h.precip > 0 && h.precip < TW.borrow.showerMm);
      if (passing || shower) {
        const deg = TW.borrow.degs[Math.floor(rng() * TW.borrow.degs.length)];
        tw = { kind: "borrow", why: shower ? "shower" : "cloud", mode: "aeolian", deg, shift: 0 };
      }
    }
    if (!tw) continue;
    used[tw.kind]++;
    for (let k = b; k < b + BPC; k++) bars[k] = { mode: tw.mode, deg: tw.deg, shift: tw.shift, twist: tw.kind };
    out.push({ chord: c, bar: b, kind: tw.kind, why: tw.why });
  }
  return out;
}

/** One cycle of an arpeggio over `ladder` (chord tones, low to high), by shape (see ARP). */
export function arpRun(ladder, shape) {
  const L = ladder, n = L.length;
  if (n < 3) return L.slice();
  switch (shape) {
    case "down": return L.slice().reverse();
    case "updown": return L.concat(L.slice(1, -1).reverse());
    case "climb": return L.slice(0, -2).flatMap((m, i) => [m, L[i + 2]]); // leapfrog up: 1-3, 2-4, 3-5…
    case "fall": return arpRun(L.slice().reverse(), "climb");
    case "rock": return L.slice(1).flatMap((m) => [L[0], m]); // low note under each upper one (Alberti)
    default: return L.slice();
  }
}

/** Pedal bars (see PEDAL): true where the bass holds the home note under the chord. */
export function pedalBars(H, bars) {
  const P = M.PEDAL;
  const BPC = M.BARS_PER_CHORD;
  const out = H.map(() => false);
  for (let b = 0; b < M.BARS - BPC; b += BPC) {
    const hrs = H.slice(b, b + BPC);
    if (bars[b].twist) continue;
    const fog = hrs.some((h) => M.CODES.fog.includes(h.code));
    const still = hrs.every((h) => h.gust < P.calmGust && h.precip === 0);
    if (fog || still) for (let k = b; k < b + BPC; k++) out[k] = true;
  }
  return out;
}

/**
 * A chord's colour from the weather in its hours (see CHORD_COLOUR):
 * { sus: null | "sus2" | "sus4", seventh: 0–1, ninth: 0–1, open: bool }.
 * Only intervals that sit well are used: a whole-tone 2nd or 9th, a perfect 4th.
 */
export function chordColour(hrs, mode, deg, final) {
  const K = M.CHORD_COLOUR;
  const avg = (fn) => mean(hrs.map(fn));
  const second = stepAbove(mode, deg, 1) === 2;
  const fourth = stepAbove(mode, deg, 3) === 5;
  let sus = null;
  let susBy = null;
  if (!final) {
    const foggy = hrs.some((h) => M.CODES.fog.includes(h.code));
    const moving = Math.abs(hrs[hrs.length - 1].pressure - hrs[0].pressure) * (2 / Math.max(1, hrs.length - 1)) >= K.sus4PressureHpa;
    if (foggy && second) sus = "sus2";
    else if ((foggy || moving) && fourth) sus = "sus4";
    if (sus) susBy = foggy ? "fog" : "pressure";
  }
  const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
  const seventh = +ramp(avg((h) => h.dew ?? h.temp), K.seventh.dewFrom, K.seventh.dewFull).toFixed(3);
  const clearDay = avg((h) => (1 - h.cloud / 100) * (h.isDay ? 1 : 0));
  const ninth = second && sus !== "sus2" ? +ramp(clearDay, K.ninth.from, K.ninth.full).toFixed(3) : 0;
  return { sus, susBy, seventh, ninth, open: avg((h) => h.wind) >= K.openWind };
}

/**
 * Place a chord's pitch classes between voicing.low and .high so the notes move
 * as little as possible from the previous chord (or sit near PAD.center for the
 * first one). An open chord must span more than voicing.openSpan semitones.
 */
export function voiceChord(pcs, prev, open) {
  const V = M.CHORD_COLOUR.voicing;
  const cands = pcs.map((pc) => {
    const out = [];
    for (let m = V.low; m <= V.high; m++) if (m % 12 === pc) out.push(m);
    return out;
  });
  let best = null;
  let bestCost = Infinity;
  const walk = (i, chosen) => {
    if (i === cands.length) {
      const span = Math.max(...chosen) - Math.min(...chosen);
      if (open && span <= V.openSpan) return;
      const centre = Math.abs(mean(chosen) - M.PAD.center);
      const move = prev ? chosen.reduce((a, n) => a + Math.min(...prev.map((p) => Math.abs(n - p))), 0) : 0;
      // Moving little matters most; then stay near the middle and keep a closed chord compact.
      const cost = move + 0.3 * centre + (open ? 0 : 0.2 * span);
      if (cost < bestCost) { bestCost = cost; best = chosen.slice(); }
      return;
    }
    for (const m of cands[i]) walk(i + 1, [...chosen, m]);
  };
  walk(0, []);
  return (best ?? cands.map((c) => c[0])).sort((a, b) => a - b);
}

/**
 * The evening outlook (see EVENING): { kind: "settled" | "hint" | "open", score, why },
 * where why is "rain", "pop", "cloud", "gust" or "pressure".
 */
export function eveningOutlook(H) {
  const E = M.EVENING;
  const early = H.slice(E.earlyFrom, E.lateFrom), late = H.slice(E.lateFrom);
  const ramp = (x, [a, b]) => clamp((x - a) / (b - a), 0, 1);
  const rise = (fn) => mean(late.map(fn)) - mean(early.map(fn));
  const wet = (h) => h.code >= M.CODES.wetFrom;
  const scores = {
    rain: !early.some(wet) && late.filter(wet).length >= 2 ? 1 : 0,
    pop: ramp(rise((h) => h.pop ?? 0), E.pop),
    cloud: ramp(rise((h) => h.cloud), E.cloud),
    gust: ramp(rise((h) => h.gust), E.gust),
    pressure: ramp(H[E.lateFrom - 1].pressure - H[H.length - 1].pressure, E.fallHpa),
  };
  const [why, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const kind = score >= E.open ? "open" : score >= E.hint ? "hint" : "settled";
  return { kind, score: +score.toFixed(3), why: kind === "settled" ? null : why };
}

/**
 * The scale degree an open ending rests on: IV, else vi (a deceptive close), else V,
 * skipping any chord without a perfect fifth and the chord just before (so it moves).
 */
export function openDegree(mode, before) {
  const iv = MODES[mode];
  return [3, 5, 4].find((d) => d !== before && (iv[(d + 4) % 7] - iv[d] + 12) % 12 === 7);
}

export function majorTriad(mode, deg) {
  const iv = MODES[mode];
  return (iv[(deg + 2) % 7] - iv[deg] + 12) % 12 === 4 && (iv[(deg + 4) % 7] - iv[deg] + 12) % 12 === 7;
}

/** Scale degree of the chord under a bar. The last two bars always resolve home. */
export function chordDegreeAt(bar, progression) {
  if (bar >= M.BARS - M.BARS_PER_CHORD) return 0;
  return progression[Math.floor(bar / M.BARS_PER_CHORD) % progression.length];
}
