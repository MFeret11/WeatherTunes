// compose(forecast) → score. Pure: no Tone.js, no DOM, no clock.
// Same forecast in, same score out (randomness comes from a seeded RNG).

import * as M from "./mapping.js";
import { MODES, MODE_LABELS, keyName, midiToNote, chordLabel, stepAbove } from "./theory.js";
import { clamp, mean, mulberry32 } from "./util.js";
import { capeLevel, hourBrightness } from "./score/analyze.js";
import { arpRun, voiceChord } from "./score/harmony.js";
import { linerNotes, notesAsText } from "./score/liner.js";
import { scoreContext } from "./score/context.js";
import { rainAndBells, atmosphereBed, oneOffFx, eyeOfStorm } from "./score/texture.js";

export function compose(f, { units = "metric" } = {}) {
  const ctx = scoreContext(f);
  const { H, A, stats, root, snow, energy, gateFor, swing, busierRow, deep, heat, whiteout, iceHour, eye, front, SK, seed, rng, pick, day, stir, arc, lift, barChords, modeAt, mode, progression, twists, evening, chordDeg, rootAt, keyAt, colours, colourAt, chordPcs, tables, octave, pitchAt, bassFeel, pedal } = ctx;
  const D = M.DYNAMICS;
  const DC = M.DEEP_COLD;
  const HT = M.HEAT;
  const GL = M.GLIDE;
  const FL = M.FLUTTER;
  const WO = M.WHITEOUT;
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
  const anchors = H.map((h, b) => snapTo(inRange(tempIdx(h.temp) + lift(b) + Math.round(DC.registerSteps * deep[b]), b), chordPcs(b), b));

  for (let b = 0; b < M.BARS; b++) {
    const h = H[b];
    const last = b === M.BARS - 1;
    const row = M.DENSITY.findIndex((r) => h.gust < r.maxGust);
    // The release after a peak breathes out: one row sparser, never busier.
    let n = last ? 1
      : M.DENSITY[day.phases[b] === "release" ? Math.max(0, row - 1) : busierRow(M.DENSITY, row, b)].notes;
    if (!last && deep[b] >= DC.sparseFrom) n = 1; // one far-off bell an hour
    else if (!last && heat[b] >= HT.sparseFrom && n > 1) n -= 1; // too hot to move
    else if (!last && eye[b]) n = 1;
    else if (!last && !day.dramatic) {
      if (stir[b] >= C.busier) n = Math.max(n, Math.min(n + 1, C.maxNotes));
      else if (stir[b] <= C.sparser && n > 1) n -= 1;
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
      } else if (rng() < M.REST_PER_CLOUD * (h.cloud / 100) + DC.rest * deep[b] + HT.rest * heat[b] && !(sectionEnd && k === rhythm.length - 1)) {
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
        bar: b, pos, dur, midi, note: midiToNote(midi), gate: last ? 0.95 : Math.min(0.98, gateFor(h) + (day.phases[b] === "release" ? R.releaseGate : 0) + HT.slur * heat[b]),
        vel: +(Math.min(0.95, vel + (k === 0 ? MEL.accent : 0)) * (eye[b] ? M.EYE.vel : 1)).toFixed(3),
      });
      prev = idx;
      prevMidi = midi;
      pos += dur;
    });
  }

  // ---- Held notes: steady weather ties a repeated pitch instead of striking it again ----
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

  // ---- Bass --------------------------------------------------------------
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

  // ---- Drums: a low pulse that gathers into a roll as a peak approaches ----
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

  // ---- Rain beat and vinyl crackle (see RAIN_BEAT, CRACKLE) ----------------
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

  // ---- Pad: one held chord per chord change (every 2 hours) ----------------------------------
  // Voice-led: each note moves as little as it can from the last chord.
  // Colour notes (7th, 9th) sit just above the chord, as loud as the weather makes them.
  const pad = [];
  const K = M.CHORD_COLOUR;
  let prevVoicing = null;
  for (let b = 0; b < M.BARS; b += M.BARS_PER_CHORD) {
    const cloud = mean(H.slice(b, b + M.BARS_PER_CHORD).map((h) => h.cloud)) / 100;
    const col = colourAt(b);
    const midis = voiceChord(chordPcs(b), prevVoicing, col.open);
    prevVoicing = midis;
    const vel = +(Math.min(0.95, M.PAD.velMin + M.PAD.velPerCloud * cloud
      + D.velBoost * Math.max(energy[b], energy[b + 1] ?? 0))
      * (1 - DC.padCut * mean(deep.slice(b, b + M.BARS_PER_CHORD))) * (b >= A.moodFrom ? 1 - M.MOOD.thin * A.harsh : 1)).toFixed(3);
    const top = Math.max(...midis);
    const above = (pc) => top + 1 + ((((pc - top - 1) % 12) + 12) % 12); // the first pc above the chord
    const colour = [];
    const deg = chordDeg(b);
    for (const [kind, k, amount] of [["7th", 6, col.seventh], ["9th", 1, col.ninth]]) {
      if (amount < K.min) continue;
      const midi = above((rootAt(b) + MODES[modeAt(b)][(deg + k) % 7]) % 12);
      colour.push({ kind, midi, note: midiToNote(midi), vel: +(vel * K.vel * amount).toFixed(3) });
    }
    pad.push({ bar: b, pos: 0, dur: M.STEPS * M.BARS_PER_CHORD, midis, notes: midis.map(midiToNote), vel, colour });
  }

  // ---- Arpeggio: clear daylight runs up and down the chord (see ARP) --------
  const AR = M.ARP;
  const arp = [];
  // The day's shape (pressure trend + seed), reach (temperature swing) and lilt (dew point).
  const arng = mulberry32((seed ^ 0xa7b) >>> 0);
  const shapes = AR.shape[A.trend];
  const shape = shapes[Math.floor(arng() * shapes.length)];
  const reach = Math.round(AR.reach.notes[0] + (AR.reach.notes[1] - AR.reach.notes[0])
    * clamp((stats.tMax - stats.tMin - AR.reach.fromC) / (AR.reach.fullC - AR.reach.fromC), 0, 1));
  const lilt = mean(H.map((h) => h.dew ?? -99)) >= AR.lilt.dew;
  let step = 0;
  for (let b = 0; b < M.BARS - 1; b++) {
    const h = H[b];
    const amount = clamp(((1 - h.cloud / 100) * (h.isDay ? 1 : 0) - AR.from) / (AR.full - AR.from), 0, 1)
      * (b >= A.moodFrom ? clamp(1 - A.harsh / M.MOOD.arpOff, 0, 1) : 1);
    if (b % M.BARS_PER_CHORD === 0) step = 0; // each chord starts its run from the bottom (or top)
    if (amount <= 0 || h.precip >= 0.1 || M.SNOW_CODES.includes(h.code)) continue;
    if (day.stormy && (day.phases[b] === "build" || day.phases[b] === "peak")) continue;
    const pcs = chordPcs(b).slice();
    if (colourAt(b).seventh >= K.min) pcs.push((rootAt(b) + MODES[modeAt(b)][(chordDeg(b) + 6) % 7]) % 12);
    const lowest = AR.low + ((((pcs[0] - AR.low) % 12) + 12) % 12); // start on the chord's root
    const ladder = [];
    for (let m = lowest; m <= AR.high && ladder.length < reach; m++) if (pcs.includes(m % 12)) ladder.push(m);
    const run = arpRun(ladder, shape);
    const every = AR.rate.find((r) => h.wind < r.maxWind).every;
    const steps = lilt ? AR.lilt.steps : Array.from({ length: Math.ceil(M.STEPS / every) }, (_, i) => i * every);
    for (const [i, pos] of steps.entries()) {
      const dur = (steps[i + 1] ?? M.STEPS) - pos;
      const midi = run[step++ % run.length];
      arp.push({ bar: b, pos, dur, midi, note: midiToNote(midi),
        vel: +(AR.vel * amount + (pos % 4 === 0 ? AR.accent * amount : 0)).toFixed(3) });
    }
  }

  const { rain, bells } = rainAndBells(ctx);
  const atmosphere = atmosphereBed(ctx);
  const fx = oneOffFx(ctx);
  // ---- Sky bells and shimmer (see the "Sky and air" section of mapping.js) ----
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

  eyeOfStorm(ctx, { drums, garage, beat, rain, fx, atmosphere });
  // ---- Per-bar automation ---------------------------------------------------
  const F = M.FILTER;
  const RV = M.REVERB;
  const automation = {
    pan: H.map((h) => +(M.PAN_WIDTH * Math.sin((h.dir * Math.PI) / 180)).toFixed(3)),
    // Night closes the filter; moonlight opens it part way again; haze closes it a little.
    cutoff: H.map((h, b) => Math.round(
      (F.clearHz - (F.clearHz - F.overcastHz) * (h.cloud / 100))
      * (h.isDay ? 1 : F.nightFactor + (1 - F.nightFactor) * M.MOON.cutoffLift * SK.moonlight[b])
      * (1 - M.AIR.cutoffCut * SK.haze[b]) * (1 - WO.cutoffCut * whiteout[b]))),
    energy,
    // Dramatic days dip in their calm hours, so the storm is a real crescendo.
    gainDb: energy.map((e, b) => +(D.maxBoostDb * e + (day.dramatic ? D.quietDb * (1 - e) : 0)
      + C.swellDb * (2 * stir[b] - 1) * (day.dramatic ? 0 : 1)
      + (b === 0 ? D.introDb : 0) + (eye[b] ? M.EYE.gainDb : 0)).toFixed(2)),
    reverbLift: day.phases.map((ph, b) => +((ph === "release" ? R.reverbLift : 0) + DC.reverbLift * deep[b]
      + WO.reverbLift * whiteout[b]).toFixed(3)),
    melodyDb: H.map((h, b) => +(M.MELODY.overcastDb * clamp((h.cloud - M.MELODY.overcastFrom) / (100 - M.MELODY.overcastFrom), 0, 1)
      + DC.melodyDb * deep[b] + WO.melodyDb * whiteout[b]).toFixed(2)),
    // Gusts well above the wind make the pad flutter (see FLUTTER).
    flutter: H.map((h) => +(clamp((h.gust - FL.gustFrom) / (FL.gustFull - FL.gustFrom), 0, 1)
      * clamp((h.gust - h.wind - FL.gapFrom) / (FL.gapFull - FL.gapFrom), 0, 1)).toFixed(3)),
    // Heat shimmer on the melody (see HEAT); left out on days without it.
    ...(heat.some((x) => x > 0) ? { wobble: heat } : {}),
    // Deep cold thins the wind to a high whistle (one value for the song).
    windBaseHz: Math.round(250 + (DC.wind.baseHz - 250) * mean(deep)),
    // Moonlight keeps the night from dimming the melody as far.
    melodyDayDb: H.map((h, b) => +(melodyDaylightDb(f, b, h) * (1 - M.MOON.nightLift * SK.moonlight[b])).toFixed(2)),
    padOpen: energy.map((e, b) => +(D.padOpenOctaves * e + C.padOpenOctaves * stir[b]).toFixed(3)),
    driveWet: energy.map((e) => +(M.DRIVE.wetMax * clamp((e - M.DRIVE.wetFrom) / (1 - M.DRIVE.wetFrom), 0, 1)).toFixed(3)),
    eqHigh: H.map((h, b) => +clamp(M.TONE.cloudCutDb * (h.cloud / 100) + (M.TONE.fogCodes.includes(h.code) ? M.TONE.fogCutDb : 0)
      + M.AIR.hazeCutDb * SK.haze[b] + M.SNOW_COVER.highCutDb * SK.cover + HT.highCutDb * heat[b],
      M.TONE.minDb, M.TONE.maxDb).toFixed(2)),
    eqLow: H.map((h, b) => +clamp(DC.lowCutDb * deep[b] + M.TONE.windBoostDb * clamp((h.gust - M.TONE.windFrom) / (M.TONE.windFull - M.TONE.windFrom), 0, 1)
      + (A.stormHour(h) ? M.TONE.stormBoostDb : 0), M.TONE.minDb, M.TONE.maxDb).toFixed(2)),
    // The melody's echo carries in clear, still, dry air (see ECHO).
    echoCarry: H.map((h, b) => {
      const E = M.ECHO;
      const wet = h.precip >= 0.1 || M.SNOW_CODES.includes(h.code) || E.fogCodes.includes(h.code);
      return wet ? 0 : +(Math.min(1, (1 - h.cloud / 100) * clamp((E.windyGust - h.gust) / (E.windyGust - E.calmGust), 0, 1)
        + DC.echoCarry * deep[b]) * (1 - HT.echo * Math.max(heat[b], A.dayHeat))).toFixed(3);
    }),
    // Snow on the ground soaks up the echoes.
    reverbWet: +((RV.min + (RV.max - RV.min) * clamp((stats.rh - RV.rhLow) / (RV.rhHigh - RV.rhLow), 0, 1))
      * (1 - M.SNOW_COVER.reverbCut * SK.cover)).toFixed(3),
  };

  // Cloud and night together stop at the floor.
  automation.melodyDayDb = automation.melodyDayDb.map((d, b) =>
    +Math.max(d, M.MELODY.floorDb - automation.melodyDb[b]).toFixed(2));

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
  meta.deepCold = deep;
  meta.outliers = { heat, whiteout, ice: iceHour, eye, front };
  meta.hourBrightness = H.map((h) => +clamp(hourBrightness(h, A.stormHour), 0, 1).toFixed(3));
  const { sky: _sky, ...skyMeta } = SK;
  meta.sky = { ...skyMeta, magLat: SK.sky.magLat };
  meta.liner = linerNotes(f, A, meta, { melody, arp, rain, bells, drums, garage, beat, crackle, atmosphere, fx, automation, chimes, shimmer }, units);
  meta.notes = notesAsText(meta.liner);
  return { meta, melody, bass, pad, arp, drums, garage, beat, crackle, rain, bells, atmosphere, fx, automation, chimes, shimmer };
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
