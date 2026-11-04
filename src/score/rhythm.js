// The rhythm section: bass, storm drums, the rain and dry beats, and vinyl crackle.

import * as M from "../mapping.js";
import { midiToNote } from "../theory.js";
import { clamp, mulberry32 } from "../util.js";

/**
 * The bass: the chord's root (or a pedal on the home note), patterned by wind and energy.
 */
export function bassLine(ctx) {
  const { H, root, gateFor, busierRow, deep, chordPcs, bassFeel, pedal } = ctx;
  const DC = M.DEEP_COLD;
  const bass = [];
  for (let b = 0; b < M.BARS; b++) {
    const pc = pedal[b] ? root : chordPcs(b)[0]; // a pedal holds the home note under the chord
    const m = 36 + pc; // root between C2 and B2
    const feel = bassFeel[b];
    let pattern;
    if (b === M.BARS - 1) pattern = [[0, M.STEPS, 0]];
    else if (feel === "half") pattern = b % M.BARS_PER_CHORD === 0 ? M.BASS_FEEL.half : [];
    else if (feel === "double") pattern = M.BASS_FEEL.double;
    else pattern = M.BASS.patterns[busierRow(M.BASS.patterns, M.BASS.patterns.findIndex((p) => H[b].wind < p.maxWind), b)].hits;
    for (const [pos, dur, iv] of pattern) {
      bass.push({ bar: b, pos, dur, midi: m + iv, note: midiToNote(m + iv), vel: +(M.BASS.vel * (1 - DC.bassCut * deep[b])).toFixed(3), gate: gateFor(H[b]) });
    }
  }
  return bass;
}

/**
 * Storm drums: a low pulse that gathers into a roll as a peak approaches.
 */
export function stormDrums(ctx) {
  const { root, energy, day } = ctx;
  const R = M.ARC;
  const drums = [];
  for (let b = 0; b < M.BARS; b++) {
    const ph = day.phases[b];
    if (!day.stormy || (ph !== "build" && ph !== "peak")) continue;
    const row = R.drums.find((r) => energy[b] >= r.minEnergy);
    if (!row) continue;
    const [v0, v1] = R.drumVel;
    row.hits.forEach((pos, k) => {
      // Within a roll the hits crescendo too.
      const vel = v0 + (v1 - v0) * energy[b] * (0.7 + (0.3 * k) / row.hits.length);
      drums.push({ bar: b, pos, dur: 1, midi: 36 + root, vel: +vel.toFixed(3) }); // timpani-like, on the home note
    });
  }
  for (const d of drums) d.note = midiToNote(d.midi);
  return drums;
}

/**
 * The rain beat (see RAIN_BEAT): a 2-hour garage pattern under grey, wet hours.
 */
export function rainBeat(ctx) {
  const { H, rng, day } = ctx;
  const RB = M.RAIN_BEAT;
  const garage = [];
  for (let b = 0; b < M.BARS - 1; b++) {
    const h = H[b];
    if (h.cloud < RB.hourCloud || (h.precip < 0.1 && h.pop < RB.hourPop)) continue;
    if (M.SNOW_CODES.includes(h.code)) continue;
    if (day.stormy && (day.phases[b] === "build" || day.phases[b] === "peak")) continue;
    const off = (b % 2) * M.STEPS; // where this hour sits in the 2-hour pattern
    const hit = (kind, steps, v) => {
      for (const st of steps) {
        if (st < off || st >= off + M.STEPS) continue;
        garage.push({ bar: b, pos: st - off, kind, vel: +clamp(v + (rng() - 0.5) * 2 * RB.humanize, 0.05, 1).toFixed(3) });
      }
    };
    const wet = 0.7 + 0.3 * (h.pop / 100);
    if (h.precip >= RB.kickMm) hit("kick", RB.kick, RB.vel.kick * wet);
    hit("snare", RB.snare, RB.vel.snare * wet);
    hit("hat", RB.hats, RB.vel.hat * wet);
    hit("ghost", RB.ghosts, RB.vel.ghost * wet);
  }
  garage.sort((x, y) => x.bar - y.bar || x.pos - y.pos);
  return garage;
}

/**
 * The dry beat (see DRY_BEAT), on dry hours the rain beat leaves free.
 */
export function dryBeat(ctx, garage) {
  const { H, A, deep, heat, seed, day } = ctx;
  const DC = M.DEEP_COLD;
  const HT = M.HEAT;
  const RB = M.RAIN_BEAT;
  // Dry beat (see DRY_BEAT): wind sets the hats, warmth the kick, clear sky the backbeat.
  // Its own random stream (for the humanizing only), so the rest of the song is unchanged.
  const DB = M.DRY_BEAT;
  const brng = mulberry32((seed ^ 0xbea7) >>> 0);
  const rainBeatBars = new Set(garage.map((x) => x.bar));
  const beat = [];
  for (let b = 0; b < M.BARS - 1; b++) {
    const h = H[b];
    if (rainBeatBars.has(b) || h.precip >= 0.1 || h.pop >= RB.hourPop || M.SNOW_CODES.includes(h.code)) continue;
    if (day.stormy && (day.phases[b] === "build" || day.phases[b] === "peak")) continue;
    const hit = (kind, pos, v) => {
      const human = (brng() - 0.5) * 2 * DB.humanize; // drawn for every hit, so the cold only removes hits
      const cold = v * (1 - DC.beat[kind === "snare" ? "rim" : kind] * deep[b]) * (kind === "hat" ? 1 - HT.hat * heat[b] : 1)
        * (b >= A.moodFrom ? 1 - M.MOOD.thin * A.harsh : 1);
      if (!deep[b] || cold >= DC.minVel) beat.push({ bar: b, pos, kind, vel: +clamp(cold + human, 0.05, 1).toFixed(3) });
    };
    const k = DB.kick.find((r) => (h.feels ?? h.temp) < r.maxFeels);
    if (!k.perChord || b % M.BARS_PER_CHORD === 0) for (const p of k.steps) hit("kick", p, DB.kickVel);
    const clear = clamp((DB.rimMaxCloud - h.cloud) / DB.rimMaxCloud, 0, 1);
    if (clear > 0) hit("snare", M.STEPS / 2, DB.rimVel * clear);
    const hv = Math.min(DB.hatMax, DB.hatVel + DB.hatPerGust * h.gust);
    for (const p of DB.hats.find((r) => h.wind < r.maxWind).steps) hit("hat", p, p % 4 === 2 ? hv * DB.hatOffAccent : hv);
  }
  beat.sort((x, y) => x.bar - y.bar || x.pos - y.pos);
  return beat;
}

/**
 * Vinyl crackle (see CRACKLE) in humid grey or hazy air.
 */
export function vinylCrackle(ctx) {
  const { H, SK, rng } = ctx;
  const CR = M.CRACKLE;
  const crackle = [];
  for (let b = 0; b < M.BARS; b++) {
    // Humid grey air crackles; so does hazy, dusty air.
    const amount = Math.max(clamp((H[b].rh - CR.rhFrom) / (CR.rhFull - CR.rhFrom), 0, 1)
      * clamp((H[b].cloud - CR.cloudFrom) / (CR.cloudFull - CR.cloudFrom), 0, 1), M.AIR.crackle * SK.haze[b]);
    const count = Math.round(CR.perHour * amount);
    for (let k = 0; k < count; k++) {
      crackle.push({ bar: b, pos: +(rng() * M.STEPS).toFixed(3), vel: +(CR.vel[0] + (CR.vel[1] - CR.vel[0]) * rng() ** 3).toFixed(3) });
    }
  }
  crackle.sort((x, y) => x.bar - y.bar || x.pos - y.pos);
  return crackle;
}
