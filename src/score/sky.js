// The sky and the air for a day, as the music uses it (from src/sky.js's astronomy
// plus the forecast's extras). Pure: no network, no DOM, no clock.

import * as M from "../mapping.js";
import { skyFor, auroraReach } from "../sky.js";
import { clamp, mean } from "../util.js";

/**
 * The sky and the air, hour by hour: moonlight, auroras, haze, UV, snow on the
 * ground and frost, plus the day's events (moonrise, eclipse, meteor shower,
 * solstice or equinox, holiday, first frost). Pure, from the forecast alone.
 */
export function daySky(f) {
  const H = f.hours;
  const X = f.extras ?? {};
  const sky = skyFor(f);
  const { moon } = sky;
  const dark = sky.sunAlt.map((a) => clamp(-a / M.DARK.darkSunAlt, 0, 1));
  const deepDark = sky.sunAlt.map((a) => clamp((-a - M.DARK.darkSunAlt) / (M.DARK.auroraSunAlt - M.DARK.darkSunAlt), 0, 1));
  const eclipse = moon.eclipse?.visible ? moon.eclipse : null;
  const moonlight = H.map((h, b) => {
    let l = moon.illum * clamp(moon.alt[b] / M.MOON.fullAlt, 0, 1) * dark[b] * (1 - M.MOON.cloudBlock * (h.cloud / 100));
    if (eclipse && Math.abs(b + 0.5 - eclipse.hour) <= 1) l *= M.MOON.eclipseLight;
    return +clamp(l, 0, 1).toFixed(3);
  });

  // Kp per hour: the 3-hour block (UTC) that holds the hour's middle.
  const kpAt = (b) => {
    const t = sky.start + (b + 0.5) * 3600000;
    return X.kp?.find((k) => t >= k.t && t < k.t + 3 * 3600000)?.kp ?? null;
  };
  const kp = H.map((_, b) => kpAt(b));
  const auroraReachH = kp.map((k) => (k == null ? 0 : auroraReach(sky.magLat, k)));
  const aurora = H.map((h, b) => +(auroraReachH[b] * deepDark[b] * (1 - h.cloud / 100) ** M.AURORA.clearPower).toFixed(3));

  const aqi = X.aqi ?? null;
  const A = M.AIR;
  const hazeAt = (v) => clamp((v - A.from) / (A.full - A.from), 0, 1)
    + (A.smokeMax - 1) * clamp((v - A.full) / (A.smokeFull - A.full), 0, 1);
  const haze = H.map((_, b) => (aqi ? +hazeAt(aqi[b]).toFixed(3) : 0));
  const uvShine = H.map((h) => +clamp((h.uv - M.UV.from) / (M.UV.full - M.UV.from), 0, 1).toFixed(3));
  const snowCm = mean(H.map((h) => h.snowDepth ?? 0));
  const cover = clamp(snowCm / M.SNOW_COVER.fullCm, 0, 1);

  const FR = M.FROST;
  const falling = (h) => h.precip >= 0.1 || M.CODES.snow.includes(h.code);
  const frostHours = H.map((h, b) => (b < FR.until && h.temp <= FR.maxTemp && h.cloud < FR.maxCloud && h.wind < FR.maxWind && !falling(h) ? b : -1)).filter((b) => b >= 0);
  const tMin = Math.min(...H.map((h) => h.temp));
  const past = X.minTemps;
  const firstFrost = tMin <= 0 && past != null && past.length >= FR.minHistory && past.every((t) => t > 0);

  const uvs = H.map((h) => h.uv ?? 0);
  const uvMax = Math.max(...uvs);
  const aqiMax = aqi ? Math.max(...aqi) : null;
  const moonUpAtNight = moonlight.some((l) => l > 0.05);
  return {
    sky, dark, moon, moonlight, eclipse, kp, kpMax: kp.some((k) => k != null) ? Math.max(...kp.filter((k) => k != null)) : null,
    aurora, auroraReach: auroraReachH,
    aqi, aqiMax, aqiMaxHour: aqi ? aqi.indexOf(aqiMax) : null, haze,
    uvMax: f.has?.uv === false ? null : uvMax, uvMaxHour: uvs.indexOf(uvMax), uvShine,
    snowCm: +snowCm.toFixed(1), cover,
    frostHours, firstFrost,
    holiday: X.holidays?.[0] ?? null,
    season: sky.season, shower: sky.shower, moonUpAtNight,
  };
}
