// compose(forecast) → score. Pure: no Tone.js, no DOM, no clock.
// Same forecast in, same score out (randomness comes from a seeded RNG).

import * as M from "./mapping.js";
import { skyFor, auroraReach } from "./sky.js";
import {
  MODES, MODE_LABELS, keyName, midiToNote, melodyDegrees, scalePitches, triadPcs,
  chordLabel, stepAbove, hashString, mulberry32, clamp, mean,
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
    feelsMean: mean(H.map((h) => h.feels ?? h.temp)),
    dewMean: mean(H.map((h) => h.dew ?? h.temp)),
    cloud: mean(H.map((h) => h.cloud)) / 100,
    pop: mean(H.map((h) => h.pop)) / 100,
    precipSum: H.reduce((a, h) => a + h.precip, 0),
    wetHours: H.filter((h) => h.precip >= 0.1).length,
    rh: mean(H.map((h) => h.rh)),
    wind: mean(H.map((h) => h.wind)),
    gustMax: Math.max(...H.map((h) => h.gust)),
    pressure: mean(H.map((h) => h.pressure)),
    pressureChange: mean(H.slice(-3).map((h) => h.pressure)) - mean(H.slice(0, 3).map((h) => h.pressure)),
  };

  stats.rainRate = stats.wetHours ? stats.precipSum / stats.wetHours : 0; // mm per wet hour
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
  // The melody follows how the day feels (humidity and wind included).
  const melody = M.MELODY_VOICES.find((v) => (stats.feelsMean ?? stats.tMean) < v.maxTemp);
  const holds = ({ when: w }) =>
    (w.storm == null || w.storm === storm) &&
    (w.snow == null || w.snow === snow) &&
    (w.minWetHours == null || stats.wetHours >= w.minWetHours) &&
    (w.maxRainRate == null || stats.rainRate <= w.maxRainRate) &&
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
/** 0–1: how much storm fuel (CAPE, J/kg) is in the air. */
export function capeLevel(cape) {
  const D = M.DYNAMICS;
  return clamp(((cape ?? 0) - D.capeFrom) / (D.capeFull - D.capeFrom), 0, 1);
}

export function dynamicsCurve(H) {
  const D = M.DYNAMICS;
  const raw = H.map((h) => Math.max(
    clamp(h.precip / D.rainFullMm, 0, 1),
    clamp((h.gust - D.gustFrom) / (D.gustFull - D.gustFrom), 0, 1),
    M.THUNDER_CODES.includes(h.code) ? 1 : 0,
    capeLevel(h.cape) * D.capeWeight,
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

/**
 * Bass feel per hour ("half", "normal" or "double"), decided once per chord from
 * the weather in its hours. The final chord is never half-time, so the last bar can hold the root.
 */
export function bassFeels(H, energy, stats) {
  const F = M.BASS_FEEL;
  const out = [];
  for (let b = 0; b < M.BARS; b += M.BARS_PER_CHORD) {
    const hrs = H.slice(b, b + M.BARS_PER_CHORD);
    const en = energy.slice(b, b + M.BARS_PER_CHORD);
    let feel = "normal";
    if (Math.max(...en) >= F.doubleEnergy) feel = "double";
    else if (b + M.BARS_PER_CHORD < M.BARS && (stats.tMean < F.halfMeanTemp
      || hrs.some((h) => F.halfCodes.includes(h.code))
      || hrs.every((h) => h.gust < F.calmGust && h.precip === 0))) feel = "half";
    for (let i = 0; i < hrs.length; i++) out.push(feel);
  }
  return out;
}

/**
 * Calm-day detail: how stirred each hour is (0–1) relative to the day's own
 * range of gusts, rain chance, cloud shifts and warming. See CALM_DETAIL.
 */
export function calmStir(H) {
  const C = M.CALM_DETAIL;
  const rel = (key, floor) => {
    const xs = H.map((h) => h[key]);
    const lo = Math.min(...xs);
    const range = Math.max(Math.max(...xs) - lo, floor);
    return xs.map((x) => (x - lo) / range);
  };
  const gust = rel("gust", C.floors.gust);
  const pop = rel("pop", C.floors.pop);
  const raw = H.map((h, b) => {
    const p = H[Math.max(0, b - 1)];
    const n = H[Math.min(H.length - 1, b + 1)];
    const cloud = clamp(Math.abs(n.cloud - p.cloud) / 2 / C.cloudSwing, 0, 1);
    const warm = clamp(Math.abs(n.temp - p.temp) / 2 / C.warmSwingC, 0, 1);
    return Math.max(C.weights.gust * gust[b], C.weights.pop * pop[b], C.weights.cloud * cloud, C.weights.warm * warm);
  });
  return raw.map((_, b) => {
    let sum = 0, w = 0;
    C.smooth.forEach((k, i) => {
      const j = b + i - 1;
      if (j >= 0 && j < raw.length) { sum += k * raw[j]; w += k; }
    });
    return +(sum / w).toFixed(3);
  });
}

/** Brightness of one hour's sky (same weights as the day's, rainfall per hour). */
export function hourBrightness(h, stormHour) {
  const B = M.BRIGHTNESS;
  return 1 - B.cloud * (h.cloud / 100) - B.pop * (h.pop / 100)
    - B.precip * Math.min(1, h.precip / M.STORY.precipHourFullMm) - (stormHour(h) ? B.storm : 0);
}

const modeFor = (br, tMean) => M.MODE_THRESHOLDS.find(
  (t) => br >= t.min && (t.minMeanTemp == null || tMean >= t.minMeanTemp)).mode;
const MODE_ORDER = M.MODE_THRESHOLDS.map((t) => t.mode); // brightest first

/**
 * The day's story: a mode per chord, grouped into chapters.
 * Starts from the day's mode and moves only when a chord's sky clearly
 * belongs to another mode. Returns { chordModes, chapters: [{ chord, mode, turn }] }.
 */
export function storyArc(H, A, margin = M.STORY.margin) {
  const S = { ...M.STORY, margin };
  const n = M.BARS / M.BARS_PER_CHORD;
  const raw = Array.from({ length: n }, (_, c) =>
    Math.min(...H.slice(c * M.BARS_PER_CHORD, (c + 1) * M.BARS_PER_CHORD).map((h) => hourBrightness(h, A.stormHour))));
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

/**
 * A chord's colour from the weather in its hours (see CHORD_COLOUR):
 * { sus: null | "sus2" | "sus4", seventh: 0–1, ninth: 0–1, open: bool }.
 * Only intervals that sit well are used: a whole-tone 2nd or 9th, a perfect 4th.
 */
export function chordColour(hrs, mode, deg, final) {
  const K = M.CHORD_COLOUR;
  const avg = (fn) => mean(hrs.map(fn));
  const second = stepAbove(mode, deg, 1) === 2;
  const fourth = stepAbove(mode, deg, 3) === 5;
  let sus = null;
  let susBy = null;
  if (!final) {
    const foggy = hrs.some((h) => K.susFogCodes.includes(h.code));
    const moving = Math.abs(hrs[hrs.length - 1].pressure - hrs[0].pressure) * (2 / Math.max(1, hrs.length - 1)) >= K.sus4PressureHpa;
    if (foggy && second) sus = "sus2";
    else if ((foggy || moving) && fourth) sus = "sus4";
    if (sus) susBy = foggy ? "fog" : "pressure";
  }
  const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
  const seventh = +ramp(avg((h) => h.dew ?? h.temp), K.seventh.dewFrom, K.seventh.dewFull).toFixed(3);
  const clearDay = avg((h) => (1 - h.cloud / 100) * (h.isDay ? 1 : 0));
  const ninth = second && sus !== "sus2" ? +ramp(clearDay, K.ninth.from, K.ninth.full).toFixed(3) : 0;
  return { sus, susBy, seventh, ninth, open: avg((h) => h.wind) >= K.openWind };
}

/**
 * Place a chord's pitch classes between voicing.low and .high so the notes move
 * as little as possible from the previous chord (or sit near PAD.center for the
 * first one). An open chord must span more than voicing.openSpan semitones.
 */
export function voiceChord(pcs, prev, open) {
  const V = M.CHORD_COLOUR.voicing;
  const cands = pcs.map((pc) => {
    const out = [];
    for (let m = V.low; m <= V.high; m++) if (m % 12 === pc) out.push(m);
    return out;
  });
  let best = null;
  let bestCost = Infinity;
  const walk = (i, chosen) => {
    if (i === cands.length) {
      const span = Math.max(...chosen) - Math.min(...chosen);
      if (open && span <= V.openSpan) return;
      const centre = Math.abs(mean(chosen) - M.PAD.center);
      const move = prev ? chosen.reduce((a, n) => a + Math.min(...prev.map((p) => Math.abs(n - p))), 0) : 0;
      // Moving little matters most; then stay near the middle and keep a closed chord compact.
      const cost = move + 0.3 * centre + (open ? 0 : 0.2 * span);
      if (cost < bestCost) { bestCost = cost; best = chosen.slice(); }
      return;
    }
    for (const m of cands[i]) walk(i + 1, [...chosen, m]);
  };
  walk(0, []);
  return (best ?? cands.map((c) => c[0])).sort((a, b) => a - b);
}

function majorTriad(mode, deg) {
  const iv = MODES[mode];
  return (iv[(deg + 2) % 7] - iv[deg] + 12) % 12 === 4 && (iv[(deg + 4) % 7] - iv[deg] + 12) % 12 === 7;
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

/**
 * The sky and the air, hour by hour: moonlight, auroras, haze, UV, snow on the
 * ground and frost, plus the day's events (moonrise, eclipse, meteor shower,
 * solstice or equinox, holiday, first frost). Pure, from the forecast alone.
 */
export function daySky(f) {
  const H = f.hours;
  const X = f.extras ?? {};
  const sky = skyFor(f);
  const { moon } = sky;
  const dark = sky.sunAlt.map((a) => clamp(-a / M.DARK.darkSunAlt, 0, 1));
  const deepDark = sky.sunAlt.map((a) => clamp((-a - M.DARK.darkSunAlt) / (M.DARK.auroraSunAlt - M.DARK.darkSunAlt), 0, 1));
  const eclipse = moon.eclipse?.visible ? moon.eclipse : null;
  const moonlight = H.map((h, b) => {
    let l = moon.illum * clamp(moon.alt[b] / M.MOON.fullAlt, 0, 1) * dark[b] * (1 - M.MOON.cloudBlock * (h.cloud / 100));
    if (eclipse && Math.abs(b + 0.5 - eclipse.hour) <= 1) l *= M.MOON.eclipseLight;
    return +clamp(l, 0, 1).toFixed(3);
  });

  // Kp per hour: the 3-hour block (UTC) that holds the hour's middle.
  const kpAt = (b) => {
    const t = sky.start + (b + 0.5) * 3600000;
    return X.kp?.find((k) => t >= k.t && t < k.t + 3 * 3600000)?.kp ?? null;
  };
  const kp = H.map((_, b) => kpAt(b));
  const auroraReachH = kp.map((k) => (k == null ? 0 : auroraReach(sky.magLat, k)));
  const aurora = H.map((h, b) => +(auroraReachH[b] * deepDark[b] * (1 - h.cloud / 100) ** M.AURORA.clearPower).toFixed(3));

  const aqi = X.aqi ?? null;
  const haze = H.map((_, b) => (aqi ? +clamp((aqi[b] - M.AIR.from) / (M.AIR.full - M.AIR.from), 0, 1).toFixed(3) : 0));
  const uvShine = H.map((h) => +clamp((h.uv - M.UV.from) / (M.UV.full - M.UV.from), 0, 1).toFixed(3));
  const snowCm = mean(H.map((h) => h.snowDepth ?? 0));
  const cover = clamp(snowCm / M.SNOW_COVER.fullCm, 0, 1);

  const FR = M.FROST;
  const falling = (h) => h.precip >= 0.1 || M.SNOW_CODES.includes(h.code);
  const frostHours = H.map((h, b) => (b < FR.until && h.temp <= FR.maxTemp && h.cloud < FR.maxCloud && h.wind < FR.maxWind && !falling(h) ? b : -1)).filter((b) => b >= 0);
  const tMin = Math.min(...H.map((h) => h.temp));
  const past = X.minTemps;
  const firstFrost = tMin <= 0 && past != null && past.length >= FR.minHistory && past.every((t) => t > 0);

  const uvs = H.map((h) => h.uv ?? 0);
  const uvMax = Math.max(...uvs);
  const aqiMax = aqi ? Math.max(...aqi) : null;
  const moonUpAtNight = moonlight.some((l) => l > 0.05);
  return {
    sky, dark, moon, moonlight, eclipse, kp, kpMax: kp.some((k) => k != null) ? Math.max(...kp.filter((k) => k != null)) : null,
    aurora, auroraReach: auroraReachH,
    aqi, aqiMax, aqiMaxHour: aqi ? aqi.indexOf(aqiMax) : null, haze,
    uvMax: f.has?.uv === false ? null : uvMax, uvMaxHour: uvs.indexOf(uvMax), uvShine,
    snowCm: +snowCm.toFixed(1), cover,
    frostHours, firstFrost,
    holiday: X.holidays?.[0] ?? null,
    season: sky.season, shower: sky.shower, moonUpAtNight,
  };
}

/** US AQI category name. */
export function aqiCategory(v) {
  return v <= 50 ? "good" : v <= 100 ? "moderate" : v <= 150 ? "unhealthy for sensitive groups"
    : v <= 200 ? "unhealthy" : v <= 300 ? "very unhealthy" : "hazardous";
}
/** UV index category name. */
export function uvCategory(v) {
  return v < 3 ? "low" : v < 6 ? "moderate" : v < 8 ? "high" : v < 11 ? "very high" : "extreme";
}

export function compose(f, { units = "metric" } = {}) {
  const A = analyze(f);
  const { stats, root, snow, energy } = A;
  const D = M.DYNAMICS;
  // One row busier in the loudest stretches.
  const G = M.GROOVE;
  const gateFor = (h) => {
    const humid = clamp((h.rh - G.rhLow) / (G.rhHigh - G.rhLow), 0, 1);
    const cold = clamp((G.clipFromC - h.temp) / (G.clipFromC - G.clipFullC), 0, 1);
    return +Math.max(G.gateMin, G.gateDry + (G.gateHumid - G.gateDry) * humid - G.clipMax * cold).toFixed(3);
  };
  // Muggy air swings: the dew point measures how much water the air holds.
  const swing = +(G.swingMax * clamp((stats.dewMean - M.DEW.swingFromDew) / (M.DEW.swingFullDew - M.DEW.swingFromDew), 0, 1)).toFixed(3);
  const busierRow = (rows, i, b) => (energy[b] >= D.busier ? Math.min(i + 1, rows.length - 1) : i);
  const H = f.hours;
  const SK = daySky(f);
  const seed = seedFor(f);
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // ---- Story: a mode and chord for every bar -------------------------------
  const day = dayArc(H, A);
  const C = M.CALM_DETAIL;
  // On a calm day the music follows the day's small changes (zero on dramatic days).
  const stir = day.dramatic ? H.map(() => 0) : calmStir(H);
  const arc = storyArc(H, A, day.dramatic ? M.STORY.margin : C.margin);
  const R = M.ARC;
  const lift = (b) => Math.round(R.liftSteps * energy[b]);
  const barChords = storyChords(arc, A, seed);
  const modeAt = (b) => barChords[b].mode;
  // The song's main mode is the one heard longest; its opening loop names the progression.
  const counts = {};
  for (const x of barChords) counts[x.mode] = (counts[x.mode] || 0) + 1;
  const mode = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b))[0];
  const firstLoops = M.PROGRESSIONS[arc.chapters[0].mode][A.trend];
  const progression = firstLoops[seed % firstLoops.length];
  const chordDeg = (b) => barChords[b].deg;
  // Each chord's colour (sevenths, ninths, sus, spread) from its two hours.
  const colours = Array.from({ length: M.BARS / M.BARS_PER_CHORD }, (_, c) => {
    const b = c * M.BARS_PER_CHORD;
    return chordColour(H.slice(b, b + M.BARS_PER_CHORD), modeAt(b), chordDeg(b), b + M.BARS_PER_CHORD >= M.BARS);
  });
  const colourAt = (b) => colours[Math.floor(b / M.BARS_PER_CHORD)];
  // The chord's own tones: a sus chord swaps its third, and the melody's strong beats follow it.
  const chordPcs = (b) => {
    const t = triadPcs(root, modeAt(b), chordDeg(b));
    const { sus } = colourAt(b);
    if (sus) t[1] = (t[0] + (sus === "sus2" ? 2 : 5)) % 12;
    return t;
  };

  // ---- Melody ------------------------------------------------------------
  // Melody positions are scale steps relative to the tonic, so a line carries
  // across a change of mode: step 2 is the third in major or minor alike.
  const MEL = M.MELODY;
  const rootMidi = 60 + root - (root >= 6 ? 12 : 0); // tonic between F#3 and F4
  const tables = {};
  for (const m of new Set(barChords.map((x) => x.mode))) {
    const p = scalePitches(root, m, melodyDegrees(m, snow));
    tables[m] = { p, base: p.indexOf(rootMidi) };
  }
  const octave = melodyDegrees(mode, snow).length; // steps per octave
  const pitchAt = (b, r) => { const t = tables[modeAt(b)]; return t.p[t.base + r]; };
  const baseIdx = 0;

  const span = Math.max(stats.tMax - stats.tMin, MEL.minSpanC);
  const lo = stats.tMin - (span - (stats.tMax - stats.tMin)) / 2; // centre flat days
  const tempNorm = (t) => clamp((t - lo) / span, 0, 1);
  const tempIdx = (t) => baseIdx + A.registerOffset + Math.round(tempNorm(t) * MEL.spanSteps);

  // Nearest step whose pitch class is in `pcs` (searching 0, -1, +1, -2, +2, ...).
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
  const anchors = H.map((h, b) => snapTo(inRange(tempIdx(h.temp) + lift(b), b), chordPcs(b), b));

  for (let b = 0; b < M.BARS; b++) {
    const h = H[b];
    const last = b === M.BARS - 1;
    const row = M.DENSITY.findIndex((r) => h.gust < r.maxGust);
    // The release after a peak breathes out: one row sparser, never busier.
    let n = last ? 1
      : M.DENSITY[day.phases[b] === "release" ? Math.max(0, row - 1) : busierRow(M.DENSITY, row, b)].notes;
    if (!last && !day.dramatic) {
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
        idx = last ? snapTo(anchor, [root], b) : anchor;
        if (!last && sectionEnd && rhythm.length === 1) { // a one-note bar that ends a section still cadences
          const pcs = chordPcs(b).filter((pc) => tonicPcs.includes(pc));
          idx = snapTo(idx, pcs.length ? pcs : chordPcs(b), b);
        }
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
      melody.push({
        bar: b, pos, dur, midi, note: midiToNote(midi), gate: last ? 0.95 : Math.min(0.98, gateFor(h) + (day.phases[b] === "release" ? R.releaseGate : 0)),
        vel: +Math.min(0.95, vel + (k === 0 ? MEL.accent : 0)).toFixed(3),
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
  const bassFeel = bassFeels(H, energy, stats);
  for (let b = 0; b < M.BARS; b++) {
    const pc = chordPcs(b)[0];
    const m = 36 + pc; // root between C2 and B2
    const feel = bassFeel[b];
    let pattern;
    if (b === M.BARS - 1) pattern = [[0, M.STEPS, 0]];
    else if (feel === "half") pattern = b % M.BARS_PER_CHORD === 0 ? M.BASS_FEEL.half : [];
    else if (feel === "double") pattern = M.BASS_FEEL.double;
    else pattern = M.BASS.patterns[busierRow(M.BASS.patterns, M.BASS.patterns.findIndex((p) => H[b].wind < p.maxWind), b)].hits;
    for (const [pos, dur, iv] of pattern) {
      bass.push({ bar: b, pos, dur, midi: m + iv, note: midiToNote(m + iv), vel: M.BASS.vel, gate: gateFor(H[b]) });
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
    const hit = (kind, pos, v) => beat.push({ bar: b, pos, kind, vel: +clamp(v + (brng() - 0.5) * 2 * DB.humanize, 0.05, 1).toFixed(3) });
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
    const vel = +Math.min(0.95, M.PAD.velMin + M.PAD.velPerCloud * cloud
      + D.velBoost * Math.max(energy[b], energy[b + 1] ?? 0)).toFixed(3);
    const top = Math.max(...midis);
    const above = (pc) => top + 1 + ((((pc - top - 1) % 12) + 12) % 12); // the first pc above the chord
    const colour = [];
    const deg = chordDeg(b);
    for (const [kind, k, amount] of [["7th", 6, col.seventh], ["9th", 1, col.ninth]]) {
      if (amount < K.min) continue;
      const midi = above((root + MODES[modeAt(b)][(deg + k) % 7]) % 12);
      colour.push({ kind, midi, note: midiToNote(midi), vel: +(vel * K.vel * amount).toFixed(3) });
    }
    pad.push({ bar: b, pos: 0, dur: M.STEPS * M.BARS_PER_CHORD, midis, notes: midis.map(midiToNote), vel, colour });
  }

  // ---- Rain shakers (or snow bells) ---------------------------------------
  const rain = [];
  const bells = [];
  const bellPitches = (b) => tables[modeAt(b)].p.filter((p) => p >= M.BELLS.low && p <= M.BELLS.high);
  for (let b = 0; b < M.BARS; b++) {
    const h = H[b];
    if (h.pop < M.RAIN.minPop && h.precip === 0) continue;
    if (M.SNOW_CODES.includes(h.code)) {
      const count = Math.max(1, Math.round((h.pop / 100) * M.BELLS.maxHits));
      const slots = shuffle([0, 2, 4, 6], rng).slice(0, count).sort((x, y) => x - y);
      for (const pos of slots) {
        const midi = pick(bellPitches(b));
        bells.push({ bar: b, pos, dur: 4, midi, note: midiToNote(midi), vel: M.BELLS.vel });
      }
      continue;
    }
    let count = Math.round((h.pop / 100) * M.RAIN.maxHits);
    if (h.precip > 0) count = Math.max(1, count);
    // Off-beat sixteenths first, so shakers sit between the melody's strong beats.
    const off = shuffle([1, 2, 3, 5, 6, 7], rng);
    const on = shuffle([0, 4], rng);
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
    const wind = +Math.max(clamp((h.gust - W.from) / (W.full - W.from), 0, 1) * W.max,
      day.breeze[b] ? R.breezeLevel : 0).toFixed(3);
    if (!row) return { bar: b, kind: null, color: null, level: 0, cutoff: 6000, wind };
    return {
      bar: b, kind: row.kind, color: row.color, cutoff: row.cutoff, wind,
      level: +Math.min(row.max, row.base + row.perMm * h.precip).toFixed(3),
    };
  });

  // ---- One-off effects ----------------------------------------------------
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

  // ---- Sky bells and shimmer (see the "Sky and air" section of mapping.js) ----
  // Their own random stream, so adding them never changes the rest of the song.
  const srng = mulberry32((seed ^ 0x5eed) >>> 0);
  const chimes = [];
  const shimmer = [];
  const chimePitches = (b, pcs) => tables[modeAt(b)].p.filter((p) => p >= M.CHIMES.low && p <= M.CHIMES.high && (!pcs || pcs.includes(p % 12)));
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

  // ---- Per-bar automation ---------------------------------------------------
  const F = M.FILTER;
  const RV = M.REVERB;
  const automation = {
    pan: H.map((h) => +(M.PAN_WIDTH * Math.sin((h.dir * Math.PI) / 180)).toFixed(3)),
    // Night closes the filter; moonlight opens it part way again; haze closes it a little.
    cutoff: H.map((h, b) => Math.round(
      (F.clearHz - (F.clearHz - F.overcastHz) * (h.cloud / 100))
      * (h.isDay ? 1 : F.nightFactor + (1 - F.nightFactor) * M.MOON.cutoffLift * SK.moonlight[b])
      * (1 - M.AIR.cutoffCut * SK.haze[b]))),
    energy,
    // Dramatic days dip in their calm hours, so the storm is a real crescendo.
    gainDb: energy.map((e, b) => +(D.maxBoostDb * e + (day.dramatic ? D.quietDb * (1 - e) : 0)
      + C.swellDb * (2 * stir[b] - 1) * (day.dramatic ? 0 : 1)
      + (b === 0 ? D.introDb : 0)).toFixed(2)),
    reverbLift: day.phases.map((ph) => (ph === "release" ? R.reverbLift : 0)),
    melodyDb: H.map((h) => +(M.MELODY.overcastDb * clamp((h.cloud - M.MELODY.overcastFrom) / (100 - M.MELODY.overcastFrom), 0, 1)).toFixed(2)),
    // Moonlight keeps the night from dimming the melody as far.
    melodyDayDb: H.map((h, b) => +(melodyDaylightDb(f, b, h) * (1 - M.MOON.nightLift * SK.moonlight[b])).toFixed(2)),
    padOpen: energy.map((e, b) => +(D.padOpenOctaves * e + C.padOpenOctaves * stir[b]).toFixed(3)),
    driveWet: energy.map((e) => +(M.DRIVE.wetMax * clamp((e - M.DRIVE.wetFrom) / (1 - M.DRIVE.wetFrom), 0, 1)).toFixed(3)),
    eqHigh: H.map((h, b) => +clamp(M.TONE.cloudCutDb * (h.cloud / 100) + (M.TONE.fogCodes.includes(h.code) ? M.TONE.fogCutDb : 0)
      + M.AIR.hazeCutDb * SK.haze[b] + M.SNOW_COVER.highCutDb * SK.cover,
      M.TONE.minDb, M.TONE.maxDb).toFixed(2)),
    eqLow: H.map((h) => +clamp(M.TONE.windBoostDb * clamp((h.gust - M.TONE.windFrom) / (M.TONE.windFull - M.TONE.windFrom), 0, 1)
      + (A.stormHour(h) ? M.TONE.stormBoostDb : 0), M.TONE.minDb, M.TONE.maxDb).toFixed(2)),
    // Snow on the ground soaks up the echoes.
    reverbWet: +((RV.min + (RV.max - RV.min) * clamp((stats.rh - RV.rhLow) / (RV.rhHigh - RV.rhLow), 0, 1))
      * (1 - M.SNOW_COVER.reverbCut * SK.cover)).toFixed(3),
  };

  // Cloud and night together stop at the floor.
  automation.melodyDayDb = automation.melodyDayDb.map((d, b) =>
    +Math.max(d, M.MELODY.floorDb - automation.melodyDb[b]).toFixed(2));

  const chords = Array.from({ length: M.BARS }, (_, b) => chordLabel(modeAt(b), chordDeg(b)));
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
    chordDegrees: barChords.map((x) => x.deg),
    chapters: arc.chapters.map((c) => ({ bar: c.chord * M.BARS_PER_CHORD, mode: c.mode, label: MODE_LABELS[c.mode], turn: c.turn })),
    capeMax: Math.max(...f.hours.map((h) => h.cape ?? 0)),
    drive: +(M.DRIVE.amount + (M.DRIVE.maxAmount - M.DRIVE.amount) * capeLevel(Math.max(...f.hours.map((h) => h.cape ?? 0)))).toFixed(3),
  };
  meta.arc = day;
  meta.heldNotes = held;
  meta.stir = stir;
  meta.hourBrightness = H.map((h) => +clamp(hourBrightness(h, A.stormHour), 0, 1).toFixed(3));
  const { sky: _sky, ...skyMeta } = SK;
  meta.sky = { ...skyMeta, magLat: SK.sky.magLat };
  meta.liner = linerNotes(f, A, meta, { melody, rain, bells, drums, garage, beat, crackle, atmosphere, fx, automation, chimes, shimmer }, units);
  meta.notes = notesAsText(meta.liner);
  return { meta, melody, bass, pad, drums, garage, beat, crackle, rain, bells, atmosphere, fx, automation, chimes, shimmer };
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

export function hourLabel(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (hh === 0 && mm === 0) return "midnight";
  if (hh === 12 && mm === 0) return "noon";
  const suffix = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

// Instrument names as sentence subjects, with the right verb.
const MELODY_PHRASE = { glass: "glass bells play", flute: "a breathy flute plays", keys: "soft keys play", pluck: "plucked strings play",
  mallet: "a marimba plays", reed: "a reedy pipe plays" };
const PAD_PHRASE = { storm: "dark, detuned saws hold", snow: "a hushed choir holds", ghost: "ghostly, wordless voices hold",
  rain: "a wobbling electric piano holds", overcast: "a muffled organ holds", icy: "a thin, icy shimmer holds",
  lush: "lush strings hold", airy: "an airy, open pad holds" };

const MODE_HINTS = {
  lydian: ", the brightest mode",
  ionian: "",
  mixolydian: ", bright with a bluesy edge",
  dorian: ", minor but hopeful",
  aeolian: "",
  phrygian: ", the darkest mode used here",
};

/**
 * Liner notes: one short paragraph, { paragraphs: [text] }. It says what the
 * weather sets (key, instruments, tune, tempo), how the day is shaped, the most
 * notable thing in the sky if there is one, and the sunrise and sunset fade.
 */
function linerNotes(f, A, meta, layers, units) {
  const s = A.stats;
  const H = f.hours;
  const v = A.voices;
  const join = (parts) => parts.filter(Boolean).join(" ");
  const an = (w) => `${/^(8|11|18)(\D|$)/.test(w) ? "an" : "a"} ${w}`;
  const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");

  const feel = s.tMean < -10 ? "bitterly cold" : s.tMean < 0 ? "freezing" : s.tMean < 8 ? "cold" : s.tMean < 15 ? "cool"
    : s.tMean < 22 ? "mild" : s.tMean < 28 ? "warm" : s.tMean < 34 ? "hot" : "scorching";
  const sky = A.storm ? "stormy" : A.snow && s.pop >= 0.3 ? "snowy" : s.pop >= 0.5 ? "rainy"
    : s.cloud < 0.2 ? "clear" : s.cloud < 0.5 ? "partly cloudy" : s.cloud < 0.8 ? "mostly cloudy" : "overcast";
  const melodyNoun = MELODY_PHRASE[v.melody.id]?.replace(/ plays?$/, "") ?? v.melody.label;
  const padNoun = PAD_PHRASE[v.pad.id]?.replace(/ holds?$/, "") ?? v.pad.label;
  const sets = `A ${feel}, ${sky} day puts the song in ${meta.rootName} ${meta.modeLabel}${MODE_HINTS[meta.mode]}, with ${melodyNoun} on the melody over ${padNoun}.`;
  const drives = `The tune follows the temperature, from ${formatTemp(s.tMin, units)} at ${hourLabel(s.tMinHour)} to ${formatTemp(s.tMax, units)} at ${hourLabel(s.tMaxHour)}, and ${an(formatSpeed(s.wind, units))} average wind sets the tempo at ${A.bpm} BPM.`;

  let shape;
  if (!meta.arc.dramatic) {
    shape = "It's a calm day, so the music stays even and only breathes with the weather.";
  } else {
    const peaks = meta.arc.moments.filter((m) => m.phase === "peak").map((m) => hourLabel(m.bar));
    const at = A.intensity.indexOf(Math.max(...A.intensity));
    const h = H[at];
    const why = [];
    if (M.THUNDER_CODES.includes(h.code)) why.push("thunder");
    else if (h.precip >= 0.5) why.push(`heavy ${M.SNOW_CODES.includes(h.code) ? "snow" : "rain"}`);
    if (h.gust >= M.DYNAMICS.gustFrom) why.push("strong gusts");
    shape = `The weather peaks ${peaks.length > 1 ? `twice, at ${listOf(peaks)}` : `at ${peaks[0] ?? hourLabel(at)}`}${why.length ? ` with ${listOf(why)}` : ""}, and the music swells with it before easing off.`;
  }

  const daylight = f.sunrise != null && f.sunset > f.sunrise
    ? `The melody fades in around sunrise and out around sunset.`
    : H.every((h) => !h.isDay) ? "With no sunrise in the polar night, the melody stays dim all day."
      : "Under the midnight sun, the melody plays at full strength all day.";

  return { paragraphs: [join([sets, drives, shape, skyNote(f, meta.sky, layers, units), daylight])] };
}

const moonNoun = (phase) => (/moon$/.test(phase) ? phase : `${phase} moon`);

/** The single most notable thing in the sky or the air today, as one sentence (or ""). Rarest first. */
function skyNote(f, K, layers, units) {
  const has = (k) => layers.chimes.some((c) => c.kind === k);
  const lights = f.lat >= 0 ? "northern lights" : "southern lights";
  const kp = Math.round(K.kpMax * 10) / 10;
  if (K.eclipse) return `A ${K.eclipse.type} lunar eclipse at ${hourLabel(K.eclipse.hour)} takes the moonlight out of the song.`;
  if (K.aurora.some((a) => a >= M.AURORA.min)) return `The ${lights} are within reach (Kp ${kp}), so a slow, shimmering chord drifts overhead.`;
  if (K.shower && has("meteor")) return `Shooting stars from the ${K.shower.name} streak down through the bells.`;
  if (K.season) return `The ${K.season.name} (${K.season.meaning}) is rung in with a bell.`;
  if (K.holiday) return `It's ${K.holiday.name}, a public holiday, so the song signs off with a run of bells.`;
  if (K.firstFrost) return "It's the first frost of the season, and the still hours glint with icy bells.";
  if (K.auroraReach.some((r, b) => r >= M.AURORA.min && K.dark[b] >= 0.9)) return `The ${lights} are within reach tonight (Kp ${kp}), but cloud hides them.`;
  if (K.shower) return `It's the ${K.shower.name}, but they're hidden tonight.`;
  if (K.moonUpAtNight && Math.max(...K.moonlight) >= 0.15 && K.moon.illum >= 0.9) return `A ${moonNoun(K.moon.phase)} keeps the night from going dark.`;
  return "";
}

/** The notes as plain lines, for tests and the text summary. */
export function notesAsText(liner) {
  return [...liner.paragraphs];
}
