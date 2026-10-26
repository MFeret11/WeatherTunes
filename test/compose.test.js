import { test, assert, equal } from "./harness.js";
import { normalizeForecast } from "../src/weather.js";
import { compose, analyze, chordDegreeAt, dynamicsCurve, capeLevel, bassFeels, chordColour, voiceChord, pickVoices } from "../src/compose.js";
import { MODES, melodyDegrees, triadPcs, chordLabel, stepAbove } from "../src/theory.js";
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
// Each bar has its own mode (the day's story) and chord.
const melodyPcs = (s, bar) => { const m = s.meta.barModes[bar]; return new Set(melodyDegrees(m, s.meta.snow).map((d) => (s.meta.root + MODES[m][d]) % 12)); };
// The chord as played: its triad, or a sus chord with the third swapped (see CHORD_COLOUR).
const chordAt = (s, bar) => s.meta.chordPcs[bar];

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
  for (const x of s.melody) assert(melodyPcs(s, x.bar).has(x.midi % 12), `${n} bar ${x.bar} ${x.note} not in ${s.meta.rootName} ${s.meta.barModes[x.bar]}`);
  for (const x of s.bells) assert(melodyPcs(s, x.bar).has(x.midi % 12), `${n} bell ${x.note}`);
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
    const lastNote = s.melody.filter((x) => x.bar <= sec).pop(); // may be held from an earlier hour
    const chord = chordAt(s, sec);
    const want = chord.some((pc) => tonic.includes(pc)) ? tonic : chord; // half cadence if the chord lacks both
    assert(want.includes(lastNote.midi % 12), `${n} section ending bar ${sec + 1}: ${lastNote.note}`);
  }
  const final = s.melody[s.melody.length - 1];
  equal(final.midi % 12, s.meta.root, `${n} final note`);
  equal(s.meta.chords[M.BARS - 1], chordLabel(s.meta.barModes[M.BARS - 1], 0), `${n} final chord is tonic`);
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
  // Notes never overlap; a note may run into later hours only as a held note.
  let end = 0;
  const covered = new Set();
  for (const x of s.melody) {
    const start = x.bar * M.STEPS + x.pos;
    assert(start >= end, `${n} melody bar ${x.bar} overlaps`);
    assert(x.dur <= M.HOLD.maxSteps, `${n} melody bar ${x.bar} longer than a whole note`);
    end = start + x.dur;
    for (let t = start; t < end; t++) covered.add(Math.floor(t / M.STEPS));
  }
  assert(end <= M.BARS * M.STEPS, `${n} melody runs past the end`);
  for (let b = 0; b < M.BARS; b++) assert(covered.has(b), `${n} melody hour ${b} is silent`);
}));

test("bass fits each chord without overlapping (half-time spans the chord)", () => each((n, s) => {
  const span = M.STEPS * M.BARS_PER_CHORD;
  for (let c = 0; c < M.BARS; c += M.BARS_PER_CHORD) {
    const notes = s.bass.filter((x) => x.bar >= c && x.bar < c + M.BARS_PER_CHORD)
      .map((x) => ({ start: (x.bar - c) * M.STEPS + x.pos, dur: x.dur }));
    assert(notes.length > 0, `${n} bass chord at ${c} is empty`);
    let end = 0;
    for (const x of notes) {
      assert(x.start >= end, `${n} bass chord ${c} overlaps`);
      end = x.start + x.dur;
    }
    assert(end <= span, `${n} bass chord ${c} runs over`);
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
  assert(scores["houston-storms"].meta.barModes.includes("phrygian"), "the storm itself is Phrygian");
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
  assert(s.meta.notes.length === 1 && s.meta.notes[0].length > 120 && s.meta.notes[0].length < 900, n);
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
  equal({ ...us, meta: { ...us.meta, notes: null, liner: null } }, { ...metric, meta: { ...metric.meta, notes: null, liner: null } });
  assert(us.meta.notes.some((t) => t.includes("116\u00a0°F")), "46.9 °C shows as 116 °F");
  assert(us.meta.notes.some((t) => t.includes("mph")) && !us.meta.notes.some((t) => t.includes("km/h")), "mph");
  assert(metric.meta.notes.some((t) => t.includes("46.9\u00a0°C")), "metric keeps °C");
});

test("climate picks the instruments", () => {
  const expect = {
    "mcmurdo-cold": ["glass", "icy"],
    "oslo-snow": ["glass", "snow"], // −5 °C, but the snowstorm's wind makes it feel like −11 °C
    "reykjavik-wind": ["flute", "storm"], // a gale with rain counts as a storm
    "kyoto-spring": ["keys", "airy"],
    "philadelphia-autumn": ["keys", "airy"],
    "london-drizzle": ["pluck", "ghost"],
    "honolulu-flat": ["mallet", "lush"],
    "houston-storms": ["mallet", "storm"],
    "mumbai-monsoon": ["mallet", "rain"],
    "phoenix-heat": ["reed", "airy"],
  };
  each((n, s) => equal([s.meta.voices.melody.id, s.meta.voices.pad.id], expect[n], n));
  assert(scores["mcmurdo-cold"].meta.notes.some((t) => /glass bells/i.test(t)), "liner notes name the instruments");
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
  for (const v of A.gainDb) assert(v <= M.DYNAMICS.maxBoostDb && v >= M.DYNAMICS.introDb + M.DYNAMICS.quietDb, `${n} gainDb ${v}`);
  for (const v of A.padOpen) assert(v >= 0 && v <= M.DYNAMICS.padOpenOctaves, `${n} padOpen ${v}`);
  const dip = s.meta.arc.dramatic ? M.DYNAMICS.quietDb * (1 - A.energy[0])
    : M.CALM_DETAIL.swellDb * (2 * s.meta.stir[0] - 1);
  assert(Math.abs(A.gainDb[0] - (M.DYNAMICS.introDb + M.DYNAMICS.maxBoostDb * A.energy[0] + dip)) < 0.01, `${n} bar 1 eases in`);
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
  assert(s.meta.notes.some((l) => /calm day|weather peaks/i.test(l)), n);
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

test("bass feel follows the weather, never the clock", () => {
  each((n, s) => {
    const f = s.meta.bassFeel;
    equal(f.length, M.BARS, `${n} bassFeel length`);
    for (let b = 0; b < M.BARS; b += M.BARS_PER_CHORD) equal(f[b], f[b + 1], `${n} feel changes only on a chord`);
    assert(f[M.BARS - 1] !== "half", `${n} ends on a held root`);
  });
  assert(scores["houston-storms"].meta.bassFeel.includes("double"), "storm → double-time");
  assert(scores["mcmurdo-cold"].meta.bassFeel.filter((x) => x === "half").length >= M.BARS - M.BARS_PER_CHORD, "freezing → half-time");
  // Same weather at a different hour gives the same feel.
  const H = forecasts["philadelphia-autumn"].hours.map((h) => ({ ...h, gust: 5, precip: 0, code: 0, isDay: 1 }));
  const night = H.map((h) => ({ ...h, isDay: 0 }));
  const e = H.map(() => 0);
  const st = { tMean: 10 };
  equal(JSON.stringify(bassFeels(H, e, st)), JSON.stringify(bassFeels(night, e, st)), "day/night has no effect");
});

test("story: the mood follows the sky and clearings resolve", () => {
  each((n, s) => {
    const ch = s.meta.chapters;
    equal(ch[0].bar, 0, `${n} first chapter starts the song`);
    for (let i = 1; i < ch.length; i++) {
      assert(ch[i].mode !== ch[i - 1].mode, `${n} chapter ${i} changes mode`);
      assert(ch[i].bar - ch[i - 1].bar >= M.STORY.minChords * M.BARS_PER_CHORD || i === 1 && ch[0].bar === 0, `${n} chapter ${i} too short`);
      equal(s.meta.chordDegrees[ch[i].bar], 0, `${n} chapter ${i} opens on its tonic`);
      if (ch[i].turn === "brighter") {
        const prep = s.meta.chordDegrees[ch[i].bar - 1];
        assert([3, 4, 6].includes(prep), `${n} clearing is prepared`);
        assert(s.fx.some((x) => x.label === "clearing" && x.bar === ch[i].bar - 1), `${n} clearing swell`);
      }
    }
  });
  // A calm, even day tells no story; a storm that passes darkens then clears.
  equal(scores["philadelphia-autumn"].meta.chapters.length, 1, "clear day stays in one mood");
  const f = forecasts["philadelphia-autumn"];
  const stormy = { ...f, hours: f.hours.map((h, b) => (b >= 10 && b < 16
    ? { ...h, cloud: 100, pop: 100, precip: 12, code: 95, gust: 80 } : h)) };
  const turns = compose(stormy).meta.chapters.map((c) => c.turn);
  assert(turns.includes("darker") && turns.indexOf("brighter") > turns.indexOf("darker"), `storm then clearing: ${turns}`);
});

test("arc: calm days stay calm, storms build, peak and release", () => {
  for (const n of ["phoenix-heat", "mcmurdo-cold", "philadelphia-autumn"]) {
    const a = scores[n].meta.arc;
    assert(!a.dramatic && a.phases.every((p) => p === "calm"), `${n} is calm all day`);
    equal(scores[n].drums.length, 0, `${n} has no storm drums`);
  }
  const s = scores["houston-storms"];
  const ph = s.meta.arc.phases;
  assert(s.meta.arc.dramatic, "Houston is dramatic");
  const firstPeak = ph.indexOf("peak");
  assert(firstPeak > 0 && ph[firstPeak - 1] === "build", "a build leads into the peak");
  assert(ph.lastIndexOf("release") > ph.lastIndexOf("peak"), "the storm releases after its last peak");
  assert(s.drums.length > 0 && s.drums.every((d) => ph[d.bar] !== "release" && ph[d.bar] !== "calm"), "drums only while building or peaking");
  const quiet = s.automation.gainDb[ph.indexOf("calm") > 0 ? ph.indexOf("calm") : 1];
  assert(Math.max(...s.automation.gainDb) - quiet >= 6, "the peak is clearly louder than the calm");
  assert(s.fx.some((f) => f.label === "release" || f.label === "clearing"), "the storm breaking gets a swell");
});

test("calm days follow their small changes", () => {
  for (const n of ["phoenix-heat", "kyoto-spring", "honolulu-flat"]) {
    const s = scores[n];
    if (s.meta.arc.dramatic) continue;
    for (const v of s.meta.stir) assert(v >= 0 && v <= 1, `${n} stir ${v}`);
    const g = s.automation.gainDb.slice(1);
    assert(Math.max(...g) - Math.min(...g) > 1, `${n} the band breathes (${Math.min(...g)}..${Math.max(...g)} dB)`);
    const perBar = Array.from({ length: M.BARS - 1 }, (_, b) => s.melody.filter((x) => x.bar === b).length);
    assert(new Set(perBar).size > 1, `${n} melody density varies`);
  }
  // A dramatic day keeps its own arc untouched.
  const storm = scores["houston-storms"];
  if (storm.meta.arc.dramatic) assert(storm.meta.stir.every((v) => v === 0), "storm day has no calm stir");
});

test("overcast hours play the melody quieter", () => {
  const f = structuredClone(forecasts["phoenix-heat"]);
  const clear = compose(f);
  for (const h of f.hours) h.cloud = 100;
  const grey = compose(f);
  assert(grey.automation.melodyDb.every((d) => d === M.MELODY.overcastDb), "full cloud → full cut every hour");
  assert(clear.automation.melodyDb.every((d, b) => d <= 0 && (f.hours[b].cloud, true)), "never boosted");
  assert(Math.min(...clear.automation.melodyDb) > M.MELODY.overcastDb, "a clear day keeps most of its melody");
});

test("the melody fades in at sunrise and out at sunset", () => {
  const s = scores["houston-storms"]; // sunrise 6:20 am, sunset 8:22 pm
  const day = s.automation.melodyDayDb;
  const total = day.map((d, b) => d + s.automation.melodyDb[b]);
  assert(day[2] < 0 && day[12] === 0 && day[23] < 0, "soft at night, full at midday");
  assert(day[5] <= day[6] && day[6] <= day[7] && day[19] >= day[20] && day[20] >= day[21], "rises at dawn, falls at dusk");
  assert(day.some((d) => d < 0 && d > M.MELODY.nightDb), "fades through in-between levels");
  assert(total.every((d) => d >= M.MELODY.floorDb - 0.01), "cloud and night stop at the floor");
  assert(scores["mcmurdo-cold"].automation.melodyDayDb.every((d) => d === 0), "polar night keeps its melody");
  assert(JSON.stringify(s.meta.notes).includes("fades in around sunrise"), "liner notes mention it");
});

test("weather traits: crackle, round bass and the rain beat follow their measurements", () => {
  const s = scores["london-drizzle"];
  equal(s.meta.voices.pad.id, "ghost", "cool grey drizzle → ghost pad");
  assert(s.meta.bassSub >= 0.9, "overcast → sub bass");
  assert(s.garage.length > 0 && s.crackle.length > 0, "beat and crackle");
  each((n, sc, f) => {
    assert(sc.meta.bassSub >= 0 && sc.meta.bassSub <= 1, `${n} bassSub`);
    for (const x of sc.garage) {
      const h = f.hours[x.bar];
      assert(x.pos >= 0 && x.pos < M.STEPS && x.vel > 0 && x.vel <= 1, `${n} beat hit ${JSON.stringify(x)}`);
      assert(!M.SNOW_CODES.includes(h.code), `${n} no beat in snow`);
      assert(x.kind !== "kick" || h.precip >= M.RAIN_BEAT.kickMm, `${n} kick only in heavier rain`);
    }
    for (const x of sc.crackle) assert(x.pos >= 0 && x.pos < M.STEPS && x.vel > 0 && x.vel <= 1, `${n} crackle`);
  });
  // Dry, clear days have none of it, except dust crackle in hazy air.
  for (const n of ["phoenix-heat", "kyoto-spring", "philadelphia-autumn"]) {
    const sc = scores[n];
    assert(sc.garage.length === 0 && sc.meta.bassSub === 0, `${n} is dry and clear`);
    for (const x of sc.crackle) assert(sc.meta.sky.haze[x.bar] > 0, `${n}: crackle only in hazy hours`);
  }
});

// ---- Sky and air ------------------------------------------------------------

const withDate = (n, date, extras) => ({ ...forecasts[n], date, extras: { ...forecasts[n].extras, ...extras } });
const inRange = (c) => c.midi >= M.CHIMES.low && c.midi <= M.CHIMES.high;

test("sky extras add parts but never change the rest of the song", () => each((n, s, f) => {
  const bare = compose({ ...f, extras: {} });
  for (const k of ["melody", "bass", "pad", "drums", "rain", "bells", "garage"]) equal(bare[k], s[k], `${n} ${k}`);
  for (const c of s.chimes) assert(inRange(c) && c.vel > 0 && c.vel <= 1 && c.pos >= 0 && c.pos < M.STEPS, `${n} chime ${JSON.stringify(c)}`);
  for (const x of s.shimmer) assert(x.notes.length && x.vel > 0 && x.vel <= 1, `${n} shimmer`);
}));

test("songs still compose with no extras and no sky data at all", () => {
  const f = { ...forecasts["kyoto-spring"], extras: undefined, has: undefined, timezone: undefined };
  const s = compose(f);
  assert(s.meta.notes.length === 1 && !/undefined|NaN/.test(s.meta.notes.join(" ")), "notes still read cleanly");
});

test("moonlight lifts the night, and a visible moonrise rings a bell", () => {
  const s = scores["philadelphia-autumn"]; // crescent rising at 2:14 am under a clear sky
  const bell = s.chimes.find((c) => c.kind === "moon");
  assert(bell && bell.bar === 2, "bell at the moonrise hour");
  const dark = compose({ ...forecasts["philadelphia-autumn"], date: "2025-10-21" }); // new moon
  assert(!dark.chimes.some((c) => c.kind === "moon"), "no bell at new moon");
  const lit = compose({ ...forecasts["phoenix-heat"] }); // 99% lit, up all evening
  const unlit = compose({ ...forecasts["phoenix-heat"], date: "2025-07-24" }); // new moon
  assert(lit.automation.melodyDayDb[22] > unlit.automation.melodyDayDb[22], "melody dims less under a bright moon");
  assert(lit.automation.cutoff[22] > unlit.automation.cutoff[22], "and the filter opens");
  assert(!scores["london-drizzle"].chimes.some((c) => c.kind === "moon"), "no bell behind thick cloud");
});

test("auroras: a shimmering chord where they can be seen", () => {
  const r = scores["reykjavik-wind"]; // Kp 6, gaps in the cloud
  const a = r.shimmer.filter((x) => x.kind === "aurora");
  assert(a.length > 0, "Reykjavik gets the chord");
  for (const x of a) assert(Math.max(...r.meta.sky.aurora.slice(x.bar, x.bar + 2)) >= M.AURORA.min, "only where bright enough");
  assert(!scores["houston-storms"].shimmer.some((x) => x.kind === "aurora"), "never in Houston, even at Kp 6.7");
  assert(scores["oslo-snow"].meta.notes.some((t) => /northern lights .* cloud hides them/.test(t)), "a snowstorm hides them, and the notes say so");
});

test("meteor showers, solstices and holidays", () => {
  const p = compose(withDate("phoenix-heat", "2025-08-12"));
  const stars = p.chimes.filter((c) => c.kind === "meteor");
  assert(stars.length >= 3 && stars.every((c) => p.meta.sky.dark[c.bar] >= 0.9), `Perseids in the dark: ${stars.length}`);
  assert(p.meta.notes.some((t) => /Perseids/.test(t)), "named in the notes");
  const sol = compose(withDate("london-drizzle", "2025-12-21"));
  assert(sol.chimes.filter((c) => c.kind === "season").length === 2 && sol.meta.notes.some((t) => /December solstice .* shortest day/.test(t)), "solstice bell");
  const hol = compose(withDate("philadelphia-autumn", "2025-10-16", { holidays: [{ name: "Test Day", localName: "Test Day" }] }));
  const arp = hol.chimes.filter((c) => c.kind === "holiday");
  assert(arp.length >= 3 && arp.every((c) => c.bar >= M.BARS - 2), "a closing arpeggio");
  assert(arp.every((c, i) => i === 0 || c.midi > arp[i - 1].midi), "rising");
  assert(hol.meta.notes.some((t) => /Test Day, a public holiday/.test(t)), "named");
});

test("haze, UV, snow cover and frost", () => {
  const ph = scores["phoenix-heat"]; // AQI 108, UV 9
  assert(ph.crackle.length > 0 && ph.automation.eqHigh.some((d, b) => d < compose({ ...forecasts["phoenix-heat"], extras: {} }).automation.eqHigh[b]), "haze crackles and dulls");
  assert(ph.shimmer.some((x) => x.kind === "sun") && !scores["london-drizzle"].shimmer.some((x) => x.kind === "sun"), "UV shimmer only under real sun");
  const os = scores["oslo-snow"]; // 12 cm of snow
  assert(os.automation.reverbWet < compose({ ...forecasts["oslo-snow"], hours: forecasts["oslo-snow"].hours.map((h) => ({ ...h, snowDepth: 0 })) }).automation.reverbWet, "snow soaks up reverb");
  const cold = forecasts["philadelphia-autumn"].hours.map((h) => ({ ...h, temp: h.hour < 9 ? -2 : h.temp }));
  const fr = compose({ ...forecasts["philadelphia-autumn"], hours: cold, extras: { ...forecasts["philadelphia-autumn"].extras, minTemps: Array(40).fill(5) } });
  assert(fr.meta.sky.firstFrost && fr.chimes.some((c) => c.kind === "frost"), "first frost glints");
  assert(fr.meta.notes.some((t) => /first frost of the season/.test(t)), "and is named");
  const notFirst = compose({ ...forecasts["philadelphia-autumn"], hours: cold, extras: { ...forecasts["philadelphia-autumn"].extras, minTemps: [5, -1, ...Array(38).fill(5)] } });
  assert(!notFirst.meta.sky.firstFrost, "an earlier frost means it isn't the first");
});

test("swing follows the dew point", () => {
  assert(scores["mumbai-monsoon"].meta.swing >= 0.45, "monsoon dew point swings hard");
  assert(scores["phoenix-heat"].meta.swing === 0, "desert air (46 °C but a 10 °C dew point) plays straight");
});

test("the forecast paragraph mentions feels-like, air, UV, snow and frost when they matter", async () => {
  const { describe } = await import("../src/describe.js");
  const ph = describe(forecasts["phoenix-heat"]);
  assert(/Air quality is unhealthy for sensitive groups \(AQI 108\)/.test(ph) && /UV is very high/.test(ph), ph);
  const mc = describe(forecasts["mcmurdo-cold"]);
  assert(/feeling like −?-?\d+ °C in the wind/.test(mc) && /103 cm of snow on the ground/.test(mc), mc);
  const mu = describe(forecasts["mumbai-monsoon"]);
  assert(/oppressively humid/.test(mu), mu);
  assert(!/Air quality|UV is/.test(describe(forecasts["london-drizzle"])), "nothing extra on an ordinary grey day");
});

// ---- Chord colour -----------------------------------------------------------

test("chords are their triad, or a sus with a whole-tone 2nd or perfect 4th", () => each((n, s) => {
  for (let b = 0; b < M.BARS; b++) {
    const m = s.meta.barModes[b], d = s.meta.chordDegrees[b];
    const t = triadPcs(s.meta.root, m, d);
    const got = s.meta.chordPcs[b];
    const sus = s.meta.colours[Math.floor(b / M.BARS_PER_CHORD)].sus;
    equal([got[0], got[2]], [t[0], t[2]], `${n} bar ${b} root and fifth`);
    if (!sus) equal(got[1], t[1], `${n} bar ${b} third`);
    else equal((got[1] - got[0] + 12) % 12, sus === "sus2" ? 2 : 5, `${n} bar ${b} ${sus}`);
    if (sus === "sus2") equal(stepAbove(m, d, 1), 2, `${n} bar ${b} sus2 is in the mode`);
    if (sus === "sus4") equal(stepAbove(m, d, 3), 5, `${n} bar ${b} sus4 is in the mode`);
  }
  assert(!s.meta.colours[s.meta.colours.length - 1].sus, `${n} the last chord resolves`);
}));

test("pad: chord tones in range, colour notes above them, in the mode and never a half step off", () => each((n, s) => {
  const V = M.CHORD_COLOUR.voicing;
  for (const c of s.pad) {
    equal(c.midis.map((x) => x % 12).sort(), s.meta.chordPcs[c.bar].slice().sort(), `${n} pad bar ${c.bar} plays its chord`);
    for (const x of c.midis) assert(x >= V.low && x <= V.high, `${n} pad ${x}`);
    const top = Math.max(...c.midis);
    for (const x of c.colour) {
      assert(x.midi > top && x.midi <= top + 12, `${n} ${x.kind} sits above the chord`);
      assert(melodyPcs({ meta: { ...s.meta, snow: false } }, c.bar).has(x.midi % 12), `${n} ${x.kind} in the mode`);
      const fromRoot = (x.midi - s.meta.chordPcs[c.bar][0] + 12) % 12;
      assert(fromRoot !== 1, `${n} ${x.kind} a half step above the root`);
      assert(x.vel > 0 && x.vel <= c.vel, `${n} ${x.kind} vel ${x.vel}`);
    }
    if (s.meta.colours[c.bar / M.BARS_PER_CHORD].open) assert(top - Math.min(...c.midis) > V.openSpan, `${n} open chord spreads`);
  }
}));

test("pad voice leading: closed chords move by a few semitones per voice", () => each((n, s) => {
  for (let i = 1; i < s.pad.length; i++) {
    const a = s.pad[i - 1].midis, b = s.pad[i].midis;
    if (s.meta.colours[i].open !== s.meta.colours[i - 1].open) continue;
    const move = b.reduce((t, x) => t + Math.min(...a.map((y) => Math.abs(x - y))), 0) / b.length;
    assert(move <= 4, `${n} chord ${i} moves ${move.toFixed(1)} per voice`);
  }
}));

test("chord colour follows the air", () => {
  const has = (n, k) => scores[n].pad.some((c) => c.colour.some((x) => x.kind === k));
  assert(has("mumbai-monsoon", "7th") && has("houston-storms", "7th") && has("london-drizzle", "7th"), "humid days get sevenths");
  assert(!has("kyoto-spring", "7th") && !has("mcmurdo-cold", "7th"), "dry days don't");
  assert(has("kyoto-spring", "9th") && has("philadelphia-autumn", "9th"), "clear days get ninths");
  assert(!has("london-drizzle", "9th") && !has("mumbai-monsoon", "9th"), "grey days don't");
  assert(scores["reykjavik-wind"].meta.colours.some((c) => c.susBy === "pressure"), "a fast pressure change suspends a chord");
  assert(scores["reykjavik-wind"].meta.colours.some((c) => c.open), "a windy day spreads the chords");
  // Fog gives sus2 where the mode has a whole-tone 2nd.
  const fog = Array.from({ length: 2 }, () => ({ code: 45, pressure: 1013, dew: 5, temp: 6, cloud: 100, isDay: 1, wind: 5 }));
  equal(chordColour(fog, "ionian", 0, false).sus, "sus2", "fog on I");
  equal(chordColour(fog, "phrygian", 0, false).sus, "sus4", "fog on Phrygian i (b2 would clash) → sus4");
  equal(chordColour(fog, "ionian", 0, true).sus, null, "never on the final chord");
  equal(voiceChord([0, 4, 7], [60, 64, 67], false), [60, 64, 67], "same chord stays put");
});

// ---- Dry beat ----------------------------------------------------------------

test("dry beat: only in dry hours the rain beat and storm leave alone", () => each((n, s, f) => {
  const rainBars = new Set(s.garage.map((x) => x.bar));
  for (const x of s.beat) {
    const h = f.hours[x.bar];
    assert(!rainBars.has(x.bar), `${n} hour ${x.bar} has both beats`);
    assert(h.precip < 0.1 && h.pop < M.RAIN_BEAT.hourPop && !M.SNOW_CODES.includes(h.code), `${n} hour ${x.bar} is wet`);
    assert(x.bar < M.BARS - 1, `${n} beat in the last hour`);
    const ph = s.meta.arc.phases[x.bar];
    assert(!(s.meta.arc.stormy && (ph === "build" || ph === "peak")), `${n} beat under storm drums`);
    assert(x.pos >= 0 && x.pos < M.STEPS && x.vel > 0 && x.vel <= 1, `${n} beat hit ${x.pos} ${x.vel}`);
  }
}));

test("dry beat: hats follow the wind, kick the warmth, rim the clear sky", () => each((n, s, f) => {
  const B = M.DRY_BEAT;
  for (const b of new Set(s.beat.map((x) => x.bar))) {
    const h = f.hours[b];
    const hits = (k) => s.beat.filter((x) => x.bar === b && x.kind === k).map((x) => x.pos);
    equal(hits("hat"), B.hats.find((r) => h.wind < r.maxWind).steps, `${n} hour ${b} hats`);
    const k = B.kick.find((r) => (h.feels ?? h.temp) < r.maxFeels);
    equal(hits("kick"), !k.perChord || b % M.BARS_PER_CHORD === 0 ? k.steps : [], `${n} hour ${b} kick`);
    equal(hits("snare").length, h.cloud < B.rimMaxCloud ? 1 : 0, `${n} hour ${b} rim`);
  }
  if (n === "oslo-snow" || n === "london-drizzle") equal(s.beat.length, 0, `${n} has no dry hours`);
  if (n === "kyoto-spring" || n === "phoenix-heat") assert(s.beat.length > 0, `${n} has a dry beat`);
}));

// ---- Held notes --------------------------------------------------------------

test("steady weather holds a repeated note instead of striking it again", () => each((n, s, f) => {
  const H = f.hours, D = M.HOLD;
  const steady = (b) => b > 0 && Math.abs(H[b].gust - H[b - 1].gust) < D.gustKmh
    && Math.abs(H[b].cloud - H[b - 1].cloud) < D.cloud && Math.abs(H[b].pop - H[b - 1].pop) < D.pop && Math.abs(H[b].precip - H[b - 1].precip) < D.precipMm;
  const opens = (b) => M.SECTIONS.some((x) => x.start === b);
  for (let i = 1; i < s.melody.length; i++) {
    const p = s.melody[i - 1], x = s.melody[i];
    if (p.midi !== x.midi || p.bar * M.STEPS + p.pos + p.dur !== x.bar * M.STEPS + x.pos) continue;
    // A re-strike is only allowed when the weather changed, a section opens, the hold is full, or it's the last hour.
    const ok = !steady(x.bar) || (p.bar !== x.bar && opens(x.bar)) || p.dur + x.dur > D.maxSteps || x.bar === M.BARS - 1;
    assert(ok, `${n} hour ${x.bar} repeats ${x.note} in steady weather`);
  }
  for (const x of s.melody) {
    const hours = Math.ceil((x.pos + x.dur) / M.STEPS);
    for (let k = 1; k < hours; k++) assert(steady(x.bar + k) && !opens(x.bar + k), `${n} ${x.note} held into a changing hour ${x.bar + k}`);
  }
}));

test("arpeggio: chord tones, in range, only in clear dry daylight", () => each((n, s, f) => {
  for (const x of s.arp) {
    const h = f.hours[x.bar];
    assert(h.isDay && h.precip < 0.1 && !M.SNOW_CODES.includes(h.code), `${n} arp in hour ${x.bar}`);
    assert(x.bar < M.BARS - 1, `${n} arp in the last hour`);
    assert(x.midi >= M.ARP.low && x.midi <= M.ARP.high, `${n} arp ${x.note} out of range`);
    const pcs = new Set(chordAt(s, x.bar));
    if (s.meta.colours[Math.floor(x.bar / M.BARS_PER_CHORD)].seventh >= M.CHORD_COLOUR.min) {
      const m = s.meta.barModes[x.bar];
      pcs.add((s.meta.root + MODES[m][(s.meta.chordDegrees[x.bar] + 6) % 7]) % 12);
    }
    assert(pcs.has(x.midi % 12), `${n} arp ${x.note} not in the chord at hour ${x.bar}`);
    assert(x.vel > 0 && x.vel <= M.ARP.vel + M.ARP.accent, `${n} arp vel ${x.vel}`);
  }
  const ph = s.meta.arc.phases;
  if (s.meta.arc.stormy) for (const x of s.arp) assert(ph[x.bar] !== "build" && ph[x.bar] !== "peak", `${n} arp in a storm`);
}));

test("arpeggio: faster in wind, direction follows pressure", () => {
  const clear = (wind) => normalizeForecast({ ...raw["phoenix-heat"], hourly: { ...raw["phoenix-heat"].hourly,
    cloud_cover: Array(24).fill(0), precipitation: Array(24).fill(0), precipitation_probability: Array(24).fill(0),
    wind_speed_10m: Array(24).fill(wind), wind_gusts_10m: Array(24).fill(wind + 5), weather_code: Array(24).fill(0) } });
  const still = compose(clear(4)).arp, windy = compose(clear(20)).arp;
  assert(still.length && windy.length > still.length, `windy ${windy.length} vs still ${still.length}`);
  assert(still.every((x) => x.dur === 2) && windy.every((x) => x.dur === 1), "rate rows");
  const s = compose(clear(4));
  const run = s.arp.filter((x) => x.bar === s.arp[0].bar).map((x) => x.midi);
  if (s.meta.trend === "rising") assert(run[1] > run[0], "rising climbs");
  if (s.meta.trend === "falling") assert(run[1] < run[0], "falling descends");
});

test("echo carries in clear, still, dry air", () => each((n, s, f) => {
  s.automation.echoCarry.forEach((c, b) => {
    const h = f.hours[b];
    assert(c >= 0 && c <= 1, `${n} carry ${c}`);
    if (h.precip >= 0.1 || M.ECHO.fogCodes.includes(h.code) || M.SNOW_CODES.includes(h.code)) equal(c, 0, `${n} wet hour ${b}`);
    if (h.gust >= M.ECHO.windyGust) equal(c, 0, `${n} windy hour ${b}`);
  });
}));

test("cloudy days split three ways: warm horns, grey organ, drifting swells", () => {
  const day = (o) => ({ tMean: 12, feelsMean: 12, cloud: 0.6, rh: 60, pop: 0, precipSum: 0, wetHours: 0, rainRate: 0, ...o });
  equal(pickVoices(day({ tMean: 22, cloud: 0.6 }), false, false).pad.id, "horns", "warm and cloudy");
  equal(pickVoices(day({ tMean: 22, cloud: 0.95 }), false, false).pad.id, "horns", "warm wins over grey");
  equal(pickVoices(day({ tMean: 8, cloud: 0.9 }), false, false).pad.id, "overcast", "cool and grey");
  equal(pickVoices(day({ tMean: 12, cloud: 0.6 }), false, false).pad.id, "drift", "broken cloud");
  equal(pickVoices(day({ tMean: 12, cloud: 0.3, rh: 50 }), false, false).pad.id, "airy", "clear days unchanged");
});
