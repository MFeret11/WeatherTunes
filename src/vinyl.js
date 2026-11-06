// The record behind the cover. Most days it's plain black vinyl; a notable day
// gets a special pressing, the way a label presses a run on coloured vinyl.
// Pure: forecast + score.meta in, a description and CSS backgrounds out.

import { CODES, AURORA } from "./mapping.js";

// First match wins, so the rarest events come first.
//   aurora     the northern or southern lights are out    green and violet swirl
//   eclipse    a lunar eclipse can be seen                black with a copper swirl
//   holiday    a public holiday                           solid colour, from the song's key
//   meteors    the peak of a meteor shower, clear night   black with gold flecks
//   heat       dangerous heat                             see-through orange
//   ice        freezing rain                              see-through ice blue
//   whiteout   blowing snow / deep cold                   white marble
//   storm      a storm day (thunder, a downpour or a gale) smoke marble
//   moon       a full moon on a mostly clear night        pearl white
//   snow       3+ hours of snow                           black with white flecks
//   fog        6+ hours of fog                            see-through grey
const ORDER = ["aurora", "eclipse", "holiday", "meteors", "heat", "ice", "whiteout", "storm", "moon", "snow", "fog"];

const NAMES = {
  black: "Black vinyl",
  aurora: "Aurora swirl vinyl, for the lights tonight",
  eclipse: "Copper swirl vinyl, for tonight's eclipse",
  holiday: "Coloured vinyl, for the holiday",
  meteors: "Gold-fleck vinyl, for the meteor shower",
  heat: "See-through orange vinyl, for the heat",
  ice: "See-through ice-blue vinyl, for the freezing rain",
  whiteout: "White marble vinyl, for the cold",
  storm: "Smoke marble vinyl, for the storm",
  moon: "Pearl vinyl, for the full moon",
  snow: "Snow-fleck vinyl, for the snow",
  fog: "See-through grey vinyl, for the fog",
};

const count = (H, codes) => H.filter((h) => codes.includes(h.code)).length;
const max = (a) => (a?.length ? Math.max(...a) : 0);

/** Which pressing this day gets: one of ORDER, or "black". */
export function pressingKind(forecast, meta) {
  const H = forecast.hours;
  const S = meta.sky ?? {};
  const O = meta.outliers ?? {};
  const night = H.filter((h) => !h.isDay);
  const clearNight = night.length && night.reduce((a, h) => a + h.cloud, 0) / night.length < 50;
  const tests = {
    aurora: () => max(S.aurora) >= AURORA.min,
    eclipse: () => !!S.eclipse,
    holiday: () => !!S.holiday,
    meteors: () => S.shower && Math.abs(S.shower.daysFromPeak) <= 1 && S.shower.zhr >= 50 && clearNight,
    heat: () => max(O.heat) >= 0.25,
    ice: () => (O.ice ?? []).filter(Boolean).length >= 2,
    whiteout: () => max(O.whiteout) >= 0.5 || max(meta.deepCold) >= 0.5,
    storm: () => !!meta.storm || count(H, CODES.thunder) >= 1,
    moon: () => S.moon?.phase === "full moon" && clearNight,
    snow: () => count(H, CODES.snow) >= 3,
    fog: () => count(H, CODES.fog) >= 6,
  };
  return ORDER.find((k) => tests[k]()) ?? "black";
}

// The song's key as a colour: keys a fifth apart sit next to each other on the
// colour wheel; minor-ish modes press darker, bright modes lighter.
const MODE_LIGHT = { lydian: 62, ionian: 58, mixolydian: 54, dorian: 48, aeolian: 42, phrygian: 38, locrian: 34 };
export function keyColour(root, mode) {
  const pc = ((root % 12) + 12) % 12;
  const hue = ((pc * 7) % 12) * 30;
  return `hsl(${hue} 70% ${MODE_LIGHT[mode] ?? 50}%)`;
}

// Small seeded random numbers, so the same day always gets the same flecks.
function rng(seed) {
  let h = (seed >>> 0) || 1;
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

const svg = (body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${body}</svg>`)}")`;

// Flecks scattered over the disc.
function flecks(seed, colours, n, size) {
  const r = rng(seed);
  let dots = "";
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = 21 + Math.sqrt(r()) * 28;
    const c = colours[Math.floor(r() * colours.length)];
    dots += `<circle cx='${(50 + d * Math.cos(a)).toFixed(1)}' cy='${(50 + d * Math.sin(a)).toFixed(1)}' r='${(size * (0.5 + r())).toFixed(2)}' fill='${c}' opacity='${(0.6 + r() * 0.4).toFixed(2)}'/>`;
  }
  return svg(dots);
}

// Marble: fractal noise turned into soft veins of one colour.
function marble(seed, [r, g, b], freq, contrast) {
  return svg(`<filter id='m'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' seed='${seed % 1000}'/>` +
    `<feColorMatrix values='0 0 0 0 ${r / 255} 0 0 0 0 ${g / 255} 0 0 0 0 ${b / 255} ${contrast} 0 0 0 ${(-contrast * 0.42).toFixed(2)}'/></filter>` +
    `<rect width='100' height='100' filter='url(#m)'/>`);
}

/**
 * The pressing for the day: { kind, name, base, pattern }.
 * `base` is the disc's colour (may be see-through); `pattern` is a CSS
 * background layered on top that turns with the record, or "none".
 */
export function pressing(forecast, meta) {
  const kind = pressingKind(forecast, meta);
  const seed = meta.seed ?? 1;
  const P = {
    black: { base: "#222227", pattern: "none" },
    aurora: { base: "#14213a", pattern: `${marble(seed, [80, 230, 160], 0.035, 3.2)}, ${marble(seed + 7, [170, 110, 240], 0.05, 2.6)}` },
    eclipse: { base: "#1d1416", pattern: marble(seed, [196, 98, 52], 0.04, 3) },
    holiday: { base: keyColour(meta.root ?? 0, meta.mode), pattern: "none" },
    meteors: { base: "#1c1c26", pattern: flecks(seed, ["#ffd75e", "#ffd75e", "#ffe7a0", "#ffffff"], 52, 0.45) },
    heat: { base: "rgba(238, 108, 40, 0.78)", pattern: "none" },
    ice: { base: "rgba(160, 205, 235, 0.6)", pattern: "none" },
    whiteout: { base: "#e9ecef", pattern: marble(seed, [150, 160, 172], 0.03, 2.4) },
    storm: { base: "#2a2b33", pattern: marble(seed, [150, 152, 168], 0.035, 2.8) },
    moon: { base: "#e8e6ef", pattern: marble(seed, [196, 186, 220], 0.025, 2) },
    snow: { base: "#222227", pattern: flecks(seed, ["#ffffff", "#e6eef5"], 70, 0.4) },
    fog: { base: "rgba(150, 156, 166, 0.55)", pattern: "none" },
  }[kind];
  return { kind, name: NAMES[kind], ...P };
}
