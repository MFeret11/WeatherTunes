// Outliers: the per-hour traits of extreme weather (dangerous heat, deep cold, a
// whiteout, freezing rain, the eye of a hurricane, a cold front, a harsh day's
// mood) and every way they bend the ordinary music, one helper per thing they shape.
//
// Each helper takes the ordinary value and returns it with the outliers applied.
// The arithmetic keeps the order it always had, so songs stay note-for-note the same.

import * as M from "../mapping.js";
import { clamp, mean } from "../util.js";
import { eyeHours, frontHour } from "./analyze.js";

const DC = M.DEEP_COLD, HT = M.HEAT, WO = M.WHITEOUT;

/**
 * The day's outlier traits. Per hour (0–1 or true/false): heat, deep (cold),
 * whiteout, ice, eye. For the day: front (the hour a cold front hits, or null),
 * harsh and dayHeat (see MOOD), and moodFrom (the hour the harsh mood starts).
 */
export function hourTraits(H, A) {
  const feels = (h) => h.feels ?? h.temp;
  return {
    heat: H.map((h) => +clamp((feels(h) - HT.fromFeels) / (HT.fullFeels - HT.fromFeels), 0, 1).toFixed(3)),
    deep: H.map((h) => +clamp((DC.fromFeels - feels(h)) / (DC.fromFeels - DC.fullFeels), 0, 1).toFixed(3)),
    whiteout: H.map((h) => (M.SNOW_CODES.includes(h.code)
      ? +clamp((h.gust - WO.fromGust) / (WO.fullGust - WO.fromGust), 0, 1).toFixed(3) : 0)),
    ice: H.map((h) => M.ICE_STORM.codes.includes(h.code)),
    eye: eyeHours(H),
    front: frontHour(H),
    harsh: A.harsh,
    dayHeat: A.dayHeat,
    moodFrom: A.moodFrom,
  };
}

/** Mean deep cold over the chord that starts at bar b. */
export const chordDeep = (T, b) => mean(T.deep.slice(b, b + M.BARS_PER_CHORD));

/** A harsh day thins the band from moodFrom on (see MOOD): a factor. */
const moodThin = (T, b) => (b >= T.moodFrom ? 1 - M.MOOD.thin * T.harsh : 1);

// ---- Melody ----------------------------------------------------------------

/** Deep cold lifts the melody's register (in scale steps). */
export const melodyLift = (T, b) => Math.round(DC.registerSteps * T.deep[b]);

/**
 * Notes in the hour, or null when no outlier decides it: deep cold leaves one
 * far-off bell, heat takes a note away (too hot to move), the eye leaves one.
 */
export function melodyNotes(T, b, n) {
  if (T.deep[b] >= DC.sparseFrom) return 1;
  if (T.heat[b] >= HT.sparseFrom && n > 1) return n - 1;
  if (T.eye[b]) return 1;
  return null;
}

/** Deep cold and heat leave more rests. */
export const restChance = (T, b, chance) => chance + DC.rest * T.deep[b] + HT.rest * T.heat[b];

/** Heat slurs the notes together. */
export const noteGate = (T, b, gate) => gate + HT.slur * T.heat[b];

/** The eye hushes the melody. */
export const melodyVel = (T, b, vel) => vel * (T.eye[b] ? M.EYE.vel : 1);

// ---- Bass, beat, pad and arpeggio -------------------------------------------

/** Deep cold thins the bass. */
export const bassVel = (T, b, vel) => vel * (1 - DC.bassCut * T.deep[b]);

/** The dry beat: deep cold thins each drum, heat the hats, a harsh day all of it. */
export const beatVel = (T, b, kind, vel) => vel * (1 - DC.beat[kind === "snare" ? "rim" : kind] * T.deep[b])
  * (kind === "hat" ? 1 - HT.hat * T.heat[b] : 1) * moodThin(T, b);

/** In deep cold a dry-beat hit too soft to hear is dropped. */
export const beatKept = (T, b, vel) => !T.deep[b] || vel >= DC.minVel;

/** Deep cold and a harsh day thin the pad. */
export const padVel = (T, b, vel) => vel * (1 - DC.padCut * chordDeep(T, b)) * moodThin(T, b);

/** A harsh day fades the arpeggio out (gone at MOOD.arpOff). */
export const arpAmount = (T, b, amount) => amount * (b >= T.moodFrom ? clamp(1 - T.harsh / M.MOOD.arpOff, 0, 1) : 1);

// ---- Atmosphere ------------------------------------------------------------

/** Wind levels the outliers add (the loudest wins): deep-cold gusts, a whiteout, a front's gust. */
export function outlierWind(T, b, h) {
  const DW = DC.wind;
  return [
    DW.level * T.deep[b] * clamp((h.gust - DW.fromGust) / (DW.fullGust - DW.fromGust), 0, 1),
    WO.wind * T.whiteout[b],
    T.front == null ? 0 : b === T.front ? M.FRONT.gust : b === T.front + 1 ? M.FRONT.gust / 2 : 0,
  ];
}

// ---- Mix automation ----------------------------------------------------------

/** A whiteout closes the filter. */
export const cutoffHz = (T, b, hz) => hz * (1 - WO.cutoffCut * T.whiteout[b]);

/** The eye drops the level. */
export const gainDb = (T, b, db) => db + (T.eye[b] ? M.EYE.gainDb : 0);

/** Deep cold and a whiteout add reverb. */
export const reverbLift = (T, b, lift) => lift + DC.reverbLift * T.deep[b] + WO.reverbLift * T.whiteout[b];

/** Deep cold and a whiteout bury the melody. */
export const melodyDb = (T, b, db) => db + DC.melodyDb * T.deep[b] + WO.melodyDb * T.whiteout[b];

/** Heat dulls the highs. */
export const eqHighDb = (T, b, db) => db + HT.highCutDb * T.heat[b];

/** Deep cold thins the lows (the starting point the wind and storms add to). */
export const eqLowDb = (T, b) => DC.lowCutDb * T.deep[b];

/** Deep cold carries the echo further; heat (the hour's or the day's) smears it. */
export const echoCarry = (T, b, carry) => Math.min(1, carry + DC.echoCarry * T.deep[b])
  * (1 - HT.echo * Math.max(T.heat[b], T.dayHeat));

/** Deep cold thins the wind to a high whistle (one value for the song). */
export const windBaseHz = (T) => Math.round(250 + (DC.wind.baseHz - 250) * mean(T.deep));
