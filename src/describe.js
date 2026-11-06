// describe(forecast, units) → two or three easy sentences about the day's weather,
// the way you'd tell a friend. Weather only; no music here.

import { hourLabel, formatSpeed, aqiCategory, uvCategory } from "./util.js";
import { daySky } from "./score/sky.js";
import { CODES } from "./mapping.js";

// Brightest first, so we can tell "clearing" from "turning".
const RANK = ["clear", "partly", "cloudy", "overcast", "fog", "drizzle", "showers", "rain", "snow", "thunder"];
const PERIODS = [[0, 6], [6, 12], [12, 18], [18, 24]];
const IN = ["overnight", "in the morning", "in the afternoon", "in the evening"];
const BARE = ["overnight", "morning", "afternoon", "evening"];

function condition(h) {
  const c = h.code;
  if (CODES.thunder.includes(c)) return "thunder";
  if (CODES.snow.includes(c)) return "snow";
  if (c >= 80 && c <= 82) return "showers";
  if (c >= 61 && c <= 67) return "rain";
  if (c >= 51 && c <= 57) return "drizzle";
  if (CODES.fog.includes(c)) return "fog";
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

/** How much fell, as a clause for the sky sentence ("about 1.4 inches in all"), or "". */
function amountClause(H, units) {
  const total = H.reduce((a, h) => a + h.precip, 0);
  if (total < 0.5) return "";
  const snow = H.filter((h) => CODES.snow.includes(h.code)).length > H.filter((h) => h.precip > 0).length / 2;
  const inches = total / 25.4;
  const amount = units === "us" ? `${inches.toFixed(inches >= 1 ? 1 : 2)} ${inches >= 0.995 && inches < 1.05 ? "inch" : "inches"}` : `${Math.round(total)} mm`;
  return snow ? `about ${amount} of melted snow in all` : `about ${amount} in all`;
}

/** A dry day's small chance of a shower, as its own short sentence. */
function showerSentence(H) {
  const total = H.reduce((a, h) => a + h.precip, 0);
  const pop = Math.max(...H.map((h) => h.pop));
  return total < 0.5 && pop >= 30 ? `There's a ${pop}% chance of a passing shower.` : "";
}

/** How the day feels: temperature, humidity, feels-like, the day's shape and the wind, in one sentence. */
function feelSentence(H, units) {
  const temps = H.map((h) => h.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const dew = H.reduce((a, h) => a + (h.dew ?? 0), 0) / H.length;
  const feel = mean < -10 ? "bitterly cold" : mean < 0 ? "freezing" : mean < 8 ? "cold" : mean < 15 ? "cool"
    : mean < 22 ? "mild" : mean < 28 ? "warm" : mean < 34 ? "hot" : "scorching";
  // The dew point says how sticky the air feels, whatever the temperature.
  const muggy = dew >= 21 ? " and oppressively humid" : dew >= 18 ? " and muggy" : mean >= 10 && dew <= 0 ? " and dry" : "";
  const t = (c) => (units === "us" ? `${Math.round((c * 9) / 5 + 32)} °F` : `${Math.round(c)} °C`);
  const loI = temps.indexOf(lo), hiI = temps.indexOf(hi);
  // Feels-like at the extremes: humidity at the warmest hour, wind at the coldest.
  const feelsHi = H[hiI].feels, feelsLo = H[loI].feels;
  const extra = [];
  if (feelsHi != null && feelsHi - hi >= 3) extra.push(`feeling more like ${t(feelsHi)}`);
  else if (feelsLo != null && lo - feelsLo >= 4) extra.push(`feeling like ${t(feelsLo)}`);
  // The day's shape, only when it isn't the usual cool morning and warm afternoon.
  if (Math.round(hi) - Math.round(lo) <= 2) extra.push(`holding near ${t(mean)} all day`);
  else if (hiI <= 11 && loI >= 17) extra.push("cooling off as the day goes on");
  else if (hiI <= 5 && loI >= 9) extra.push("getting colder through the day");
  else if (hiI >= 20) extra.push("getting milder into the night");
  // The wind.
  const wind = H.reduce((a, h) => a + h.wind, 0) / H.length;
  const gust = Math.max(...H.map((h) => h.gust));
  const at = hourLabel(H.findIndex((h) => h.gust === gust));
  const breeze = wind < 8 ? "with barely a breeze" : wind < 18 ? "with a gentle breeze" : wind < 30 ? "with a brisk wind" : wind < 45 ? "with a strong wind" : "with a gale blowing";
  const gusts = gust >= 45 ? `, gusting to ${formatSpeed(gust, units)} around ${at}` : "";
  const body = `It's ${feel}${muggy}${extra.length ? `, ${extra.join(", ")}` : ""}`;
  return `${body}${extra.length ? "," : ""} ${breeze}${gusts}.`;
}

/** Air quality, UV, snow on the ground and frost: only when they're worth a mention. */
function airSentences(f, units) {
  let K;
  try { K = daySky(f); } catch { return []; }
  const out = [];
  if (K.snowCm >= 1) out.push(`there's ${units === "us" ? `${Math.round(K.snowCm / 2.54)}\u00a0in` : `${Math.round(K.snowCm)}\u00a0cm`} of snow on the ground`);
  if (K.firstFrost) out.push("it's the first frost of the season");
  else if (K.frostHours.length) out.push("frost is likely early on");
  if (K.aqiMax != null && K.aqiMax > 100) out.push(`air quality is ${aqiCategory(K.aqiMax)} (AQI ${Math.round(K.aqiMax)}) around ${hourLabel(K.aqiMaxHour)}`);
  if (K.uvMax != null && K.uvMax >= 8) out.push(`UV is ${uvCategory(K.uvMax)} around ${hourLabel(K.uvMaxHour)}`);
  if (!out.length) return [];
  const list = out.length > 1 ? `${out.slice(0, -1).join(", ")} and ${out[out.length - 1]}` : out[0];
  return [`${list[0].toUpperCase()}${list.slice(1)}.`];
}

/**
 * The day's weather in two or three easy sentences: the sky (and how much fell),
 * how it feels, then anything worth a heads-up. The high and low are already in
 * the line under the place name, so they aren't repeated here.
 */
export function describe(f, units = "metric") {
  const H = f.hours;
  const amount = amountClause(H, units);
  const sky = amount ? skySentence(H).replace(/\.$/, `, ${amount}.`) : skySentence(H);
  return [sky, showerSentence(H), feelSentence(H, units), ...airSentences(f, units)].filter(Boolean).join(" ");
}
