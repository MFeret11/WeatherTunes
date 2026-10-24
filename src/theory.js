// Small music-theory helpers: modes, note names, triads, and a seeded RNG.

export const MODES = {
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  ionian:     [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  aeolian:    [0, 2, 3, 5, 7, 8, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
};
export const MODE_LABELS = {
  lydian: "Lydian", ionian: "major", mixolydian: "Mixolydian",
  dorian: "Dorian", aeolian: "minor", phrygian: "Phrygian",
};
const MAJOR_FAMILY = new Set(["lydian", "ionian", "mixolydian"]);

const NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Display name for a key root, preferring the spelling musicians expect. */
export function keyName(pc) {
  return [1, 3, 8, 10].includes(pc) ? NAMES_FLAT[pc] : NAMES_SHARP[pc];
}

/** MIDI number → Tone.js note name, e.g. 62 → "D4". */
export function midiToNote(m) {
  return NAMES_SHARP[m % 12] + (Math.floor(m / 12) - 1);
}

/** Scale degrees (indexes into the mode) used by the melody. Snow days use the pentatonic subset. */
export function melodyDegrees(mode, pentatonic) {
  if (!pentatonic) return [0, 1, 2, 3, 4, 5, 6];
  return MAJOR_FAMILY.has(mode) ? [0, 1, 2, 4, 5] : [0, 2, 3, 4, 6];
}

/** Every MIDI pitch from lo to hi whose pitch class is in the scale. */
export function scalePitches(rootPc, mode, degrees, lo = 24, hi = 108) {
  const pcs = new Set(degrees.map((d) => (rootPc + MODES[mode][d]) % 12));
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(m % 12)) out.push(m);
  return out;
}

/** Pitch classes of the triad on scale degree `deg` (0-based) of the mode. */
export function triadPcs(rootPc, mode, deg) {
  const iv = MODES[mode];
  return [0, 2, 4].map((k) => (rootPc + iv[(deg + k) % 7]) % 12);
}

/** Semitones from the chord root up to the mode's note `k` steps above it (k = 1 second, 3 fourth, 6 seventh). */
export function stepAbove(mode, deg, k) {
  const iv = MODES[mode];
  return (iv[(deg + k) % 7] - iv[deg] + 12) % 12;
}

/** Roman-numeral label for a triad, e.g. "IV", "vi", "bVII". */
export function chordLabel(mode, deg) {
  const iv = MODES[mode];
  const root = iv[deg];
  const third = (iv[(deg + 2) % 7] - root + 12) % 12;
  const fifth = (iv[(deg + 4) % 7] - root + 12) % 12;
  const majorRef = MODES.ionian[deg];
  const prefix = root < majorRef ? "b" : root > majorRef ? "#" : "";
  let num = ["I", "II", "III", "IV", "V", "VI", "VII"][deg];
  if (third === 3) num = num.toLowerCase();
  if (fifth === 6) num += "°";
  return prefix + num;
}

// ---- Seeded randomness (same seed → same song) ---------------------------

export function hashString(s) {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
