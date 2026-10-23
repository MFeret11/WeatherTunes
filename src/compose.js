// compose(forecast) → score. Pure: no Tone.js, no DOM, no clock.
// Same forecast in, same score out (randomness comes from a seeded RNG).

import * as M from "./mapping.js";
import {
  MODE_LABELS, keyName, midiToNote, melodyDegrees, scalePitches, triadPcs,
  chordLabel, hashString, mulberry32, clamp, mean,
} from "./theory.js";

export function seedFor(f) {
  return hashString(`${Number(f.lat).toFixed(1)},${Number(f.lon).toFixed(1)},${f.date}`);
}

/** Day-level stats and the global musical choices (mode, key, tempo, chords). */
export function analyze(f) {
  const H = f.hours;
  const temps = H.map((h) => h.temp);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const stats = {
    tMin, tMax,
    tMinHour: temps.indexOf(tMin),
    tMaxHour: temps.indexOf(tMax),
    tMean: mean(temps),
    cloud: mean(H.map((h) => h.cloud)) / 100,
    pop: mean(H.map((h) => h.pop)) / 100,
    precipSum: H.reduce((a, h) => a + h.precip, 0),
    rh: mean(H.map((h) => h.rh)),
    wind: mean(H.map((h) => h.wind)),
    gustMax: Math.max(...H.map((h) => h.gust)),
    pressure: mean(H.map((h) => h.pressure)),
    pressureChange: mean(H.slice(-3).map((h) => h.pressure)) - mean(H.slice(0, 3).map((h) => h.pressure)),
  };

  const stormHour = (h) =>
    M.THUNDER_CODES.includes(h.code) ||
    h.precip >= M.STORM.hourlyPrecipMm ||
    (h.gust >= M.STORM.gustKmh && h.precip > 0);
  const storm = H.some(stormHour);
  const snow = H.filter((h) => M.SNOW_CODES.includes(h.code)).length >= 3;

  const B = M.BRIGHTNESS;
  const brightness = 1 - B.cloud * stats.cloud - B.pop * stats.pop
    - B.precip * Math.min(1, stats.precipSum / B.precipFullMm) - (storm ? B.storm : 0);
  const mode = M.MODE_THRESHOLDS.find(
    (t) => brightness >= t.min && (t.minMeanTemp == null || stats.tMean >= t.minMeanTemp),
  ).mode;

  const root = ((Math.round(stats.pressure) % 12) + 12) % 12;
  const T = M.TEMPO;
  const bpm = Math.round(clamp(T.base + T.perKmh * stats.wind, T.min, T.max));
  const trend = stats.pressureChange > M.PRESSURE_TREND_HPA ? "rising"
    : stats.pressureChange < -M.PRESSURE_TREND_HPA ? "falling" : "steady";
  const loops = M.PROGRESSIONS[mode][trend];
  const progression = loops[seedFor(f) % loops.length];
  const registerOffset = clamp(
    Math.round((stats.tMean - M.MELODY.registerCenterC) * M.MELODY.registerPerC),
    -M.MELODY.registerMax, M.MELODY.registerMax,
  );
  const voices = pickVoices(stats, storm, snow);
  const { raw: intensity, energy } = dynamicsCurve(H);
  return { stats, storm, stormHour, snow, brightness, mode, root, bpm, trend, progression, registerOffset, voices, intensity, energy };
}

/** Melody instrument from the mean temperature; pad instrument from sky and moisture. */
export function pickVoices(stats, storm, snow) {
  const melody = M.MELODY_VOICES.find((v) => stats.tMean < v.maxTemp);
  const holds = ({ when: w }) =>
    (w.storm == null || w.storm === storm) &&
    (w.snow == null || w.snow === snow) &&
    (w.minPop == null || stats.pop >= w.minPop || stats.precipSum >= w.minRainMm) &&
    (w.minCloud == null || stats.cloud >= w.minCloud) &&
    (w.maxTemp == null || stats.tMean < w.maxTemp) &&
    (w.minRh == null || stats.rh >= w.minRh);
  const pad = M.PAD_VOICES.find(holds);
  return { melody, pad };
}

/**
 * Weather intensity per hour (raw) and the spread curve the music follows (energy).
 * Energy rises a couple of bars before rough weather and fades a few bars after.
 */
export function dynamicsCurve(H) {
  const D = M.DYNAMICS;
  const raw = H.map((h) => Math.max(
    clamp(h.precip / D.rainFullMm, 0, 1),
    clamp((h.gust - D.gustFrom) / (D.gustFull - D.gustFrom), 0, 1),
    M.THUNDER_CODES.includes(h.code) ? 1 : 0,
  ));
  const energy = raw.map((r, b) => {
    let e = r;
    D.lead.forEach((w, i) => {
      const j = b + D.lead.length - i;
      if (j < raw.length) e = Math.max(e, raw[j] * w);
    });
    D.tail.forEach((w, i) => {
      const j = b - 1 - i;
      if (j >= 0) e = Math.max(e, raw[j] * w);
    });
    return +e.toFixed(3);
  });
  return { raw, energy };
}

/** Scale degree of the chord under a bar. The last two bars always resolve home. */
export function chordDegreeAt(bar, progression) {
  if (bar >= M.BARS - M.BARS_PER_CHORD) return 0;
  return progression[Math.floor(bar / M.BARS_PER_CHORD) % progression.length];
}

/**
 * Display units for the liner notes only; the music is the same either way.
 * "metric" = °C and km/h, "us" = °F and mph.
 */
export function formatTemp(c, units) {
  return units === "us" ? `${Math.round((c * 9) / 5 + 32)}\u00a0°F` : `${Math.round(c * 10) / 10}\u00a0°C`;
}
export function formatSpeed(kmh, units) {
  return units === "us" ? `${Math.round(kmh / 1.609)}\u00a0mph` : `${Math.round(kmh)}\u00a0km/h`;
}

export function compose(f, { units = "metric" } = {}) {
  const A = analyze(f);
  const { stats, mode, root, progression, snow, energy } = A;
  const D = M.DYNAMICS;
  // One row busier in the loudest stretches.
  const G = M.GROOVE;
  const gateFor = (h) => {
    const humid = clamp((h.rh - G.rhLow) / (G.rhHigh - G.rhLow), 0, 1);
    const cold = clamp((G.clipFromC - h.temp) / (G.clipFromC - G.clipFullC), 0, 1);
    return +Math.max(G.gateMin, G.gateDry + (G.gateHumid - G.gateDry) * humid - G.clipMax * cold).toFixed(3);
  };
  const warm = clamp((stats.tMean - G.clipFromC) / (G.swingWarmC - G.clipFromC), 0, 1);
  const swing = +(G.swingMax * warm * clamp((stats.rh - G.swingFromRh) / (G.swingFullRh - G.swingFromRh), 0, 1)).toFixed(3);
  const busierRow = (rows, i, b) => (energy[b] >= D.busier ? Math.min(i + 1, rows.length - 1) : i);
  const H = f.hours;
  const seed = seedFor(f);
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const chordDeg = (b) => chordDegreeAt(b, progression);
  const chordPcs = (b) => triadPcs(root, mode, chordDeg(b));

  // ---- Melody ------------------------------------------------------------
  const MEL = M.MELODY;
  const degrees = melodyDegrees(mode, snow);
  const pitches = scalePitches(root, mode, degrees);
  const octave = degrees.length; // index steps per octave
  const rootMidi = 60 + root - (root >= 6 ? 12 : 0); // tonic between F#3 and F4
  const baseIdx = pitches.indexOf(rootMidi);

  const span = Math.max(stats.tMax - stats.tMin, MEL.minSpanC);
  const lo = stats.tMin - (span - (stats.tMax - stats.tMin)) / 2; // centre flat days
  const tempNorm = (t) => clamp((t - lo) / span, 0, 1);
  const tempIdx = (t) => baseIdx + A.registerOffset + Math.round(tempNorm(t) * MEL.spanSteps);

  // Nearest index whose pitch class is in `pcs` (searching 0, -1, +1, -2, +2, ...).
  const snapTo = (idx, pcs) => {
    for (let d = 0; d < octave * 2; d++) {
      for (const s of d === 0 ? [0] : [-d, d]) {
        const p = pitches[idx + s];
        if (p != null && pcs.includes(p % 12)) return idx + s;
      }
    }
    return idx;
  };
  const inRange = (idx) => {
    while (pitches[idx] < MEL.low) idx += octave;
    while (pitches[idx] > MEL.high) idx -= octave;
    return idx;
  };
  const tonicPcs = [root, (root + 7) % 12];

  const melody = [];
  let prev = null;
  const anchors = H.map((h, b) => snapTo(inRange(tempIdx(h.temp)), chordPcs(b)));

  for (let b = 0; b < M.BARS; b++) {
    const h = H[b];
    const last = b === M.BARS - 1;
    const n = last ? 1
      : M.DENSITY[busierRow(M.DENSITY, M.DENSITY.findIndex((r) => h.gust < r.maxGust), b)].notes;
    const rhythm = last ? [16] : pick(M.RHYTHMS[n]);
    const anchor = anchors[b];
    const next = last ? anchor : anchors[b + 1];
    const sectionEnd = M.SECTIONS.some((s) => s.start === b + 1) || last;
    const vel = MEL.velLow + (MEL.velHigh - MEL.velLow) * tempNorm(h.temp) + D.velBoost * energy[b];

    let pos = 0;
    rhythm.forEach((dur, k) => {
      let idx;
      if (k === 0) {
        idx = last ? snapTo(anchor, [root]) : anchor;
      } else if (rng() < M.REST_PER_CLOUD * (h.cloud / 100) && !(sectionEnd && k === rhythm.length - 1)) {
        pos += dur;
        return; // rest
      } else {
        const target = anchor + Math.round(((next - anchor) * k) / rhythm.length);
        if (target === prev) {
          idx = rng() < M.NEIGHBOR_CHANCE ? prev + (rng() < 0.5 ? -1 : 1) : prev;
        } else {
          idx = prev + clamp(target - prev, -2, 2);
        }
        idx = inRange(idx);
        if (pos === 8) idx = snapTo(idx, chordPcs(b)); // beat 3 is a chord tone
        if (sectionEnd && k === rhythm.length - 1) {
          const pcs = chordPcs(b).filter((pc) => tonicPcs.includes(pc));
          // Root or fifth if the chord has one, otherwise any chord tone (a half cadence).
          idx = snapTo(idx, pcs.length ? pcs : chordPcs(b));
        }
      }
      // No leaps wider than a sixth: move the note an octave toward the last one.
      if (prev != null) {
        while (pitches[idx] - pitches[prev] > MEL.maxLeap) idx -= octave;
        while (pitches[prev] - pitches[idx] > MEL.maxLeap) idx += octave;
      }
      const midi = pitches[idx];
      melody.push({
        bar: b, pos, dur, midi, note: midiToNote(midi), gate: last ? 0.95 : gateFor(h),
        vel: +Math.min(0.95, vel + (k === 0 ? MEL.accent : 0)).toFixed(3),
      });
      prev = idx;
      pos += dur;
    });
  }

  // ---- Bass --------------------------------------------------------------
  const bass = [];
  for (let b = 0; b < M.BARS; b++) {
    const pc = chordPcs(b)[0];
    const m = 36 + pc; // root between C2 and B2
    const pattern = b === M.BARS - 1
      ? [[0, 16, 0]]
      : M.BASS.patterns[busierRow(M.BASS.patterns, M.BASS.patterns.findIndex((p) => H[b].wind < p.maxWind), b)].hits;
    for (const [pos, dur, iv] of pattern) {
      bass.push({ bar: b, pos, dur, midi: m + iv, note: midiToNote(m + iv), vel: M.BASS.vel, gate: gateFor(H[b]) });
    }
  }

  // ---- Pad: one held chord every 2 bars ----------------------------------
  const pad = [];
  for (let b = 0; b < M.BARS; b += M.BARS_PER_CHORD) {
    const cloud = mean(H.slice(b, b + M.BARS_PER_CHORD).map((h) => h.cloud)) / 100;
    const notes = chordPcs(b).map((pc) => {
      let m = M.PAD.center + ((pc - (M.PAD.center % 12) + 12) % 12);
      if (m > M.PAD.center + 6) m -= 12;
      return midiToNote(m);
    });
    pad.push({
      bar: b, pos: 0, dur: 16 * M.BARS_PER_CHORD, notes,
      vel: +Math.min(0.95, M.PAD.velMin + M.PAD.velPerCloud * cloud
        + D.velBoost * Math.max(energy[b], energy[b + 1] ?? 0)).toFixed(3),
    });
  }

  // ---- Rain shakers (or snow bells) ---------------------------------------
  const rain = [];
  const bells = [];
  const bellPitches = pitches.filter((p) => p >= M.BELLS.low && p <= M.BELLS.high);
  for (let b = 0; b < M.BARS; b++) {
    const h = H[b];
    if (h.pop < M.RAIN.minPop && h.precip === 0) continue;
    if (M.SNOW_CODES.includes(h.code)) {
      const count = Math.max(1, Math.round((h.pop / 100) * M.BELLS.maxHits));
      const slots = shuffle([0, 2, 4, 6, 8, 10, 12, 14], rng).slice(0, count).sort((x, y) => x - y);
      for (const pos of slots) {
        const midi = pick(bellPitches);
        bells.push({ bar: b, pos, dur: 4, midi, note: midiToNote(midi), vel: M.BELLS.vel });
      }
      continue;
    }
    let count = Math.round((h.pop / 100) * M.RAIN.maxHits);
    if (h.precip > 0) count = Math.max(1, count);
    // Off-beat sixteenths first, so shakers sit between the melody's strong beats.
    const off = shuffle([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], rng);
    const on = shuffle([0, 4, 8, 12], rng);
    const slots = off.concat(on).slice(0, count).sort((x, y) => x - y);
    const v = Math.min(M.RAIN.velMax, M.RAIN.velBase + M.RAIN.velPerMm * h.precip);
    for (const pos of slots) {
      rain.push({ bar: b, pos, dur: 1, vel: +clamp(v + (rng() - 0.5) * 0.1, 0.05, 1).toFixed(3) });
    }
  }

  // ---- Atmosphere (noise bed) and wind whoosh, one value per bar ----------
  const atmosphere = H.map((h, b) => {
    let row = M.ATMOSPHERE.find((r) => r.codes.includes(h.code));
    if (A.stormHour(h)) row = M.ATMOSPHERE.find((r) => r.kind === "storm");
    else if (!row && h.precip >= 0.1) row = M.ATMOSPHERE.find((r) => r.kind === "rain");
    const W = M.WIND_NOISE;
    const wind = +(clamp((h.gust - W.from) / (W.full - W.from), 0, 1) * W.max).toFixed(3);
    if (!row) return { bar: b, kind: null, color: null, level: 0, cutoff: 6000, wind };
    return {
      bar: b, kind: row.kind, color: row.color, cutoff: row.cutoff, wind,
      level: +Math.min(row.max, row.base + row.perMm * h.precip).toFixed(3),
    };
  });

  // ---- One-off effects ----------------------------------------------------
  const fx = [];
  H.forEach((h, b) => {
    if (A.stormHour(h)) fx.push({ bar: b, pos: 8, type: "thunder" });
  });
  for (const [label, t] of [["sunrise", f.sunrise], ["sunset", f.sunset]]) {
    if (t == null) continue;
    const bar = Math.floor(t);
    fx.push({ bar, pos: clamp(Math.round((t - bar) * 16), 0, 15), type: "swell", label });
  }

  // ---- Per-bar automation ---------------------------------------------------
  const F = M.FILTER;
  const R = M.REVERB;
  const automation = {
    pan: H.map((h) => +(M.PAN_WIDTH * Math.sin((h.dir * Math.PI) / 180)).toFixed(3)),
    cutoff: H.map((h) => Math.round(
      (F.clearHz - (F.clearHz - F.overcastHz) * (h.cloud / 100)) * (h.isDay ? 1 : F.nightFactor))),
    energy,
    gainDb: energy.map((e, b) => +(D.maxBoostDb * e + (b === 0 ? D.introDb : 0)).toFixed(2)),
    padOpen: energy.map((e) => +(D.padOpenOctaves * e).toFixed(3)),
    reverbWet: +(R.min + (R.max - R.min) * clamp((stats.rh - R.rhLow) / (R.rhHigh - R.rhLow), 0, 1)).toFixed(3),
  };

  const chords = Array.from({ length: M.BARS }, (_, b) => chordLabel(mode, chordDeg(b)));
  const meta = {
    name: f.name, date: f.date, seed,
    root, rootName: keyName(root), mode, modeLabel: MODE_LABELS[mode],
    bpm: A.bpm, bars: M.BARS, sections: M.SECTIONS,
    trend: A.trend, progressionDegrees: progression,
    progression: progression.map((d) => chordLabel(mode, d)),
    chords, brightness: +A.brightness.toFixed(3), storm: A.storm, snow,
    stats, voices: A.voices, swing,
  };
  meta.notes = linerNotes(f, A, meta, { melody, rain, bells, atmosphere, fx, automation }, units);
  return { meta, melody, bass, pad, rain, bells, atmosphere, fx, automation };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Liner notes: plain-English reasons for today's song -------------------

export function hourLabel(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (hh === 0 && mm === 0) return "midnight";
  if (hh === 12 && mm === 0) return "noon";
  const suffix = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

/** Group bar numbers into readable ranges: [3,4,5,9] → "bars 4–6 and 10" (1-based). */
function barRanges(bars) {
  const r = [];
  for (const b of bars) {
    const lastR = r[r.length - 1];
    if (lastR && b === lastR[1] + 1) lastR[1] = b;
    else r.push([b, b]);
  }
  const parts = r.map(([a, z]) => (a === z ? `${a + 1}` : `${a + 1}–${z + 1}`));
  const word = bars.length === 1 ? "bar" : "bars";
  return `${word} ` + (parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]);
}

const MODE_HINTS = {
  lydian: ", the brightest mode",
  ionian: "",
  mixolydian: ", bright with a bluesy edge",
  dorian: ", minor but hopeful",
  aeolian: "",
  phrygian: ", the darkest mode used here",
};

function grooveNote(s, meta, melody) {
  const feel = meta.swing >= 0.3 ? "a lazy swing" : meta.swing > 0 ? "a light swing" : "a straight beat";
  const g = mean(melody.map((n) => n.gate));
  const touch = g >= 0.85 ? "long, slurred notes" : g >= 0.6 ? "even notes" : "short, clipped notes";
  return `Humidity ${Math.round(s.rh)}%${s.tMean < M.GROOVE.clipFromC ? " in cold air" : ""} → ${feel} with ${touch}.`;
}

function dynamicsNote(f, A, units) {
  const D = M.DYNAMICS;
  const peak = Math.max(...A.intensity);
  if (peak < D.calm) return "Calm all day → even dynamics, no big swells.";
  const at = A.intensity.indexOf(peak);
  const h = f.hours[at];
  const why = [];
  if (M.THUNDER_CODES.includes(h.code)) why.push("thunder");
  if (h.precip >= 0.5) why.push(`${Math.round(h.precip * 10) / 10}\u00a0mm of ${M.SNOW_CODES.includes(h.code) ? "snow" : "rain"}`);
  if (h.gust >= D.gustFrom) why.push(`gusts of ${formatSpeed(h.gust, units)}`);
  const loud = A.energy.map((e, b) => (e >= D.busier ? b : -1)).filter((b) => b >= 0);
  const head = `Weather peaks at ${hourLabel(at)} (${why.join(", ")})`;
  if (!loud.length) return `${head} → the band lifts a little around bar ${at + 1}.`;
  return `${head} → the band builds, swells and plays busier in ${barRanges(loud)}, then settles.`;
}

function linerNotes(f, A, meta, layers, units) {
  const s = A.stats;
  const r1 = (x) => Math.round(x * 10) / 10;
  const pct = (x) => Math.round(x * 100);
  const sky = s.cloud < 0.2 ? "Clear skies" : s.cloud < 0.5 ? "Partly cloudy"
    : s.cloud < 0.8 ? "Mostly cloudy" : "Overcast";
  const notes = [];

  notes.push(`${sky}${A.storm ? " with storms" : ""} (${pct(s.cloud)}% cloud, ` +
    `${pct(s.pop)}% average chance of ${A.snow ? "snow" : "rain"}) → ` +
    `${meta.rootName} ${meta.modeLabel}${MODE_HINTS[A.mode]}.`);
  notes.push(`Average pressure ${Math.round(s.pressure)} hPa → key of ${meta.rootName}.`);
  notes.push(`Average wind ${formatSpeed(s.wind, units)} → ${A.bpm} BPM. ` +
    `Gusts up to ${formatSpeed(s.gustMax, units)} set how busy the melody gets.`);
  notes.push(`High of ${formatTemp(s.tMax, units)} at ${hourLabel(s.tMaxHour)} is the melody's peak (bar ${s.tMaxHour + 1}); ` +
    `the low of ${formatTemp(s.tMin, units)} at ${hourLabel(s.tMinHour)} is where it sits lowest.`);
  const change = r1(s.pressureChange);
  const v = A.voices;
  const padWhy = { storm: "Stormy day", snow: "Snowy day", rain: "Wet day", overcast: "Grey sky",
    icy: "Clear, freezing sky", lush: "Clear, humid sky", airy: "Clear, dry sky" }[v.pad.id];
  notes.push(`Average ${formatTemp(s.tMean, units)} → ${v.melody.label} on the melody. ` +
    `${padWhy} → ${v.pad.label} on the pad.`);
  notes.push(`Pressure ${A.trend === "steady" ? "holds steady" : A.trend} over the day ` +
    `(${change > 0 ? "+" : ""}${change} hPa) → chords ${meta.progression.join("–")}.`);

  notes.push(dynamicsNote(f, A, units));
  notes.push(grooveNote(s, meta, layers.melody));

  const kinds = {};
  for (const a of layers.atmosphere) if (a.kind) (kinds[a.kind] ||= []).push(a.bar);
  const kindText = { fog: "Fog → a faint hiss", drizzle: "Drizzle → light white noise",
    rain: "Rain → pink-noise rainfall", showers: "Showers → bursts of pink noise",
    snow: "Snow → bells and a muffled hush", storm: "Storm hours → deep brown noise and thunder" };
  for (const [k, bars] of Object.entries(kinds)) notes.push(`${kindText[k]} in ${barRanges(bars)}.`);
  const shakerBars = [...new Set(layers.rain.map((n) => n.bar))];
  if (shakerBars.length) notes.push(`Chance of rain → shakers in ${barRanges(shakerBars)}; the likelier the rain, the more hits.`);
  const windy = layers.atmosphere.filter((a) => a.wind > 0).map((a) => a.bar);
  if (windy.length) notes.push(`Strong gusts → wind noise in ${barRanges(windy)}.`);

  if (f.sunrise != null) {
    notes.push(`Sunrise at ${hourLabel(f.sunrise)} (bar ${Math.floor(f.sunrise) + 1}) and sunset at ` +
      `${hourLabel(f.sunset)} (bar ${Math.floor(f.sunset) + 1}) each get a cymbal swell.`);
  } else {
    const dark = f.hours.every((h) => !h.isDay);
    notes.push(dark ? "No sunrise today (polar night), so the whole piece keeps its night-time tone."
      : "The sun never sets today (midnight sun), so there's no sunrise or sunset swell.");
  }
  notes.push(`Humidity ${Math.round(s.rh)}% → ${pct(layers.automation.reverbWet)}% reverb.`);
  return notes;
}
