// A small "album cover" for the day, drawn from the forecast: the sky colour
// changes across the cover from midnight (left) to 11 pm (right), the sun sits at
// the hottest hour in the colour of that temperature, and rain, snow and
// lightning fall where they do in the day.

import { tempColor } from "./icons.js";
import { THUNDER_CODES, SNOW_CODES } from "./mapping.js";

const NIGHT = [24, 22, 52];
const CLEAR = [104, 170, 228];
const GREY = [148, 154, 170];
const STORM = [56, 60, 92];
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c) => `rgb(${c})`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function rng(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}

/** forecast: normalized forecast; meta: score.meta (for hourBrightness). Returns an SVG string. */
export function coverArt(forecast, meta) {
  const H = forecast.hours;
  const x = (i) => ((i + 0.5) / H.length) * 100;
  const rand = rng(`${meta.name}|${meta.date}`);

  // Sky, hour by hour.
  const stops = H.map((h, i) => {
    const storm = THUNDER_CODES.includes(h.code);
    const day = storm ? STORM : mix(CLEAR, GREY, h.cloud / 100);
    const c = mix(NIGHT, day, Math.max(0.05, meta.hourBrightness[i]));
    return `<stop offset="${(x(i)).toFixed(1)}%" stop-color="${rgb(c)}"/>`;
  }).join("");

  // Sun at the hottest daylight hour, or a moon on a day with no daylight.
  const dayHours = H.map((h, i) => (h.isDay ? i : -1)).filter((i) => i >= 0);
  let body;
  if (dayHours.length) {
    const hot = dayHours.reduce((b, i) => (H[i].temp > H[b].temp ? i : b), dayHours[0]);
    const col = tempColor(H[hot].temp);
    const cx = Math.min(80, Math.max(20, x(hot)));
    const haze = (1 - 0.6 * (H[hot].cloud / 100)).toFixed(2); // a pale sun behind thick cloud
    body = `<g opacity="${haze}"><circle cx="${cx}" cy="36" r="20" fill="${col}" opacity=".22"/><circle cx="${cx}" cy="36" r="12" fill="${col}"/></g>`;
  } else {
    body = `<circle cx="68" cy="32" r="10" fill="#e8e4f8"/><circle cx="73" cy="28" r="9" fill="${rgb(NIGHT)}"/>`;
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
      wet += SNOW_CODES.includes(h.code)
        ? `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r=".9" fill="#fff" opacity="${op.toFixed(2)}"/>`
        : `<path d="M${px.toFixed(1)} ${py.toFixed(1)}l-1.4 5" stroke="#bfe3ff" stroke-width=".7" stroke-linecap="round" opacity="${op.toFixed(2)}"/>`;
    }
    if (THUNDER_CODES.includes(h.code) && i % 3 === 0) {
      const bx = x(i);
      wet += `<path d="M${bx + 1} 40l-4 9h3.5l-2.5 8 6-10.5h-3.6l2.4-6.5z" fill="#ffd23f"/>`;
    }
  });

  const city = meta.name.split(",")[0];
  const size = Math.min(11, 150 / Math.max(city.length, 1));
  const date = new Date(`${meta.date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
  <defs>
    <linearGradient id="cv-sky">${stops}</linearGradient>
    <linearGradient id="cv-fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#cv-sky)"/>
  ${body}${clouds}${wet}
  <rect width="100" height="100" fill="url(#cv-fade)"/>
  <text x="7" y="11" fill="#fff" opacity=".8" font-family="JetBrains Mono, monospace" font-size="4" letter-spacing=".6">WEATHERTUNES</text>
  <text x="7" y="${(92 - 6).toFixed(1)}" fill="#fff" font-family="Space Grotesk, sans-serif" font-weight="700" font-size="${size.toFixed(1)}">${esc(city)}</text>
  <text x="7" y="93" fill="#fff" opacity=".85" font-family="Inter, sans-serif" font-size="4.4">${esc(date)}</text>
</svg>`;
}
