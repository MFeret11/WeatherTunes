// Turns an Open-Meteo /v1/forecast response into a clean Forecast object:
// exactly 24 hours, no nulls, and plain field names.

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
};
// Used only when a whole column is missing.
const DEFAULTS = { temp: 15, rh: 60, pressure: 1013, wind: 10, gust: 15, dir: 0, pop: 0, precip: 0, cloud: 50, code: 0, isDay: 1 };
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
