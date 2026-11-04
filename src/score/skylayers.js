// The sky's own layers: bells for the moon, meteors, frost, seasons and holidays,
// and shimmer for UV and auroras.

import * as M from "../mapping.js";
import { midiToNote } from "../theory.js";
import { clamp, mulberry32 } from "../util.js";

/**
 * Sky bells: moonrise, shooting stars, frost, a solstice or equinox, a holiday.
 */
export function skyChimes(ctx) {
  const { H, root, SK, seed, keyAt, chordPcs, tables } = ctx;
  // Their own random stream, so adding them never changes the rest of the song.
  const srng = mulberry32((seed ^ 0x5eed) >>> 0);
  const chimes = [];
  const chimePitches = (b, pcs) => tables[keyAt(b)].p.filter((p) => p >= M.CHIMES.low && p <= M.CHIMES.high && (!pcs || pcs.includes(p % 12)));
  const chime = (bar, pos, midi, vel, kind, dur = 4) => chimes.push({ bar, pos, dur, midi, note: midiToNote(midi), vel: +vel.toFixed(3), kind });
  const { moon } = SK;
  // Moonrise after dark: one bell on the key's fifth, louder for a fuller moon.
  // (Only if it can be seen: after dark, and not behind thick cloud.)
  if (moon.rise != null && moon.illum >= M.MOON.minIllum && SK.dark[Math.floor(moon.rise)] > 0.3
    && 1 - M.MOON.cloudBlock * (H[Math.floor(moon.rise)].cloud / 100) >= M.MOON.bellClear) {
    const bar = Math.floor(moon.rise);
    const p = chimePitches(bar, [(root + 7) % 12]);
    const [v0, v1] = M.MOON.bellVel;
    chime(bar, clamp(Math.round((moon.rise - bar) * M.STEPS), 0, M.STEPS - 1), p[Math.floor(p.length / 2)], v0 + (v1 - v0) * moon.illum, "moon", 8);
  }
  // Shooting stars: quick runs of three falling notes from the top of the range.
  if (SK.shower) {
    const MT = M.METEORS;
    let total = 0;
    for (let b = 0; b < M.BARS && total < MT.maxTotal; b++) {
      if (SK.dark[b] < 0.9 || H[b].cloud >= MT.maxCloud) continue;
      const rate = MT.perHour * (SK.shower.zhr / 100) * (SK.shower.peak ? 1 : MT.offPeak) * (1 - MT.moonDim * SK.moonlight[b]);
      const n = Math.min(MT.maxPerHour, Math.floor(rate) + (srng() < rate % 1 ? 1 : 0), MT.maxTotal - total);
      const top = chimePitches(b);
      for (let k = 0; k < n; k++) {
        const start = top.length - 1 - Math.floor(srng() * 3);
        const pos = Math.floor(srng() * (M.STEPS - 3));
        for (let j = 0; j < 3; j++) chime(b, pos + j, top[Math.max(0, start - j * 2)], MT.vel * (1 - j * 0.25), "meteor", 2);
        total++;
      }
    }
  }
  // Frost glints in the clear, still early hours.
  for (const b of SK.frostHours) {
    const p = chimePitches(b);
    for (let k = 0; k < (SK.firstFrost ? 2 : 1); k++) chime(b, Math.floor(srng() * M.STEPS), p[p.length - 1 - Math.floor(srng() * 3)], M.FROST.vel, "frost", 1);
  }
  // A solstice or equinox rings the root and fifth together at its moment.
  if (SK.season) {
    const bar = Math.floor(SK.season.hour);
    const pos = clamp(Math.round((SK.season.hour - bar) * M.STEPS), 0, M.STEPS - 1);
    for (const pc of [root, (root + 7) % 12]) chime(bar, pos, chimePitches(bar, [pc])[0], M.CALENDAR.seasonVel, "season", 8);
  }
  // A holiday signs off with a rising arpeggio over the final chord.
  if (SK.holiday) {
    const bar = M.BARS - 2;
    const arp = chimePitches(bar, chordPcs(bar)).slice(0, 5);
    arp.forEach((midi, k) => chime(bar + Math.floor((k * 3) / M.STEPS), (k * 3) % M.STEPS, midi, M.CALENDAR.holidayVel, "holiday", 6));
  }
  chimes.sort((x, y) => x.bar - y.bar || x.pos - y.pos);
  return chimes;
}

/**
 * Shimmer: UV doubles the melody an octave up; auroras hold a high chord.
 */
export function skyShimmer(ctx, melody) {
  const { SK, chordPcs } = ctx;
  const shimmer = [];
  // UV: sunny hours double the melody an octave up, softly.
  for (const n of melody) {
    const u = SK.uvShine[n.bar];
    if (u > 0 && n.midi + 12 <= 100) shimmer.push({ kind: "sun", bar: n.bar, pos: n.pos, dur: n.dur, notes: [midiToNote(n.midi + 12)], vel: +(M.UV.vel * u).toFixed(3) });
  }
  // Auroras: a slow high chord over each chord change they light up.
  for (let b = 0; b < M.BARS; b += M.BARS_PER_CHORD) {
    const level = Math.max(...SK.aurora.slice(b, b + M.BARS_PER_CHORD));
    if (level < M.AURORA.min) continue;
    const notes = chordPcs(b).map((pc) => { // voiced around C6, like the pad around C4
      const m = 84 + ((pc - (84 % 12) + 12) % 12);
      return midiToNote(m > 90 ? m - 12 : m);
    });
    shimmer.push({ kind: "aurora", bar: b, pos: 0, dur: M.STEPS * M.BARS_PER_CHORD, notes, vel: +(M.AURORA.vel * level).toFixed(3) });
  }
  return shimmer;
}
