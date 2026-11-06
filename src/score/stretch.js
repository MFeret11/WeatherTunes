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
      if (x.kind === "quiet" && !BREATH_KEEPS.has(l)) continue;
      copies.push({ ...e, t: second[c] + within(e), again: true });
    }
    list.push(...copies);
  }
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
      for (let i = 0; i < M.BARS_PER_CHORD; i++) slots.push({ bar: c * M.BARS_PER_CHORD + i, t: s + i * HOUR });
    }
  }
  return {
    length, slots,
    barAt: Array.from({ length: M.BARS }, (_, b) => first[chordOf(b)] + (b % M.BARS_PER_CHORD) * HOUR),
    again: picked.map((x) => ({ chord: x.chord, bar: x.chord * M.BARS_PER_CHORD, kind: x.kind, why: x.why, score: +x.score.toFixed(2) })).sort((x, y) => x.chord - y.chord),
    coda: codaBars ? { at: codaAt, bars: codaBars } : null,
  };
}
