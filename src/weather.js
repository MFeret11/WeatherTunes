// Open-Meteo access: today's forecast for a place, city search, and turning a
// /v1/forecast response into a clean Forecast object (exactly 24 hours, no
// nulls, plain field names).

const FIELDS = {
  temp: "temperature_2m",
  rh: "relative_humidity_2m",
  pressure: "pressure_msl",
  wind: "wind_speed_10m",
  gust: "wind_gusts_10m",
  dir: "wind_direction_10m",
  pop: "precipitation_probability",
  precip: "precipitation",
  cloud: "cloud_cover",
  code: "weather_code",
  isDay: "is_day",
  cape: "cape",
};
// Used only when a whole column is missing.
const DEFAULTS = { temp: 15, rh: 60, pressure: 1013, wind: 10, gust: 15, dir: 0, pop: 0, precip: 0, cloud: 50, code: 0, isDay: 1, cape: 0 };
// These are categories, so gaps copy the nearest value instead of averaging.
const DISCRETE = new Set(["code", "isDay"]);

/** Fill nulls by linear interpolation (or nearest value for categories). */
function fillGaps(values, fallback, discrete) {
  const out = values.slice();
  const known = out.map((v, i) => (v == null || Number.isNaN(v) ? -1 : i)).filter((i) => i >= 0);
  if (!known.length) return out.map(() => fallback);
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null && !Number.isNaN(out[i])) continue;
    const prev = known.filter((k) => k < i).pop();
    const next = known.find((k) => k > i);
    if (prev == null) out[i] = out[next];
    else if (next == null) out[i] = out[prev];
    else if (discrete) out[i] = i - prev <= next - i ? out[prev] : out[next];
    else out[i] = out[prev] + ((out[next] - out[prev]) * (i - prev)) / (next - prev);
  }
  return out;
}

function hourOf(iso) {
  // "2025-07-09T05:26" → 5.433 (local time, as returned with timezone=auto)
  const m = /T(\d\d):(\d\d)/.exec(iso || "");
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

export function normalizeForecast(raw, name) {
  const h = raw.hourly || {};
  const cols = {};
  for (const [key, src] of Object.entries(FIELDS)) {
    let col = (h[src] || []).slice(0, 24);
    while (col.length < 24) col.push(null);
    cols[key] = fillGaps(col, DEFAULTS[key], DISCRETE.has(key));
  }
  const hours = Array.from({ length: 24 }, (_, i) => {
    const o = { hour: i };
    for (const key of Object.keys(FIELDS)) o[key] = cols[key][i];
    return o;
  });

  const d = raw.daily || {};
  let sunrise = hourOf(d.sunrise && d.sunrise[0]);
  let sunset = hourOf(d.sunset && d.sunset[0]);
  // Polar night or midnight sun: Open-Meteo returns equal times.
  if (sunrise != null && sunrise === sunset) sunrise = sunset = null;

  const date = (d.time && d.time[0]) || ((h.time && h.time[0]) || "").slice(0, 10);
  return {
    name: name || raw.name || "Somewhere",
    lat: raw.latitude,
    lon: raw.longitude,
    timezone: raw.timezone,
    date,
    sunrise,
    sunset,
    hours,
  };
}

// ---- Fetching ----------------------------------------------------------------

const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";
const CACHE_MINUTES = 60; // Open-Meteo updates hourly
const TIMEOUT_MS = 10000;

/** Coordinates are rounded to 0.1° (about 11 km) before they leave the browser. */
export const roundCoord = (x) => Math.round(Number(x) * 10) / 10;

export function forecastUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: roundCoord(lat).toFixed(1),
    longitude: roundCoord(lon).toFixed(1),
    hourly: Object.values(FIELDS).join(","),
    daily: "sunrise,sunset",
    timezone: "auto",
    forecast_days: "1",
  });
  return `${FORECAST_API}?${q}`;
}

async function getJson(url, fetchFn) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`weather service returned ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function session() {
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * Today's forecast (in the place's own time zone) as a normalized Forecast.
 * place = { name, lat, lon }. Cached for an hour per session.
 */
export async function fetchForecast(place, { fetchFn = fetch, storage = session(), now = Date.now() } = {}) {
  const lat = roundCoord(place.lat);
  const lon = roundCoord(place.lon);
  const key = `wt:forecast:${lat.toFixed(1)},${lon.toFixed(1)}`;
  let raw = null;
  try {
    const hit = storage && JSON.parse(storage.getItem(key));
    if (hit && now - hit.savedAt < CACHE_MINUTES * 60000) raw = hit.raw;
  } catch { /* bad or blocked cache: fetch instead */ }
  if (!raw) {
    raw = await getJson(forecastUrl(lat, lon), fetchFn);
    if (!raw.hourly || !raw.hourly.temperature_2m) throw new Error("forecast had no hourly data");
    try { storage && storage.setItem(key, JSON.stringify({ savedAt: now, raw })); } catch { /* full or blocked */ }
  }
  const f = normalizeForecast(raw, place.name);
  f.lat = lat; // the rounded values, so the song's seed matches a shared link
  f.lon = lon;
  return f;
}

/** City search. Returns [{ name, label, lat, lon }], best matches first. */
export async function searchPlaces(query, { fetchFn = fetch, count = 6 } = {}) {
  const name = String(query || "").trim();
  if (name.length < 2) return [];
  const q = new URLSearchParams({ name, count: String(count), language: "en", format: "json" });
  const data = await getJson(`${GEOCODE_API}?${q}`, fetchFn);
  return (data.results || []).map((r) => {
    const parts = [r.name, r.admin1, r.country].filter((x, i, a) => x && a.indexOf(x) === i);
    return {
      name: r.country ? `${r.name}, ${r.country}` : r.name,
      label: parts.join(", "),
      lat: roundCoord(r.latitude),
      lon: roundCoord(r.longitude),
    };
  });
}

// "Song of the day" before someone picks a place: one city per day, in turn.
export const FEATURED = [
  { name: "Kyoto, Japan", lat: 35.0, lon: 135.8 },
  { name: "Reykjavik, Iceland", lat: 64.1, lon: -21.9 },
  { name: "New Orleans, United States", lat: 30.0, lon: -90.1 },
  { name: "Cape Town, South Africa", lat: -33.9, lon: 18.4 },
  { name: "Buenos Aires, Argentina", lat: -34.6, lon: -58.4 },
  { name: "Mumbai, India", lat: 19.1, lon: 72.9 },
  { name: "Vienna, Austria", lat: 48.2, lon: 16.4 },
  { name: "Sydney, Australia", lat: -33.9, lon: 151.2 },
  { name: "Havana, Cuba", lat: 23.1, lon: -82.4 },
  { name: "Nashville, United States", lat: 36.2, lon: -86.8 },
  { name: "Lagos, Nigeria", lat: 6.5, lon: 3.4 },
  { name: "Seoul, South Korea", lat: 37.6, lon: 127.0 },
  { name: "Lisbon, Portugal", lat: 38.7, lon: -9.1 },
  { name: "Anchorage, United States", lat: 61.2, lon: -149.9 },
];

export function featuredPlace(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return FEATURED[day % FEATURED.length];
}
