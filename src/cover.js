// A small "album cover" for the day, drawn from the forecast. Like a real record
// shelf, covers come in a few designs, and the day's weather picks one:
//   storm     a dark, grainy sleeve with big lightning and slanting rain
//   clock     the day as a ring of 24 hours around tonight's moon (aurora, eclipse,
//             meteor or full-moon nights, and days with no sunrise at all)
//   stripes   the day's temperature as a band of colour under its sky (big swings)
//   horizon   the day's temperature drawn as a line of hills under the sky
//   sky       the sky changing from midnight (left) to 11 pm (right)
//   poster    flat colour from the day's temperature and one big sun
// Plain days rotate between horizon, sky and poster. Every design shares the same
// details: stars on clear nights, the real phase of the moon, fog, wind, frost,
// and the country's flag in the corner.

import { tempColor, moonDisc } from "./icons.js";
import { CODES, AURORA, STORM as STORM_AT } from "./mapping.js";

const NIGHT = [24, 22, 52];
const CLEAR = [104, 170, 228];
const GREY = [148, 154, 170];
const STORM = [56, 60, 92];
// Deep cold drains the colour: snow-white by day, slate by night.
const ICE_DAY = [226, 230, 234];
const ICE_NIGHT = [22, 25, 30];
const GLARE = [244, 226, 186]; // deadly heat bleaches the sky
const WHITEOUT = [214, 218, 222];
const GLAZE = [176, 194, 208]; // freezing rain
const MOON = "#ece8f8";
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c) => `rgb(${c})`;
const parse = (css) => css.match(/\d+/g).slice(0, 3).map(Number);
const f1 = (n) => n.toFixed(1);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

function rng(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}

const FLAGS = new URL("../vendor/flags/", import.meta.url).href;

/** The country's flag as a small sticker in the corner, like a parental advisory label. */
function flag(cc) {
  if (!/^[A-Za-z]{2}$/.test(cc ?? "")) return ""; // out at sea, or no country
  const w = 12, h = 9, x = 100 - 6 - w, y = 100 - 6 - h;
  return `<g><rect x="${x - 0.8}" y="${y - 0.8}" width="${w + 1.6}" height="${h + 1.6}" rx=".6" fill="#fff" opacity=".95"/>` +
    `<image href="${FLAGS}${cc.toLowerCase()}.svg" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/></g>`;
}

// ---- Which design ----------------------------------------------------------

const thundery = (h) => CODES.thunder.includes(h.code);
const stormy = (h) => thundery(h) || h.precip >= STORM_AT.hourlyPrecipMm || (h.gust >= STORM_AT.gustKmh && h.precip > 0);

/** The night's sky event worth a clock cover, or null. */
function nightEvent(forecast, meta) {
  const H = forecast.hours, S = meta.sky ?? {};
  const night = H.filter((h) => !h.isDay);
  const clearNight = night.length > 0 && mean(night.map((h) => h.cloud)) < 50;
  if (Math.max(0, ...(S.aurora ?? [])) >= AURORA.min) return "aurora";
  if (S.eclipse) return "eclipse";
  if (S.shower && Math.abs(S.shower.daysFromPeak) <= 1 && S.shower.zhr >= 50 && clearNight) return "meteors";
  if (S.moon?.phase === "full moon" && clearNight) return "moon";
  return null;
}

/** One of "storm", "clock", "stripes", "horizon", "sky", "poster". */
export function coverStyle(forecast, meta) {
  const H = forecast.hours;
  if (H.filter(thundery).length >= 2 || H.filter(stormy).length >= 3) return "storm";
  if (!H.some((h) => h.isDay) || nightEvent(forecast, meta)) return "clock";
  const temps = H.map((h) => h.temp);
  if (Math.max(...temps) - Math.min(...temps) >= 10) return "stripes";
  const r = rng(`${meta.name}|${meta.date}|design`)();
  return r < 0.36 ? "horizon" : r < 0.68 ? "sky" : "poster";
}

// ---- Shared pieces ---------------------------------------------------------

/** The sky's colour for each hour. */
function skyColours(H, meta) {
  const O = meta.outliers;
  return H.map((h, i) => {
    const day = thundery(h) ? STORM : mix(CLEAR, GREY, h.cloud / 100);
    let c = mix(mix(NIGHT, day, Math.max(0.05, meta.hourBrightness[i])),
      h.isDay ? ICE_DAY : ICE_NIGHT, 0.9 * (meta.deepCold?.[i] ?? 0));
    if (O) {
      if (h.isDay) c = mix(c, GLARE, 0.6 * O.heat[i]);
      c = mix(c, h.isDay ? WHITEOUT : mix(WHITEOUT, ICE_NIGHT, 0.6), 0.85 * O.whiteout[i]);
      if (O.ice[i]) c = mix(c, h.isDay ? GLAZE : mix(GLAZE, NIGHT, 0.6), 0.5);
      if (O.eye[i]) c = mix(c, CLEAR, 0.5); // a glimpse of sky in the eye
    }
    return c;
  }).map((c, i, all) => {
    // Blend each hour with its neighbours, so the sky changes smoothly.
    const at = (k) => all[Math.max(0, Math.min(all.length - 1, i + k))];
    return c.map((_, j) => Math.round((at(-2)[j] + 2 * at(-1)[j] + 3 * at(0)[j] + 2 * at(1)[j] + at(2)[j]) / 9));
  });
}

/** True when the sky colour is dark enough for the moon and stars to show. */
const darkSky = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] < 95;

const gradient = (id, cols, x) =>
  `<linearGradient id="${id}">${cols.map((c, i) => `<stop offset="${f1(x(i))}%" stop-color="${rgb(c)}"/>`).join("")}</linearGradient>`;

/** The sun at the hottest daylight hour, dimmed by the day's cloud and rain. */
function sun(H, meta, x, cy = 36, scale = 1) {
  const dayHours = H.map((h, i) => (h.isDay ? i : -1)).filter((i) => i >= 0);
  if (!dayHours.length) return null;
  const hot = dayHours.reduce((b, i) => (H[i].temp > H[b].temp ? i : b), dayHours[0]);
  const cold = mean(dayHours.map((i) => meta.deepCold?.[i] ?? 0));
  const col = cold > 0.5 ? "#f4f6f8" : tempColor(H[hot].temp); // a pale, colourless sun
  const cx = Math.min(80, Math.max(20, x(hot)));
  const cloudDay = mean(dayHours.map((i) => H[i].cloud)) / 100;
  const wetDay = dayHours.filter((i) => H[i].precip >= 0.2 || H[i].pop >= 60).length / dayHours.length;
  const seen = (1 - 0.9 * cloudDay) * (1 - 0.85 * wetDay);
  const haze = Math.min(1, Math.max(0.1, 0.1 + 0.9 * seen)).toFixed(2);
  return { cx, hot, col, svg: `<g opacity="${haze}"><circle cx="${f1(cx)}" cy="${cy}" r="${20 * scale}" fill="${col}" opacity=".22"/><circle cx="${f1(cx)}" cy="${cy}" r="${12 * scale}" fill="${col}"/></g>` };
}

/** Tonight's moon in its real phase. */
function moonShape(cx, cy, r, m, south, fill = MOON) {
  return moonDisc(f1(cx), f1(cy), r, { illum: m.illum, waxing: m.waxing, south }).replaceAll("var(--moon)", fill);
}

/** The night hour when the moon is highest in a fairly clear sky, or -1. */
function moonHour(H, meta, cols) {
  const m = meta.sky?.moon;
  if (!m || m.illum < 0.04) return -1;
  let best = -1;
  H.forEach((h, i) => {
    if (h.isDay || !darkSky(cols[i]) || !((m.alt?.[i] ?? 0) > 5) || h.cloud > 75) return;
    if (best < 0 || m.alt[i] > m.alt[best]) best = i;
  });
  return best;
}

/** Stars over the clear night hours. */
function stars(H, meta, rand, x, top = 4, bottom = 44) {
  let out = "";
  const w = 100 / H.length;
  H.forEach((h, i) => {
    const clear = 1 - h.cloud / 60;
    if (h.isDay || clear <= 0) return;
    const dark = 1 - Math.min(1, meta.hourBrightness?.[i] ?? 0);
    for (let k = 0; k < Math.round(1 + 3 * clear); k++) {
      const px = x(i) + (rand() - 0.5) * w, py = top + rand() * (bottom - top);
      out += `<circle cx="${f1(px)}" cy="${f1(py)}" r="${(0.22 + rand() * 0.38).toFixed(2)}" fill="#fff" opacity="${((0.35 + rand() * 0.65) * clear * dark).toFixed(2)}"/>`;
    }
  });
  return out;
}

/** Clouds drift across the sun on grey days. */
function clouds(H, rand) {
  const cloud = mean(H.map((h) => h.cloud)) / 100;
  let out = "";
  for (let k = 0; k < Math.round(cloud * 4); k++) {
    const cx = 10 + rand() * 80, cy = 30 + rand() * 18, w = 16 + rand() * 14;
    out += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(w)}" ry="${f1(w * 0.32)}" fill="#fff" opacity="${(0.12 + cloud * 0.25).toFixed(2)}"/>`;
  }
  return out;
}

/** Rain streaks and snowflakes under the wet hours, a bolt at each storm. */
function wet(H, rand, x, top = 44, depth = 30, bolts = true) {
  let out = "";
  H.forEach((h, i) => {
    if (h.precip <= 0 && h.pop < 40) return;
    const n = Math.min(5, 1 + Math.round(h.precip * 1.5));
    const op = Math.min(0.85, 0.25 + h.precip / 4 + h.pop / 400);
    for (let k = 0; k < n; k++) {
      const px = x(i) + (rand() - 0.5) * 4, py = top + rand() * depth;
      out += CODES.snow.includes(h.code)
        ? `<circle cx="${f1(px)}" cy="${f1(py)}" r=".9" fill="#fff" opacity="${op.toFixed(2)}"/>`
        : `<path d="M${f1(px)} ${f1(py)}l-1.4 5" stroke="#bfe3ff" stroke-width=".7" stroke-linecap="round" opacity="${op.toFixed(2)}"/>`;
    }
    if (bolts && thundery(h) && i % 3 === 0) {
      const bx = x(i);
      out += `<path d="M${f1(bx + 1)} ${top - 4}l-4 9h3.5l-2.5 8 6-10.5h-3.6l2.4-6.5z" fill="#ffd23f"/>`;
    }
  });
  return out;
}

/** Runs of consecutive hours that pass a test, as [first, last] pairs. */
function runs(H, test) {
  const out = [];
  H.forEach((h, i) => {
    if (!test(h, i)) return;
    if (out.length && out.at(-1)[1] === i - 1) out.at(-1)[1] = i;
    else out.push([i, i]);
  });
  return out;
}

/** Soft white bands over the foggy hours. */
function fog(H, x, ys = [50, 60, 70]) {
  const w = 100 / H.length;
  const bands = runs(H, (h) => CODES.fog.includes(h.code));
  if (!bands.length) return "";
  let out = `<filter id="cv-fog" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="1.8"/></filter><g filter="url(#cv-fog)">`;
  for (const [a, b] of bands) {
    const x0 = Math.max(-4, x(a) - w), x1 = Math.min(104, x(b) + w);
    ys.forEach((y, k) => {
      out += `<rect x="${f1(x0 + k * 2)}" y="${y}" width="${f1(x1 - x0 - k * 3)}" height="${3 + k}" rx="2" fill="#fff" opacity="${(0.32 - k * 0.06).toFixed(2)}"/>`;
    });
  }
  return out + "</g>";
}

/** Faint streaks across the windy hours. */
function wind(H, rand, x, top = 18, depth = 50) {
  let out = "";
  H.forEach((h, i) => {
    if (h.wind < 28) return;
    const n = h.wind >= 50 ? 3 : h.wind >= 38 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const px = x(i) - 6 + rand() * 4, py = top + rand() * depth, len = 9 + rand() * 7;
      out += `<path d="M${f1(px)} ${f1(py)}q${f1(len / 2)} -1.6 ${f1(len)} 0" stroke="#fff" stroke-width=".45" fill="none" stroke-linecap="round" opacity="${(0.25 + Math.min(0.3, (h.wind - 28) / 80)).toFixed(2)}"/>`;
    }
  });
  return out;
}

/** Frost creeping in from the top corners on frosty mornings. */
function frost(meta, rand) {
  if (!meta.sky?.frostHours?.length) return "";
  let out = `<radialGradient id="cv-frost"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  for (const [cx, dir] of [[0, 1], [100, -1]]) {
    out += `<circle cx="${cx}" cy="0" r="24" fill="url(#cv-frost)"/>`;
    // A few fern-like crystals growing out of the corner.
    for (let k = 0; k < 4; k++) {
      const a = (0.15 + (k / 4) * 1.2 + rand() * 0.15), len = 10 + rand() * 9;
      const ex = cx + dir * Math.cos(a) * len, ey = Math.sin(a) * len;
      let d = `M${cx} 0L${f1(ex)} ${f1(ey)}`;
      for (let s = 1; s <= 3; s++) {
        const t = s / 4, px = cx + (ex - cx) * t, py = ey * t, b = 2.4 * (1 - t) + 0.8;
        d += `M${f1(px)} ${f1(py)}l${f1(dir * b)} ${f1(-b * 0.4)}M${f1(px)} ${f1(py)}l${f1(-dir * b * 0.3)} ${f1(b)}`;
      }
      out += `<path d="${d}" stroke="#fff" stroke-width=".35" fill="none" stroke-linecap="round" opacity=".7"/>`;
    }
  }
  return out;
}

/**
 * Aurora curtains over the hours when the lights could be seen: soft green
 * bands that rise to a violet fringe, brighter as the aurora gets stronger.
 */
function aurora(forecast, meta, rand) {
  const level = meta.sky?.aurora ?? [];
  const H = forecast.hours;
  if (!level.some((a) => a >= AURORA.min)) return "";
  let out = `<defs><linearGradient id="cv-aur" x1="0" y1="1" x2="0" y2="0">` +
    `<stop offset="0" stop-color="#5cf2a4" stop-opacity="0"/><stop offset=".25" stop-color="#5cf2a4" stop-opacity=".85"/>` +
    `<stop offset=".7" stop-color="#3fd6b0" stop-opacity=".35"/><stop offset="1" stop-color="#b07cf0" stop-opacity=".45"/></linearGradient>` +
    `<filter id="cv-aur-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter></defs><g filter="url(#cv-aur-blur)">`;
  H.forEach((_, i) => {
    const a = level[i] ?? 0;
    if (a < AURORA.min * 0.6) return;
    const x0 = (i / H.length) * 100;
    // A few wavy vertical rays per hour, their height and strength set by the aurora.
    for (let k = 0; k < 3; k++) {
      const cx = x0 + (k + rand()) * (100 / H.length / 3);
      const top = 8 + (1 - a) * 22 + rand() * 6, base = 46 + rand() * 10;
      const sway = (rand() - 0.5) * 6;
      out += `<path d="M${f1(cx - 1.4)} ${f1(base)} Q${f1(cx + sway)} ${f1((top + base) / 2)} ${f1(cx - 1)} ${f1(top)} L${f1(cx + 1.6)} ${f1(top)} Q${f1(cx + sway + 2.4)} ${f1((top + base) / 2)} ${f1(cx + 1.4)} ${f1(base)} Z" fill="url(#cv-aur)" opacity="${Math.min(0.9, 0.35 + a * 0.6).toFixed(2)}"/>`;
    }
  });
  return out + "</g>";
}

// ---- Lettering ---------------------------------------------------------------

const LABEL = (y, x = 7) => `<text x="${x}" y="${y}" fill="#fff" opacity=".8" font-family="JetBrains Mono, monospace" font-size="4" letter-spacing=".6">WEATHERTUNES</text>`;
const DISPLAY = `font-family="Space Grotesk, sans-serif" font-weight="700"`;

function lettering(design, city, date) {
  const n = Math.max(city.length, 1);
  const dateText = (y, size = 4.4, x = 7) => `<text x="${x}" y="${y}" fill="#fff" opacity=".85" font-family="Inter, sans-serif" font-size="${size}">${esc(date)}</text>`;
  if (design === "stripes") {
    // A big title across the top of the stripes.
    const size = Math.min(15, 150 / n);
    return `<text x="6" y="${f1(8 + size * 0.92)}" fill="#fff" ${DISPLAY} font-size="${f1(size)}" letter-spacing="-.3">${esc(city)}</text>` +
      dateText(f1(14 + size * 0.92), 4.4, 6.4) + LABEL(93);
  }
  if (design === "storm") {
    // Heavy capitals at the top, under the storm clouds.
    const size = Math.min(12, 104 / n);
    return `<text x="7" y="${f1(8 + size * 0.9)}" fill="#fff" ${DISPLAY} font-size="${f1(size)}" letter-spacing=".4">${esc(city.toUpperCase())}</text>` +
      dateText(f1(14 + size * 0.9)) + LABEL(93);
  }
  if (design === "clock") {
    // A quiet band along the bottom, under the ring.
    const size = Math.min(7.5, 80 / n);
    return `<rect y="80" width="100" height="20" fill="#05040f" opacity=".55"/>` +
      `<text x="7" y="89.5" fill="#fff" ${DISPLAY} font-size="${f1(size)}">${esc(city)}</text>` + dateText(95, 3.8) + LABEL(11);
  }
  // Sky and horizon: the name at the bottom left (long names shrink to leave room for the flag).
  const size = Math.min(11, 118 / n);
  return LABEL(11) + `<text x="7" y="86" fill="#fff" ${DISPLAY} font-size="${f1(size)}">${esc(city)}</text>` + dateText(93);
}

const fadeDown = `<linearGradient id="cv-fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>`;
const fadeUp = `<linearGradient id="cv-fade" x1="0" y1="1" x2="0" y2="0"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>`;

// ---- The designs ---------------------------------------------------------------

function skyDesign(c) {
  const { H, meta, x, rand, cols } = c;
  const s = sun(H, meta, x);
  const mh = moonHour(H, meta, cols);
  let moon = "";
  if (mh >= 0 && (!s || Math.abs(x(mh) - s.cx) > 22)) {
    moon = moonShape(Math.min(88, Math.max(12, x(mh))), 40 - (meta.sky.moon.alt[mh] / 90) * 24, s ? 7 : 9, meta.sky.moon, c.south);
  }
  return `<defs>${gradient("cv-sky", cols, x)}${fadeDown}</defs>` +
    `<rect width="100" height="100" fill="url(#cv-sky)"/>` +
    stars(H, meta, rand, x) + (s?.svg ?? "") + moon + aurora(c.forecast, meta, rand) + clouds(H, rand) +
    fog(H, x) + wind(H, rand, x) + wet(H, rand, x) +
    `<rect width="100" height="100" fill="url(#cv-fade)"/>`;
}

/** A smooth hill line through the points, closed along the bottom. */
function ridge(pts) {
  let d = `M-1 ${f1(pts[0][1])}L${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [qx, qy] = pts[i];
    d += `Q${f1(px)} ${f1(py)} ${f1((px + qx) / 2)} ${f1((py + qy) / 2)}`;
  }
  const last = pts.at(-1);
  return `${d}L${f1(last[0])} ${f1(last[1])}L101 ${f1(last[1])}L101 101L-1 101Z`;
}

function horizonDesign(c) {
  const { H, meta, x, rand, cols } = c;
  const temps = H.map((h) => h.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const amp = Math.min(1, (hi - lo) / 8); // calm days roll gently, big swings climb
  const norm = (t) => (hi > lo ? (t - lo) / (hi - lo) : 0.5) * amp;
  const far = H.map((h, i) => [x(i), 66 - norm(h.temp) * 14 - rand() * 4]);
  const near = H.map((h, i) => [x(i), 80 - norm(h.temp) * 20]);
  const avg = cols.reduce((a, v) => a.map((s, j) => s + v[j] / cols.length), [0, 0, 0]).map(Math.round);
  const tint = parse(tempColor(mean(temps)));
  const farCol = mix(avg, NIGHT, 0.45), nearCol = mix([16, 15, 28], tint, 0.22);
  const snowy = (meta.sky?.snowCm ?? 0) >= 1 || H.filter((h) => CODES.snow.includes(h.code)).length >= 3;
  const s = sun(H, meta, x, 32);
  const mh = moonHour(H, meta, cols);
  const moon = mh >= 0 && (!s || Math.abs(x(mh) - s.cx) > 22)
    ? moonShape(Math.min(88, Math.max(12, x(mh))), 36 - (meta.sky.moon.alt[mh] / 90) * 22, s ? 7 : 8, meta.sky.moon, c.south) : "";
  // A painted sky: deep overhead, glowing warm along the hills when the day is clear.
  const dayCols = cols.filter((_, i) => H[i].isDay);
  const base = dayCols.length ? dayCols.reduce((a, v) => a.map((s2, j) => s2 + v[j] / dayCols.length), [0, 0, 0]).map(Math.round) : avg;
  const clearness = 1 - mean(H.map((h) => h.cloud)) / 100;
  const glow = mix(mix(base, [255, 255, 255], 0.25), [250, 178, 120], 0.55 * clearness);
  const vsky = `<linearGradient id="cv-vsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rgb(mix(base, NIGHT, 0.45))}"/>` +
    `<stop offset=".45" stop-color="${rgb(base)}"/><stop offset=".72" stop-color="${rgb(glow)}"/></linearGradient>`;
  return `<defs>${vsky}${fadeDown}</defs>` +
    `<rect width="100" height="100" fill="url(#cv-vsky)"/>` +
    stars(H, meta, rand, x, 4, 40) + (s?.svg ?? "") + moon + aurora(c.forecast, meta, rand) + clouds(H, rand) +
    wind(H, rand, x, 12, 34) + wet(H, rand, x, 40, 26) +
    `<path d="${ridge(far)}" fill="${rgb(farCol)}" opacity=".92"/>` +
    (snowy ? `<path d="${ridge(far).split("L101")[0]}" stroke="#fff" stroke-width="1.6" fill="none" opacity=".85"/>` : "") +
    fog(H, x, [58, 64, 70]) +
    `<path d="${ridge(near)}" fill="${rgb(nearCol)}"/>` +
    `<rect width="100" height="100" fill="url(#cv-fade)"/>`;
}

function stripesDesign(c) {
  const { H, meta, x, rand, cols } = c;
  // The day's temperature as one smooth band of colour, left to right, with the
  // night hours softly shaded so daylight reads as the bright middle.
  const temp = `<linearGradient id="cv-temp">${H.map((h, i) => `<stop offset="${f1(x(i))}%" stop-color="${tempColor(h.temp)}"/>`).join("")}</linearGradient>`;
  const shade = H.map((h) => (h.isDay ? 0 : 0.4));
  const night = `<linearGradient id="cv-night">${H.map((_, i) => {
    const k = (shade[Math.max(0, i - 1)] + 2 * shade[i] + shade[Math.min(H.length - 1, i + 1)]) / 4;
    return `<stop offset="${f1(x(i))}%" stop-color="#0b0a1e" stop-opacity="${k.toFixed(2)}"/>`;
  }).join("")}</linearGradient>`;
  // The sky sits above it and melts into the colour about halfway down.
  const fall = `<linearGradient id="cv-melt" x1="0" y1="0" x2="0" y2="1"><stop offset=".08" stop-color="#fff"/><stop offset=".58" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<mask id="cv-skymask"><rect width="100" height="100" fill="url(#cv-melt)"/></mask>`;
  const s = sun(H, meta, x, 34, 0.85);
  return `<defs>${temp}${night}${gradient("cv-sky", cols, x)}${fall}${fadeUp}</defs>` +
    `<rect width="100" height="100" fill="url(#cv-temp)"/>` +
    `<rect width="100" height="100" fill="url(#cv-sky)" mask="url(#cv-skymask)"/>` +
    `<rect width="100" height="100" fill="url(#cv-night)"/>` +
    stars(H, meta, rand, x, 6, 40) + (s?.svg ?? "") + clouds(H, rand) +
    wind(H, rand, x, 40, 30) + wet(H, rand, x, 52, 30) +
    `<rect width="100" height="100" fill="url(#cv-fade)"/>`;
}

function clockDesign(c) {
  const { H, meta, rand, cols } = c;
  const S = meta.sky ?? {};
  const cx = 50, cy = 44, r1 = 20, r2 = 30;
  const n = H.length;
  const ang = (i) => (i / n) * Math.PI * 2 - Math.PI / 2; // midnight at the top
  const pt = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const event = nightEvent(c.forecast, meta);
  let out = `<defs><radialGradient id="cv-bg" cx=".5" cy=".44" r=".75"><stop offset="0" stop-color="#1d1a40"/><stop offset="1" stop-color="#06051a"/></radialGradient></defs>` +
    `<rect width="100" height="100" fill="url(#cv-bg)"/>`;
  // Stars everywhere, as many as the night's clear sky allows.
  const night = H.filter((h) => !h.isDay);
  const clear = Math.max(0, 1 - mean(night.map((h) => h.cloud)) / 70);
  for (let k = 0; k < Math.round(60 * clear); k++) {
    out += `<circle cx="${f1(rand() * 100)}" cy="${f1(rand() * 80)}" r="${(0.2 + rand() * 0.35).toFixed(2)}" fill="#fff" opacity="${(0.25 + rand() * 0.6).toFixed(2)}"/>`;
  }
  if (event === "meteors") {
    for (let k = 0; k < 5; k++) {
      const sx = 8 + rand() * 84, sy = 4 + rand() * 30, len = 8 + rand() * 8;
      out += `<path d="M${f1(sx)} ${f1(sy)}l${f1(len)} ${f1(len * 0.45)}" stroke="#ffe7a0" stroke-width=".6" stroke-linecap="round" opacity=".8"/>` +
        `<circle cx="${f1(sx + len)}" cy="${f1(sy + len * 0.45)}" r=".7" fill="#fff"/>`;
    }
  }
  // The aurora as a glowing arc over the hours it shows.
  const level = S.aurora ?? [];
  if (level.some((a) => a >= AURORA.min)) {
    out += `<defs><linearGradient id="cv-aur" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5cf2a4"/><stop offset="1" stop-color="#b07cf0"/></linearGradient>` +
      `<filter id="cv-aur-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter></defs><g filter="url(#cv-aur-blur)">`;
    H.forEach((_, i) => {
      const a = level[i] ?? 0;
      if (a < AURORA.min * 0.6) return;
      const [ax, ay] = pt(ang(i), r2 + 3), [bx, by] = pt(ang(i + 1), r2 + 3);
      const [ox, oy] = pt(ang(i + 0.5), r2 + 6 + a * 8);
      out += `<path d="M${f1(ax)} ${f1(ay)}L${f1(ox)} ${f1(oy)}L${f1(bx)} ${f1(by)}Z" fill="url(#cv-aur)" opacity="${Math.min(0.95, 0.4 + a * 0.6).toFixed(2)}"/>`;
    });
    out += "</g>";
  }
  // The ring: one wedge per hour in that hour's sky colour.
  H.forEach((h, i) => {
    const a0 = ang(i), a1 = ang(i + 1);
    const [p, q] = [pt(a0, r2), pt(a1, r2)], [s, t] = [pt(a1, r1), pt(a0, r1)];
    out += `<path d="M${f1(p[0])} ${f1(p[1])}A${r2} ${r2} 0 0 1 ${f1(q[0])} ${f1(q[1])}L${f1(s[0])} ${f1(s[1])}A${r1} ${r1} 0 0 0 ${f1(t[0])} ${f1(t[1])}Z" fill="${rgb(mix(cols[i], [92, 88, 150], 0.3))}" stroke="#06051a" stroke-width=".35"/>`;
  });
  // Rain and snow as drops just outside the ring, the sun at the warmest hour.
  H.forEach((h, i) => {
    if (h.precip <= 0 && h.pop < 40) return;
    const [dx, dy] = pt(ang(i + 0.5), r2 + 2.4);
    out += `<circle cx="${f1(dx)}" cy="${f1(dy)}" r="${Math.min(1.3, 0.5 + h.precip / 3).toFixed(2)}" fill="${CODES.snow.includes(h.code) ? "#fff" : "#8fd0ff"}" opacity=".85"/>`;
  });
  const s = sun(H, meta, (i) => i);
  if (s) {
    const [sx, sy] = pt(ang(s.hot + 0.5), r2 + 4.5);
    out += `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="2.2" fill="${s.col}"/>`;
  }
  // Midnight, 6 am, noon and 6 pm as small ticks inside the ring.
  for (let k = 0; k < 4; k++) {
    const [a, b] = [pt(ang((k * n) / 4), r1 - 1), pt(ang((k * n) / 4), r1 - 2.6)];
    out += `<path d="M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}" stroke="#fff" stroke-width=".5" opacity=".6"/>`;
  }
  // Tonight's moon in the middle: copper in an eclipse.
  const m = S.moon;
  if (m && m.illum >= 0.04) {
    out += event === "eclipse"
      ? `<circle cx="${cx}" cy="${cy}" r="10" fill="#b5503c"/><circle cx="${cx - 3}" cy="${cy - 3}" r="10" fill="#7a2e22" opacity=".45"/>`
      : `<circle cx="${cx}" cy="${cy}" r="15" fill="${MOON}" opacity=".07"/>` + moonShape(cx, cy, 10, m, c.south);
  }
  return out + frost(meta, rand);
}

/** A jagged bolt from the clouds down towards the ground. */
function bolt(bx, rand) {
  let px = bx, py = 6, d = `M${f1(px)} ${py}`;
  while (py < 66) {
    px += (rand() - 0.5) * 12; py += 6 + rand() * 7;
    d += `L${f1(px)} ${f1(py)}`;
  }
  return d;
}

function stormDesign(c) {
  const { H, meta, x, rand, cols } = c;
  let out = `<defs>${gradient("cv-sky", cols, x)}${fadeUp}` +
    `<linearGradient id="cv-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0e18"/><stop offset="1" stop-color="#1c2030"/></linearGradient>` +
    `<pattern id="cv-dots" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".55" fill="#fff"/></pattern>` +
    `<linearGradient id="cv-htg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#fff" stop-opacity=".9"/></linearGradient>` +
    `<mask id="cv-htm"><rect width="100" height="100" fill="url(#cv-htg)"/></mask>` +
    `<filter id="cv-glow" x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="2"/></filter></defs>` +
    `<rect width="100" height="100" fill="url(#cv-dark)"/>` +
    `<rect width="100" height="100" fill="url(#cv-sky)" opacity=".35"/>`;
  // Heavy cloud along the top.
  for (let k = 0; k < 6; k++) {
    const cx = k * 20 - 5 + rand() * 10, w = 14 + rand() * 10;
    out += `<ellipse cx="${f1(cx)}" cy="${f1(6 + rand() * 8)}" rx="${f1(w)}" ry="${f1(w * 0.45)}" fill="#05060c" opacity=".55"/>`;
  }
  // One big bolt for each run of thunder, the two longest runs at most.
  const strikes = runs(H, thundery).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 2);
  for (const [a, b] of strikes) {
    const d = bolt(Math.min(85, Math.max(15, (x(a) + x(b)) / 2)), rand);
    out += `<path d="${d}" stroke="#ffd23f" stroke-width="3.5" fill="none" filter="url(#cv-glow)" opacity=".8"/>` +
      `<path d="${d}" stroke="#fffbe8" stroke-width="1.1" fill="none" stroke-linejoin="round"/>`;
  }
  // Rain slanting with the wind across every wet hour.
  H.forEach((h, i) => {
    if (h.precip <= 0 && h.pop < 40) return;
    const n = Math.min(9, 2 + Math.round(h.precip * 1.2));
    const slant = -1 - Math.min(4, h.wind / 18);
    const snow = CODES.snow.includes(h.code);
    for (let k = 0; k < n; k++) {
      const px = x(i) + (rand() - 0.5) * 5, py = 14 + rand() * 80;
      out += snow
        ? `<circle cx="${f1(px)}" cy="${f1(py)}" r=".9" fill="#fff" opacity=".7"/>`
        : `<path d="M${f1(px)} ${f1(py)}l${f1(slant)} 7" stroke="#bfe3ff" stroke-width=".55" stroke-linecap="round" opacity="${(0.35 + Math.min(0.4, h.precip / 10)).toFixed(2)}"/>`;
    }
  });
  // A coarse halftone grain, heavier towards the bottom.
  out += `<rect width="100" height="100" fill="url(#cv-dots)" opacity=".09" mask="url(#cv-htm)"/>`;
  return out + `<rect width="100" height="100" fill="url(#cv-fade)"/>`;
}

function posterDesign(c) {
  const { H, meta, x, rand } = c;
  const temps = H.map((h) => h.temp);
  const bg = mix(parse(tempColor(mean(temps))), [22, 20, 34], 0.45);
  const s = sun(H, meta, x);
  const cloud = mean(H.map((h) => h.cloud)) / 100;
  const cx = 50, cy = 42, r = 25;
  let out = `<defs>${fadeDown}<clipPath id="cv-disc"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>` +
    `<rect width="100" height="100" fill="${rgb(bg)}"/>`;
  // One big disc: the sun in the colour of the warmest hour (or tonight's moon),
  // with the day's cloud drawn across it as flat bands.
  const m = meta.sky?.moon;
  out += s
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.col}"/>`
    : m ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${rgb(mix(bg, [0, 0, 0], 0.3))}"/>` + moonShape(cx, cy, r - 4, m, c.south) : "";
  let bands = "";
  for (let k = 0; k < Math.round(cloud * 5); k++) {
    const y = cy - r + 10 + k * 9 + rand() * 3;
    bands += `<rect x="${cx - r}" y="${f1(y)}" width="${r * 2}" height="${f1(3 + cloud * 4)}" fill="${rgb(bg)}" opacity="${(0.35 + cloud * 0.5).toFixed(2)}"/>`;
  }
  out += `<g clip-path="url(#cv-disc)">${bands}</g>`;
  // Rain as a field of short dashes, snow as dots, wind as long lines across.
  const wetHours = H.filter((h) => h.precip > 0 || h.pop >= 40);
  const snow = wetHours.filter((h) => CODES.snow.includes(h.code)).length > wetHours.length / 2;
  const marks = Math.min(70, Math.round(wetHours.length * 2.5 + mean(wetHours.map((h) => h.precip)) * 12));
  for (let k = 0; k < marks; k++) {
    const px = 8 + rand() * 84, py = 22 + rand() * 50;
    out += snow
      ? `<circle cx="${f1(px)}" cy="${f1(py)}" r=".8" fill="#fff" opacity=".8"/>`
      : `<path d="M${f1(px)} ${f1(py)}l-1 4" stroke="#fff" stroke-width=".6" stroke-linecap="round" opacity=".7"/>`;
  }
  const windy = Math.max(...H.map((h) => h.wind));
  for (let k = 0; k < (windy >= 40 ? 3 : windy >= 28 ? 2 : 0); k++) {
    const y = cy - 6 + k * 7;
    out += `<path d="M10 ${y}q20 -3 40 0t40 0" stroke="#fff" stroke-width=".7" fill="none" opacity=".55"/>`;
  }
  return out + fog(H, x, [44, 52, 60]) + `<rect width="100" height="100" fill="url(#cv-fade)"/>`;
}

const DESIGNS = { poster: posterDesign,  sky: skyDesign, horizon: horizonDesign, stripes: stripesDesign, clock: clockDesign, storm: stormDesign };

/** forecast: normalized forecast; meta: score.meta. Returns an SVG string. */
export function coverArt(forecast, meta) {
  const H = forecast.hours;
  const design = coverStyle(forecast, meta);
  const c = {
    forecast, meta, H,
    x: (i) => ((i + 0.5) / H.length) * 100,
    rand: rng(`${meta.name}|${meta.date}`),
    cols: skyColours(H, meta),
    south: forecast.lat < 0,
  };
  const art = DESIGNS[design](c) + (design === "clock" ? "" : frost(meta, c.rand));
  const city = meta.name.split(",")[0];
  const date = new Date(`${meta.date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" data-design="${design}">
  ${art}
  ${lettering(design, city, date)}
  ${flag(forecast.country)}
</svg>`;
}
