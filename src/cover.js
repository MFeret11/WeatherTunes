// A small "album cover" for the day, drawn from the forecast: the sky colour
// changes across the cover from midnight (left) to 11 pm (right), the sun sits at
// the hottest hour in the colour of that temperature (dimmed by the day's cloud and rain), and rain, snow and
// lightning fall where they do in the day. Auroras glow over the hours they can be
// seen, and the country's flag sits in the corner.

import { tempColor } from "./icons.js";
import { CODES, AURORA } from "./mapping.js";

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
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c) => `rgb(${c})`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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
      out += `<path d="M${(cx - 1.4).toFixed(1)} ${base.toFixed(1)} Q${(cx + sway).toFixed(1)} ${((top + base) / 2).toFixed(1)} ${(cx - 1).toFixed(1)} ${top.toFixed(1)} L${(cx + 1.6).toFixed(1)} ${top.toFixed(1)} Q${(cx + sway + 2.4).toFixed(1)} ${((top + base) / 2).toFixed(1)} ${(cx + 1.4).toFixed(1)} ${base.toFixed(1)} Z" fill="url(#cv-aur)" opacity="${Math.min(0.9, 0.35 + a * 0.6).toFixed(2)}"/>`;
    }
  });
  return out + "</g>";
}

/** forecast: normalized forecast; meta: score.meta (for hourBrightness). Returns an SVG string. */
export function coverArt(forecast, meta) {
  const H = forecast.hours;
  const x = (i) => ((i + 0.5) / H.length) * 100;
  const rand = rng(`${meta.name}|${meta.date}`);

  // Sky, hour by hour.
  const stops = H.map((h, i) => {
    const storm = CODES.thunder.includes(h.code);
    const day = storm ? STORM : mix(CLEAR, GREY, h.cloud / 100);
    let c = mix(mix(NIGHT, day, Math.max(0.05, meta.hourBrightness[i])),
      h.isDay ? ICE_DAY : ICE_NIGHT, 0.9 * (meta.deepCold?.[i] ?? 0));
    const O = meta.outliers;
    if (O) {
      if (h.isDay) c = mix(c, GLARE, 0.6 * O.heat[i]);
      c = mix(c, h.isDay ? WHITEOUT : mix(WHITEOUT, ICE_NIGHT, 0.6), 0.85 * O.whiteout[i]);
      if (O.ice[i]) c = mix(c, h.isDay ? GLAZE : mix(GLAZE, NIGHT, 0.6), 0.5);
      if (O.eye[i]) c = mix(c, CLEAR, 0.5); // a glimpse of sky in the eye
    }
    return `<stop offset="${(x(i)).toFixed(1)}%" stop-color="${rgb(c)}"/>`;
  }).join("");

  // Sun at the hottest daylight hour, or a moon on a day with no daylight.
  const dayHours = H.map((h, i) => (h.isDay ? i : -1)).filter((i) => i >= 0);
  let body;
  if (dayHours.length) {
    const hot = dayHours.reduce((b, i) => (H[i].temp > H[b].temp ? i : b), dayHours[0]);
    const cold = dayHours.reduce((a, i) => a + (meta.deepCold?.[i] ?? 0), 0) / dayHours.length;
    const col = cold > 0.5 ? "#f4f6f8" : tempColor(H[hot].temp); // a pale, colourless sun
    const cx = Math.min(80, Math.max(20, x(hot)));
    // How much sun the day really had: thick cloud and rain through the daylight hours hide it.
    const cloudDay = dayHours.reduce((a, i) => a + H[i].cloud, 0) / dayHours.length / 100;
    const wetDay = dayHours.filter((i) => H[i].precip >= 0.2 || H[i].pop >= 60).length / dayHours.length;
    const seen = (1 - 0.9 * cloudDay) * (1 - 0.85 * wetDay);
    const haze = Math.min(1, Math.max(0.1, 0.1 + 0.9 * seen)).toFixed(2);
    body = `<g opacity="${haze}"><circle cx="${cx}" cy="36" r="20" fill="${col}" opacity=".22"/><circle cx="${cx}" cy="36" r="12" fill="${col}"/></g>`;
  } else {
    body = `<circle cx="68" cy="32" r="10" fill="#e8e4f8"/><circle cx="73" cy="28" r="9" fill="${rgb(mix(NIGHT, ICE_NIGHT, 0.9 * Math.max(...H.map((_, i) => meta.deepCold?.[i] ?? 0))))}"/>`;
  }

  // Clouds drift across the sun on grey days.
  const cloud = H.reduce((a, h) => a + h.cloud, 0) / H.length / 100;
  let clouds = "";
  for (let k = 0; k < Math.round(cloud * 4); k++) {
    const cx = 10 + rand() * 80, cy = 30 + rand() * 18, w = 16 + rand() * 14;
    clouds += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${w.toFixed(1)}" ry="${(w * 0.32).toFixed(1)}" fill="#fff" opacity="${(0.12 + cloud * 0.25).toFixed(2)}"/>`;
  }

  // Rain streaks and snowflakes under the wet hours, a bolt at each storm.
  let wet = "";
  H.forEach((h, i) => {
    if (h.precip <= 0 && h.pop < 40) return;
    const n = Math.min(5, 1 + Math.round(h.precip * 1.5));
    const op = Math.min(0.85, 0.25 + h.precip / 4 + h.pop / 400);
    for (let k = 0; k < n; k++) {
      const px = x(i) + (rand() - 0.5) * 4, py = 44 + rand() * 30;
      wet += CODES.snow.includes(h.code)
        ? `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r=".9" fill="#fff" opacity="${op.toFixed(2)}"/>`
        : `<path d="M${px.toFixed(1)} ${py.toFixed(1)}l-1.4 5" stroke="#bfe3ff" stroke-width=".7" stroke-linecap="round" opacity="${op.toFixed(2)}"/>`;
    }
    if (CODES.thunder.includes(h.code) && i % 3 === 0) {
      const bx = x(i);
      wet += `<path d="M${bx + 1} 40l-4 9h3.5l-2.5 8 6-10.5h-3.6l2.4-6.5z" fill="#ffd23f"/>`;
    }
  });

  const city = meta.name.split(",")[0];
  // Long names shrink to leave the bottom-right corner for the flag.
  const size = Math.min(11, 118 / Math.max(city.length, 1));
  const date = new Date(`${meta.date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
  <defs>
    <linearGradient id="cv-sky">${stops}</linearGradient>
    <linearGradient id="cv-fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#cv-sky)"/>
  ${body}${aurora(forecast, meta, rand)}${clouds}${wet}
  <rect width="100" height="100" fill="url(#cv-fade)"/>
  ${flag(forecast.country)}
  <text x="7" y="11" fill="#fff" opacity=".8" font-family="JetBrains Mono, monospace" font-size="4" letter-spacing=".6">WEATHERTUNES</text>
  <text x="7" y="${(92 - 6).toFixed(1)}" fill="#fff" font-family="Space Grotesk, sans-serif" font-weight="700" font-size="${size.toFixed(1)}">${esc(city)}</text>
  <text x="7" y="93" fill="#fff" opacity=".85" font-family="Inter, sans-serif" font-size="4.4">${esc(date)}</text>
</svg>`;
}
