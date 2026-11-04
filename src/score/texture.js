// Weather textures: rain shakers, snow bells and ice ticks, the atmosphere bed,
// one-off effects, and the eye of a hurricane.

import * as M from "../mapping.js";
import { midiToNote } from "../theory.js";
import { clamp, mulberry32, shuffle } from "../util.js";
import { outlierWind } from "./traits.js";

/**
 * Rain shakers, snow bells and ice ticks. Returns { rain, bells }.
 */
export function rainAndBells(ctx) {
  const { H, T, seed, rng, pick, keyAt, tables } = ctx;
  const rain = [];
  const bells = [];
  const bellPitches = (b) => tables[keyAt(b)].p.filter((p) => p >= M.BELLS.low && p <= M.BELLS.high);
  for (let b = 0; b < M.BARS; b++) {
    const h = H[b];
    if (h.pop < M.RAIN.minPop && h.precip === 0) continue;
    if (M.CODES.snow.includes(h.code)) {
      const count = Math.max(1, Math.round((h.pop / 100) * M.BELLS.maxHits));
      const slots = shuffle([0, 2, 4, 6], rng).slice(0, count).sort((x, y) => x - y);
      for (const pos of slots) {
        const midi = pick(bellPitches(b));
        bells.push({ bar: b, pos, dur: 4, midi, note: midiToNote(midi), vel: M.BELLS.vel });
      }
      continue;
    }
    if (T.ice[b]) continue; // ice ticks instead (below)
    const hail = M.CODES.hail.includes(h.code);
    let count = Math.round((h.pop / 100) * M.RAIN.maxHits);
    if (h.precip > 0) count = Math.max(1, count);
    if (hail) count = Math.min(8, count * M.HAIL.hits);
    // Off-beat sixteenths first, so shakers sit between the melody's strong beats.
    const off = shuffle([1, 2, 3, 5, 6, 7], rng);
    const on = shuffle([0, 4], rng);
    const slots = off.concat(on).slice(0, count).sort((x, y) => x - y);
    const v = Math.min(M.RAIN.velMax, M.RAIN.velBase + M.RAIN.velPerMm * h.precip) + (hail ? M.HAIL.velBoost : 0);
    for (const pos of slots) {
      rain.push({ bar: b, pos, dur: 1, vel: +clamp(v + (rng() - 0.5) * 0.1, 0.05, 1).toFixed(3) });
    }
  }
  // Ice storm: glassy ticks, high and short (see ICE_STORM). Their own random
  // stream, so the rest of the song is unchanged.
  const IS = M.ICE_STORM;
  const irng = mulberry32((seed ^ 0x1ce) >>> 0);
  for (let b = 0; b < M.BARS; b++) {
    if (!T.ice[b]) continue;
    const k = clamp(H[b].precip / IS.fullMm, 0, 1);
    const count = Math.round(IS.perHour[0] + (IS.perHour[1] - IS.perHour[0]) * k);
    const pitches = tables[keyAt(b)].p.filter((p) => p >= IS.low && p <= IS.high);
    const slots = shuffle([0, 1, 2, 3, 4, 5, 6, 7], irng).slice(0, count).sort((x, y) => x - y);
    for (const pos of slots) {
      const midi = pitches[Math.floor(irng() * pitches.length)];
      bells.push({ bar: b, pos, dur: 1, midi, note: midiToNote(midi), ice: true,
        vel: +(IS.vel[0] + (IS.vel[1] - IS.vel[0]) * (k * 0.6 + irng() * 0.4)).toFixed(3) });
    }
  }
  bells.sort((x, y) => x.bar - y.bar || x.pos - y.pos);
  return { rain, bells };
}

/**
 * The atmosphere (noise bed) and wind whoosh, one value per bar.
 */
export function atmosphereBed(ctx) {
  const { H, A, T, day } = ctx;
  const R = M.ARC;
  const atmosphere = H.map((h, b) => {
    let row = M.ATMOSPHERE.find((r) => r.codes.includes(h.code));
    if (A.stormHour(h)) row = M.ATMOSPHERE.find((r) => r.kind === "storm");
    else if (!row && h.precip >= 0.1) row = M.ATMOSPHERE.find((r) => r.kind === "rain");
    const W = M.WIND_NOISE;
    const wind = +Math.max(clamp((h.gust - W.from) / (W.full - W.from), 0, 1) * W.max,
      day.breeze[b] ? R.breezeLevel : 0, ...outlierWind(T, b, h)).toFixed(3);
    if (!row) return { bar: b, kind: null, color: null, level: 0, cutoff: 6000, wind };
    return {
      bar: b, kind: row.kind, color: row.color, cutoff: row.cutoff, wind,
      level: +Math.min(row.max, row.base + row.perMm * h.precip).toFixed(3),
    };
  });
  return atmosphere;
}

/**
 * One-off effects: thunder, and swells for clearings, releases, sunrise and sunset.
 */
export function oneOffFx(ctx) {
  const { f, H, A, day, arc } = ctx;
  const fx = [];
  H.forEach((h, b) => {
    if (A.stormHour(h)) fx.push({ bar: b, pos: M.STEPS / 2, type: "thunder" });
  });
  // A clearing swells into its new tonic.
  for (const ch of arc.chapters) {
    if (ch.turn === "brighter") fx.push({ bar: ch.chord * M.BARS_PER_CHORD - 1, pos: 0, type: "swell", label: "clearing" });
  }
  // The storm breaks: a swell where the release begins (unless a clearing already swells there).
  for (const mo of day.moments) {
    if (mo.phase === "release" && !fx.some((x) => x.type === "swell" && Math.abs(x.bar - mo.bar) <= 1)) {
      fx.push({ bar: mo.bar, pos: 0, type: "swell", label: "release" });
    }
  }
  for (const [label, t] of [["sunrise", f.sunrise], ["sunset", f.sunset]]) {
    if (t == null) continue;
    const bar = Math.floor(t);
    fx.push({ bar, pos: clamp(Math.round((t - bar) * M.STEPS), 0, M.STEPS - 1), type: "swell", label });
  }
  return fx;
}

/**
 * The eye of a hurricane (see EYE): the storm layers fall away in its hours (in place).
 */
export function eyeOfStorm(ctx, { drums, garage, beat, rain, fx, atmosphere }) {
  const { eye } = ctx.T;
  if (eye.some(Boolean)) {
    const calm = (x) => !eye[x.bar];
    for (const list of [drums, garage, beat, rain]) {
      const kept = list.filter(calm);
      list.length = 0;
      list.push(...kept);
    }
    for (let i = fx.length - 1; i >= 0; i--) if (eye[fx[i].bar] && fx[i].type === "thunder") fx.splice(i, 1);
    for (const a of atmosphere) if (eye[a.bar]) { a.level = +(a.level * M.EYE.keep).toFixed(3); a.wind = +(a.wind * M.EYE.keep).toFixed(3); }
  }
}
