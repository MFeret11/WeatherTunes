// The day's story: a mode per chord grouped into chapters, the dramatic arc
// (calm, build, peak, release), and the chord under every bar.

import * as M from "../mapping.js";
import { hourBrightness } from "./analyze.js";
import { majorTriad } from "./harmony.js";

export const modeFor = (br, tMean) => M.MODE_THRESHOLDS.find(
  (t) => br >= t.min && (t.minMeanTemp == null || tMean >= t.minMeanTemp)).mode;
export const MODE_ORDER = M.MODE_THRESHOLDS.map((t) => t.mode); // brightest first

/** After a cold front the story stays `FRONT.darker` modes darker (rebuilding the chapters). */
export function afterFront(arc, front) {
  if (front == null) return arc;
  const c0 = Math.floor(front / M.BARS_PER_CHORD);
  const cap = MODE_ORDER.indexOf("aeolian");
  const from = MODE_ORDER.indexOf(arc.chordModes[c0]);
  const dark = MODE_ORDER[Math.max(from, Math.min(from + M.FRONT.darker, cap))];
  const chordModes = arc.chordModes.map((m, c) =>
    (c >= c0 && MODE_ORDER.indexOf(m) < MODE_ORDER.indexOf(dark) ? dark : m));
  const chapters = [{ chord: 0, mode: chordModes[0], turn: null }];
  for (let c = 1; c < chordModes.length; c++) {
    if (chordModes[c] === chordModes[c - 1]) continue;
    const turn = MODE_ORDER.indexOf(chordModes[c]) < MODE_ORDER.indexOf(chordModes[c - 1]) ? "brighter" : "darker";
    chapters.push({ chord: c, mode: chordModes[c], turn, front: c === c0 || undefined });
  }
  return { ...arc, chordModes, chapters };
}

/**
 * The day's story: a mode per chord, grouped into chapters.
 * Starts from the day's mode and moves only when a chord's sky clearly
 * belongs to another mode. Returns { chordModes, chapters: [{ chord, mode, turn }] }.
 */
export function storyArc(H, A, margin = M.STORY.margin) {
  const S = { ...M.STORY, margin };
  const n = M.BARS / M.BARS_PER_CHORD;
  const raw = Array.from({ length: n }, (_, c) =>
    Math.min(...H.slice(c * M.BARS_PER_CHORD, (c + 1) * M.BARS_PER_CHORD).map((h) => hourBrightness(h, A.stormHour)))
      - (c * M.BARS_PER_CHORD >= (A.moodFrom ?? 0) ? A.moodDark ?? 0 : 0));
  const br = raw.map((_, c) => {
    let sum = 0, w = 0;
    S.smooth.forEach((k, i) => {
      const j = c + i - 1;
      if (j >= 0 && j < n) { sum += k * raw[j]; w += k; }
    });
    return sum / w;
  });
  const t = A.stats.tMean;
  let cur = A.mode;
  let since = S.minChords; // the home chapter may turn at once
  const chordModes = [];
  const chapters = [{ chord: 0, mode: cur, turn: null }];
  for (let c = 0; c < n; c++) {
    const target = modeFor(br[c], t);
    const clear = modeFor(br[c] - S.margin, t) !== cur && modeFor(br[c] + S.margin, t) !== cur;
    if (target !== cur && clear && since >= S.minChords) {
      const turn = MODE_ORDER.indexOf(target) < MODE_ORDER.indexOf(cur) ? "brighter" : "darker";
      cur = target;
      since = 0;
      if (c === 0) chapters[0] = { chord: 0, mode: cur, turn: null };
      else chapters.push({ chord: c, mode: cur, turn });
    }
    chordModes.push(cur);
    since++;
  }
  return { chordModes, chapters, brightness: br };
}

/**
 * The day's dramatic arc, per hour: "calm", "build", "peak" or "release".
 * moments lists where the phase changes, for the page and the liner notes.
 */
export function dayArc(H, A) {
  const R = M.ARC;
  const raw = A.intensity;
  const top = Math.max(...raw);
  const dramatic = top >= R.dramaMin;
  const phases = H.map(() => "calm");
  const breeze = H.map(() => false);
  if (dramatic) {
    let peaks = raw.map((r, b) => (r >= top * R.peakShare ? b : -1)).filter((b) => b >= 0);
    peaks = peaks.flatMap((p, i) => {
      const next = peaks[i + 1];
      return next != null && next - p <= R.mergeGap ? Array.from({ length: next - p }, (_, k) => p + k) : [p];
    });
    H.forEach((h, b) => {
      if (peaks.includes(b)) phases[b] = "peak";
      else if (peaks.some((p) => p > b && p - b <= R.buildHours)) phases[b] = "build";
      else if (peaks.some((p) => p < b && b - p <= R.releaseHours)) {
        phases[b] = "release";
        const p = Math.max(...peaks.filter((x) => x < b));
        breeze[b] = H[p].temp - h.temp >= R.coolDropC || h.gust >= M.DYNAMICS.gustFrom;
      }
    });
  }
  const moments = [];
  phases.forEach((ph, b) => {
    if (b === 0 || ph !== phases[b - 1]) moments.push({ bar: b, phase: ph, breeze: breeze[b] });
  });
  return { dramatic, stormy: top >= R.drumsMin, phases, breeze, moments, peakBar: dramatic ? raw.indexOf(top) : null };
}

/** The chord (scale degree, in its own mode) for every bar, following the chapters. */
export function storyChords(arc, A, seed) {
  const n = M.BARS / M.BARS_PER_CHORD;
  const degs = [];
  const modes = arc.chordModes.slice();
  for (const [i, ch] of arc.chapters.entries()) {
    const end = arc.chapters[i + 1]?.chord ?? n;
    const loops = M.PROGRESSIONS[ch.mode][A.trend];
    const prog = loops[(seed + i) % loops.length];
    for (let c = ch.chord; c < end; c++) {
      const k = c - ch.chord;
      degs[c] = i > 0 && k === 0 ? 0 : prog[k % prog.length];
    }
    // A clearing resolves: the chord before it becomes V (or IV) of the new mode.
    if (ch.turn === "brighter" && ch.chord > 0) {
      degs[ch.chord - 1] = majorTriad(ch.mode, 4) ? 4 : majorTriad(ch.mode, 3) ? 3 : 6;
      modes[ch.chord - 1] = ch.mode;
    }
  }
  degs[n - 1] = 0; // the piece ends home, in its last chapter
  const bars = [];
  for (let b = 0; b < M.BARS; b++) {
    const c = Math.floor(b / M.BARS_PER_CHORD);
    bars.push({ mode: modes[c], deg: degs[c] });
  }
  return bars;
}
