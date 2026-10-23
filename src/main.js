// Preview page: pick a sample day, play it, read why it sounds that way.

import { normalizeForecast } from "./weather.js";
import { compose, hourLabel } from "./compose.js";
import { Engine, LAYERS } from "./engine.js";

const SAMPLES = [
  ["phoenix-heat", "Phoenix · hot and clear"],
  ["kyoto-spring", "Kyoto · clear spring day"],
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

const $ = (id) => document.getElementById(id);
const sel = $("sample");
const playBtn = $("play");
let engine = null;
let score = null;
let forecast = null;
const muted = {};

for (const [id, label] of SAMPLES) sel.add(new Option(label, id));
sel.value = new URLSearchParams(location.search).get("sample") || SAMPLES[0][0];

// Layer mute toggles.
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

async function loadSample(id) {
  const raw = await (await fetch(`samples/${id}.json`)).json();
  forecast = normalizeForecast(raw);
  score = compose(forecast);
  render();
  const url = new URL(location.href);
  url.searchParams.set("sample", id);
  history.replaceState(null, "", url);
}

function render() {
  const m = score.meta;
  const date = new Date(`${m.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  $("summary").textContent = `${m.name} · ${date} → ${m.rootName} ${m.modeLabel} · ${m.bpm} BPM · ${m.progression.join("–")}`;
  $("notes").replaceChildren(...m.notes.map((t) => Object.assign(document.createElement("li"), { textContent: t })));

  // One column per hour: bar height = temperature, shading = cloud, blue = rain chance.
  const temps = forecast.hours.map((h) => h.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const span = Math.max(hi - lo, 8);
  const base = lo - (span - (hi - lo)) / 2;
  $("hours").replaceChildren(...forecast.hours.map((h, i) => {
    const col = document.createElement("div");
    col.className = "hour" + (h.isDay ? "" : " night");
    col.style.setProperty("--t", ((h.temp - base) / span).toFixed(3));
    col.style.setProperty("--cloud", (h.cloud / 100).toFixed(2));
    col.style.setProperty("--rain", (h.pop / 100).toFixed(2));
    col.title = `${hourLabel(i)}: ${Math.round(h.temp)} °C, ${h.cloud}% cloud, ${h.pop}% rain, wind ${Math.round(h.wind)} km/h`;
    col.innerHTML = `<span class="temp"></span><span class="rain"></span><span class="lbl">${i % 6 === 0 ? hourLabel(i) : ""}</span>`;
    return col;
  }));
}

function highlight(bar) {
  for (const [i, el] of [...$("hours").children].entries()) el.classList.toggle("now", i === bar);
}

async function play() {
  await Tone.start();
  if (!engine) {
    engine = new Engine({ onBar: highlight });
    await engine.ready;
    for (const l of LAYERS) engine.setMute(l, !!muted[l]);
  }
  engine.load(score);
  engine.start("+0.1");
  playBtn.textContent = "Stop";
}

function stop() {
  engine.stop();
  playBtn.textContent = "Play";
}

playBtn.addEventListener("click", () => (engine && engine.playing ? stop() : play()));
sel.addEventListener("change", async () => {
  const wasPlaying = engine && engine.playing;
  if (wasPlaying) stop();
  await loadSample(sel.value);
  if (wasPlaying) play();
});

await loadSample(sel.value);
playBtn.disabled = false;
