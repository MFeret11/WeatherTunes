// Eventful days run longer (SPEC §6.8, STRETCH in mapping.js): eventful chords play
// twice and a dramatic day winds down after 11 pm. Runs after every layer is written.
// A day with nothing to stretch is left exactly as it was. Otherwise every event gets
// `t`, its start in sixteenths from the top of the song, and meta gets the time map
// (see timeline() in engine.js for how it's read).

import * as M from "../mapping.js";
import { midiToNote } from "../theory.js";

const HOUR = M.STEPS; // sixteenths per hour slot
const CHORD = M.STEPS * M.BARS_PER_CHORD; // sixteenths per chord
const NOTE_LAYERS = ["melody", "bass", "pad", "arp", "drums", "garage", "beat", "crackle", "rain", "bells", "chimes", "shimmer", "fx"];
// What a breath keeps: the sustained sounds and the weather's own texture.
const BREATH_KEEPS = new Set(["bass", "pad", "arp", "rain", "bells", "chimes", "shimmer"]);
const vel = (v, k) => +Math.min(1, Math.max(0.03, v * k)).toFixed(3);

const wet = (h) => h.precip >= 0.2 || h.code >= M.CODES.wetFrom;

/** How eventful each chord is: [{ chord, score, kind: "weather" | "quiet", why }]. */
export function eventfulness(ctx, { chimes, shimmer }) {
  const { H, A, T } = ctx;
  const S = M.STRETCH, W = S.weights;
  const n = M.BARS / M.BARS_PER_CHORD;
  const out = [];
  for (let c = 0; c < n; c++) {
    const b0 = c * M.BARS_PER_CHORD, hours = [b0, b0 + 1];
    const found = [];
    const add = (why, score, kind) => found.push({ why, score, kind });
    const felt = Math.max(...hours.map((b) => A.feltEnergy[b]));
    if (felt >= S.stormFrom) add("storm", W.storm * felt, "weather");
    if (T.front != null && hours.includes(T.front)) add("front", W.front, "weather");
    if (hours.some((b) => T.eye[b])) add("eye", W.eye, "weather");
    const dryBefore = (b) => b >= S.dryHours && H.slice(b - S.dryHours, b).every((h) => !wet(h));
    if (hours.some((b) => H[b].precip >= S.wetMm && dryBefore(b))) add("wetStarts", W.wetStarts, "weather");
    if (hours.some((b) => b >= 1 && M.CODES.fog.includes(H[b - 1].code) && !M.CODES.fog.includes(H[b].code))) add("fogLifts", W.fogLifts, "quiet");
    const grey = (h) => h.cloud >= S.greyCloud || wet(h);
    if (hours.some((b) => b >= S.greyHours && H[b].isDay && H[b].cloud <= S.clearCloud && !wet(H[b])
      && H.slice(b - S.greyHours, b).every(grey))) add("sunBreaks", W.sunBreaks, "quiet");
    const before = H[Math.max(0, b0 - 1)].temp;
    if (before - Math.min(H[b0].temp, H[b0 + 1].temp) >= S.tempDropC) add("tempDrop", W.tempDrop, "weather");
    if (chimes.some((x) => hours.includes(x.bar) && x.kind === "meteor") || shimmer.some((x) => hours.includes(x.bar) && x.kind === "aurora")) add("sky", W.sky, "quiet");
    found.sort((x, y) => y.score - x.score);
    out.push({ chord: c, score: found[0]?.score ?? 0, kind: found[0]?.kind ?? null, why: found[0]?.why ?? null });
  }
  return out;
}

/**
 * The melody's answer: the same rhythm, each chord tone moved to the next chord tone
 * up or down (so strong beats stay on the chord), other notes `answerSteps` scale
 * steps, and the last note leading into the next chord.
 */
function answer(ctx, notes, c, up) {
  const { tables, keyAt, chordPcs } = ctx;
  const S = M.STRETCH;
  const pc = (x) => ((x % 12) + 12) % 12;
  const nextBar = Math.min(M.BARS - 1, (c + 1) * M.BARS_PER_CHORD);
  const land = chordPcs(nextBar);
  return notes.map((n, i) => {
    const p = tables[keyAt(n.bar)].p;
    const pcs = chordPcs(n.bar);
    let k = p.indexOf(n.midi);
    if (k < 0) k = p.reduce((best, x, j) => (Math.abs(x - n.midi) < Math.abs(p[best] - n.midi) ? j : best), 0);
    const dir = up ? 1 : -1;
    let j = k + dir * S.answerSteps;
    if (pcs.includes(pc(n.midi))) {
      j = k + dir;
      while (j > 0 && j < p.length - 1 && !pcs.includes(pc(p[j]))) j += dir;
    }
    let midi = p[Math.max(0, Math.min(p.length - 1, j))];
    if (!pcs.includes(pc(midi)) && pcs.includes(pc(n.midi))) midi = n.midi; // ran out of range: keep the note
    if (i === notes.length - 1) {
      // Lead into the next chord: a note both chords share, else one of this chord's.
      const shared = p.filter((x) => land.includes(pc(x)) && pcs.includes(pc(x)));
      const near = shared.length ? shared : p.filter((x) => pcs.includes(pc(x)));
      if (near.length) midi = near.reduce((best, x) => (Math.abs(x - midi) < Math.abs(best - midi) ? x : best));
    }
    const { glide, from, ...rest } = n;
    return { ...rest, midi, note: midiToNote(midi) };
  });
}

/**
 * Reshape a chord's second-pass copies (already in `layers`, marked `again`) so the
 * pass moves with the weather: build, ease or breath (see STRETCH.second).
 */
function secondPass(layers, c, mode, start) {
  const P = M.STRETCH.second[mode];
  const mine = (l) => (layers[l] ?? []).filter((e) => e.again && Math.floor(e.bar / M.BARS_PER_CHORD) === c);
  const drop = (l, keep) => { // in place: compose() holds these same arrays
    const kept = layers[l].filter((e) => !(e.again && Math.floor(e.bar / M.BARS_PER_CHORD) === c) || keep(e));
    layers[l].length = 0;
    layers[l].push(...kept);
  };
  const at = (e) => e.t - start; // 0..15 within the pass
  const free = (l, k) => !mine(l).some((e) => e.t === start + k);
  const hourOf = (k) => c * M.BARS_PER_CHORD + Math.floor(k / HOUR);
  if (mode === "build") {
    for (const l of ["drums", "rain", "garage", "beat", "bass", "pad", "arp"]) for (const e of mine(l)) e.vel = vel(e.vel, P.vel);
    // Rain fills free sixteenths (louder after heavier rain), up to rainExtra more hits.
    const rain = mine("rain");
    if (rain.length) {
      const v = Math.max(...rain.map((e) => e.vel));
      const add = Math.round(rain.length * P.rainExtra);
      for (let k = 1, made = 0; k < CHORD && made < add; k += 2) {
        if (free("rain", k)) { layers.rain.push({ bar: hourOf(k), pos: k % HOUR, t: start + k, dur: 1, vel: vel(v, 0.8), again: true }); made++; }
      }
    }
    // A fill into the next chord: the storm drums if they play here, else the rim.
    const drums = mine("drums");
    const last = CHORD - P.fillSteps;
    if (drums.length) {
      const d = drums[0];
      drop("drums", (e) => at(e) < last);
      for (let i = 0; i < P.fillSteps; i++) {
        const k = last + i;
        layers.drums.push({ ...d, bar: hourOf(k), pos: k % HOUR, t: start + k, dur: 1,
          vel: +(P.fillVel[0] + ((P.fillVel[1] - P.fillVel[0]) * i) / (P.fillSteps - 1)).toFixed(3), again: true });
      }
    } else if (mine("garage").length || mine("beat").length) {
      const kit = layers.garage.some((e) => e.again && Math.floor(e.bar / M.BARS_PER_CHORD) === c) ? "garage" : "beat";
      drop(kit, (e) => at(e) < last || e.kind === "kick");
      for (let i = 0; i < P.fillSteps; i++) {
        const k = last + i;
        layers[kit].push({ bar: hourOf(k), pos: k % HOUR, t: start + k, kind: "snare",
          vel: +((P.fillVel[0] + ((P.fillVel[1] - P.fillVel[0]) * i) / (P.fillSteps - 1)) * 0.7).toFixed(3), again: true });
      }
    }
    // The bass jumps octaves: every other note up twelve.
    mine("bass").forEach((e, i) => { if (i % 2 === 1 && e.midi + 12 <= 60) { e.midi += 12; e.note = midiToNote(e.midi); } });
  } else if (mode === "ease") {
    let i = 0;
    drop("drums", () => i++ % 2 === 0);
    i = 0;
    drop("rain", () => (i++ % Math.round(1 / P.rainKeep)) === 0);
    drop("garage", (e) => e.kind === "kick");
    drop("beat", (e) => e.kind === "kick");
    drop("bass", (e) => e.pos % 4 === 0);
    for (const e of mine("bass")) e.dur = Math.min(e.dur * 2, HOUR - e.pos);
    for (const l of ["drums", "rain", "garage", "beat", "bass", "pad", "arp"]) for (const e of mine(l)) e.vel = vel(e.vel, P.vel);
  } else {
    for (const e of mine("pad")) {
      e.midis = e.midis.map((m) => m + 12);
      e.notes = e.midis.map(midiToNote);
      e.vel = vel(e.vel, P.padVel);
      e.colour = e.colour?.map((x) => ({ ...x, midi: x.midi + 12, note: midiToNote(x.midi + 12), vel: vel(x.vel, P.padVel) }));
    }
    // One held bass note per hour.
    const seen = new Set();
    drop("bass", (e) => { const h = e.bar; if (seen.has(h)) return false; seen.add(h); return true; });
    for (const e of mine("bass")) { e.pos = 0; e.t = start + (e.bar % M.BARS_PER_CHORD) * HOUR; e.dur = HOUR; e.vel = vel(e.vel, P.bassVel); }
    for (const e of mine("rain")) e.vel = vel(e.vel, P.rainVel);
  }
}

/**
 * Stretch the score in place: second passes for eventful chords and a wind-down.
 * `layers` is { melody, bass, pad, ... } as compose() returns them.
 */
export function stretch(ctx, layers) {
  const { A, energy } = ctx;
  const S = M.STRETCH;
  const scores = eventfulness(ctx, layers);
  const n = M.BARS / M.BARS_PER_CHORD;
  let quiet = 0;
  const picked = scores.filter((x) => x.chord > 0 && x.chord < n - 1 && x.score >= S.min)
    .sort((x, y) => y.score - x.score || x.chord - y.chord)
    .filter((x) => x.kind !== "quiet" || quiet++ < S.maxQuiet)
    .slice(0, S.maxChords);
  // Where the weather is heading decides what the second pass does (STRETCH.second).
  const feltOf = (c) => Math.max(...[0, 1].map((i) => A.feltEnergy[Math.min(M.BARS - 1, c * M.BARS_PER_CHORD + i)]));
  for (const x of picked) {
    x.mode = x.kind === "quiet" ? "breath" : feltOf(x.chord + 1) < S.second.easeBelow * feltOf(x.chord) ? "ease" : "build";
  }
  const again = new Map(picked.map((x) => [x.chord, x]));
  const feltPeak = Math.max(...A.felt);
  const codaBars = feltPeak >= S.coda.long ? S.coda.bars[1] : feltPeak >= S.coda.from ? S.coda.bars[0] : 0;
  if (!again.size && !codaBars) return null;

  // The time map: where each chord's first and second pass start.
  const first = [], second = [];
  let at = 0;
  for (let c = 0; c < n; c++) {
    first[c] = at;
    at += CHORD;
    if (again.has(c)) { second[c] = at; at += CHORD; }
  }
  const codaAt = at;
  const length = at + codaBars * 16;
  const chordOf = (bar) => Math.floor(bar / M.BARS_PER_CHORD);
  const within = (e) => (e.bar % M.BARS_PER_CHORD) * HOUR + e.pos;

  for (const l of NOTE_LAYERS) {
    const list = layers[l];
    if (!list) continue;
    const copies = [];
    for (const e of list) {
      const c = chordOf(e.bar);
      e.t = first[c] + within(e);
      const x = again.get(c);
      if (!x || l === "melody" || l === "fx") continue;
      if (x.mode === "breath" && !BREATH_KEEPS.has(l)) continue;
      copies.push({ ...e, t: second[c] + within(e), again: true });
    }
    list.push(...copies);
  }
  for (const [c, x] of again) secondPass(layers, c, x.mode, second[c]);
  // Thunder rolls again in a storm's second pass; the melody answers.
  for (const [c, x] of again) {
    if (x.kind !== "weather") continue;
    for (const f of layers.fx.filter((f) => chordOf(f.bar) === c && f.type === "thunder" && !f.again)) {
      layers.fx.push({ ...f, t: second[c] + within(f), again: true });
    }
    const notes = layers.melody.filter((m) => chordOf(m.bar) === c && !m.again);
    const nextBar = Math.min(M.BARS - 1, (c + 1) * M.BARS_PER_CHORD);
    const up = energy[nextBar] >= energy[c * M.BARS_PER_CHORD];
    for (const m of answer(ctx, notes, c, up)) layers.melody.push({ ...m, t: second[c] + within(m), again: true });
  }

  // The wind-down: the last chord held and slowed, the last melody notes at half speed.
  if (codaBars) {
    const len = codaBars * 16;
    const C = S.coda;
    const lastPad = layers.pad.filter((p) => !p.again).at(-1);
    if (lastPad) layers.pad.push({ ...lastPad, t: codaAt, dur: len, vel: +(lastPad.vel * C.vel).toFixed(3), coda: true,
      colour: lastPad.colour?.map((x) => ({ ...x, vel: +(x.vel * C.vel).toFixed(3) })) });
    const lastBass = layers.bass.filter((b) => !b.again).at(-1);
    if (lastBass) layers.bass.push({ ...lastBass, t: codaAt, dur: len, vel: +(lastBass.vel * C.vel).toFixed(3), coda: true });
    const tail = layers.melody.filter((m) => !m.again).slice(-C.melodyNotes);
    const t0 = tail.length ? tail[0].t : 0;
    for (const m of tail) {
      const { glide, from, ...rest } = m;
      const t = codaAt + Math.min(len - 4, (m.t - t0) * 2);
      layers.melody.push({ ...rest, t, dur: Math.min(m.dur * 2, len - (t - codaAt)), vel: +(m.vel * C.vel).toFixed(3), coda: true });
    }
    if (layers.rain.some((r) => r.bar >= M.BARS - 4)) {
      for (let k = 0; k < C.drips; k++) {
        layers.rain.push({ bar: M.BARS - 1, pos: 0, t: codaAt + 3 + Math.floor((k * len) / C.drips), dur: 1, vel: C.dripVel, drip: true, coda: true });
      }
    }
  }

  // The ending (ENDING) lets the last melody note and pad chord ring out.
  for (const l of ["melody", "pad"]) {
    layers[l].sort((x, y) => x.t - y.t);
    if (layers[l].length) layers[l].at(-1).last = true;
  }
  for (const l of NOTE_LAYERS) layers[l]?.sort((x, y) => x.t - y.t);

  // Hour slots in play order: each hour's settings (automation) apply at every pass.
  const slots = [];
  for (let c = 0; c < n; c++) {
    for (const s of [first[c], second[c]]) {
      if (s == null) continue;
      const gainDb = s === second[c] ? S.second[again.get(c).mode].gainDb : 0;
      for (let i = 0; i < M.BARS_PER_CHORD; i++) {
        slots.push({ bar: c * M.BARS_PER_CHORD + i, t: s + i * HOUR, ...(gainDb ? { gainDb } : {}) });
      }
    }
  }
  return {
    length, slots,
    barAt: Array.from({ length: M.BARS }, (_, b) => first[chordOf(b)] + (b % M.BARS_PER_CHORD) * HOUR),
    again: picked.map((x) => ({ chord: x.chord, bar: x.chord * M.BARS_PER_CHORD, kind: x.kind, mode: x.mode, why: x.why, score: +x.score.toFixed(2) })).sort((x, y) => x.chord - y.chord),
    coda: codaBars ? { at: codaAt, bars: codaBars } : null,
  };
}
