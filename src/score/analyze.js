// The day at a glance: stats, the global musical choices (mode, key, tempo,
// progression, voices) and per-hour curves the layers read (energy, calm stir,
// eye of a storm, cold front).

import * as M from "../mapping.js";
import { clamp, mean, hashString } from "../util.js";

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
    M.CODES.thunder.includes(h.code) ||
    h.precip >= M.STORM.hourlyPrecipMm ||
    (h.gust >= M.STORM.gustKmh && h.precip > 0);
  const storm = H.some(stormHour);
  const snow = H.filter((h) => M.CODES.snow.includes(h.code)).length >= 3;

  const B = M.BRIGHTNESS;
  const HT = M.HEAT, DC = M.DEEP_COLD, MD = M.MOOD;
  // After a cold front only the hours from the front on are harsh (the warm morning before it isn't).
  const moodFrom = frontHour(H) ?? 0;
  const feels = H.slice(moodFrom).map((h) => h.feels ?? h.temp);
  const dayHeat = Math.max(...feels.map((t) => clamp((t - HT.fromFeels) / (HT.fullFeels - HT.fromFeels), 0, 1)));
  const dayCold = Math.max(...feels.map((t) => clamp((DC.fromFeels - t) / (DC.fromFeels - DC.fullFeels), 0, 1)));
  const harsh = Math.max(dayHeat, dayCold); // see MOOD
  const moodDark = MD.darken * harsh;
  const brightness = 1 - B.cloud * stats.cloud - B.pop * stats.pop
    - B.precip * Math.min(1, stats.precipSum / B.precipFullMm) - (storm ? B.storm : 0) - (moodFrom ? 0 : moodDark);
  const mode = M.MODE_THRESHOLDS.find(
    (t) => brightness >= t.min && (t.minMeanTemp == null || stats.tMean >= t.minMeanTemp),
  ).mode;

  const root = ((Math.round(stats.pressure) % 12) + 12) % 12;
  const T = M.TEMPO;
  const bpm = Math.round(Math.max(MD.minBpm,
    clamp(T.base + T.perRootKmh * Math.sqrt(stats.wind), T.min, T.max) * (1 - MD.slow * harsh)));
  const trend = stats.pressureChange > M.PRESSURE_TREND_HPA ? "rising"
    : stats.pressureChange < -M.PRESSURE_TREND_HPA ? "falling" : "steady";
  const loops = M.PROGRESSIONS[mode][trend];
  const progression = loops[seedFor(f) % loops.length];
  const registerOffset = clamp(
    Math.round((stats.tMean - M.MELODY.registerCenterC) * M.MELODY.registerPerC),
    -M.MELODY.registerMax, M.MELODY.registerMax,
  );
  const voices = pickVoices(stats, storm, snow);
  const { raw: intensity, energy, felt, feltEnergy } = dynamicsCurve(H);
  return { stats, storm, stormHour, snow, brightness, moodDark, moodFrom, dayHeat, harsh, mode, root, bpm, trend, progression, registerOffset, voices, intensity, energy, felt, feltEnergy };
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
    (w.minTemp == null || stats.tMean >= w.minTemp) &&
    (w.minRh == null || stats.rh >= w.minRh);
  const pad = M.PAD_VOICES.find(holds);
  return { melody, pad };
}

/** 0–1: how much storm fuel (CAPE, J/kg) is in the air. */
export function capeLevel(cape) {
  const D = M.DYNAMICS;
  return clamp(((cape ?? 0) - D.capeFrom) / (D.capeFull - D.capeFrom), 0, 1);
}

/**
 * Weather intensity per hour (raw) and the spread curve the music follows (energy).
 * Energy rises a couple of bars before rough weather and fades a few bars after.
 * `felt` and `feltEnergy` leave out CAPE: storm fuel alone isn't weather you'd
 * notice, so it adds tension but never the double-time bass or storm drums.
 */
export function dynamicsCurve(H) {
  const D = M.DYNAMICS;
  const felt = H.map((h) => Math.max(
    clamp(h.precip / D.rainFullMm, 0, 1),
    clamp((h.gust - D.gustFrom) / (D.gustFull - D.gustFrom), 0, 1),
    M.CODES.thunder.includes(h.code) ? 1 : 0,
  ));
  const raw = H.map((h, b) => Math.max(felt[b], capeLevel(h.cape) * D.capeWeight));
  return { raw, energy: spread(raw), felt, feltEnergy: spread(felt) };
}

/** Spread an hourly intensity: a lead-in before each event and a tail after it (DYNAMICS.lead/tail). */
function spread(raw) {
  const D = M.DYNAMICS;
  return raw.map((r, b) => {
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
}

/**
 * Bass feel per hour ("half", "normal" or "double"), decided once per chord from
 * the weather in its hours. Double-time needs weather you'd notice (`felt`, no CAPE);
 * a chord charged by CAPE alone stays "normal" rather than dropping to half-time.
 * The final chord is never half-time, so the last bar can hold the root.
 */
export function bassFeels(H, energy, stats, felt = energy) {
  const F = M.BASS_FEEL;
  const out = [];
  for (let b = 0; b < M.BARS; b += M.BARS_PER_CHORD) {
    const hrs = H.slice(b, b + M.BARS_PER_CHORD);
    const top = (curve) => Math.max(...curve.slice(b, b + M.BARS_PER_CHORD));
    let feel = "normal";
    if (top(felt) >= F.doubleEnergy) feel = "double";
    else if (top(energy) < F.doubleEnergy && b + M.BARS_PER_CHORD < M.BARS && (stats.tMean < F.halfMeanTemp
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

/** Hours in the eye of a hurricane (see EYE): true or false per hour. */
export function eyeHours(H) {
  const E = M.EYE;
  const none = H.map(() => false);
  if (Math.max(...H.map((h) => h.gust)) < E.minGust) return none;
  const lowest = Math.min(...H.map((h) => h.pressure));
  return H.map((h, b) => {
    if (h.pressure > lowest + E.nearHpa || b === 0 || b === H.length - 1) return false;
    const side = (from, to) => Math.max(...H.slice(Math.max(0, from), Math.min(H.length, to)).map((x) => x.wind));
    const before = side(b - E.look, b), after = side(b + 1, b + 1 + E.look);
    return Math.max(...H.slice(Math.max(0, b - E.look), b + 1 + E.look).map((x) => x.gust)) >= E.minGust
      && h.wind <= E.calmShare * before && h.wind <= E.calmShare * after;
  });
}

/** The hour a cold front hits (see FRONT): the steepest fall of the first big drop with rising pressure, or null. */
export function frontHour(H) {
  const F = M.FRONT;
  for (let b = F.hours; b < H.length; b++) {
    if (H[b - F.hours].temp - H[b].temp < F.dropC) continue;
    let at = b - F.hours + 1;
    for (let k = at; k <= b; k++) if (H[k - 1].temp - H[k].temp > H[at - 1].temp - H[at].temp) at = k;
    if (H[Math.min(H.length - 1, at + 2)].pressure - H[at - 1].pressure >= F.riseHpa) return at;
  }
  return null;
}
