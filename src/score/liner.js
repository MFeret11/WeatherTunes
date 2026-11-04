// Liner notes: plain-English reasons for today's song.

import * as M from "../mapping.js";
import { MODE_LABELS } from "../theory.js";
import { clamp, hourLabel, formatTemp, formatSpeed } from "../util.js";
import { modeFor } from "./story.js";

// Instrument names as sentence subjects, with the right verb.
const MELODY_PHRASE = { glass: "glass bells play", flute: "a breathy flute plays", keys: "soft keys play", pluck: "plucked strings play",
  mallet: "a marimba plays", reed: "a reedy pipe plays" };
const PAD_PHRASE = { storm: "dark, detuned saws hold", snow: "a hushed choir holds", ghost: "ghostly, wordless voices hold",
  rain: "a wobbling electric piano holds", overcast: "a muffled organ holds", icy: "a thin, icy shimmer holds",
  lush: "lush strings hold", airy: "an airy, open pad holds" };

const MODE_HINTS = {
  lydian: ", the brightest mode",
  ionian: "",
  mixolydian: ", bright with a bluesy edge",
  dorian: ", minor but hopeful",
  aeolian: "",
  phrygian: ", the darkest mode used here",
};

/**
 * Liner notes: one short paragraph, { paragraphs: [text] }. It says what the
 * weather sets (key, instruments, tune, tempo), how the day is shaped, the most
 * notable thing in the sky if there is one, and the sunrise and sunset fade.
 */
export function linerNotes(f, A, meta, layers, units) {
  const s = A.stats;
  const H = f.hours;
  const v = A.voices;
  const join = (parts) => parts.filter(Boolean).join(" ");
  const an = (w) => `${/^(8|11|18)(\D|$)/.test(w) ? "an" : "a"} ${w}`;
  const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");

  const feel = s.tMean < -10 ? "bitterly cold" : s.tMean < 0 ? "freezing" : s.tMean < 8 ? "cold" : s.tMean < 15 ? "cool"
    : s.tMean < 22 ? "mild" : s.tMean < 28 ? "warm" : s.tMean < 34 ? "hot" : "scorching";
  const sky = A.storm ? "stormy" : A.snow && s.pop >= 0.3 ? "snowy" : s.pop >= 0.5 ? "rainy"
    : s.cloud < 0.2 ? "clear" : s.cloud < 0.5 ? "partly cloudy" : s.cloud < 0.8 ? "mostly cloudy" : "overcast";
  const melodyNoun = MELODY_PHRASE[v.melody.id]?.replace(/ plays?$/, "") ?? v.melody.label;
  const padNoun = PAD_PHRASE[v.pad.id]?.replace(/ holds?$/, "") ?? v.pad.label;
  // A harsh day (see MOOD) says what the sky alone would have played, and that the heat or cold changed it.
  const harm = A.dayHeat >= A.harsh ? "heat" : "cold";
  const skyMode = A.moodFrom ? A.mode : modeFor(A.brightness + A.moodDark, s.tMean);
  const darkened = skyMode !== A.mode;
  const sets = `A ${feel}, ${sky} day puts the song in ${meta.rootName} ${meta.modeLabel}${darkened ? "" : MODE_HINTS[meta.mode]}, with ${melodyNoun} on the melody over ${padNoun}.`
    + (darkened ? ` The ${sky} sky alone would make it ${MODE_LABELS[skyMode]}, but the ${harm} darkens it.` : "");
  const T = M.TEMPO, windBpm = Math.round(clamp(T.base + T.perRootKmh * Math.sqrt(s.wind), T.min, T.max));
  const tempo = windBpm - A.bpm >= 5
    ? `${an(formatSpeed(s.wind, units))} average wind would set the tempo at ${windBpm} BPM, but the ${harm} slows it to ${A.bpm}.`
    : `${an(formatSpeed(s.wind, units))} average wind sets the tempo at ${A.bpm} BPM.`;
  const drives = `The tune follows the temperature, from ${formatTemp(s.tMin, units)} at ${hourLabel(s.tMinHour)} to ${formatTemp(s.tMax, units)} at ${hourLabel(s.tMaxHour)}, and ${tempo}`;

  let shape;
  if (!meta.arc.dramatic) {
    shape = "It's a calm day, so the music stays even and only breathes with the weather.";
  } else {
    const peaks = meta.arc.moments.filter((m) => m.phase === "peak").map((m) => hourLabel(m.bar));
    const at = A.intensity.indexOf(Math.max(...A.intensity));
    const h = H[at];
    const why = [];
    if (M.THUNDER_CODES.includes(h.code)) why.push("thunder");
    else if (h.precip >= 0.5) why.push(`heavy ${M.SNOW_CODES.includes(h.code) ? "snow" : "rain"}`);
    if (h.gust >= M.DYNAMICS.gustFrom) why.push("strong gusts");
    shape = `The weather peaks ${peaks.length > 1 ? `twice, at ${listOf(peaks)}` : `at ${peaks[0] ?? hourLabel(at)}`}${why.length ? ` with ${listOf(why)}` : ""}, and the music swells with it before easing off.`;
  }

  const daylight = f.sunrise != null && f.sunset > f.sunrise
    ? `The melody fades in around sunrise and out around sunset.`
    : H.every((h) => !h.isDay) ? "With no sunrise in the polar night, the melody stays dim all day."
      : "Under the midnight sun, the melody plays at full strength all day.";

  const arpHours = new Set(layers.arp.map((n) => n.bar)).size;
  const echoes = layers.automation.echoCarry.filter((c) => c >= 0.5).length >= 3;
  const arp = arpHours >= 3
    ? `Clear daylight sets a soft arpeggio running over the chords${echoes ? ", and the melody echoes in the still air" : ""}.`
    : echoes ? "The melody echoes in the clear, still air." : "";

  const O = meta.outliers;
  const hours = (xs) => xs.map((x, b) => (x ? b : -1)).filter((b) => b >= 0);
  const outliers = [];
  const hot = hours(O.heat.map((x) => x >= 0.5));
  if (hot.length) outliers.push(`The heat is dangerous${hot.length < 20 ? ` around ${hourLabel(hot[Math.floor(hot.length / 2)])}` : ""}, so the melody wilts: it wavers like air over hot ground, thins out and dulls.`);
  if (O.ice.some(Boolean)) outliers.push("Freezing rain glazes everything, and the shakers turn into brittle, glassy ticks.");
  const eyeAt = hours(O.eye);
  if (eyeAt.length) outliers.push(`At ${hourLabel(eyeAt[0])} the eye of the storm passes over: the wind drops away and the music almost stops, before the storm slams back.`);
  const white = hours(O.whiteout.map((x) => x >= 0.5));
  if (white.length >= 2) outliers.push("Snow in a gale makes a whiteout: the melody is buried in the wind.");
  if (O.front != null) outliers.push(`A cold front hits at ${hourLabel(O.front)}, and the song turns darker with a gust of wind as the temperature crashes.`);
  if (layers.rain.length && H.some((h) => M.HAIL.codes.includes(h.code))) outliers.push("Hail clatters down hard in the storm.");
  const hollow = meta.colours.filter((c) => c.susBy === "cold").length;
  const frigid = hollow < 3 ? ""
    : white.length >= 2 ? "The deep cold hollows the chords out to bare, open intervals."
      : "The deep cold hollows the chords out to bare, open intervals and thins the band, so the melody rings out alone in the frozen air.";

  // Twists and the pedal (see TWISTS, PEDAL).
  const WHO = { cloud: "a passing cloud", shower: "a light shower", sun: "the sun breaking through", gust: "a sudden gust", pressure: "rising pressure" };
  const DOES = {
    borrow: (n) => `${n > 1 ? "borrow chords" : "borrows a chord"} from the minor key`,
    mediant: (_, why) => (why === "sun" ? "lifts the harmony to a bright, distant chord" : "knocks the harmony to a distant chord"),
    dominant: () => "pulls the chords forward",
  };
  const tw = [];
  for (const kind of ["borrow", "mediant", "dominant"]) {
    const ts = (meta.twists ?? []).filter((t) => t.kind === kind);
    if (ts.length) tw.push(`${listOf(ts.map((t) => `${WHO[t.why]} around ${hourLabel(t.bar + 1)}`))} ${DOES[kind](ts.length, ts[0].why)}`);
  }
  const twistNote = tw.length ? `${tw[0][0].toUpperCase()}${listOf(tw).slice(1)}.` : "";
  const pedals = (meta.pedal ?? []).filter((x, b) => x && b % M.BARS_PER_CHORD === 0).length;
  const fogPedal = (meta.pedal ?? []).some((x, b) => x && M.PEDAL.fogCodes.includes(H[b].code));
  const pedalNote = pedals >= 2 ? `In the ${fogPedal ? "fog" : "still air"} the bass holds the home note while the chords drift above it.` : "";
  // Glides and flutter (see GLIDE, FLUTTER).
  const glides = layers.melody.filter((n) => n.glide);
  const glideNote = glides.length >= 2
    ? `As the temperature ${H[glides[0].bar].temp > H[glides[0].bar - 1].temp ? "climbs" : "drops"} fast around ${hourLabel(glides[0].bar)}, the melody slides between its notes.` : "";
  const fl = layers.automation.flutter.map((x, b) => (x >= 0.5 ? b : -1)).filter((b) => b >= 0);
  const flutterNote = fl.length >= 2 ? `Gusts${fl.length < 12 ? ` around ${hourLabel(fl[Math.floor(fl.length / 2)])}` : ""} make the chords flutter like wind against a window.` : "";
  // The ending (see EVENING).
  const EVE = { rain: "Rain moves in", pop: "The chance of rain climbs", cloud: "Clouds gather", gust: "The wind picks up", pressure: "The pressure falls" };
  const en = meta.ending;
  const endNote = en?.kind === "open" ? `${EVE[en.why]} toward evening, so the song ends on an open chord, like a question, instead of coming home.`
    : en?.kind === "hint" ? `${EVE[en.why]} toward evening, so the last note stops just short of home.` : "";
  return { paragraphs: [join([sets, drives, shape, skyNote(f, meta.sky, layers, units), arp, twistNote, pedalNote, glideNote, flutterNote, frigid, ...outliers, daylight, endNote])] };
}

const moonNoun = (phase) => (/moon$/.test(phase) ? phase : `${phase} moon`);

/** The single most notable thing in the sky or the air today, as one sentence (or ""). Rarest first. */
function skyNote(f, K, layers, units) {
  const has = (k) => layers.chimes.some((c) => c.kind === k);
  const lights = f.lat >= 0 ? "northern lights" : "southern lights";
  const kp = Math.round(K.kpMax * 10) / 10;
  if (K.eclipse) return `A ${K.eclipse.type} lunar eclipse at ${hourLabel(K.eclipse.hour)} takes the moonlight out of the song.`;
  if (K.aurora.some((a) => a >= M.AURORA.min)) return `The ${lights} are within reach (Kp ${kp}), so a slow, shimmering chord drifts overhead.`;
  if (K.shower && has("meteor")) return `Shooting stars from the ${K.shower.name} streak down through the bells.`;
  if (K.season) return `The ${K.season.name} (${K.season.meaning}) is rung in with a bell.`;
  if (K.holiday) return `It's ${K.holiday.name}, a public holiday, so the song signs off with a run of bells.`;
  if (K.firstFrost) return "It's the first frost of the season, and the still hours glint with icy bells.";
  if (K.auroraReach.some((r, b) => r >= M.AURORA.min && K.dark[b] >= 0.9)) return `The ${lights} are within reach tonight (Kp ${kp}), but cloud hides them.`;
  if (K.shower) return `It's the ${K.shower.name}, but they're hidden tonight.`;
  if (K.moonUpAtNight && Math.max(...K.moonlight) >= 0.15 && K.moon.illum >= 0.9) return `A ${moonNoun(K.moon.phase)} keeps the night from going dark.`;
  return "";
}

/** The notes as plain lines, for tests and the text summary. */
export function notesAsText(liner) {
  return [...liner.paragraphs];
}
