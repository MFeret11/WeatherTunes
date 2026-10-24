// describe(forecast, units) → a few plain sentences about the day's weather,
// like a forecaster would say it. Weather only; no music here.

import { hourLabel, formatSpeed } from "./compose.js";
import { THUNDER_CODES, SNOW_CODES } from "./mapping.js";

// Brightest first, so we can tell "clearing" from "turning".
const RANK = ["clear", "partly", "cloudy", "overcast", "fog", "drizzle", "showers", "rain", "snow", "thunder"];
const PERIODS = [[0, 6], [6, 12], [12, 18], [18, 24]];
const IN = ["overnight", "in the morning", "in the afternoon", "in the evening"];
const BARE = ["overnight", "morning", "afternoon", "evening"];

function condition(h) {
  const c = h.code;
  if (THUNDER_CODES.includes(c)) return "thunder";
  if (SNOW_CODES.includes(c)) return "snow";
  if (c >= 80 && c <= 82) return "showers";
  if (c >= 61 && c <= 67) return "rain";
  if (c >= 51 && c <= 57) return "drizzle";
  if (c === 45 || c === 48) return "fog";
  if (c === 3 || h.cloud >= 85) return "overcast";
  if (h.cloud >= 60) return "cloudy";
  if (c === 2 || h.cloud >= 25) return "partly";
  return "clear";
}

/** The condition that best sums up a stretch of hours: the worst one that lasts 2+ hours. */
function dominant(hours) {
  const counts = {};
  for (const h of hours) counts[condition(h)] = (counts[condition(h)] || 0) + 1;
  const lasting = Object.keys(counts).filter((k) => counts[k] >= 2 || RANK.indexOf(k) >= RANK.indexOf("drizzle"));
  const pool = lasting.length ? lasting : Object.keys(counts);
  return pool.sort((a, b) => RANK.indexOf(b) - RANK.indexOf(a))[0];
}

function noun(cond, hours) {
  const maxMm = Math.max(...hours.map((h) => h.precip));
  const day = hours.filter((h) => h.isDay).length > hours.length / 2;
  switch (cond) {
    case "thunder": return "thunderstorms";
    case "snow": return maxMm >= 2 ? "heavy snow" : maxMm < 0.3 ? "light snow" : "snow";
    case "showers": return "showers";
    case "rain": return maxMm >= 4 ? "heavy rain" : maxMm < 0.5 ? "light rain" : "rain";
    case "drizzle": return "drizzle";
    case "fog": return "fog";
    case "overcast": return "grey, overcast skies";
    case "cloudy": return "mostly cloudy skies";
    case "partly": return day ? "a mix of sun and cloud" : "partly cloudy skies";
    default: return day ? "sunshine" : "clear skies";
  }
}

function when(a, b) {
  if (a === 0 && b === 3) return "all day";
  if (a === b) return IN[a];
  return `from ${BARE[a]} into the ${BARE[b]}`.replace("into the overnight", "overnight");
}

function skySentence(H) {
  // One condition per quarter of the day, merged where neighbours match.
  const parts = PERIODS.map(([s, e]) => ({ cond: dominant(H.slice(s, e)), hours: H.slice(s, e) }));
  const runs = [];
  parts.forEach((p, i) => {
    const last = runs[runs.length - 1];
    if (last && last.cond === p.cond) { last.b = i; last.hours = last.hours.concat(p.hours); }
    else runs.push({ cond: p.cond, a: i, b: i, hours: p.hours });
  });
  const bits = runs.map((r, i) => {
    const text = `${noun(r.cond, r.hours)} ${when(r.a, r.b)}`;
    if (i === 0) return text;
    const brighter = RANK.indexOf(r.cond) < RANK.indexOf(runs[i - 1].cond);
    if (r.cond === "clear") return `clearing ${when(r.a, r.b)}`;
    const wet = RANK.indexOf(r.cond) >= RANK.indexOf("drizzle");
    return `${brighter ? (wet ? "easing to" : "clearing to") : "turning to"} ${text}`;
  });
  const s = bits.length > 2 ? `${bits.slice(0, -1).join(", ")}, then ${bits[bits.length - 1]}` : bits.join(", ");
  return s[0].toUpperCase() + s.slice(1) + ".";
}

function tempSentence(H, units) {
  const temps = H.map((h) => h.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const rh = H.reduce((a, h) => a + h.rh, 0) / H.length;
  const feel = mean < -10 ? "Bitterly cold" : mean < 0 ? "Freezing" : mean < 8 ? "Cold" : mean < 15 ? "Cool"
    : mean < 22 ? "Mild" : mean < 28 ? "Warm" : mean < 34 ? "Hot" : "Scorching";
  const muggy = mean >= 20 && rh >= 75 ? " and muggy" : mean < 28 && rh <= 30 ? " and dry" : "";
  const t = (c) => (units === "us" ? `${Math.round((c * 9) / 5 + 32)} °F` : `${Math.round(c)} °C`);
  const loAt = hourLabel(temps.indexOf(lo)), hiAt = hourLabel(temps.indexOf(hi));
  if (Math.round(hi) - Math.round(lo) <= 2) return `${feel}${muggy}, holding near ${t(mean)} all day.`;
  return `${feel}${muggy}, with a low of ${t(lo)} at ${loAt} and a high of ${t(hi)} at ${hiAt}.`;
}

function windSentence(H, units) {
  const wind = H.reduce((a, h) => a + h.wind, 0) / H.length;
  const gust = Math.max(...H.map((h) => h.gust));
  const at = hourLabel(H.findIndex((h) => h.gust === gust));
  const base = wind < 8 ? "Light winds" : wind < 18 ? "A gentle breeze" : wind < 30 ? "Breezy" : wind < 45 ? "Windy" : "A gale";
  return gust >= 45 ? `${base}, with gusts up to ${formatSpeed(gust, units)} around ${at}.` : `${base}.`;
}

function rainSentence(H, units) {
  const total = H.reduce((a, h) => a + h.precip, 0);
  if (total < 0.5) {
    const pop = Math.max(...H.map((h) => h.pop));
    return pop >= 30 ? `A ${pop}% chance of a passing shower, but little or nothing expected.` : "";
  }
  const snow = H.filter((h) => SNOW_CODES.includes(h.code)).length > H.filter((h) => h.precip > 0).length / 2;
  const amount = units === "us" ? `${(total / 25.4).toFixed(total >= 25.4 ? 1 : 2)} in` : `${Math.round(total)} mm`;
  return snow ? `About ${amount} of melted snow in all.` : `About ${amount} of rain in all.`;
}

export function describe(f, units = "metric") {
  const H = f.hours;
  return [skySentence(H), tempSentence(H, units), windSentence(H, units), rainSentence(H, units)].filter(Boolean).join(" ");
}
