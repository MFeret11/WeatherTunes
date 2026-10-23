// The page: pick a place (your location, a searched city, today's featured
// city or a sample day), get today's forecast, play it, explain it.

import { normalizeForecast, fetchForecast, searchPlaces, featuredPlace, roundCoord } from "./weather.js";
import { compose, hourLabel, formatTemp, formatSpeed } from "./compose.js";
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
  melody: "Melody", bass: "Bass", pad: "Pad", rain: "Rain & bells",
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
  $("notes").replaceChildren(...m.notes.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
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
}

function highlight(bar) {
  for (const [i, el] of [...$("hours").children].entries()) el.classList.toggle("now", i === bar);
}

// ---- Playback ------------------------------------------------------------------

async function play() {
  playing = true;
  playBtn.textContent = "Stop";
  await Tone.start();
  if (!engine) {
    engine = new Engine({ onBar: highlight });
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
