// The sky over a place on a date, worked out in the browser: the moon's phase,
// rise and set, lunar eclipses, solstices and equinoxes, meteor showers, and
// the place's magnetic latitude (for auroras). Pure: no network, no DOM, no clock.
//
// Positions use low-precision formulas (the sun from the Astronomical Almanac,
// the moon from Paul Schlyter's orbital elements with its main perturbations).
// They are good to a few minutes of rise time, which is plenty for music.

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const atan2d = (y, x) => Math.atan2(y, x) / RAD;
const asind = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / RAD;
const norm = (d) => ((d % 360) + 360) % 360;
const HOUR = 3600000;

/** Days since J2000.0 (2000-01-01 12:00 UTC). */
const days = (ms) => ms / 86400000 - 10957.5;

/** The sun's ecliptic longitude (degrees, of date). */
export function sunLongitude(ms) {
  const n = days(ms);
  const L = 280.46 + 0.9856474 * n;
  const g = 357.528 + 0.9856003 * n;
  return norm(L + 1.915 * sin(g) + 0.02 * sin(2 * g));
}

/** The moon's ecliptic longitude and latitude (degrees) and distance (Earth radii). */
export function moonPosition(ms) {
  const d = days(ms) + 1.5; // Schlyter's day count starts at 2000 Jan 0.0
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666;
  const e = 0.0549;
  const M = norm(115.3654 + 13.0649929509 * d);
  let E = M + (e / RAD) * sin(M) * (1 + e * cos(M));
  for (let k = 0; k < 5; k++) E -= (E - (e / RAD) * sin(E) - M) / (1 - e * cos(E));
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = atan2d(yv, xv);
  let r = Math.hypot(xv, yv);
  const xh = r * (cos(N) * cos(v + w) - sin(N) * sin(v + w) * cos(i));
  const yh = r * (sin(N) * cos(v + w) + cos(N) * sin(v + w) * cos(i));
  const zh = r * sin(v + w) * sin(i);
  let lon = atan2d(yh, xh);
  let lat = atan2d(zh, Math.hypot(xh, yh));
  // Main perturbations (evection, variation, the yearly term and smaller ones).
  const Ms = 356.047 + 0.9856002585 * d;
  const Ls = Ms + 282.9404 + 4.70935e-5 * d;
  const Lm = N + w + M;
  const D = Lm - Ls;
  const F = Lm - N;
  lon += -1.274 * sin(M - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms) - 0.059 * sin(2 * M - 2 * D)
    - 0.057 * sin(M - 2 * D + Ms) + 0.053 * sin(M + 2 * D) + 0.046 * sin(2 * D - Ms) + 0.041 * sin(M - Ms)
    - 0.035 * sin(D) - 0.031 * sin(M + Ms) - 0.015 * sin(2 * F - 2 * D) + 0.011 * sin(M - 4 * D);
  lat += -0.173 * sin(F - 2 * D) - 0.055 * sin(M - F - 2 * D) - 0.046 * sin(M + F - 2 * D)
    + 0.033 * sin(F + 2 * D) + 0.017 * sin(2 * M + F);
  r += -0.58 * cos(M - 2 * D) - 0.46 * cos(2 * D);
  return { lon: norm(lon), lat, r };
}

/** Altitude (degrees) of a body at ecliptic (lon, lat) seen from (latDeg, lonDeg) at time ms. */
function altitude(ms, eclLon, eclLat, latDeg, lonDeg) {
  const eps = 23.4393 - 3.563e-7 * days(ms);
  const x = cos(eclLat) * cos(eclLon);
  const y = cos(eps) * cos(eclLat) * sin(eclLon) - sin(eps) * sin(eclLat);
  const z = sin(eps) * cos(eclLat) * sin(eclLon) + cos(eps) * sin(eclLat);
  const ra = atan2d(y, x);
  const dec = asind(z);
  const lst = 280.46061837 + 360.98564736629 * days(ms) + lonDeg;
  return asind(sin(latDeg) * sin(dec) + cos(latDeg) * cos(dec) * cos(lst - ra));
}

export function sunAltitude(ms, lat, lon) {
  return altitude(ms, sunLongitude(ms), 0, lat, lon);
}

/** The moon's altitude as seen from the ground (parallax applied), in degrees. */
export function moonAltitude(ms, lat, lon) {
  const m = moonPosition(ms);
  const geo = altitude(ms, m.lon, m.lat, lat, lon);
  return geo - asind(1 / m.r) * cos(geo);
}

/** How far the moon is ahead of the sun, 0–360° (0 new, 90 first quarter, 180 full). */
export function elongation(ms) {
  return norm(moonPosition(ms).lon - sunLongitude(ms));
}

/** Fraction of the moon's face that is lit, 0–1. */
export function illumination(ms) {
  const m = moonPosition(ms);
  const psi = Math.acos(cos(m.lat) * cos(m.lon - sunLongitude(ms))) / RAD; // sun–moon angle
  return (1 - cos(psi)) / 2;
}

// ---- Local time ---------------------------------------------------------------

/** Minutes ahead of UTC for an IANA time zone at a moment (null if the browser can't tell). */
export function zoneOffset(timeZone, ms) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return Math.round((asUtc - ms) / 60000);
  } catch {
    return null;
  }
}

/** UTC time (ms) of local midnight on `date` (YYYY-MM-DD), and the offset used (minutes). */
export function localMidnight(date, timeZone, fallbackOffsetMin = 0) {
  const [y, m, d] = date.split("-").map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  const off = (timeZone && zoneOffset(timeZone, noon)) ?? fallbackOffsetMin;
  return { start: Date.UTC(y, m - 1, d) - off * 60000, offset: off };
}

// ---- Events within one local day ------------------------------------------------

/** Times (as local hours, 0–24) where f(t) crosses `level` during the day, rising or falling. */
function crossings(start, f, level, stepMin = 10) {
  const out = [];
  let t0 = start;
  let v0 = f(t0) - level;
  for (let k = 1; k <= (24 * 60) / stepMin; k++) {
    const t1 = start + k * stepMin * 60000;
    const v1 = f(t1) - level;
    if ((v0 < 0) !== (v1 < 0)) {
      out.push({ hour: (t0 + ((t1 - t0) * v0) / (v0 - v1) - start) / HOUR, rising: v1 > v0 });
    }
    t0 = t1;
    v0 = v1;
  }
  return out;
}

/** The moment (ms) in [a, b] where an angle passes `target` (degrees), by bisection. */
function whenAngle(a, b, f, target) {
  const g = (t) => ((f(t) - target + 540) % 360) - 180;
  for (let k = 0; k < 40; k++) {
    const m = (a + b) / 2;
    if ((g(a) < 0) === (g(m) < 0)) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Did an angle pass through `target` between t0 and t1 (moving forward)? */
function passes(f, t0, t1, target) {
  const a = ((f(t0) - target + 540) % 360) - 180;
  const b = ((f(t1) - target + 540) % 360) - 180;
  return a < 0 && b >= 0 && b - a < 90;
}

const PHASES = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon", "waning gibbous", "last quarter", "waning crescent"];

/**
 * The moon on a local day: { phase, illum (at local midnight→noon→midnight average), waxing,
 * elongation, rise, set (local hours or null), alt: [24] degrees at each mid-hour, eclipse }.
 * A main phase (new, quarters, full) is named only on the day it actually happens.
 */
export function moonDay(lat, lon, start) {
  const end = start + 24 * HOUR;
  const mid = start + 12 * HOUR;
  const el = elongation(mid);
  let phase = null;
  for (const [k, target] of [[0, 0], [2, 90], [4, 180], [6, 270]]) {
    if (passes(elongation, start, end, target)) phase = PHASES[k];
  }
  if (!phase) phase = PHASES[[1, 3, 5, 7][Math.floor(el / 90)]];
  const h0 = 0.125; // geocentric altitude at rise/set: parallax minus refraction
  const geoAlt = (t) => { const m = moonPosition(t); return altitude(t, m.lon, m.lat, lat, lon); };
  const cx = crossings(start, geoAlt, h0);
  const rise = cx.find((c) => c.rising)?.hour ?? null;
  const set = cx.find((c) => !c.rising)?.hour ?? null;
  const alt = Array.from({ length: 24 }, (_, i) => +moonAltitude(start + (i + 0.5) * HOUR, lat, lon).toFixed(2));

  // A lunar eclipse happens at a full moon close to the moon's node. The earth's
  // umbra is about 0.7° in radius and the moon about 0.26°, so |latitude| under
  // ~0.44° is total and under ~0.96° partial.
  let eclipse = null;
  if (passes(elongation, start, end, 180)) {
    const t = whenAngle(start, end, elongation, 180);
    const b = Math.abs(moonPosition(t).lat);
    if (b < 0.96) {
      eclipse = {
        type: b < 0.44 ? "total" : "partial",
        hour: +((t - start) / HOUR).toFixed(2),
        visible: moonAltitude(t, lat, lon) > 0,
      };
    }
  }
  return {
    phase,
    illum: +illumination(mid).toFixed(3),
    waxing: el < 180,
    elongation: +el.toFixed(1),
    rise, set, alt, eclipse,
  };
}

/** Sun altitude at each mid-hour of the local day (degrees). */
export function sunAltitudes(lat, lon, start) {
  return Array.from({ length: 24 }, (_, i) => +sunAltitude(start + (i + 0.5) * HOUR, lat, lon).toFixed(2));
}

// ---- The year's calendar --------------------------------------------------------

const SEASON_POINTS = [
  [0, "March equinox"], [90, "June solstice"], [180, "September equinox"], [270, "December solstice"],
];

/** A solstice or equinox falling on this local day: { name, kind, hour, lat } or null. */
export function seasonPoint(lat, start) {
  const end = start + 24 * HOUR;
  for (const [deg, name] of SEASON_POINTS) {
    if (!passes(sunLongitude, start, end, deg)) continue;
    const t = whenAngle(start, end, sunLongitude, deg);
    const solstice = deg % 180 === 90;
    // The June solstice is the longest day in the north and the shortest in the south.
    const longest = solstice && (deg === 90) === lat >= 0;
    return {
      name,
      kind: solstice ? "solstice" : "equinox",
      hour: +((t - start) / HOUR).toFixed(2),
      meaning: !solstice ? "day and night are close to equal"
        : Math.abs(lat) < 5 ? "the sun is at its furthest point from the equator"
          : longest ? "the longest day of the year" : "the shortest day of the year",
      longest: solstice && Math.abs(lat) >= 5 ? longest : null,
    };
  }
  return null;
}

// Major annual meteor showers: peak (month, day), the days either side worth
// watching, typical peak rate per hour (ZHR) and the radiant's declination.
export const SHOWERS = [
  { name: "Quadrantids", month: 1, day: 3, spread: 1, zhr: 110, dec: 49 },
  { name: "Lyrids", month: 4, day: 22, spread: 1, zhr: 18, dec: 34 },
  { name: "Eta Aquariids", month: 5, day: 6, spread: 2, zhr: 50, dec: -1 },
  { name: "Southern Delta Aquariids", month: 7, day: 30, spread: 2, zhr: 25, dec: -16 },
  { name: "Perseids", month: 8, day: 12, spread: 2, zhr: 100, dec: 58 },
  { name: "Orionids", month: 10, day: 21, spread: 1, zhr: 20, dec: 16 },
  { name: "Leonids", month: 11, day: 17, spread: 1, zhr: 15, dec: 22 },
  { name: "Geminids", month: 12, day: 14, spread: 1, zhr: 150, dec: 33 },
];

/** A meteor shower worth looking for from this latitude on this date, or null. */
export function meteorShower(date, lat) {
  const [y, m, d] = date.split("-").map(Number);
  const today = Date.UTC(y, m - 1, d);
  for (const s of SHOWERS) {
    for (const yy of [y - 1, y, y + 1]) {
      const gap = Math.round((today - Date.UTC(yy, s.month - 1, s.day)) / 86400000);
      // The radiant has to climb well above the horizon: at least 20° at its highest.
      if (Math.abs(gap) <= s.spread && 90 - Math.abs(lat - s.dec) >= 20) {
        return { name: s.name, zhr: s.zhr, peak: gap === 0, daysFromPeak: gap };
      }
    }
  }
  return null;
}

// ---- Auroras ---------------------------------------------------------------------

// The geomagnetic north pole (IGRF dipole, epoch 2025).
const GEOPOLE = { lat: 80.8, lon: -72.6 };

/** Geomagnetic latitude (degrees) of a place, from a tilted-dipole model of the earth's field. */
export function magneticLatitude(lat, lon) {
  return asind(sin(lat) * sin(GEOPOLE.lat) + cos(lat) * cos(GEOPOLE.lat) * cos(lon - GEOPOLE.lon));
}

/**
 * 0–1: how well an aurora could show from this magnetic latitude at activity Kp,
 * if the sky is dark and clear. The auroral oval's edge sits near 66.5° − 2°×Kp
 * (overhead); it can be seen on the horizon about 5° further from the pole.
 * Deep inside the polar cap (beyond ~78°) it fades again.
 */
export function auroraReach(magLat, kp) {
  const m = Math.abs(magLat);
  const edge = 66.5 - 2.04 * kp;
  const toward = Math.max(0, Math.min(1, (m - (edge - 5)) / 5));
  const cap = Math.max(0, Math.min(1, (82 - m) / 4));
  return +(toward * cap).toFixed(3);
}

/**
 * Everything above for one place and local day. `f` needs lat, lon, date and
 * timezone (or utcOffset minutes as a fallback).
 */
export function skyFor(f) {
  const { start, offset } = localMidnight(f.date, f.timezone, f.utcOffset ?? 0);
  return {
    start, offset,
    moon: moonDay(f.lat, f.lon, start),
    sunAlt: sunAltitudes(f.lat, f.lon, start),
    season: seasonPoint(f.lat, start),
    shower: meteorShower(f.date, f.lat),
    magLat: +magneticLatitude(f.lat, f.lon).toFixed(1),
  };
}
