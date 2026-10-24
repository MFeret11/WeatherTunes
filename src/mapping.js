// Every tunable number in the weather → music mapping lives here, so the
// sound can be adjusted by ear without touching compose.js.

// Time is counted in hour slots: each forecast hour gets STEPS sixteenths
// (half a bar), so the 24-hour song is 12 bars, about 20–24 seconds.
// The score's `bar` field is the hour slot; the engine turns it into time.
export const BARS = 24;              // hour slots, midnight to 11 pm
export const STEPS = 8;              // sixteenths per hour (2 beats)
export const BARS_PER_CHORD = 2;     // hours per chord: 4-chord loop = 8 hours, played 3 times
export const SECTIONS = [            // 8-hour phrases, named in the liner notes
  { name: "Night", start: 0 },
  { name: "Day", start: 8 },
  { name: "Evening", start: 16 },
];

// ---- Mode (scale) from "brightness" -------------------------------------
// brightness = 1 - cloud - rain chance - rainfall - storm, each weighted below.
export const BRIGHTNESS = {
  cloud: 0.4,          // × mean cloud cover (0–1)
  pop: 0.25,           // × mean precipitation probability (0–1)
  precip: 0.15,        // × min(1, daily rainfall / precipFullMm)
  precipFullMm: 20,
  storm: 0.2,          // subtracted on storm days (see STORM)
};
// Brightest first. Lydian also needs a warm day, or it falls through to Ionian.
export const MODE_THRESHOLDS = [
  { mode: "lydian", min: 0.9, minMeanTemp: 15 },
  { mode: "ionian", min: 0.7 },
  { mode: "mixolydian", min: 0.55 },
  { mode: "dorian", min: 0.4 },
  { mode: "aeolian", min: 0.2 },
  { mode: "phrygian", min: -Infinity },
];
// A storm day: any thunder code, or an hour with this much rain or wind.
export const STORM = { hourlyPrecipMm: 8, gustKmh: 75 };
export const THUNDER_CODES = [95, 96, 99];
export const SNOW_CODES = [71, 73, 75, 77, 85, 86];

// ---- Story: the mood follows the sky through the day -----------------------
// Each chord (2 hours) gets the brightness of its darker hour (a storm is an
// event, not an average), from that hour's cloud, rain
// chance, rainfall and storms (same weights as BRIGHTNESS, with rainfall
// counted per hour). When it clearly leaves the current mode's band, the song
// starts a new chapter in that mode, on the same tonic:
//   darker   the new chapter opens on its tonic chord, so the colour change lands at once
//   brighter a clearing: one chord of preparation (V, or IV) resolves to the new tonic,
//            with a cymbal swell
//   margin   how far past a band edge the brightness must go (stops flicker)
//   minChords a chapter lasts at least this many chords
export const STORY = { precipHourFullMm: 3, smooth: [0.2, 0.6, 0.2], margin: 0.1, minChords: 2 };

// ---- Key, tempo, register ------------------------------------------------
export const TEMPO = { base: 120, perKmh: 1, min: 120, max: 156 };
export const MELODY = {
  spanSteps: 10,       // the day's temperature range covers this many scale steps
  minSpanC: 8,         // flat days are spread over at least this many °C
  registerPerC: 1 / 8, // scale steps per °C away from registerCenterC
  registerCenterC: 15,
  registerMax: 3,      // ± scale steps
  maxLeap: 9,          // semitones (a major sixth)
  low: 48, high: 91,   // MIDI range clamp (C3–G6)
  velLow: 0.6, velHigh: 0.9, accent: 0.05,
  // Under a grey sky the melody steps back into the mix: from overcastFrom %
  // cloud, each hour turns the melody down, reaching overcastDb at 100% cloud,
  // while the pad, bass and atmosphere stay as they are. (This is a level
  // change after the melody's compressor, so the compressor can't undo it.)
  overcastFrom: 50, overcastDb: -6,
};

// Notes per hour from wind gusts (km/h): first row whose maxGust exceeds the gust.
export const DENSITY = [
  { maxGust: 15, notes: 1 },
  { maxGust: 30, notes: 2 },
  { maxGust: 50, notes: 3 },
  { maxGust: Infinity, notes: 4 },
];
// Rhythm patterns in sixteenth notes (each sums to STEPS = 8), picked by the seed.
export const RHYTHMS = {
  1: [[8]],
  2: [[4, 4], [6, 2], [5, 3]],
  3: [[4, 2, 2], [2, 2, 4], [3, 3, 2]],
  4: [[2, 2, 2, 2], [3, 1, 2, 2]],
};
export const REST_PER_CLOUD = 0.3;   // rest chance = this × cloud cover (0–1)
export const NEIGHBOR_CHANCE = 0.7;  // when the line would repeat a note, step away instead

// ---- Harmony -------------------------------------------------------------
// Chords are scale degrees (0 = tonic) built as triads inside the mode.
// Each mode avoids its diminished chord. Pressure trend picks the row and the
// day's seed picks one of its loops. Rising loops tend to climb or resolve,
// falling loops tend to descend.
export const PROGRESSIONS = {
  lydian: {
    rising: [[0, 1, 5, 4], [0, 1, 4, 5]],
    steady: [[0, 1, 0, 1], [0, 6, 1, 0]],
    falling: [[5, 1, 0, 4], [5, 4, 1, 0]],
  },
  ionian: {
    rising: [[0, 4, 5, 3], [0, 5, 3, 4]],
    steady: [[0, 3, 0, 4], [3, 0, 4, 0]],
    falling: [[5, 3, 0, 4], [0, 2, 5, 3]],
  },
  mixolydian: {
    rising: [[0, 6, 3, 0], [0, 3, 6, 0]],
    steady: [[0, 6, 0, 3], [0, 1, 6, 0]],
    falling: [[0, 4, 6, 3], [5, 6, 0, 0]],
  },
  dorian: {
    rising: [[0, 2, 3, 0], [0, 1, 2, 3]],
    steady: [[0, 3, 0, 3], [0, 2, 6, 3]],
    falling: [[0, 4, 6, 3], [3, 2, 1, 0]],
  },
  aeolian: {
    rising: [[0, 5, 2, 6], [5, 6, 0, 0]],
    steady: [[0, 6, 5, 6], [0, 3, 0, 4]],
    falling: [[0, 3, 5, 4], [0, 6, 5, 4]],
  },
  phrygian: {
    rising: [[0, 1, 0, 6], [0, 2, 1, 0]],
    steady: [[0, 1, 2, 1], [0, 6, 1, 0]],
    falling: [[0, 1, 3, 0], [0, 6, 5, 1]],
  },
};
export const PRESSURE_TREND_HPA = 1.5; // change over the day that counts as rising/falling

// ---- Other layers --------------------------------------------------------
export const BASS = {
  // Pattern per hour by its mean wind (km/h): [pos16, dur16, interval] where
  // interval is 0 root, 7 fifth, 12 octave. Positions fit in STEPS = 8.
  patterns: [
    { maxWind: 12, hits: [[0, 8, 0]] },
    { maxWind: 25, hits: [[0, 4, 0], [4, 4, 0]] },
    { maxWind: 40, hits: [[0, 3, 0], [3, 1, 12], [4, 3, 0], [7, 1, 7]] },
    { maxWind: Infinity, hits: [[0, 2, 0], [2, 2, 12], [4, 2, 0], [6, 2, 7]] },
  ],
  vel: 0.75,
};
// Bass feel, decided per chord (2 hours) from the weather only (not time of day):
//   double  either hour's energy (DYNAMICS, includes CAPE) at least doubleEnergy
//   half    a freezing day (mean below halfMeanTemp), a fog or snow hour, or both
//           hours dead calm (gusts under calmGust km/h and no rain)
//   normal  everything else: the wind-picked rows in BASS.patterns
// Hits are [pos16, dur16, interval]. Half-time spans the whole 2-hour chord (16 sixteenths).
export const BASS_FEEL = {
  doubleEnergy: 0.6,
  halfMeanTemp: 0,
  halfCodes: [45, 48, 71, 73, 75, 77, 85, 86],
  calmGust: 10,
  double: [[0, 1, 0], [1, 1, 12], [2, 1, 0], [3, 1, 12], [4, 1, 0], [5, 1, 7], [6, 1, 0], [7, 1, 12]],
  half: [[0, 12, 0], [12, 4, 7]],
};
export const PAD = { velMin: 0.25, velPerCloud: 0.45, center: 60 };
export const RAIN = { minPop: 10, maxHits: 5, velBase: 0.2, velPerMm: 0.15, velMax: 0.8 };
export const BELLS = { maxHits: 2, vel: 0.35, low: 79, high: 96 };

// ---- Atmosphere: a noise bed that follows each hour's conditions ----------
// White = hiss (fog, drizzle), pink = fuller (rain, snow), brown = deep (storms).
// level = base + perMm × that hour's precipitation, capped at max.
// cutoff = lowpass on the bed (low = muffled, e.g. snow).
// Matched by WMO weather code; the first row listing the code wins.
export const ATMOSPHERE = [
  { kind: "fog",     codes: [45, 48],             color: "white", base: 0.10, perMm: 0,    max: 0.10, cutoff: 2500 },
  { kind: "drizzle", codes: [51, 53, 55, 56, 57], color: "white", base: 0.16, perMm: 0.10, max: 0.30, cutoff: 5000 },
  { kind: "rain",    codes: [61, 63, 65, 66, 67], color: "pink",  base: 0.25, perMm: 0.06, max: 0.55, cutoff: 6000 },
  { kind: "showers", codes: [80, 81, 82],         color: "pink",  base: 0.30, perMm: 0.06, max: 0.60, cutoff: 6000 },
  { kind: "snow",    codes: [71, 73, 75, 77, 85, 86], color: "pink", base: 0.15, perMm: 0.03, max: 0.30, cutoff: 1200 },
  { kind: "storm",   codes: [95, 96, 99],         color: "brown", base: 0.55, perMm: 0.03, max: 0.75, cutoff: 900 },
];
// Gusts above `from` km/h (a strong breeze; models often forecast 40 km/h gusts on calm days) add a swept pink-noise "whoosh", full at `full` km/h.
export const WIND_NOISE = { from: 45, full: 100, max: 0.5 };

// ---- Dynamics: the song swells and settles with the day's weather ----------
// Each hour gets an intensity (0–1): the strongest of its rain, gusts and thunder.
// It's spread so the music builds for a couple of hours before rough weather
// arrives and settles over a few hours after it passes. Intensity then:
//   raises the band (melody, bass, pad) by up to maxBoostDb
//   plays harder (velocity + velBoost × intensity)
//   at `busier` or above, steps melody density and bass pattern up one row
//   opens the pad's tone filter by up to padOpenOctaves
export const DYNAMICS = {
  capeFrom: 500, capeFull: 2500, // CAPE (J/kg, storm fuel in the air) starts counting at capeFrom, full at capeFull
  capeWeight: 0.8,             // unstable air alone can push intensity this high, even before rain arrives
  rainFullMm: 6,               // this much rain (or snow water) in an hour = full intensity
  gustFrom: 35, gustFull: 85,  // gusts (km/h) start counting at gustFrom, full at gustFull
  lead: [0.2, 0.4, 0.62, 0.85], // weights 4, 3, 2 and 1 hours before an event: a crescendo
  tail: [0.6, 0.32, 0.12],     // weights 1, 2 and 3 hours after: a quicker release
  maxBoostDb: 5,
  quietDb: -6,                 // on a dramatic day the calm hours drop this far, so the peak stands out
  velBoost: 0.15,
  busier: 0.5,
  padOpenOctaves: 1.2,
  introDb: -4,                 // the first hour eases in
  calm: 0.15,                  // a day whose peak stays below this reads as calm
};

// ---- The day's arc: calm → build → peak → release ---------------------------
// A day whose peak intensity reaches dramaMin is "dramatic". Each hour gets a phase:
//   peak     intensity at least peakShare × the day's peak (gaps up to mergeGap filled in)
//   build    a peak is coming within buildHours
//   release  a peak passed within releaseHours (a "cool breeze" if the air cools
//            by coolDropC or more from the peak, and the wind keeps blowing)
//   calm     everything else (a calm day has no arc; CALM_DETAIL gives it small swells instead)
// The phases drive:
//   lift          melody climbs up to liftSteps scale steps with the energy
//   drums         a low drum that grows from one hit to a roll as a peak approaches
//   release       melody plays sparser and longer, reverb opens by reverbLift,
//                 a soft breeze (breezeLevel) blows when the air cools
export const ARC = {
  dramaMin: 0.45, peakShare: 0.7, buildHours: 4, releaseHours: 4, coolDropC: 1.5,
  mergeGap: 3,         // peaks this many hours apart or closer are one long climax
  drumsMin: 0.6,       // drums only on a day whose peak reaches this (a real storm)
  liftSteps: 3,
  drums: [ // first row whose minEnergy the hour's energy reaches
    { minEnergy: 0.85, hits: [0, 1, 2, 3, 4, 5, 6, 7] },
    { minEnergy: 0.6, hits: [0, 2, 4, 6] },
    { minEnergy: 0.4, hits: [0, 4] },
    { minEnergy: 0.2, hits: [0] },
  ],
  drumVel: [0.35, 0.95],
  releaseGate: 0.15, reverbLift: 0.25, breezeLevel: 0.22,
};

// ---- Calm-day detail: small changes matter on a quiet day ------------------
// Most days never reach the storm thresholds above, so on a day that isn't
// dramatic (see ARC.dramaMin) each hour is also measured against the day's own
// range. Its "stir" (0–1) is the strongest of:
//   gust    how far this hour's gusts sit between the day's lowest and highest
//   pop     the same for chance of rain
//   cloud   how much the cloud cover moved since the last hour (cloudSwing % = 1)
//   warm    how fast the air is warming or cooling (warmSwingC °C per hour = 1)
// Each range counts at least its floor, so a day that barely moves stays even
// (a 3 km/h gust range is not stretched into a full swing).
// Stir is smoothed with `smooth`, then:
//   swellDb   the band breathes ± this much around the day's middle
//   velBoost  plays harder in stirred hours
//   busier    at or above this, the melody plays one row busier (never past maxNotes)
//   sparser   at or below this, the melody plays one row sparser
//   padOpenOctaves   the pad's filter opens this far at full stir
//   margin    a calm day changes mode on smaller sky shifts (STORY.margin elsewhere)
export const CALM_DETAIL = {
  weights: { gust: 1, pop: 0.8, cloud: 0.7, warm: 0.5 },
  floors: { gust: 12, pop: 30 },
  cloudSwing: 25, warmSwingC: 2,
  smooth: [0.25, 0.5, 0.25],
  swellDb: 2.5, velBoost: 0.1,
  busier: 0.6, sparser: 0.15, maxNotes: 3,
  padOpenOctaves: 0.5,
  margin: 0.04,
};

// ---- Weather traits: each sound follows one measurement, on any day ---------
// No place or "type of day" is coded in. A day's character comes from how
// these combine: humid grey air crackles, cloud rounds off the bass, rain
// brings in a beat.

// Vinyl crackle: humid air under cloud. Per hour,
//   amount = (rh between rhFrom and rhFull) × (cloud between cloudFrom and cloudFull)
// gives up to perHour faint pops, louder ones rarer (vel from vel[0] to vel[1]).
export const CRACKLE = { rhFrom: 70, rhFull: 95, cloudFrom: 50, cloudFull: 90, perHour: 12, vel: [0.08, 0.35] };

// Bass tone: the day's mean cloud cover rounds the bass off. At cloudFrom or
// below it's the plain saw bass; by cloudFull it's a deep sub (a sine with a
// touch of second harmonic, so small speakers still carry it).
export const BASS_TONE = { cloudFrom: 0.5, cloudFull: 0.9 };

// Rain beat: a skippy, shuffled 2-step pattern in hours when rain is falling
// (or pop ≥ hourPop) under cloud ≥ hourCloud. Light rain plays the rim and hats;
// kickMm of rain in the hour brings in the kick. Hits get louder with the chance
// of rain. Snow hours ring bells instead, and the build and peak of a storm
// leave the floor to the storm drums.
// Steps are sixteenths across a 2-hour chord (0–15).
export const RAIN_BEAT = {
  hourCloud: 60, hourPop: 40, kickMm: 1,
  kick: [0, 10], snare: [4, 12], hats: [2, 6, 10, 14], ghosts: [3, 7, 11, 15],
  vel: { kick: 0.75, snare: 0.5, hat: 0.3, ghost: 0.14 }, humanize: 0.06,
};

// ---- Groove and articulation ------------------------------------------------
// Humid air swings and slurs; dry air plays straight; cold air plays clipped.
//   swing  the day's mean humidity: 0 below swingFromRh, swingMax at swingFullRh
//          (Tone's swing on sixteenths: 0 straight, 0.5 a lazy shuffle), faded
//          out on cold days: none at a mean of clipFromC, full from swingWarmC up
//   gate   each note sounds for this fraction of its length, from that hour's
//          humidity (gateDry → gateHumid), minus up to clipMax when it's cold
export const GROOVE = {
  swingFromRh: 55, swingFullRh: 95, swingMax: 0.5, swingWarmC: 15,
  rhLow: 30, rhHigh: 100, gateDry: 0.55, gateHumid: 0.98,
  clipFromC: 5, clipFullC: -20, clipMax: 0.3,
  gateMin: 0.3,
};

// ---- Sound shaping (per-hour automation) ----------------------------------
export const FILTER = { clearHz: 6000, overcastHz: 2000, nightFactor: 0.6 };
export const REVERB = { min: 0.1, max: 0.6, rhLow: 30, rhHigh: 100 };
export const PAN_WIDTH = 0.6;

// ---- Instruments ("voices") picked by the climate --------------------------
// A voice is plain data that the engine turns into a Tone.js synth:
//   synth   Tone class for each PolySynth voice ("Synth" or "FMSynth")
//   options passed to that class (oscillator, envelope, FM settings)
//   gain    dB trim so every voice sits at about the same loudness
//   tone    lowpass cutoff (Hz) on this instrument alone
//   vibrato [rate Hz, depth 0–1]   (melody)   tremolo [rate Hz, depth 0–1] (pad)

// Melody: the day's mean temperature. First row whose maxTemp (°C) is above it.
export const MELODY_VOICES = [
  {
    id: "glass", label: "glass bells", maxTemp: -8, synth: "FMSynth", gain: 0, tone: 7000, vibrato: [0, 0],
    options: {
      harmonicity: 3.5, modulationIndex: 2.5,
      oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 1.8, sustain: 0.05, release: 1.8 },
      modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.1, release: 0.6 },
    },
  },
  {
    id: "flute", label: "breathy flute", maxTemp: 6, synth: "Synth", gain: 1, tone: 3500, vibrato: [5, 0.08],
    options: {
      oscillator: { partials: [1, 0.25, 0.08] },
      envelope: { attack: 0.08, decay: 0.2, sustain: 0.8, release: 0.5 },
    },
  },
  {
    id: "keys", label: "soft keys", maxTemp: 20, synth: "Synth", gain: 0, tone: 8000, vibrato: [0, 0],
    options: {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.6 },
    },
  },
  {
    id: "mallet", label: "marimba", maxTemp: 30, synth: "FMSynth", gain: 3, tone: 6000, vibrato: [0, 0],
    options: {
      harmonicity: 4, modulationIndex: 3,
      oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: 1.1, sustain: 0, release: 0.9 },
      modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
    },
  },
  {
    id: "reed", label: "reedy pipe", maxTemp: Infinity, synth: "Synth", gain: -7, tone: 2400, vibrato: [5.5, 0.12],
    options: {
      oscillator: { type: "pulse", width: 0.3 },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.4 },
    },
  },
];

// Pad: sky and moisture. The first row whose conditions all hold wins.
//   storm / snow  the day is a storm or snow day (see STORM, SNOW_CODES)
//   minPop        mean chance of rain (0–1) at least this, or minRainMm of rain
//   minCloud      mean cloud cover (0–1) at least this
//   maxTemp       mean temperature (°C) below this
//   minRh         mean humidity (%) at least this
//   minWetHours   at least this many hours with rain or drizzle
//   maxRainRate   ...and on average no more than this many mm in each wet hour (drizzle, not downpour)
export const PAD_VOICES = [
  {
    id: "storm", label: "dark, detuned saws", when: { storm: true }, gain: 0, tone: 700, tremolo: [0, 0],
    options: { oscillator: { type: "fatsawtooth", count: 3, spread: 45 }, envelope: { attack: 0.6, decay: 0.5, sustain: 0.9, release: 2.5 } },
  },
  {
    id: "snow", label: "hushed choir", when: { snow: true }, gain: 4, tone: 2000, tremolo: [0, 0],
    options: { oscillator: { type: "fatsine", count: 3, spread: 30 }, envelope: { attack: 2.5, decay: 0.5, sustain: 0.9, release: 3.5 } },
  },
  {
    // Wordless "ooh" voices: soft detuned saws through a low formant-like filter, with a slow tape wobble.
    id: "ghost", label: "ghostly, wordless voices", when: { minCloud: 0.75, maxTemp: 20, minWetHours: 6, maxRainRate: 1.2 }, gain: 3, tone: 900, tremolo: [0.35, 0.3],
    options: { oscillator: { type: "fatsawtooth", count: 4, spread: 28 }, envelope: { attack: 1.8, decay: 0.5, sustain: 0.85, release: 3.5 } },
  },
  {
    id: "rain", label: "wobbling electric piano", when: { minPop: 0.5, minRainMm: 5 }, gain: 2, tone: 1100, tremolo: [4, 0.45],
    options: { oscillator: { type: "fattriangle", count: 2, spread: 25 }, envelope: { attack: 0.4, decay: 0.5, sustain: 0.8, release: 2 } },
  },
  {
    id: "overcast", label: "muffled organ", when: { minCloud: 0.5 }, gain: -2, tone: 1100, tremolo: [0, 0],
    options: { oscillator: { type: "fatsquare", count: 2, spread: 15 }, envelope: { attack: 1, decay: 0.5, sustain: 0.8, release: 2.5 } },
  },
  {
    id: "icy", label: "thin, icy shimmer", when: { maxTemp: 0 }, gain: 2, tone: 4000, tremolo: [6, 0.15],
    options: { oscillator: { type: "fattriangle", count: 2, spread: 8 }, envelope: { attack: 2, decay: 0.5, sustain: 0.8, release: 3 } },
  },
  {
    id: "lush", label: "lush strings", when: { minRh: 60 }, gain: -1, tone: 1800, tremolo: [0, 0],
    options: { oscillator: { type: "fatsawtooth", count: 5, spread: 35 }, envelope: { attack: 1.5, decay: 0.5, sustain: 0.85, release: 3 } },
  },
  {
    id: "airy", label: "airy, open pad", when: {}, gain: 2, tone: 3000, tremolo: [0, 0],
    options: { oscillator: { type: "fattriangle", count: 2, spread: 12 }, envelope: { attack: 0.8, decay: 0.5, sustain: 0.8, release: 2.5 } },
  },
];

// ---- Drive and tone (distortion + 3-band EQ) --------------------------------
// The band (melody, bass, pad) passes through a distortion whose wet mix
// follows each hour's energy (see DYNAMICS, which includes CAPE): calm hours
// stay clean, and rough or unstable weather adds grit.
//   amount   Tone.Distortion amount (0–1): `amount` on a stable day, rising to
//            `maxAmount` as the day's peak CAPE goes from capeFrom to capeFull
//   wetFrom  energy where the grit starts; wetMax at full energy
export const DRIVE = { amount: 0.25, maxAmount: 0.6, wetFrom: 0.3, wetMax: 0.35 };

// The master EQ3 moves hour by hour (dB):
//   high  cloud dulls the top end (up to cloudCutDb at 100% cloud); fog cuts more
//   low   wind and storms add weight (up to windBoostDb at windFull km/h gusts)
export const TONE = {
  cloudCutDb: -4, fogCutDb: -5, fogCodes: [45, 48],
  windFrom: 20, windFull: 70, windBoostDb: 3, stormBoostDb: 2,
  minDb: -9, maxDb: 5,
};
