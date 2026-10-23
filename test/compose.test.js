import { test, assert, equal } from "./harness.js";
import { normalizeForecast } from "../src/weather.js";
import { compose, analyze, chordDegreeAt, dynamicsCurve, capeLevel } from "../src/compose.js";
import { MODES, melodyDegrees, triadPcs, chordLabel } from "../src/theory.js";
import * as M from "../src/mapping.js";

export const FIXTURES = [
  "phoenix-heat", "kyoto-spring", "london-drizzle", "mumbai-monsoon", "houston-storms",
  "oslo-snow", "mcmurdo-cold", "honolulu-flat", "reykjavik-wind", "philadelphia-autumn",
];

const raw = {};
for (const name of FIXTURES) raw[name] = await (await fetch(`../samples/${name}.json`)).json();
const forecasts = Object.fromEntries(FIXTURES.map((n) => [n, normalizeForecast(raw[n])]));
const scores = Object.fromEntries(FIXTURES.map((n) => [n, compose(forecasts[n])]));

const each = (fn) => { for (const n of FIXTURES) fn(n, scores[n], forecasts[n]); };
const melodyPcs = (s) => new Set(melodyDegrees(s.meta.mode, s.meta.snow).map((d) => (s.meta.root + MODES[s.meta.mode][d]) % 12));
const chordAt = (s, bar) => triadPcs(s.meta.root, s.meta.mode, chordDegreeAt(bar, s.meta.progressionDegrees));

// ---- weather.js ----------------------------------------------------------

test("normalize gives 24 complete hours for every fixture", () => each((n, s, f) => {
  equal(f.hours.length, 24, n);
  for (const h of f.hours) for (const [k, v] of Object.entries(h)) assert(Number.isFinite(v), `${n} hour ${h.hour} ${k}=${v}`);
}));

test("normalize fills gaps and missing columns", () => {
  const r = structuredClone(raw["london-drizzle"]);
  r.hourly.temperature_2m[0] = null;
  r.hourly.temperature_2m[5] = null;
  r.hourly.temperature_2m[6] = null;
  r.hourly.weather_code[3] = null;
  delete r.hourly.wind_gusts_10m;
  r.hourly.cloud_cover = r.hourly.cloud_cover.slice(0, 20); // short column
  const f = normalizeForecast(r);
  const t = raw["london-drizzle"].hourly.temperature_2m;
  equal(f.hours[0].temp, t[1], "leading gap copies next value");
  assert(Math.abs(f.hours[5].temp - (t[4] + (t[7] - t[4]) / 3)) < 1e-9, "interior gap interpolates");
  assert(Number.isInteger(f.hours[3].code), "codes are copied, not averaged");
  for (const h of f.hours) assert(Number.isFinite(h.gust) && Number.isFinite(h.cloud), "no NaN");
  compose(f); // must not throw
});

test("polar night has no sunrise", () => {
  equal(forecasts["mcmurdo-cold"].sunrise, null);
  assert(forecasts["phoenix-heat"].sunrise > 5 && forecasts["phoenix-heat"].sunrise < 6);
});

// ---- compose.js ------------------------------------------------------------

test("same forecast → identical score", () => each((n, s, f) => {
  equal(compose(f), s, n);
}));

test("different days and places → different melodies", () => {
  const seen = new Set(FIXTURES.map((n) => scores[n].melody.map((x) => x.midi).join(",")));
  equal(seen.size, FIXTURES.length);
  const moved = { ...forecasts["kyoto-spring"], date: "2025-04-27" };
  assert(JSON.stringify(compose(moved).melody) !== JSON.stringify(scores["kyoto-spring"].melody), "date changes the song");
});

test("every melody note is in the scale", () => each((n, s) => {
  const pcs = melodyPcs(s);
  for (const x of s.melody) assert(pcs.has(x.midi % 12), `${n} bar ${x.bar} ${x.note} not in ${s.meta.rootName} ${s.meta.mode}`);
  for (const x of s.bells) assert(pcs.has(x.midi % 12), `${n} bell ${x.note}`);
}));

test("beats 1 and 3 are chord tones", () => each((n, s) => {
  for (const x of s.melody) {
    if (x.pos !== 0 && x.pos !== M.STEPS / 2) continue;
    assert(chordAt(s, x.bar).includes(x.midi % 12), `${n} bar ${x.bar} pos ${x.pos} ${x.note} vs chord ${s.meta.chords[x.bar]}`);
  }
}));

test("sections end on the root or fifth (or a chord tone), the piece ends on the root", () => each((n, s) => {
  const tonic = [s.meta.root, (s.meta.root + 7) % 12];
  for (const sec of M.SECTIONS.slice(1).map((x) => x.start - 1).concat([M.BARS - 1])) {
    const notes = s.melody.filter((x) => x.bar === sec);
    const lastNote = notes[notes.length - 1];
    const chord = chordAt(s, sec);
    const want = chord.some((pc) => tonic.includes(pc)) ? tonic : chord; // half cadence if the chord lacks both
    assert(want.includes(lastNote.midi % 12), `${n} section ending bar ${sec + 1}: ${lastNote.note}`);
  }
  const final = s.melody[s.melody.length - 1];
  equal(final.midi % 12, s.meta.root, `${n} final note`);
  equal(s.meta.chords[M.BARS - 1], chordLabel(s.meta.mode, 0), `${n} final chord is tonic`);
}));

test("no melodic leap wider than a sixth", () => each((n, s) => {
  for (let i = 1; i < s.melody.length; i++) {
    const leap = Math.abs(s.melody[i].midi - s.melody[i - 1].midi);
    assert(leap <= M.MELODY.maxLeap, `${n} bar ${s.melody[i].bar}: ${s.melody[i - 1].note}→${s.melody[i].note}`);
  }
}));

test("all notes stay between C2 and C7", () => each((n, s) => {
  for (const x of [...s.melody, ...s.bass, ...s.bells]) assert(x.midi >= 36 && x.midi <= 96, `${n} ${x.note}`);
}));

test("rhythms fit their bars without overlapping", () => each((n, s) => {
  for (const layer of ["melody", "bass"]) {
    for (let b = 0; b < M.BARS; b++) {
      const notes = s[layer].filter((x) => x.bar === b);
      assert(notes.length > 0, `${n} ${layer} bar ${b} is empty`);
      let end = 0;
      for (const x of notes) {
        assert(x.pos >= end, `${n} ${layer} bar ${b} overlaps`);
        end = x.pos + x.dur;
      }
      assert(end <= M.STEPS, `${n} ${layer} bar ${b} runs over`);
    }
  }
}));

test("tempo, velocities and automation are in range", () => each((n, s) => {
  assert(s.meta.bpm >= M.TEMPO.min && s.meta.bpm <= M.TEMPO.max, `${n} bpm ${s.meta.bpm}`);
  for (const x of [...s.melody, ...s.bass, ...s.pad, ...s.rain, ...s.bells]) assert(x.vel > 0 && x.vel <= 1, `${n} vel ${x.vel}`);
  for (const p of s.automation.pan) assert(Math.abs(p) <= M.PAN_WIDTH, `${n} pan`);
  for (const c of s.automation.cutoff) assert(c >= 500 && c <= 20000, `${n} cutoff ${c}`);
  for (const a of s.atmosphere) assert(a.level >= 0 && a.level <= 1 && a.wind >= 0 && a.wind <= 1, `${n} atmosphere`);
}));

test("weather picks sensible moods", () => {
  const b = (n) => scores[n].meta.brightness;
  equal(scores["phoenix-heat"].meta.mode, "lydian", "hot clear day");
  equal(scores["mcmurdo-cold"].meta.mode, "ionian", "cold clear day is bright but not Lydian");
  equal(scores["houston-storms"].meta.mode, "phrygian", "storm day");
  assert(["aeolian", "phrygian"].includes(scores["mumbai-monsoon"].meta.mode), "monsoon is dark");
  assert(["dorian", "aeolian"].includes(scores["london-drizzle"].meta.mode), "drizzle is gloomy, not stormy");
  assert(b("kyoto-spring") > b("reykjavik-wind") && b("reykjavik-wind") > b("mumbai-monsoon"), "brightness order");
  assert(scores["oslo-snow"].meta.snow && scores["oslo-snow"].bells.length > 0 && scores["oslo-snow"].rain.length === 0, "snow → bells");
  assert(scores["houston-storms"].fx.some((x) => x.type === "thunder"), "storm → thunder");
  assert(!scores["phoenix-heat"].fx.some((x) => x.type === "thunder"), "no thunder in the desert");
});

test("atmosphere follows conditions", () => {
  const kinds = (n) => new Set(scores[n].atmosphere.map((a) => a.kind).filter(Boolean));
  equal(kinds("phoenix-heat").size, 0, "dry day is silent");
  assert(kinds("oslo-snow").has("snow"), "snow bed");
  assert(kinds("houston-storms").has("storm"), "storm bed");
  assert(kinds("london-drizzle").has("drizzle"), "drizzle bed");
  assert(scores["reykjavik-wind"].atmosphere.some((a) => a.wind > 0), "gale → wind noise");
  assert(scores["kyoto-spring"].atmosphere.every((a) => a.wind === 0), "calm day → no wind noise");
});

test("liner notes are filled in", () => each((n, s) => {
  assert(s.meta.notes.length >= 6, n);
  for (const line of s.meta.notes) assert(!/undefined|NaN|null/.test(line), `${n}: ${line}`);
}));

test("same score whatever the hour of the call (seed ignores time)", () => {
  const f = forecasts["honolulu-flat"];
  const a = analyze(f);
  equal(compose({ ...f, lat: f.lat + 0.01 }).meta.seed, compose(f).meta.seed, "coordinates are rounded to 0.1°");
  assert(a.stats.tMax - a.stats.tMin < M.MELODY.minSpanC, "flat-day fixture is actually flat");
});

test("units change the wording, never the music", () => {
  const f = forecasts["phoenix-heat"];
  const us = compose(f, { units: "us" });
  const metric = scores["phoenix-heat"];
  equal({ ...us, meta: { ...us.meta, notes: null } }, { ...metric, meta: { ...metric.meta, notes: null } });
  assert(us.meta.notes.some((t) => t.includes("116\u00a0°F")), "46.9 °C shows as 116 °F");
  assert(us.meta.notes.some((t) => t.includes("mph")) && !us.meta.notes.some((t) => t.includes("km/h")), "mph");
  assert(metric.meta.notes.some((t) => t.includes("46.9\u00a0°C")), "metric keeps °C");
});

test("climate picks the instruments", () => {
  const expect = {
    "mcmurdo-cold": ["glass", "icy"],
    "oslo-snow": ["flute", "snow"],
    "reykjavik-wind": ["flute", "storm"], // a gale with rain counts as a storm
    "kyoto-spring": ["keys", "airy"],
    "philadelphia-autumn": ["keys", "airy"],
    "london-drizzle": ["keys", "rain"],
    "honolulu-flat": ["mallet", "lush"],
    "houston-storms": ["mallet", "storm"],
    "mumbai-monsoon": ["mallet", "rain"],
    "phoenix-heat": ["reed", "airy"],
  };
  each((n, s) => equal([s.meta.voices.melody.id, s.meta.voices.pad.id], expect[n], n));
  assert(scores["mcmurdo-cold"].meta.notes.some((t) => t.includes("glass bells")), "liner notes name the instruments");
});

test("voice tables are complete", () => {
  const last = M.PAD_VOICES[M.PAD_VOICES.length - 1];
  equal(last.when, {}, "the last pad row is a catch-all");
  equal(M.MELODY_VOICES[M.MELODY_VOICES.length - 1].maxTemp, Infinity, "the last melody row is a catch-all");
  for (const v of [...M.MELODY_VOICES, ...M.PAD_VOICES]) {
    assert(v.id && v.label && v.options && Number.isFinite(v.gain) && v.tone > 0, v.id);
  }
  const temps = M.MELODY_VOICES.map((v) => v.maxTemp);
  equal(temps, [...temps].sort((a, b) => a - b), "melody rows run cold to hot");
});

test("dynamics: calm days stay flat, rough weather builds and fades", () => {
  const e = (n) => scores[n].automation.energy;
  assert(Math.max(...e("phoenix-heat")) === 0, "Phoenix is calm");
  assert(Math.max(...e("mcmurdo-cold")) === 0, "McMurdo is calm");
  const h = e("houston-storms");
  const peak = h.indexOf(Math.max(...h));
  assert(h[peak] === 1, "Houston peaks at full energy");
  assert(h[peak - 1] > 0 && h[peak - 1] < 1 || h[peak - 1] === 1, "energy builds before the peak");
  const quiet = h.findIndex((v, i) => i > peak && v < 0.2);
  assert(quiet > peak, "energy settles after the storm");
});

test("dynamics: automation is in range and fills every bar", () => each((n, s) => {
  const A = s.automation;
  for (const k of ["energy", "gainDb", "padOpen"]) equal(A[k].length, M.BARS, `${n} ${k}`);
  for (const v of A.energy) assert(v >= 0 && v <= 1, `${n} energy ${v}`);
  for (const v of A.gainDb) assert(v <= M.DYNAMICS.maxBoostDb && v >= M.DYNAMICS.introDb, `${n} gainDb ${v}`);
  for (const v of A.padOpen) assert(v >= 0 && v <= M.DYNAMICS.padOpenOctaves, `${n} padOpen ${v}`);
  assert(Math.abs(A.gainDb[0] - (M.DYNAMICS.introDb + M.DYNAMICS.maxBoostDb * A.energy[0])) < 0.01, `${n} bar 1 eases in`);
}));

test("dynamics: busy bars step up a density row", () => {
  const s = scores["houston-storms"];
  const hours = forecasts["houston-storms"].hours;
  const busy = s.automation.energy.map((v, b) => (v >= M.DYNAMICS.busier && b < M.BARS - 1 ? b : -1)).filter((b) => b >= 0);
  assert(busy.length > 0, "has busy bars");
  // Rests can thin a bar, so ask whether any busy bar beats its calm density.
  const beats = busy.some((b) => {
    const calm = M.DENSITY.find((r) => hours[b].gust < r.maxGust).notes;
    return s.melody.filter((x) => x.bar === b).length > calm;
  });
  assert(beats, "some busy bar plays more notes than its calm row");
});

test("dynamics: the liner notes mention it", () => each((n, s) => {
  assert(s.meta.notes.some((l) => /Calm all day|Weather peaks/.test(l)), n);
}));

test("groove: humidity swings and slurs, cold clips", () => {
  each((n, s) => {
    assert(s.meta.swing >= 0 && s.meta.swing <= M.GROOVE.swingMax, `${n} swing ${s.meta.swing}`);
    for (const x of [...s.melody, ...s.bass]) assert(x.gate >= M.GROOVE.gateMin && x.gate <= 1, `${n} gate ${x.gate}`);
  });
  const avg = (n) => scores[n].melody.reduce((a, x) => a + x.gate, 0) / scores[n].melody.length;
  assert(scores["phoenix-heat"].meta.swing === 0, "dry Phoenix plays straight");
  assert(scores["mumbai-monsoon"].meta.swing > 0.3, `humid Mumbai swings (${scores["mumbai-monsoon"].meta.swing})`);
  assert(scores["oslo-snow"].meta.swing === 0 && scores["mcmurdo-cold"].meta.swing === 0, "cold days play straight");
  assert(avg("mcmurdo-cold") < avg("mumbai-monsoon"), "cold notes are shorter than humid ones");
});

test("drive and tone: in range, clean when calm, gritty in storms", () => {
  each((n, s) => {
    const A = s.automation;
    for (const k of ["driveWet", "eqHigh", "eqLow"]) equal(A[k].length, M.BARS, `${n} ${k}`);
    for (const v of A.driveWet) assert(v >= 0 && v <= M.DRIVE.wetMax, `${n} driveWet ${v}`);
    for (const v of [...A.eqHigh, ...A.eqLow]) assert(v >= M.TONE.minDb && v <= M.TONE.maxDb, `${n} eq ${v}`);
    A.energy.forEach((e, b) => { if (e <= M.DRIVE.wetFrom) equal(A.driveWet[b], 0, `${n} clean at bar ${b}`); });
  });
  const st = scores["houston-storms"];
  assert(Math.max(...st.automation.driveWet) > 0, "storm day gets some distortion");
  assert(st.meta.drive > scores["kyoto-spring"].meta.drive, "high CAPE drives harder");
  equal(scores["kyoto-spring"].meta.drive, M.DRIVE.amount, "stable air keeps the base drive");
});

test("CAPE: unstable air raises intensity before it rains", () => {
  const f = forecasts["philadelphia-autumn"];
  const calm = dynamicsCurve(f.hours).raw;
  const charged = dynamicsCurve(f.hours.map((h, b) => (b === 12 ? { ...h, cape: M.DYNAMICS.capeFull } : h)));
  assert(calm.every((v) => v < 0.5), "calm day stays calm");
  assert(Math.abs(charged.raw[12] - M.DYNAMICS.capeWeight) < 1e-9, "full CAPE → capeWeight");
  assert(charged.energy[10] > 0 && charged.energy[11] > charged.energy[10], "swell builds ahead of it");
  equal(capeLevel(undefined), 0, "missing CAPE counts as stable");
});
