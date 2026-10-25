// The page: pick a place (your location, a searched city, today's featured
// city or a sample day), get today's forecast, play it, explain it.

import { normalizeForecast, fetchForecast, searchPlaces, featuredPlace, randomPlace, roundCoord } from "./weather.js";
import { compose, hourLabel, formatTemp, formatSpeed, aqiCategory, uvCategory } from "./compose.js";
import { describe } from "./describe.js";
import { Engine, LAYERS, songSeconds } from "./engine.js";
import { toWav, wavName } from "./wav.js";
import { weatherIcon, tempColor, moonDisc } from "./icons.js";
import { coverArt } from "./cover.js";

const SAMPLES = [
  ["phoenix-heat", "Phoenix · hot and clear"],
  ["kyoto-spring", "Kyoto · clear spring day"],
  ["philadelphia-autumn", "Philadelphia · crisp autumn day"],
  ["honolulu-flat", "Honolulu · breezy, even temperatures"],
  ["mcmurdo-cold", "McMurdo Station · polar night, −38 °C"],
  ["london-drizzle", "London · overcast drizzle"],
  ["mumbai-monsoon", "Mumbai · monsoon"],
  ["houston-storms", "Houston · flooding downpour"],
  ["oslo-snow", "Oslo · snowstorm"],
  ["reykjavik-wind", "Reykjavik · gale"],
];
// The factors: each layer of the song and the weather that plays it.
const ICON = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const CHANNELS = [
  { layer: "melody", name: () => "Melody", weather: "temperature",
    icon: ICON('<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>') },
  { layer: "pad", name: () => "Pad", weather: "sky",
    icon: ICON('<path d="M7 18h10a4 4 0 0 0 .5-8A5.5 5.5 0 0 0 7 9.5 4.3 4.3 0 0 0 7 18z"/>') },
  { layer: "bass", name: (m) => (m.bassSub >= 0.5 ? "Deep bass" : "Bass"), weather: "pressure & cloud",
    icon: ICON('<circle cx="12" cy="12" r="8"/><path d="M7.5 15.5l.8-.6M6.5 11h1M8.8 7.6l.6.8M12 6.5v1M15.2 7.6l-.6.8M17.5 11h-1M16.5 15.5l-.8-.6M12 12l3.2-3.2"/><circle cx="12" cy="12" r=".6"/>') },
  { layer: "rain", name: (m) => (m.snow ? "Shakers & bells" : "Shakers"), weather: "rain & snow",
    icon: ICON('<path d="M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"/>') },
  { layer: "drums", name: () => "Beat", weather: "wind, warmth & storms",
    icon: ICON('<ellipse cx="12" cy="8" rx="7" ry="3"/><path d="M5 8v8c0 1.7 3.1 3 7 3s7-1.3 7-3V8"/>') },
  { layer: "atmosphere", name: () => "Noise", weather: "gusts, rain & fog",
    icon: ICON('<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>') },
  { layer: "fx", name: () => "Sparkles", weather: "sun, moon & sky",
    icon: ICON('<circle cx="12" cy="15" r="4"/><path d="M12 5v3M5 15H3M21 15h-2M6.3 9.3l1.4 1.4M17.7 9.3l-1.4 1.4M3 20h18"/>') },
];
// Your own location has no place name, so holidays use your browser's region.
const BROWSER_CC = (navigator.language || "").split("-")[1]?.toUpperCase() || null;
const KIND_LABELS = {
  featured: "Today's featured city",
  search: "Today in",
  link: "Today in",
  geo: "Today where you are",
  sample: "Sample day",
};

const $ = (id) => document.getElementById(id);
const playBtn = $("play");
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let engine = null;
let playing = false; // our own flag: the transport only reports "started" ~0.1 s after Play
let forecast = null;
let score = null;
let current = null; // { kind, place?, sample? }
let loadToken = 0;
const muted = {};
// US-style units for US visitors (and the two other countries using °F), metric for everyone else.
const region = (navigator.language || "").split("-")[1];
let units = store.get("wt:units") || (["US", "LR", "MM"].includes(region) ? "us" : "metric");

// ---- Header: back button and light/dark switch (same saved setting as mferet.com) ----

{
  const root = document.documentElement;
  const btn = document.querySelector(".theme");
  const sync = () => {
    const dark = root.dataset.theme === "dark";
    btn.setAttribute("aria-pressed", String(dark));
    btn.title = dark ? "Switch to light theme" : "Switch to dark theme";
  };
  btn.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* private mode */ }
    sync();
  });
  sync();

  // Came from mferet.com? Go back to that exact page (and scroll spot); otherwise the link goes home.
  $("back").addEventListener("click", (e) => {
    let fromSite = false;
    try { fromSite = new URL(document.referrer).origin === location.origin; } catch { /* no referrer */ }
    if (fromSite && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });
}

// iPhones and iPads mute web audio in silent mode; only they need the tip.
const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
$("ios-hint").hidden = !ios;

// ---- Status line -------------------------------------------------------------

function status(text, isError = false) {
  $("status").textContent = text || "";
  $("status").classList.toggle("error", isError);
}

// ---- Loading a place ---------------------------------------------------------

/** kind: featured | search | link | geo | sample.  place: { name, lat, lon }.  sample: fixture id. */
async function choose({ kind, place, sample, reveal = false }) {
  const token = ++loadToken;
  const wasPlaying = playing;
  $("results").hidden = true;
  playBtn.disabled = true;
  dlBtn.disabled = !!rendering;
  let f;
  try {
    if (kind === "sample") {
      status("");
      f = normalizeForecast(await (await fetch(`samples/${sample}.json`)).json());
    } else {
      status(`Getting today's forecast for ${place.name}…`);
      f = await fetchForecast(place);
      status("");
    }
  } catch (e) {
    if (token !== loadToken) return;
    console.warn(e);
    const fallback = SAMPLES[Math.floor(Math.random() * SAMPLES.length)][0];
    status(`Couldn't reach the weather service right now, so here's a sample day instead.`, true);
    kind = "sample";
    sample = fallback;
    f = normalizeForecast(await (await fetch(`samples/${sample}.json`)).json());
  }
  if (token !== loadToken) return; // a newer choice won

  current = { kind, place, sample };
  forecast = f;
  score = compose(forecast, { units });
  $("sample").value = kind === "sample" ? sample : "";
  render();
  rememberAndLink();
  // The finder sits below the player, so bring the new song into view if it's scrolled off.
  if (reveal && document.querySelector(".player").getBoundingClientRect().top < 0) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector(".player").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  playBtn.disabled = false;
  dlBtn.disabled = !!rendering;
  if (wasPlaying) {
    engine.stop();
    play();
  }
}

/** Keep the URL shareable for cities and samples. Your own location never goes in the URL. */
function rememberAndLink() {
  const url = new URL(location.href);
  for (const k of ["sample", "lat", "lon", "name", "cc"]) url.searchParams.delete(k);
  const { kind, place, sample } = current;
  if (kind === "sample") url.searchParams.set("sample", sample);
  if (kind === "search" || kind === "link") {
    url.searchParams.set("name", place.name);
    url.searchParams.set("lat", roundCoord(place.lat).toFixed(1));
    url.searchParams.set("lon", roundCoord(place.lon).toFixed(1));
    if (place.cc) url.searchParams.set("cc", place.cc);
  }
  history.replaceState(null, "", url);
  if (kind === "search") store.set("wt:place", { kind: "search", place });
  if (kind === "geo") store.set("wt:place", { kind: "geo" });
}

// ---- Rendering -----------------------------------------------------------------

function render() {
  const m = score.meta;
  $("place-kind").textContent = KIND_LABELS[current.kind];
  $("place-name").textContent = m.name;
  const date = new Date(`${m.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  renderNotes(m);
  $("units").textContent = units === "us" ? "Show °C" : "Show °F";

  // High, low and the wettest hour, for the header line.
  const hiI = forecast.hours.reduce((b, h, i, a) => (h.temp > a[b].temp ? i : b), 0);
  const loI = forecast.hours.reduce((b, h, i, a) => (h.temp < a[b].temp ? i : b), 0);
  const wetI = forecast.hours.reduce((b, h, i, a) => (h.pop > a[b].pop ? i : b), 0);
  const wet = forecast.hours[wetI].pop;
  // The header line is the weather; the music theory lives in the liner notes.
  const whole = (c) => (units === "us" ? `${Math.round((c * 9) / 5 + 32)}\u00a0°F` : `${Math.round(c)}\u00a0°C`);
  const wetWord = weatherIcon(forecast.hours[wetI].code, 1).label === "Snow" ? "Snow" : "Rain";
  $("summary").textContent = `${date} · High\u00a0${whole(forecast.hours[hiI].temp)} · Low\u00a0${whole(forecast.hours[loI].temp)} · ` +
    (wet >= 10 ? `${wetWord}\u00a0${wet}%` : "Dry");
  $("cover").innerHTML = coverArt(forecast, m);
  $("cover").style.setProperty("--label", tempColor(forecast.hours[hiI].temp));
  document.querySelector(".vinyl").style.setProperty("--label", tempColor(forecast.hours[hiI].temp));
  renderBand(m);

  renderHours();
  $("desc").textContent = describe(forecast, units);
  renderChips();
}

// ---- Hour by hour: sky icons, a temperature line (the melody's contour), rain bars ----

const shortHour = (i) => (i === 0 ? "midnight" : i === 12 ? "noon" : `${i % 12} ${i < 12 ? "am" : "pm"}`);
const deg = (c) => `${units === "us" ? Math.round((c * 9) / 5 + 32) : Math.round(c)}°`;

/** Picks which hours get a label: most important first, none closer than `gap` columns. */
function spaced(candidates, gap) {
  const kept = [];
  for (const i of candidates) if (!kept.some((k) => Math.abs(k - i) < gap)) kept.push(i);
  return new Set(kept);
}

/** Smooth path through the points that never overshoots them (monotone cubic). */
function smoothPath(pts) {
  const n = pts.length;
  const d = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / (p[0] - pts[i][0]));
  const m = pts.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  let path = `M${pts[0][0]} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = (x1 - x0) / 3;
    path += `C${x0 + h} ${(y0 + m[i] * h).toFixed(2)} ${x1 - h} ${(y1 - m[i + 1] * h).toFixed(2)} ${x1} ${y1.toFixed(2)}`;
  }
  return path;
}

function renderHours() {
  const hours = forecast.hours;
  const temps = hours.map((h) => h.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const span = Math.max(hi - lo, 8);
  const base = lo - (span - (hi - lo)) / 2;
  const t = temps.map((c) => (c - base) / span);
  const hiI = temps.indexOf(hi), loI = temps.indexOf(lo);
  const sk = score.meta.sky;
  const moonLook = { illum: sk.moon.illum, waxing: sk.moon.waxing, south: forecast.lat < 0 };

  // Temperature labels: high and low always, then every third hour where there's room.
  const tLabels = spaced([hiI, loI, ...hours.map((_, i) => i).filter((i) => i % 3 === 0)], 2);
  // Rain labels: one at the start of each peak (a steady 100% all day gets one label), wettest first.
  const pops = hours.map((h) => h.pop);
  const dry = Math.max(...pops) < 10;
  const peaks = pops.map((p, i) => i).filter((i) => pops[i] >= 20 && (i === 0 || pops[i] > pops[i - 1]) && (i === 23 || pops[i] >= pops[i + 1]));
  const rLabels = spaced(peaks.sort((a, b) => pops[b] - pops[a]), 4);

  // The line: x is the column centre (0–24), y is 0 (hot) to 100 (cold); runs edge to edge.
  const pts = t.map((v, i) => [i + 0.5, (1 - v) * 100]);
  const line = smoothPath([[0, pts[0][1]], ...pts, [24, pts[23][1]]]);
  const stops = hours.map((h, i) => `<stop offset="${((i + 0.5) / 24).toFixed(4)}" stop-color="${tempColor(h.temp)}"/>`).join("");
  const svg = `<svg class="hr-line" viewBox="0 0 24 100" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="hr-temp" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient>
      <linearGradient id="hr-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="hr-mask" maskContentUnits="userSpaceOnUse"><rect width="24" height="130" fill="url(#hr-fade)"/></mask>
    </defs>
    <path d="${line}V130H0Z" fill="url(#hr-temp)" mask="url(#hr-mask)"/>
    <path d="${line}" fill="none" stroke="url(#hr-temp)" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;

  // Icons only where the sky changes (a new kind of weather, sunrise or sunset, the moon
  // rising or setting). Phones have narrow columns, so there a change right after the
  // last icon waits for room (gap columns), and shows only if it still differs by then.
  const icons = hours.map((h, i) => weatherIcon(h.code, h.isDay, { ...moonLook, up: sk.moon.alt[i] > 0 }));
  const changes = (gap) => {
    const shown = new Set();
    let last = null, at = -Infinity;
    icons.forEach((ic, i) => {
      if (ic.svg !== last && i - at >= gap) { shown.add(i); last = ic.svg; at = i; }
    });
    return shown;
  };
  const iconWide = changes(1), iconNarrow = changes(3);

  const cols = hours.map((h, i) => {
    const col = document.createElement("div");
    const aur = sk.aurora[i];
    col.className = "hour" + (h.isDay ? "" : " night") + (i === hiI ? " hi" : "") + (i === loI ? " lo" : "") + (aur >= 0.25 ? " aurora" : "") +
      (tLabels.has(i) ? " show-t" : "") + (i % 3 ? "" : " major") + (i % 6 ? "" : " axis6") +
      (iconWide.has(i) ? " sky-wide" : "") + (iconNarrow.has(i) ? " sky-narrow" : "") + (i === 0 ? " first" : i === 23 ? " last" : "");
    col.style.setProperty("--t", t[i].toFixed(3));
    col.style.setProperty("--pop", (h.pop / 100).toFixed(2));
    col.style.setProperty("--bar", tempColor(h.temp));
    col.style.setProperty("--aur", aur.toFixed(2));
    const icon = icons[i];
    col.title = `${hourLabel(i)}: ${icon.label}, ${formatTemp(h.temp, units)}, ${h.cloud}% cloud, ${h.pop}% rain, wind ${formatSpeed(h.wind, units)}`;
    col.innerHTML = `<span class="icon">${icon.svg}</span><span class="tv">${deg(h.temp)}</span><span class="dot"></span>` +
      `<span class="rain">${h.pop >= 5 ? `<i></i>` : ""}${rLabels.has(i) ? `<b>${h.pop}%</b>` : ""}</span>` +
      `<span class="lbl">${i % 3 ? "" : shortHour(i)}</span>`;
    return col;
  });
  const box = $("hours");
  box.classList.toggle("dry", dry);
  box.innerHTML = svg + (dry ? `<p class="hr-dry">No rain or snow expected</p>` : "");
  box.append(...cols);
  box.setAttribute("aria-label", `Hourly forecast. High ${deg(hi)} at ${hourLabel(hiI)}, low ${deg(lo)} at ${hourLabel(loI)}. ` +
    (dry ? "No rain expected." : `Best chance of rain ${Math.max(...pops)}% at ${hourLabel(pops.indexOf(Math.max(...pops)))}.`));
}

// ---- Also today: the moon, the sky's events and the air, as small chips ----

const CHIP = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const CHIP_ICONS = {
  eclipse: CHIP('<circle cx="12" cy="12" r="7" fill="#b5503c"/><path d="M5 12a7 7 0 0 1 7-7" stroke="currentColor" stroke-width="1.6" fill="none"/>'),
  aurora: CHIP('<path d="M3 16c3-6 5-6 7-2s4 4 6-1 4-5 5-4" stroke="#3fbf7f" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M3 20c3-4 6-4 9-1s6 1 9-2" stroke="#7a6cf0" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>'),
  meteor: CHIP('<path d="M4 4l11 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".55"/><circle cx="16.5" cy="16.5" r="3" fill="var(--sun)"/>'),
  season: CHIP('<path d="M4 18h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7 18a5 5 0 0 1 10 0" fill="var(--sun)"/><path d="M12 6v3M6 9.5l1.6 1.6M18 9.5l-1.6 1.6" stroke="var(--sun)" stroke-width="1.6" stroke-linecap="round"/>'),
  holiday: CHIP('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" fill="var(--sun)"/>'),
  air: CHIP('<path d="M3 9h12a3 3 0 1 0-3-3M3 13h16M3 17h10a3 3 0 1 1-3 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'),
  uv: CHIP('<circle cx="12" cy="12" r="4" fill="var(--sun)"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" stroke="var(--sun)" stroke-width="1.6" stroke-linecap="round"/>'),
  snow: CHIP('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" stroke="var(--accent-2)" stroke-width="1.6" stroke-linecap="round"/>'),
  frost: CHIP('<path d="M12 4v16M5 8l14 8M5 16l14-8" stroke="var(--accent-2)" stroke-width="1.3" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="var(--accent-2)"/>'),
};

function renderChips() {
  const sk = score.meta.sky;
  const m = sk.moon;
  const chips = [];
  const add = (icon, text, tone = "") => chips.push(`<li class="chip ${tone}">${icon}<span>${esc(text)}</span></li>`);
  const phase = m.phase[0].toUpperCase() + m.phase.slice(1);
  const times = [m.rise != null && `rises ${hourLabel(m.rise)}`, m.set != null && `sets ${hourLabel(m.set)}`].filter(Boolean);
  add(CHIP(moonDisc(12, 12, 8, { illum: m.illum, waxing: m.waxing, south: forecast.lat < 0 })),
    `${phase}, ${Math.round(m.illum * 100)}% lit${times.length ? ` · ${times.join(", ")}` : m.alt.some((a) => a > 0) ? " · up all day" : " · below the horizon"}`);
  if (sk.eclipse) add(CHIP_ICONS.eclipse, `${sk.eclipse.type === "total" ? "Total" : "Partial"} lunar eclipse · ${hourLabel(sk.eclipse.hour)}`, "event");
  const lights = forecast.lat >= 0 ? "Northern lights" : "Southern lights";
  const auroraBars = sk.aurora.map((a, b) => (a >= 0.25 ? b : -1)).filter((b) => b >= 0);
  if (auroraBars.length) add(CHIP_ICONS.aurora, `${lights} possible · Kp ${Math.round(sk.kpMax * 10) / 10}`, "event");
  else if (sk.auroraReach.some((r, b) => r >= 0.25 && sk.dark[b] >= 0.9)) add(CHIP_ICONS.aurora, `${lights} in reach, but cloudy`);
  if (sk.shower) add(CHIP_ICONS.meteor, `${sk.shower.name} meteor shower${sk.shower.peak ? " · peak" : ""}`, "event");
  if (sk.season) add(CHIP_ICONS.season, `${sk.season.name} · ${hourLabel(sk.season.hour)}`, "event");
  if (sk.holiday) add(CHIP_ICONS.holiday, sk.holiday.name, "event");
  if (sk.aqiMax != null) {
    const cat = aqiCategory(sk.aqiMax);
    add(CHIP_ICONS.air, `Air quality ${Math.round(sk.aqiMax)}, ${cat}`, sk.aqiMax > 100 ? "warn" : "");
  }
  if (sk.uvMax != null && sk.uvMax >= 3) add(CHIP_ICONS.uv, `UV ${Math.round(sk.uvMax)}, ${uvCategory(sk.uvMax)} · ${hourLabel(sk.uvMaxHour)}`, sk.uvMax >= 8 ? "warn" : "");
  if (sk.snowCm >= 1) add(CHIP_ICONS.snow, `${units === "us" ? `${Math.round(sk.snowCm / 2.54)} in` : `${Math.round(sk.snowCm)} cm`} of snow on the ground`);
  if (sk.firstFrost) add(CHIP_ICONS.frost, "First frost of the season", "event");
  else if (sk.frostHours.length) add(CHIP_ICONS.frost, "Frost early");
  $("extras").innerHTML = chips.join("");
}

// ---- Liner notes: the credits row, then a short write-up ----

const cap = (t) => t[0].toUpperCase() + t.slice(1);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderNotes(m) {
  const credits = [
    ["Key", `${m.rootName} ${m.modeLabel}`],
    ["Tempo", `${m.bpm} BPM`],
    ["Chords", m.progression.join("–")],
    ["Melody", cap(m.voices.melody.label)],
    ["Pad", cap(m.voices.pad.label)],
  ];
  $("credits").innerHTML = credits.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  $("notes").innerHTML = m.liner.paragraphs.map((t) => `<p>${esc(t)}</p>`).join("");
}

// ---- The factors: one per part of the weather, lit while it plays ----

/** How busy each layer is in each hour, 0–1, from the score itself. */
function activity(sc, hours) {
  const lane = () => new Array(hours).fill(0);
  const add = (a, notes, w = (n) => n.vel ?? 1) => { for (const n of notes ?? []) if (n.bar < hours) a[n.bar] += w(n); return a; };
  const act = {
    // The melody's lane also shows its level (cloud and night turn it down).
    // A held note counts in every hour it sounds through.
    melody: add(lane(), sc.melody.flatMap((n) => Array.from({ length: Math.ceil((n.pos + n.dur) / (sc.meta.steps ?? 8)) }, (_, k) => ({ ...n, bar: n.bar + k })))).map((v, b) => v * 10 ** (((sc.automation.melodyDb[b] ?? 0) + (sc.automation.melodyDayDb?.[b] ?? 0)) / 20)),
    bass: add(lane(), sc.bass),
    pad: add(lane(), sc.pad),
    drums: add(add(add(lane(), sc.drums), sc.garage), sc.beat),
    rain: add(add(lane(), sc.rain), sc.bells),
    atmosphere: add(sc.atmosphere.map((a) => a.level + a.wind), sc.crackle, () => 0.02),
    fx: add(add(add(lane(), sc.fx, () => 1), sc.chimes), sc.shimmer),
  };
  for (const k of Object.keys(act)) {
    const top = Math.max(...act[k]);
    act[k] = act[k].map((v) => (top > 0 ? v / top : 0));
  }
  return act;
}

function renderBand(m) {
  const act = activity(score, forecast.hours.length);
  $("layers").replaceChildren(...CHANNELS.map((ch) => {
    const lane = act[ch.layer];
    const silent = lane.every((v) => v === 0);
    const name = ch.name(m);
    const by = silent ? "silent today" : ch.weather;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `factor ${ch.layer}` + (muted[ch.layer] ? " muted" : "") + (silent ? " silent" : "");
    btn.setAttribute("aria-pressed", String(!muted[ch.layer]));
    btn.setAttribute("aria-label", `${name}, played by ${ch.weather}${silent ? ", silent today" : ""}`);
    btn.title = `${name}: ${by}. Tap to mute or unmute.`;
    btn.innerHTML = `<span class="f-icon">${ch.icon}</span><span class="f-name">${name}</span><span class="f-plays">${by}</span>`;
    btn.addEventListener("click", () => {
      muted[ch.layer] = !muted[ch.layer];
      btn.setAttribute("aria-pressed", String(!muted[ch.layer]));
      btn.classList.toggle("muted", muted[ch.layer]);
      if (engine) engine.setMute(ch.layer, muted[ch.layer]);
    });
    btn.lane = lane;
    return btn;
  }));
}

// ---- Live sky: the player darkens, rains and flashes with the hour being played ----

function skyAt(bar) {
  const card = document.querySelector(".player");
  if (bar == null) {
    card.style.removeProperty("--dim");
    card.style.removeProperty("--energy");
    card.style.removeProperty("--wet");
    card.dataset.phase = "";
    return;
  }
  const h = forecast.hours[bar];
  card.style.setProperty("--dim", (1 - score.meta.hourBrightness[bar]).toFixed(2));
  card.style.setProperty("--energy", score.automation.energy[bar].toFixed(2));
  card.style.setProperty("--wet", Math.min(1, h.precip / 4 + (h.precip > 0 ? 0.2 : 0)).toFixed(2));
  card.dataset.phase = score.meta.arc.phases[bar];
}

function onEvent(type) {
  if (type !== "thunder" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const f = document.querySelector(".sky .flash");
  f.classList.remove("on");
  void f.offsetWidth; // restart the animation
  f.classList.add("on");
}

function highlight(bar) {
  for (const [i, el] of [...$("hours").querySelectorAll(".hour")].entries()) el.classList.toggle("now", i === bar);
  // A factor lights up while its part is playing this hour.
  for (const f of $("layers").children) f.classList.toggle("live", bar != null && f.lane[bar] > 0);
  if (bar == null) $("nowhour").textContent = "";
  else {
    const h = forecast.hours[bar];
    $("nowhour").textContent = `${hourLabel(bar)} · ${weatherIcon(h.code, h.isDay).label} · ${units === "us" ? Math.round((h.temp * 9) / 5 + 32) + "\u00a0°F" : Math.round(h.temp) + "\u00a0°C"}`;
  }
  skyAt(bar);
}

// ---- Playback ------------------------------------------------------------------

async function play() {
  playing = true;
  setPlayState(true);
  await Tone.start();
  if (!engine) {
    engine = new Engine({ onBar: highlight, onEvent, onEnd: () => { playing = false; setPlayState(false); } });
    await engine.ready;
    for (const l of LAYERS) engine.setMute(l, !!muted[l]);
  }
  if (!playing) return; // stopped while the audio was starting up
  engine.load(score);
  engine.start("+0.1");
}

function stop() {
  playing = false;
  if (engine) engine.stop();
  setPlayState(false);
}

function setPlayState(on) {
  playBtn.querySelector("span").textContent = on ? "Stop" : "Play";
  document.querySelector(".player").classList.toggle("playing", on);
}

playBtn.addEventListener("click", () => (playing ? stop() : play()));

// ---- Download: render the song offline (faster than real time on most devices) and save a WAV.
// It's the song as it sounds now, so any layers you've muted stay muted.
const dlBtn = $("download");
let rendering = null;
dlBtn.addEventListener("click", async () => {
  if (!score || rendering) return;
  const s = score;
  const label = dlBtn.querySelector("span");
  rendering = s;
  dlBtn.disabled = true;
  label.textContent = "Preparing…";
  try {
    const buf = await Tone.Offline(async () => {
      const e = new Engine();
      await e.ready;
      for (const l of LAYERS) e.setMute(l, !!muted[l]);
      e.load(s);
      e.start(0);
    }, songSeconds(s), 2, 44100);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(toWav(buf.get()));
    a.download = wavName(s.meta.name, s.meta.date);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    label.textContent = "Download";
  } catch (e) {
    console.warn(e);
    label.textContent = "Couldn't save, try again";
  } finally {
    rendering = null;
    dlBtn.disabled = !score;
  }
});

// ---- Controls ----------------------------------------------------------------------

for (const [id, label] of SAMPLES) $("sample").add(new Option(label, id));
$("sample").addEventListener("change", (e) => {
  if (e.target.value) choose({ kind: "sample", sample: e.target.value, reveal: true });
});

$("units").addEventListener("click", () => {
  units = units === "us" ? "metric" : "us";
  store.set("wt:units", units);
  if (forecast) {
    score = compose(forecast, { units }); // only the wording changes; the music is identical
    render();
  }
});

function locate(reveal = false) {
  if (!navigator.geolocation) {
    status("This browser can't share its location. Search for a city instead.", true);
    return;
  }
  status("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => choose({ kind: "geo", place: { name: "Near you", lat: pos.coords.latitude, lon: pos.coords.longitude, cc: BROWSER_CC }, reveal }),
    (err) => {
      const blocked = err.code === err.PERMISSION_DENIED;
      status(blocked
        ? "Location access is off for this site. Search for a city instead."
        : "Couldn't find your location. Search for a city instead.", true);
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 },
  );
}
$("geo").addEventListener("click", () => locate(true));

// On phones the place finder sits below the player; this jumps down to it.
$("change-place").addEventListener("click", () => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("finder").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  $("q").focus({ preventScroll: true });
});

/** A search result was chosen: clear the box and the list, then load it. */
function pickPlace(p) {
  $("q").value = "";
  $("results").replaceChildren();
  $("results").hidden = true;
  status("");
  choose({ kind: "search", place: p, reveal: true });
}

$("search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  const list = $("results");
  if (q.length < 2) {
    status("Type at least two letters of a city name.", true);
    return;
  }
  status(`Searching for “${q}”…`);
  try {
    const places = await searchPlaces(q);
    if (!places.length) {
      list.hidden = true;
      status(`No places found for “${q}”. Try another spelling or a nearby city.`, true);
      return;
    }
    status(places.length === 1 ? "" : `${places.length} places match. Pick one:`);
    list.replaceChildren(...places.map((p) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = p.label;
      b.addEventListener("click", () => pickPlace(p));
      li.append(b);
      return li;
    }));
    list.hidden = false;
    if (places.length === 1) pickPlace(places[0]);
    else list.querySelector("button").focus();
  } catch (err) {
    console.warn(err);
    status("City search isn't responding right now. Try again in a moment, or pick a sample day.", true);
  }
});

// A random city behaves like a searched one: shareable and remembered.
$("random").addEventListener("click", () => {
  pickPlace(randomPlace(current && current.place ? current.place.name : null));
});

// ---- Start-up: link → last place → your location (if already allowed) → featured city ----

async function geoAlreadyAllowed() {
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state === "granted";
  } catch {
    return false;
  }
}

const q = new URLSearchParams(location.search);
const saved = store.get("wt:place");
if (q.get("sample") && SAMPLES.some(([id]) => id === q.get("sample"))) {
  await choose({ kind: "sample", sample: q.get("sample") });
} else if (/^[a-z0-9-]{1,40}$/.test(q.get("local") || "")) {
  // Dev only: a day from a local, unpublished tuning set (local/ordinary/, not in the repo).
  await choose({ kind: "sample", sample: `../local/ordinary/${q.get("local")}` });
} else if (q.get("lat") && q.get("lon") && Number.isFinite(+q.get("lat")) && Number.isFinite(+q.get("lon"))) {
  const cc = /^[A-Za-z]{2}$/.test(q.get("cc") || "") ? q.get("cc").toUpperCase() : null;
  await choose({ kind: "link", place: { name: q.get("name") || "Shared place", lat: +q.get("lat"), lon: +q.get("lon"), cc } });
} else if (saved && saved.kind === "search" && saved.place) {
  await choose({ kind: "search", place: saved.place });
} else if (saved && saved.kind === "geo" && (await geoAlreadyAllowed())) {
  await choose({ kind: "featured", place: featuredPlace() }); // something to show while the browser finds you
  locate();
} else {
  await choose({ kind: "featured", place: featuredPlace() });
}
