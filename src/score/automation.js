// Per-bar automation (the mix follows the weather) and the score's meta.

import * as M from "../mapping.js";
import { MODE_LABELS, keyName, chordLabel, stepAbove } from "../theory.js";
import { clamp } from "../util.js";
import { capeLevel, hourBrightness } from "./analyze.js";
import { linerNotes, notesAsText } from "./liner.js";
import * as O from "./traits.js";

/**
 * Per-bar automation: filter, gain, reverb, EQ, echo and the other mix curves.
 */
export function barAutomation(ctx) {
  const { f, H, A, stats, energy, T, SK, day, stir } = ctx;
  const D = M.DYNAMICS;
  const FL = M.FLUTTER;
  const C = M.CALM_DETAIL;
  const R = M.ARC;
  const F = M.FILTER;
  const RV = M.REVERB;
  const automation = {
    pan: H.map((h) => +(M.PAN_WIDTH * Math.sin((h.dir * Math.PI) / 180)).toFixed(3)),
    // Night closes the filter; moonlight opens it part way again; haze closes it a little.
    cutoff: H.map((h, b) => Math.round(O.cutoffHz(T, b,
      (F.clearHz - (F.clearHz - F.overcastHz) * (h.cloud / 100))
      * (h.isDay ? 1 : F.nightFactor + (1 - F.nightFactor) * M.MOON.cutoffLift * SK.moonlight[b])
      * (1 - M.AIR.cutoffCut * SK.haze[b])))),
    energy,
    // Dramatic days dip in their calm hours, so the storm is a real crescendo.
    gainDb: energy.map((e, b) => +O.gainDb(T, b, D.maxBoostDb * e + (day.dramatic ? D.quietDb * (1 - e) : 0)
      + C.swellDb * (2 * stir[b] - 1) * (day.dramatic ? 0 : 1)
      + (b === 0 ? D.introDb : 0)).toFixed(2)),
    reverbLift: day.phases.map((ph, b) => +O.reverbLift(T, b, ph === "release" ? R.reverbLift : 0).toFixed(3)),
    melodyDb: H.map((h, b) => +O.melodyDb(T, b,
      M.MELODY.overcastDb * clamp((h.cloud - M.MELODY.overcastFrom) / (100 - M.MELODY.overcastFrom), 0, 1)).toFixed(2)),
    // Gusts well above the wind make the pad flutter (see FLUTTER).
    flutter: H.map((h) => +(clamp((h.gust - FL.gustFrom) / (FL.gustFull - FL.gustFrom), 0, 1)
      * clamp((h.gust - h.wind - FL.gapFrom) / (FL.gapFull - FL.gapFrom), 0, 1)).toFixed(3)),
    // Heat shimmer on the melody (see HEAT); left out on days without it.
    ...(T.heat.some((x) => x > 0) ? { wobble: T.heat } : {}),
    windBaseHz: O.windBaseHz(T),
    // Moonlight keeps the night from dimming the melody as far.
    melodyDayDb: H.map((h, b) => +(melodyDaylightDb(f, b, h) * (1 - M.MOON.nightLift * SK.moonlight[b])).toFixed(2)),
    padOpen: energy.map((e, b) => +(D.padOpenOctaves * e + C.padOpenOctaves * stir[b]).toFixed(3)),
    driveWet: energy.map((e) => +(M.DRIVE.wetMax * clamp((e - M.DRIVE.wetFrom) / (1 - M.DRIVE.wetFrom), 0, 1)).toFixed(3)),
    eqHigh: H.map((h, b) => +clamp(O.eqHighDb(T, b, M.TONE.cloudCutDb * (h.cloud / 100) + (M.TONE.fogCodes.includes(h.code) ? M.TONE.fogCutDb : 0)
      + M.AIR.hazeCutDb * SK.haze[b] + M.SNOW_COVER.highCutDb * SK.cover),
      M.TONE.minDb, M.TONE.maxDb).toFixed(2)),
    eqLow: H.map((h, b) => +clamp(O.eqLowDb(T, b) + M.TONE.windBoostDb * clamp((h.gust - M.TONE.windFrom) / (M.TONE.windFull - M.TONE.windFrom), 0, 1)
      + (A.stormHour(h) ? M.TONE.stormBoostDb : 0), M.TONE.minDb, M.TONE.maxDb).toFixed(2)),
    // The melody's echo carries in clear, still, dry air (see ECHO).
    echoCarry: H.map((h, b) => {
      const E = M.ECHO;
      const wet = h.precip >= 0.1 || M.SNOW_CODES.includes(h.code) || E.fogCodes.includes(h.code);
      return wet ? 0 : +O.echoCarry(T, b, (1 - h.cloud / 100) * clamp((E.windyGust - h.gust) / (E.windyGust - E.calmGust), 0, 1)).toFixed(3);
    }),
    // Snow on the ground soaks up the echoes.
    reverbWet: +((RV.min + (RV.max - RV.min) * clamp((stats.rh - RV.rhLow) / (RV.rhHigh - RV.rhLow), 0, 1))
      * (1 - M.SNOW_COVER.reverbCut * SK.cover)).toFixed(3),
  };

  // Cloud and night together stop at the floor.
  automation.melodyDayDb = automation.melodyDayDb.map((d, b) =>
    +Math.max(d, M.MELODY.floorDb - automation.melodyDb[b]).toFixed(2));
  return automation;
}

/**
 * The score's meta: key, chords and their names, story, outliers, sky and liner notes.
 */
export function scoreMeta(ctx, { melody, arp, rain, bells, drums, garage, beat, crackle, atmosphere, fx, automation, chimes, shimmer }, held, units) {
  const { f, H, A, stats, root, snow, swing, T, SK, seed, day, stir, arc, barChords, modeAt, mode, progression, twists, evening, chordDeg, colours, colourAt, chordPcs, bassFeel, pedal } = ctx;
  const K = M.CHORD_COLOUR;
  const chords = Array.from({ length: M.BARS }, (_, b) => chordLabel(modeAt(b), chordDeg(b)));
  for (const t of twists) for (let b = t.bar; b < t.bar + M.BARS_PER_CHORD; b++) {
    if (t.kind === "mediant") chords[b] = { 4: "III", 8: "bVI", 1: "bII" }[barChords[b].shift];
    else if (t.kind === "dominant") {
      const to = chords[t.bar + M.BARS_PER_CHORD];
      chords[b] = /^[Ii]$/.test(to) ? "V" : `V/${to}`; // V of the tonic is just V (a major V in a minor key)
    }
  }
  // With colour: "Imaj7", "ii9", "Vsus4", "IVadd9".
  const chordNames = chords.map((label, b) => {
    const col = colourAt(b);
    const m = modeAt(b);
    const seventh = col.seventh >= K.min;
    const ninth = col.ninth >= K.min;
    const major7 = stepAbove(m, chordDeg(b), 6) === 11;
    const ext = seventh ? `${major7 ? "maj" : ""}${ninth ? 9 : 7}` : ninth ? "add9" : "";
    return label + ext + (col.sus ?? "");
  });
  const meta = {
    name: f.name, date: f.date, seed,
    root, rootName: keyName(root), mode, modeLabel: MODE_LABELS[mode],
    bpm: A.bpm, bars: M.BARS, steps: M.STEPS, sections: M.SECTIONS,
    trend: A.trend, progressionDegrees: progression,
    progression: progression.map((d) => chordLabel(arc.chapters[0].mode, d)),
    chords, chordNames, chordPcs: Array.from({ length: M.BARS }, (_, b) => chordPcs(b)), colours,
    brightness: +A.brightness.toFixed(3), storm: A.storm, snow,
    stats, voices: A.voices, swing,
    bassSub: +clamp((stats.cloud - M.BASS_TONE.cloudFrom) / (M.BASS_TONE.cloudFull - M.BASS_TONE.cloudFrom), 0, 1).toFixed(3),
    bassFeel,
    barModes: barChords.map((x) => x.mode),
    barShifts: barChords.map((x) => x.shift ?? 0),
    twists, pedal, ending: evening,
    chordDegrees: barChords.map((x) => x.deg),
    chapters: arc.chapters.map((c) => ({ bar: c.chord * M.BARS_PER_CHORD, mode: c.mode, label: MODE_LABELS[c.mode], turn: c.turn })),
    capeMax: Math.max(...f.hours.map((h) => h.cape ?? 0)),
    drive: +(M.DRIVE.amount + (M.DRIVE.maxAmount - M.DRIVE.amount) * capeLevel(Math.max(...f.hours.map((h) => h.cape ?? 0)))).toFixed(3),
  };
  meta.arc = day;
  meta.heldNotes = held;
  meta.stir = stir;
  meta.deepCold = T.deep;
  meta.outliers = { heat: T.heat, whiteout: T.whiteout, ice: T.ice, eye: T.eye, front: T.front };
  meta.hourBrightness = H.map((h) => +clamp(hourBrightness(h, A.stormHour), 0, 1).toFixed(3));
  const { sky: _sky, ...skyMeta } = SK;
  meta.sky = { ...skyMeta, magLat: SK.sky.magLat };
  meta.liner = linerNotes(f, A, meta, { melody, arp, rain, bells, drums, garage, beat, crackle, atmosphere, fx, automation, chimes, shimmer }, units);
  meta.notes = notesAsText(meta.liner);
  return meta;
}

/**
 * Melody level from daylight, in dB (0 by day, MELODY.nightDb at night), fading
 * across sunrise and sunset. Days with no sunrise or sunset (polar night,
 * midnight sun) stay at full level.
 */
export function melodyDaylightDb(f, b) {
  const { sunrise, sunset } = f;
  if (sunrise == null || sunset == null || sunset <= sunrise) return 0;
  const MEL = M.MELODY;
  const t = b + 0.5; // middle of the hour
  const up = clamp((t - sunrise) / MEL.fadeHours + 0.5, 0, 1);
  const down = clamp((sunset - t) / MEL.fadeHours + 0.5, 0, 1);
  return +(MEL.nightDb * (1 - Math.min(up, down))).toFixed(2);
}
