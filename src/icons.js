// Small inline SVG weather icons, picked from the WMO weather code, plus a
// temperature colour scale for the forecast bars.

const SUN = `<circle cx="12" cy="12" r="4.5" fill="var(--sun)"/><g stroke="var(--sun)" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>`;
const MOON = `<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z" fill="var(--moon)"/>`;
const SMALL_SUN = `<circle cx="8" cy="8" r="3.4" fill="var(--sun)"/><g stroke="var(--sun)" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.5v1.6M1.5 8h1.6M3.4 3.4l1.1 1.1M12.6 3.4l-1.1 1.1"/></g>`;
const SMALL_MOON = `<path d="M10 2.5a5.5 5.5 0 1 0 3.3 8.8A4.6 4.6 0 0 1 10 2.5z" fill="var(--moon)"/>`;
const cloud = (y = 0, fill = "var(--cloud-fill)") =>
  `<path d="M7 ${17 + y}h10.5a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8.3 9.4 3.8 3.8 0 0 0 7 ${17 + y}z" transform="translate(0 ${y})" fill="${fill}" stroke="var(--cloud-edge)" stroke-width="1"/>`;
const DARK = "var(--cloud-dark)";
const drops = (n) => {
  const xs = n === 2 ? [10, 15] : [8, 12.5, 17];
  return `<g stroke="var(--rain)" stroke-width="1.8" stroke-linecap="round">${xs.map((x) => `<path d="M${x} 18.5l-1 3"/>`).join("")}</g>`;
};
const FLAKES = `<g fill="var(--snow)" stroke="var(--cloud-edge)" stroke-width=".5">${[8, 12.5, 17].map((x, i) => `<circle cx="${x}" cy="${20 + (i % 2)}" r="1.5"/>`).join("")}</g>`;
const BOLT = `<path d="M13 15.5l-3 4.5h2.5l-1.5 4 4.5-5.5h-2.6l1.6-3z" fill="var(--bolt)"/>`;
const FOG = `<g stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round"><path d="M4 9h16M6 13h12M4 17h16"/></g>`;

const svg = (body, label) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" role="img" aria-label="${label}"><title>${label}</title>${body}</svg>`;

/** Returns { svg, label } for a WMO weather code. */
export function weatherIcon(code, isDay) {
  const c = Number(code);
  if (c >= 95) return { svg: svg(cloud(-3, DARK) + BOLT, "Thunderstorm"), label: "Thunderstorm" };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { svg: svg(cloud(-3) + FLAKES, "Snow"), label: "Snow" };
  if (c >= 61 && c <= 82) {
    const heavy = c === 65 || c === 67 || c === 82;
    return { svg: svg(cloud(-3, heavy ? DARK : undefined) + drops(3), heavy ? "Heavy rain" : "Rain"), label: heavy ? "Heavy rain" : "Rain" };
  }
  if (c >= 51 && c <= 57) return { svg: svg(cloud(-3) + drops(2), "Drizzle"), label: "Drizzle" };
  if (c === 45 || c === 48) return { svg: svg(FOG, "Fog"), label: "Fog" };
  if (c === 3) return { svg: svg(cloud(-1), "Overcast"), label: "Overcast" };
  if (c === 2) return { svg: svg((isDay ? SMALL_SUN : SMALL_MOON) + cloud(1), "Partly cloudy"), label: "Partly cloudy" };
  return { svg: svg(isDay ? SUN : MOON, c === 1 ? "Mostly clear" : "Clear"), label: c === 1 ? "Mostly clear" : "Clear" };
}

// °C → colour: frigid violet, cold blue, mild teal/green, warm amber, hot red.
const STOPS = [
  [-20, [123, 97, 255]], [0, [66, 153, 232]], [10, [45, 190, 180]],
  [18, [120, 200, 80]], [24, [242, 190, 40]], [30, [242, 130, 45]], [38, [225, 65, 70]],
];
export function tempColor(c) {
  if (c <= STOPS[0][0]) return `rgb(${STOPS[0][1]})`;
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, a] = STOPS[i - 1], [t2, b] = STOPS[i];
    if (c <= t2) {
      const k = (c - t1) / (t2 - t1);
      return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k))})`;
    }
  }
  return `rgb(${STOPS[STOPS.length - 1][1]})`;
}
