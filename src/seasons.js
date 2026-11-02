// Season suite: a place's year as four movements, one typical day per season.
//
// "Typical" comes from 30 years of daily weather (Open-Meteo's ERA5 archive):
// for each season, the middle value of its days' temperature, daily range,
// cloud, rain and wind. The day picked is the real day closest to all of them.
// It comes from the recent years Open-Meteo keeps full hourly forecasts for,
// so each movement is a real day, played like any other.

import { HOURLY_FIELDS, normalizeForecast, roundCoord, getJson, holidaysFor } from "./weather.js";

const CLIMATE_API = "https://archive-api.open-meteo.com/v1/archive";
const DAY_API = "https://historical-forecast-api.open-meteo.com/v1/forecast";
const AIR_API = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const CLIMATE_YEARS = 30;
export const HOURLY_SINCE = "2022-01-01"; // full hourly forecasts are kept from here on
const CACHE_DAYS = 30; // a place's typical days barely change, so keep them a month
const TROPICS = 23.5; // nearer the equator than this, seasons go by months, not names

// Meteorological seasons, in calendar order from December.
const SEASONS = [
  { id: "djf", months: [12, 1, 2], span: "Dec–Feb", north: "Winter", south: "Summer" },
  { id: "mam", months: [3, 4, 5], span: "Mar–May", north: "Spring", south: "Autumn" },
  { id: "jja", months: [6, 7, 8], span: "Jun–Aug", north: "Summer", south: "Winter" },
  { id: "son", months: [9, 10, 11], span: "Sep–Nov", north: "Autumn", south: "Spring" },
];

/**
 * The four seasons for a latitude, in the order they play: winter first.
 * Each { id, months, span, name }. Near the equator `name` is the months ("Dec–Feb").
 */
export function seasonsFor(lat) {
  const list = SEASONS.map((s) => ({
    id: s.id, months: s.months, span: s.span,
    name: Math.abs(lat) < TROPICS ? s.span : lat >= 0 ? s.north : s.south,
  }));
  if (Math.abs(lat) < TROPICS) return list;
  const winter = list.findIndex((s) => s.name === "Winter");
  return [...list.slice(winter), ...list.slice(0, winter)];
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const spread = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

// What makes a day typical, from the daily archive: [label, value from a row].
const FEATURES = [
  ["temp", (r) => r.mean],
  ["range", (r) => r.max - r.min],
  ["cloud", (r) => r.cloud],
  ["rain", (r) => Math.sqrt(r.precip)], // square root, so one downpour doesn't swamp the rest
  ["wind", (r) => r.wind],
];

/**
 * The most typical day of each season, from a daily archive response.
 * Returns [{ season, date, climate }] in play order; climate holds the season's
 * middle temperature (°C), how often it rains or snows (share of days with
 * ≥ 1 mm), how many years it covers, and the day's own temperature.
 * A season with no recent day to pick is left out.
 */
export function typicalDays(daily, lat, { since = HOURLY_SINCE } = {}) {
  const d = daily || {};
  const rows = (d.time || []).map((date, i) => ({
    date, month: Number(date.slice(5, 7)),
    mean: d.temperature_2m_mean?.[i], max: d.temperature_2m_max?.[i], min: d.temperature_2m_min?.[i],
    cloud: d.cloud_cover_mean?.[i], precip: d.precipitation_sum?.[i], wind: d.wind_speed_10m_mean?.[i],
  })).filter((r) => [r.mean, r.max, r.min, r.cloud, r.precip, r.wind].every(Number.isFinite));
  const out = [];
  for (const season of seasonsFor(lat)) {
    const all = rows.filter((r) => season.months.includes(r.month));
    const recent = all.filter((r) => r.date >= since);
    if (all.length < 30 || !recent.length) continue;
    const vals = FEATURES.map(([, f]) => all.map(f));
    const mid = vals.map(median);
    const scale = vals.map((v) => Math.max(spread(v), 1e-6));
    const dist = (r) => FEATURES.reduce((t, [, f], k) => t + ((f(r) - mid[k]) / scale[k]) ** 2, 0);
    const pick = recent.reduce((best, r) => (dist(r) < dist(best) ? r : best));
    out.push({
      season,
      date: pick.date,
      climate: {
        temp: +median(all.map((r) => r.mean)).toFixed(1),
        wetShare: +(all.filter((r) => r.precip >= 1).length / all.length).toFixed(2),
        years: new Set(all.map((r) => r.date.slice(0, 4))).size,
        dayTemp: pick.mean,
      },
    });
  }
  return out;
}

const coords = (lat, lon) => ({ latitude: roundCoord(lat).toFixed(1), longitude: roundCoord(lon).toFixed(1) });

/** Thirty full years of daily weather, ending a week ago (the archive runs a few days behind). */
export function climateUrl(lat, lon, now = Date.now()) {
  const end = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const start = `${Number(end.slice(0, 4)) - CLIMATE_YEARS}${end.slice(4)}`;
  const q = new URLSearchParams({
    ...coords(lat, lon), start_date: start, end_date: end, timezone: "auto",
    daily: "temperature_2m_mean,temperature_2m_max,temperature_2m_min,cloud_cover_mean,precipitation_sum,wind_speed_10m_mean",
  });
  return `${CLIMATE_API}?${q}`;
}

/** One past day, hour by hour, in the same shape as today's forecast. */
export function dayUrl(lat, lon, date) {
  const q = new URLSearchParams({
    ...coords(lat, lon), start_date: date, end_date: date, timezone: "auto",
    hourly: HOURLY_FIELDS.join(","), daily: "sunrise,sunset",
  });
  return `${DAY_API}?${q}`;
}

/**
 * Past days don't always keep the chance of rain. When it's missing, use what
 * actually fell: an hour with rain or snow had it for certain.
 * Returns true if the chance was filled in this way.
 */
export function rainFromRecord(raw) {
  const h = raw.hourly || {};
  const pop = h.precipitation_probability;
  if (Array.isArray(pop) && pop.some((v) => v != null)) return false;
  h.precipitation_probability = (h.precipitation || []).map((mm) => (mm >= 0.1 ? 100 : 0));
  return true;
}

function local() {
  try { return window.localStorage; } catch { return null; }
}

/**
 * The season suite for a place ({ name, lat, lon, cc }): four movements,
 * [{ season, date, climate, forecast }], each forecast ready for compose().
 * The days are kept in this browser for a month.
 */
export async function fetchSuite(place, { fetchFn = fetch, storage = local(), now = Date.now() } = {}) {
  const lat = roundCoord(place.lat), lon = roundCoord(place.lon);
  const key = `wt:suite:${lat.toFixed(1)},${lon.toFixed(1)}`;
  let saved = null;
  try {
    const hit = storage && JSON.parse(storage.getItem(key));
    if (hit && now - hit.savedAt < CACHE_DAYS * 86400000 && hit.days?.length) saved = hit.days;
  } catch { /* fetch instead */ }
  if (!saved) {
    const climate = await getJson(climateUrl(lat, lon, now), fetchFn, 20000);
    const picks = typicalDays(climate.daily, lat);
    if (picks.length < 4) throw new Error("not enough past weather here for four seasons");
    saved = await Promise.all(picks.map(async (p) => {
      const raw = await getJson(dayUrl(lat, lon, p.date), fetchFn);
      if (!raw.hourly?.temperature_2m) throw new Error(`no hourly weather for ${p.date}`);
      const observed = rainFromRecord(raw);
      const air = await getJson(`${AIR_API}?${new URLSearchParams({ ...coords(lat, lon), start_date: p.date, end_date: p.date, hourly: "us_aqi", timezone: "auto" })}`, fetchFn, 4000).catch(() => null);
      raw.extras = { aqi: air?.hourly?.us_aqi ?? null, kp: null, holidays: null, minTemps: null };
      return { season: p.season, date: p.date, climate: p.climate, observed, raw };
    }));
    try { storage && storage.setItem(key, JSON.stringify({ savedAt: now, days: saved })); } catch { /* full */ }
  }
  // Holidays are looked up fresh (they have their own cache), so the saved days stay small.
  return Promise.all(saved.map(async (d) => {
    const raw = { ...d.raw, extras: { ...d.raw.extras } };
    if (place.cc) raw.extras.holidays = await holidaysFor(Number(d.date.slice(0, 4)), place.cc, fetchFn).catch(() => null);
    raw.country_code = place.cc || null;
    const forecast = normalizeForecast(raw, place.name);
    forecast.lat = lat;
    forecast.lon = lon;
    forecast.observed = d.observed; // rain shown as what fell, not a chance
    return { season: d.season, date: d.date, climate: d.climate, forecast };
  }));
}
