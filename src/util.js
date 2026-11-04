// Small shared helpers: numbers, seeded randomness, and display formatting.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- Seeded randomness (same seed → same song) ---------------------------

export function hashString(s) {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy of arr (Fisher–Yates, drawing from rng). */
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Display formatting --------------------------------------------------

/** "midnight", "noon", "3 pm", "7:30 am". */
export function hourLabel(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (hh === 0 && mm === 0) return "midnight";
  if (hh === 12 && mm === 0) return "noon";
  const suffix = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

/**
 * Display units for the liner notes only; the music is the same either way.
 * "metric" = °C and km/h, "us" = °F and mph.
 */
export function formatTemp(c, units) {
  return units === "us" ? `${Math.round((c * 9) / 5 + 32)}\u00a0°F` : `${Math.round(c * 10) / 10}\u00a0°C`;
}
export function formatSpeed(kmh, units) {
  return units === "us" ? `${Math.round(kmh / 1.609)}\u00a0mph` : `${Math.round(kmh)}\u00a0km/h`;
}

/** US AQI category name. */
export function aqiCategory(v) {
  return v <= 50 ? "good" : v <= 100 ? "moderate" : v <= 150 ? "unhealthy for sensitive groups"
    : v <= 200 ? "unhealthy" : v <= 300 ? "very unhealthy" : "hazardous";
}
/** UV index category name. */
export function uvCategory(v) {
  return v < 3 ? "low" : v < 6 ? "moderate" : v < 8 ? "high" : v < 11 ? "very high" : "extreme";
}
