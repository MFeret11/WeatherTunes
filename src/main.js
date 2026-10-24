// The page: pick a place (your location, a searched city, today's featured
// city or a sample day), get today's forecast, play it, explain it.

import { normalizeForecast, fetchForecast, searchPlaces, featuredPlace, roundCoord } from "./weather.js";
import { compose, hourLabel, formatTemp, formatSpeed, arcSummary } from "./compose.js";
import { Engine, LAYERS } from "./engine.js";
import { weatherIcon, tempColor } from "./icons.js";

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
const LAYER_LABELS = {
  melody: "Melody", bass: "Bass", pad: "Pad", drums: "Storm drums", rain: "Rain & bells",
  atmosphere: "Atmosphere", fx: "Thunder & swells",
};
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

// ---- Status line -------------------------------------------------------------

function status(text, isError = false) {
  $("status").textContent = text || "";
  $("status").classList.toggle("error", isError);
}

// ---- Loading a place ---------------------------------------------------------

/** kind: featured | search | link | geo | sample.  place: { name, lat, lon }.  sample: fixture id. */
async function choose({ kind, place, sample }) {
  const token = ++loadToken;
  const wasPlaying = playing;
  $("results").hidden = true;
  playBtn.disabled = true;
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
  playBtn.disabled = false;
  if (wasPlaying) {
    engine.stop();
    play();
  }
}

/** Keep the URL shareable for cities and samples. Your own location never goes in the URL. */
function rememberAndLink() {
  const url = new URL(location.href);
  for (const k of ["sample", "lat", "lon", "name"]) url.searchParams.delete(k);
  const { kind, place, sample } = current;
  if (kind === "sample") url.searchParams.set("sample", sample);
  if (kind === "search" || kind === "link") {
    url.searchParams.set("name", place.name);
    url.searchParams.set("lat", roundCoord(place.lat).toFixed(1));
    url.searchParams.set("lon", roundCoord(place.lon).toFixed(1));
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
  $("summary").textContent = `${date} → ${m.rootName} ${m.modeLabel} · ${m.bpm} BPM · ${m.progression.join("–")}`;
  renderNotes(m);
  $("units").textContent = units === "us" ? "Show °C" : "Show °F";

  // Forecast heading: high, low and the wettest hour.
  const hiI = forecast.hours.reduce((b, h, i, a) => (h.temp > a[b].temp ? i : b), 0);
  const loI = forecast.hours.reduce((b, h, i, a) => (h.temp < a[b].temp ? i : b), 0);
  const wetI = forecast.hours.reduce((b, h, i, a) => (h.pop > a[b].pop ? i : b), 0);
  const wet = forecast.hours[wetI].pop;
  $("fc-stats").innerHTML =
    `<span class="hi">High ${formatTemp(forecast.hours[hiI].temp, units)} <small>${hourLabel(hiI)}</small></span>` +
    `<span class="lo">Low ${formatTemp(forecast.hours[loI].temp, units)} <small>${hourLabel(loI)}</small></span>` +
    `<span class="wet">${wet >= 10 ? `${weatherIcon(forecast.hours[wetI].code, 1).label === "Snow" ? "Snow" : "Rain"} ${wet}% <small>${hourLabel(wetI)}</small>` : "Dry"}</span>`;

  // One column per hour: icon = sky, bar height and colour = temperature, blue bar = rain chance.
  const temps = forecast.hours.map((h) => h.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const span = Math.max(hi - lo, 8);
  const base = lo - (span - (hi - lo)) / 2;
  $("hours").replaceChildren(...forecast.hours.map((h, i) => {
    const col = document.createElement("div");
    col.className = "hour" + (h.isDay ? "" : " night");
    col.style.setProperty("--t", ((h.temp - base) / span).toFixed(3));
    col.style.setProperty("--cloud", (h.cloud / 100).toFixed(2));
    col.style.setProperty("--pop", (h.pop / 100).toFixed(2));
    col.style.setProperty("--bar", tempColor(h.temp));
    const icon = weatherIcon(h.code, h.isDay);
    col.title = `${hourLabel(i)}: ${icon.label}, ${formatTemp(h.temp, units)}, ${h.cloud}% cloud, ${h.pop}% rain, wind ${formatSpeed(h.wind, units)}`;
    col.innerHTML = `<span class="icon${i % 3 ? " minor" : ""}">${icon.svg}</span><span class="temp"></span><span class="rain"></span><span class="lbl">${i % 6 === 0 ? hourLabel(i) : ""}</span>`;
    return col;
  }));
  renderArc();
}

// ---- Liner notes: credits, the story, then cause → effect cards by group ----

const GROUP_ICONS = {
  harmony: '<path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" />',
  melody: '<path d="M3 15c2-6 4-6 6 0s4 6 6 0 4-6 6 0" />',
  voices: '<path d="M4 10v4h4l5 4V6L8 10H4z" /><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />',
  dynamics: '<path d="M4 20V14M9 20V10M14 20V6M19 20V3" />',
  texture: '<path d="M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z" />',
};
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
  const [lead, ...rest] = m.liner.story;
  $("story").innerHTML = `<p class="story-lead">${esc(lead)}</p>${rest.map((t) => `<p>${esc(t)}</p>`).join("")}`;
  $("notes").innerHTML = m.liner.groups.map((g) => `
    <section class="note-group ${g.id}">
      <h3><svg viewBox="0 0 24 24" aria-hidden="true">${GROUP_ICONS[g.id]}</svg>${g.title}</h3>
      <ul>${g.items.map((it) => `<li><span class="effect">${esc(it.effect)}</span><span class="cause">${esc(it.cause)}</span></li>`).join("")}</ul>
    </section>`).join("");
}

// ---- The day's arc: a ribbon of phases under the strip, with the intensity curve ----

const PHASE_LABELS = { calm: "Calm", build: "Building", peak: "Peak", release: "Release" };

function renderArc() {
  const arc = score.meta.arc;
  const e = score.automation.energy;
  const n = e.length;
  // Intensity curve, one point per hour centre, drawn in a 0–100 × 0–40 box.
  const pts = e.map((v, i) => [((i + 0.5) / n) * 100, 38 - v * 34]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L100 40 L0 40 Z`;
  const cells = arc.phases.map((ph, i) => `<span class="cell ${ph}" style="grid-column:${i + 1}"></span>`).join("");
  const labels = arc.moments.map((m, i) => {
    const text = m.phase === "release" && m.breeze ? "Cool breeze" : PHASE_LABELS[m.phase];
    const span = (arc.moments[i + 1]?.bar ?? n) - m.bar;
    return `<span class="mark ${m.phase}" style="grid-column:${m.bar + 1} / span ${span}" title="${text} from ${hourLabel(m.bar)}">${text}</span>`;
  }).join("");
  $("arc").innerHTML = `
    <svg class="curve" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path class="area" d="${area}"/><path class="line" d="${line}" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="ribbon">${cells}</div>
    <div class="marks">${labels}</div>`;
  $("arc").setAttribute("aria-label", `The day's shape: ${arcSummary(arc)}`);
  $("arc-text").textContent = arcSummary(arc);
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
  for (const [i, el] of [...$("hours").children].entries()) el.classList.toggle("now", i === bar);
  for (const [i, el] of [...document.querySelectorAll("#arc .cell")].entries()) el.classList.toggle("now", i === bar);
  skyAt(bar);
}

// ---- Playback ------------------------------------------------------------------

async function play() {
  playing = true;
  playBtn.textContent = "Stop";
  await Tone.start();
  if (!engine) {
    engine = new Engine({ onBar: highlight, onEvent });
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
  playBtn.textContent = "Play";
}

playBtn.addEventListener("click", () => (playing ? stop() : play()));

// ---- Controls ----------------------------------------------------------------------

for (const [id, label] of SAMPLES) $("sample").add(new Option(label, id));
$("sample").addEventListener("change", (e) => {
  if (e.target.value) choose({ kind: "sample", sample: e.target.value });
});

for (const l of LAYERS) {
  const lab = document.createElement("label");
  lab.className = "toggle";
  lab.innerHTML = `<input type="checkbox" checked> <span>${LAYER_LABELS[l]}</span>`;
  lab.querySelector("input").addEventListener("change", (e) => {
    muted[l] = !e.target.checked;
    if (engine) engine.setMute(l, muted[l]);
  });
  $("layers").append(lab);
}

$("units").addEventListener("click", () => {
  units = units === "us" ? "metric" : "us";
  store.set("wt:units", units);
  if (forecast) {
    score = compose(forecast, { units }); // only the wording changes; the music is identical
    render();
  }
});

function locate() {
  if (!navigator.geolocation) {
    status("This browser can't share its location. Search for a city instead.", true);
    return;
  }
  status("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => choose({ kind: "geo", place: { name: "Near you", lat: pos.coords.latitude, lon: pos.coords.longitude } }),
    (err) => {
      const blocked = err.code === err.PERMISSION_DENIED;
      status(blocked
        ? "Location access is off for this site. Search for a city instead."
        : "Couldn't find your location. Search for a city instead.", true);
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 },
  );
}
$("geo").addEventListener("click", locate);

/** A search result was chosen: clear the box and the list, then load it. */
function pickPlace(p) {
  $("q").value = "";
  $("results").replaceChildren();
  $("results").hidden = true;
  status("");
  choose({ kind: "search", place: p });
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
} else if (q.get("lat") && q.get("lon") && Number.isFinite(+q.get("lat")) && Number.isFinite(+q.get("lon"))) {
  await choose({ kind: "link", place: { name: q.get("name") || "Shared place", lat: +q.get("lat"), lon: +q.get("lon") } });
} else if (saved && saved.kind === "search" && saved.place) {
  await choose({ kind: "search", place: saved.place });
} else if (saved && saved.kind === "geo" && (await geoAlreadyAllowed())) {
  await choose({ kind: "featured", place: featuredPlace() }); // something to show while the browser finds you
  locate();
} else {
  await choose({ kind: "featured", place: featuredPlace() });
}
