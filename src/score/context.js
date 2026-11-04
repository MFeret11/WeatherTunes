// The shared context every layer of the score reads (see scoreContext).

import * as M from "../mapping.js";
import { melodyDegrees, scalePitches, triadPcs, stepAbove } from "../theory.js";
import { clamp, mean, mulberry32 } from "../util.js";
import { seedFor, analyze, bassFeels, calmStir, eyeHours, frontHour } from "./analyze.js";
import { MODE_ORDER, afterFront, storyArc, dayArc, storyChords } from "./story.js";
import { twistChords, pedalBars, chordColour, eveningOutlook, openDegree } from "./harmony.js";
import { daySky } from "./sky.js";

/**
 * Everything the layers share, built once per song: the day's analysis, per-hour
 * traits, the story and the chord under every bar, and the melody's pitch tables.
 * The main random stream (rng, pick) is shared: layers must draw from it in score order.
 */
export function scoreContext(f) {
  const A = analyze(f);
  const { stats, root, snow, energy } = A;
  const D = M.DYNAMICS;
  // One row busier in the loudest stretches.
  const G = M.GROOVE;
  const gateFor = (h) => {
    const humid = clamp((h.rh - G.rhLow) / (G.rhHigh - G.rhLow), 0, 1);
    const cold = clamp((G.clipFromC - h.temp) / (G.clipFromC - G.clipFullC), 0, 1);
    return +Math.max(G.gateMin, G.gateDry + (G.gateHumid - G.gateDry) * humid - G.clipMax * cold).toFixed(3);
  };
  // Muggy air swings: the dew point measures how much water the air holds.
  const swing = +(G.swingMax * clamp((stats.dewMean - M.DEW.swingFromDew) / (M.DEW.swingFullDew - M.DEW.swingFromDew), 0, 1)).toFixed(3);
  const busierRow = (rows, i, b) => (energy[b] >= D.busier ? Math.min(i + 1, rows.length - 1) : i);
  const H = f.hours;
  const DC = M.DEEP_COLD;
  const deep = H.map((h) => +clamp((DC.fromFeels - (h.feels ?? h.temp)) / (DC.fromFeels - DC.fullFeels), 0, 1).toFixed(3));
  const HT = M.HEAT;
  const GL = M.GLIDE, FL = M.FLUTTER;
  const heat = H.map((h) => +clamp(((h.feels ?? h.temp) - HT.fromFeels) / (HT.fullFeels - HT.fromFeels), 0, 1).toFixed(3));
  const WO = M.WHITEOUT;
  const whiteout = H.map((h) => (M.SNOW_CODES.includes(h.code)
    ? +clamp((h.gust - WO.fromGust) / (WO.fullGust - WO.fromGust), 0, 1).toFixed(3) : 0));
  const iceHour = H.map((h) => M.ICE_STORM.codes.includes(h.code));
  const eye = eyeHours(H);
  const front = frontHour(H);
  const SK = daySky(f);
  const seed = seedFor(f);
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // ---- Story: a mode and chord for every bar -------------------------------
  const day = dayArc(H, A);
  const C = M.CALM_DETAIL;
  // On a calm day the music follows the day's small changes (zero on dramatic days).
  const stir = day.dramatic ? H.map(() => 0) : calmStir(H);
  const arc = afterFront(storyArc(H, A, day.dramatic ? M.STORY.margin : C.margin), front);
  const R = M.ARC;
  const lift = (b) => Math.round(R.liftSteps * energy[b]);
  const barChords = storyChords(arc, A, seed);
  const modeAt = (b) => barChords[b].mode;
  // The song's main mode is the one heard longest; its opening loop names the progression.
  const counts = {};
  for (const x of barChords) counts[x.mode] = (counts[x.mode] || 0) + 1;
  const mode = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b))[0];
  const firstLoops = M.PROGRESSIONS[arc.chapters[0].mode][A.trend];
  const progression = firstLoops[seed % firstLoops.length];
  // Twists: a few chords step outside the mode where the weather surprises (see TWISTS).
  const twists = twistChords(H, A, arc, barChords, { day, deep, front, seed });
  // The ending follows the evening: weather moving in leaves the last chord away from home.
  const evening = eveningOutlook(H);
  if (evening.kind === "open") {
    const prev = barChords[M.BARS - M.BARS_PER_CHORD - 1];
    const d = openDegree(barChords[M.BARS - 1].mode, prev.mode === barChords[M.BARS - 1].mode && !prev.shift ? prev.deg : null);
    for (let b = M.BARS - M.BARS_PER_CHORD; b < M.BARS; b++) barChords[b] = { ...barChords[b], deg: d };
  }
  const chordDeg = (b) => barChords[b].deg;
  const rootAt = (b) => (root + (barChords[b].shift ?? 0)) % 12;
  const keyAt = (b) => `${barChords[b].mode}@${barChords[b].shift ?? 0}`;
  // Each chord's colour (sevenths, ninths, sus, spread) from its two hours.
  const colours = Array.from({ length: M.BARS / M.BARS_PER_CHORD }, (_, c) => {
    const b = c * M.BARS_PER_CHORD;
    const final = b + M.BARS_PER_CHORD >= M.BARS;
    const col = chordColour(H.slice(b, b + M.BARS_PER_CHORD), modeAt(b), chordDeg(b), final);
    // Deep cold hollows the chord out (see DEEP_COLD).
    if (mean(deep.slice(b, b + M.BARS_PER_CHORD)) >= DC.hollowFrom) {
      const second = stepAbove(modeAt(b), chordDeg(b), 1) === 2;
      return { ...col, sus: !final && second ? "sus2" : "5", susBy: "cold", seventh: 0, ninth: 0, open: true };
    }
    return col;
  });
  const colourAt = (b) => colours[Math.floor(b / M.BARS_PER_CHORD)];
  // The chord's own tones: a sus chord swaps its third, and the melody's strong beats follow it.
  const chordPcs = (b) => {
    const t = triadPcs(rootAt(b), modeAt(b), chordDeg(b));
    const { sus } = colourAt(b);
    if (sus === "5") return [t[0], t[2]]; // a bare fifth
    if (sus) t[1] = (t[0] + (sus === "sus2" ? 2 : 5)) % 12;
    return t;
  };

  // ---- Melody pitch tables (the melody, bells and chimes pick from them) --
  // Melody positions are scale steps relative to the tonic, so a line carries
  // across a change of mode: step 2 is the third in major or minor alike.
  const MEL = M.MELODY;
  const rootMidi = 60 + root - (root >= 6 ? 12 : 0); // tonic between F#3 and F4
  const tables = {};
  for (let b = 0; b < M.BARS; b++) {
    const k = keyAt(b), m = modeAt(b);
    if (tables[k]) continue;
    const p = scalePitches(rootAt(b), m, melodyDegrees(m, snow));
    // A twisted chord's scale may not hold the tonic: step 0 is its nearest note (lower on a tie).
    let base = p.indexOf(rootMidi);
    if (base < 0) base = p.reduce((best, x, i) => (Math.abs(x - rootMidi) < Math.abs(p[best] - rootMidi) ? i : best), 0);
    tables[k] = { p, base };
  }
  const octave = melodyDegrees(mode, snow).length; // steps per octave
  const pitchAt = (b, r) => { const t = tables[keyAt(b)]; return t.p[t.base + r]; };
  const bassFeel = bassFeels(H, energy, stats);
  const pedal = pedalBars(H, barChords);
  return {
    f, H, A, stats, root, snow, energy, gateFor, swing, busierRow, deep, heat, whiteout, iceHour,
    eye, front, SK, seed, rng, pick, day, stir, arc, lift, barChords, modeAt, mode, progression,
    twists, evening, chordDeg, rootAt, keyAt, colours, colourAt, chordPcs, tables, octave, pitchAt, bassFeel, pedal,
  };
}
