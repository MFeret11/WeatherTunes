// Liner notes: plain-English reasons for today's song.

import * as M from "../mapping.js";
import { clamp, hourLabel, formatTemp } from "../util.js";

// Instrument names as sentence subjects, with the right verb.
const MELODY_PHRASE = { glass: "glass bells play", flute: "a breathy flute plays", keys: "soft keys play", pluck: "plucked strings play",
  mallet: "a marimba plays", reed: "a reedy pipe plays" };
const PAD_PHRASE = { storm: "dark, detuned saws hold", snow: "a hushed choir holds", ghost: "ghostly, wordless voices hold",
  rain: "a wobbling electric piano holds", overcast: "a muffled organ holds", icy: "a thin, icy shimmer holds",
  lush: "lush strings hold", airy: "an airy, open pad holds" };

// Seeded choice between phrasings, so two similar days don't read the same.
function chooser(seed) {
  return (options, salt) => options[(Math.imul((seed >>> 0) ^ salt, 2654435761) >>> 0) % options.length];
}

const cap1 = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const QUARTERS = [["night", 0, 6], ["morning", 6, 12], ["afternoon", 12, 18], ["evening", 18, 24]];

/**
 * Liner notes, written like the back of a record sleeve:
 *   lead        one line that sums up the day
 *   paragraphs  [story]: the day in time order, through what the music does with it.
 *               Always starts with "The song", so the drop cap never lands on "A".
 *   listen      [{ bar, text }]: two to four moments to listen for (the page adds times)
 * Every sentence comes from something the score really does.
 */
export function linerNotes(f, A, meta, layers, units) {
  const s = A.stats;
  const H = f.hours;
  const v = A.voices;
  const pick = chooser(meta.seed ?? 1);
  const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
  const snowy = (h) => M.CODES.snow.includes(h.code);
  const thundery = (h) => M.CODES.thunder.includes(h.code);
  const wet = (h) => h.precip >= 0.2 || h.pop >= 60 || thundery(h);
  const melodyNoun = MELODY_PHRASE[v.melody.id]?.replace(/ plays?$/, "") ?? v.melody.label;
  const padNoun = PAD_PHRASE[v.pad.id]?.replace(/ holds?$/, "") ?? v.pad.label;
  const padPlural = /^(dark, detuned saws|lush strings|ghostly, wordless voices)$/.test(padNoun);
  const melPlural = /(strings|keys|bells)$/.test(melodyNoun);

  // ---- The lead: the day in a line ----
  const feel = s.tMean < -10 ? "bitterly cold" : s.tMean < 0 ? "freezing" : s.tMean < 8 ? "cold" : s.tMean < 15 ? "cool"
    : s.tMean < 22 ? "mild" : s.tMean < 28 ? "warm" : s.tMean < 34 ? "hot" : "scorching";
  const muggy = s.dewMean >= 20 && s.tMean >= 22;
  const feelWords = muggy ? `${feel} and muggy` : feel;
  const parts = QUARTERS.map(([name, a, b]) => {
    const hs = H.slice(a, b);
    return { name, wet: hs.filter(wet).length >= 3, storm: hs.some(thundery), snow: hs.filter(snowy).length >= 2,
      rain: hs.reduce((x, h) => x + h.precip, 0), cloud: hs.reduce((x, h) => x + h.cloud, 0) / hs.length / 100 };
  });
  const wetParts = parts.filter((q) => q.wet);
  const wetWord = A.storm && parts.some((q) => q.storm) ? "storms"
    : parts.some((q) => q.snow) ? "snow"
      : s.wetHours && s.precipSum / Math.max(1, s.wetHours) >= 2 ? "heavy rain"
        : s.wetHours && s.precipSum / Math.max(1, s.wetHours) < 0.4 ? "drizzle" : "rain";
  let lead;
  if (wetParts.length === 4) {
    lead = pick([`${cap1(wetWord)} from start to finish, ${feelWords} all day.`, `${cap1(wetWord)} that never lets up, ${feelWords} all the while.`], 1);
  } else if (wetParts.length) {
    const idx = wetParts.map((q) => parts.indexOf(q));
    const run = idx.every((x, i) => i === 0 || x === idx[i - 1] + 1);
    const when = run && idx.length === 3 && idx[2] === 3 ? `the ${parts[idx[0]].name} on`.replace(/^the (.*) on$/, "the $1 on")
      : listOf(wetParts.map((q) => `the ${q.name}`));
    const dry = parts.filter((q) => !q.wet);
    const rest = dry.reduce((x, q) => x + q.cloud, 0) / dry.length;
    const sky = rest < 0.3 ? "bright" : rest < 0.7 ? "changeable" : "grey";
    lead = pick([`${cap1(feelWords)} and ${sky}, with ${wetWord} ${/ on$/.test(when) ? `from ${when}` : `in ${when}`}.`, `A ${feel}, ${sky} day, with ${wetWord} ${/ on$/.test(when) ? `from ${when}` : `in ${when}`}.`], 2);
  } else {
    const first = (parts[1].cloud + parts[0].cloud) / 2, last = (parts[2].cloud + parts[3].cloud) / 2;
    const polar = f.sunrise == null || !(f.sunset > f.sunrise);
    lead = s.cloud < 0.2 ? (polar ? `${cap1(feelWords)} and clear all day.` : pick([`${cap1(feelWords)} and clear from dawn to dusk.`, `Clear skies all day, ${feelWords} and dry.`], 3))
      : first - last >= 0.4 ? `${cap1(feelWords)}: a grey start gives way to sun.`
        : last - first >= 0.4 ? `${cap1(feelWords)}: a bright start, then the clouds roll in.`
          : s.cloud < 0.6 ? pick([`${cap1(feelWords)} and dry, with clouds coming and going.`, `A ${feel} day of sun and passing cloud.`], 4)
            : pick([`${cap1(feelWords)} and dry under a lid of grey cloud.`, `A ${feel}, grey day that never quite brightens.`], 5);
  }
  if (A.dayHeat >= 0.5) lead = `Dangerous heat. ${lead}`;
  else if (Math.max(...(meta.deepCold ?? [0])) >= 0.5 && feel !== "bitterly cold") lead = `Deep, biting cold. ${lead}`;

  // ---- The story: events in time order ----
  const events = []; // { bar, text, listen?, weight }
  const add = (bar, text, listen, weight = 1) => (text || listen) && events.push({ bar, text, listen, weight });
  const h0 = H[0];
  const where = h0.isDay ? "in daylight" : "in the dark";
  const opening = thundery(h0) ? `The song opens ${where} with thunder already rolling.`
    : wet(h0) && h0.precip > 0 ? `The song opens ${where} with ${snowy(h0) ? "snow" : "rain"} already falling.`
      : !h0.isDay && h0.cloud < 30 ? pick(["The song opens under a clear night sky.", "The song begins under clear, dark skies.",
        "The song starts in the small hours, the sky clear and still.", "The song begins at midnight under open sky."], 6)
        : !h0.isDay ? pick(["The song opens in the dark under thick cloud.", "The song begins on a cloudy night.",
          "The song starts in the small hours, under a low ceiling of cloud."], 7)
          : "The song opens in daylight.";
  const voices = pick([
    `${cap1(melodyNoun)} ${melPlural ? "carry" : "carries"} the tune over ${padNoun}.`,
    `${cap1(melodyNoun)} ${melPlural ? "pick" : "picks"} out the tune while ${padNoun} ${padPlural ? "hold" : "holds"} the chords underneath.`,
    `${cap1(padNoun)} ${padPlural ? "set" : "sets"} the mood, with ${melodyNoun} on top.`,
    `${cap1(melodyNoun)} ${melPlural ? "lead" : "leads"}, with ${padNoun} underneath.`,
    `${cap1(padNoun)} ${padPlural ? "fill" : "fills"} the background while ${melodyNoun} ${melPlural ? "carry" : "carries"} the tune.`,
  ], 8);
  add(-1, `${opening} ${voices}`, null, 99);

  // Daylight: the melody wakes at sunrise and settles at sunset (polar days say why not).
  const daylight = f.sunrise != null && f.sunset > f.sunrise;
  if (!daylight) add(0, H.every((h) => !h.isDay) ? "With no sunrise in the polar night, the melody stays dim all day." : "Under the midnight sun, the melody never dims.", null, 0.5);

  // The temperature is the tune: the high note is the day's high.
  const swing = s.tMax - s.tMin;
  const edge = s.tMaxHour < 3 || s.tMaxHour > 21;
  if (swing >= 4 && edge) add(s.tMaxHour, `It's warmest around ${hourLabel(s.tMaxHour)} (${formatTemp(s.tMax, units)}), where the tune sits highest.`, `${hourLabel(s.tMaxHour)}, the tune's highest notes`, 1);
  else if (swing >= 4) add(s.tMaxHour, pick([
    `It warms to ${formatTemp(s.tMax, units)} by ${hourLabel(s.tMaxHour)}, and the tune climbs with it to its highest notes.`,
    `The tune rises with the temperature, reaching its top note at the day's high of ${formatTemp(s.tMax, units)} around ${hourLabel(s.tMaxHour)}.`,
  ], 9), `${hourLabel(s.tMaxHour)}, the day's high and the tune's top note`, swing >= 8 ? 2 : 1);
  else if (!meta.arc.dramatic) add(12, "The temperature hardly moves, so neither does the tune: it circles the same few notes.", null, 0.6);

  // The day's shape: a calm day breathes; a dramatic one builds, peaks and lets go.
  if (!meta.arc.dramatic) {
    add(13.5, pick(["Nothing much happens, and the song lets it be: it stays even and only breathes with the weather.",
      "It's a calm day, so the music stays even and only breathes with the weather."], 10), null, 1.5);
  } else {
    const at = A.intensity.indexOf(Math.max(...A.intensity));
    const h = H[at];
    const what = thundery(h) ? "the thunder" : h.precip >= 0.5 ? (snowy(h) ? "the snow" : "the downpour") : "the wind";
    const why = [];
    if (thundery(h)) why.push("thunder");
    else if (h.precip >= 0.5) why.push(`heavy ${snowy(h) ? "snow" : "rain"}`);
    if (h.gust >= M.DYNAMICS.gustFrom) why.push("strong gusts");
    const build = meta.arc.moments.find((m) => m.phase === "build");
    const peaks = meta.arc.moments.filter((m) => m.phase === "peak").map((m) => m.bar);
    if (build && build.bar < (peaks[0] ?? at) - 1) add(build.bar, `${pick(["From", "Around"], 11)} ${hourLabel(build.bar)} it starts to build.`, null, 1);
    const how = what === "the wind" ? [] : why;
    const peakText = peaks.length > 1
      ? `The weather peaks twice, at ${listOf(peaks.map(hourLabel))}${why.length ? ` with ${listOf(why)}` : ""}, and each time the music swells with it before easing off.`
      : `By ${hourLabel(peaks[0] ?? at)} ${what} is at its strongest${how.length ? ` (${listOf(how)})` : ""}, and the music swells with it, then eases off.`;
    add(peaks[0] ?? at, peakText, `${hourLabel(peaks[0] ?? at)}, ${what} at its strongest`, 3);
    if (peaks.length > 1) add(peaks[1], "", `${hourLabel(peaks[1])}, the second peak`, 2);
  }

  // Mode turns: the sky changes the key's colour.
  const harsh = A.dayHeat >= 0.5 ? "heat" : Math.max(...(meta.deepCold ?? [0])) >= 0.5 ? "cold" : null;
  (meta.chapters ?? []).slice(1).filter((c) => !c.front).slice(0, 2).forEach((c, i) => {
    const t = hourLabel(c.bar);
    const text = c.turn === "darker" && harsh ? `Around ${t} the ${harsh} starts to tell, and the song darkens.`
      : c.turn === "brighter" ? pick([`Around ${t} the sky lifts, and so does the song.`, `The sky opens up around ${t}, and the song brightens with it.`], 20 + i)
        : pick([`Around ${t} the sky closes in, and the song darkens with it.`, `Cloud thickens around ${t}, and the song turns darker.`], 30 + i);
    add(c.bar, text, `${t}, the song turns ${c.turn}`, 1.4);
  });

  // Twists (see TWISTS) and the pedal (see PEDAL).
  const WHO = { cloud: "a passing cloud", shower: "a light shower", sun: "the sun breaking through", gust: "a sudden gust", pressure: "rising pressure" };
  const DOES = {
    borrow: "borrows a chord from the minor key",
    mediant: (why) => (why === "sun" ? "lifts the harmony to a bright, distant chord" : "knocks the harmony to a distant chord"),
    dominant: "tips the chords forward",
  };
  const AGAIN = { borrow: "brings another minor-key shadow", mediant: "jumps the harmony again", dominant: "tips the chords forward again" };
  const SHORT = { borrow: "a shadow over the chords", mediant: "the harmony jumps", dominant: "the chords lean forward" };
  const seen = new Set();
  for (const t of meta.twists ?? []) {
    const did = seen.has(t.kind) ? AGAIN[t.kind] : typeof DOES[t.kind] === "function" ? DOES[t.kind](t.why) : DOES[t.kind];
    add(t.bar + 1, `${cap1(WHO[t.why])} around ${hourLabel(t.bar + 1)} ${did}.`, `${hourLabel(t.bar + 1)}, ${SHORT[t.kind]}`, seen.has(t.kind) ? 1.2 : 1.8);
    seen.add(t.kind);
  }
  const pedalBars = (meta.pedal ?? []).map((x, b) => (x && b % M.BARS_PER_CHORD === 0 ? b : -1)).filter((b) => b >= 0);
  if (pedalBars.length >= 2) {
    const fog = pedalBars.some((b) => M.CODES.fog.includes(H[b].code));
    add(pedalBars[0], `In the ${fog ? "fog" : "still air"} the bass holds the home note while the chords drift above it.`, null, 1.2);
  }

  // Glides, flutter, arpeggio and echo.
  const glides = layers.melody.filter((n) => n.glide);
  if (glides.length >= 2) {
    const g = glides[0].bar;
    add(g, `As the temperature ${H[g].temp > H[Math.max(0, g - 1)].temp ? "climbs" : "drops"} fast around ${hourLabel(g)}, the melody slides between its notes.`, `${hourLabel(g)}, the melody slides`, 1.5);
  }
  const fl = layers.automation.flutter.map((x, b) => (x >= 0.5 ? b : -1)).filter((b) => b >= 0);
  if (fl.length >= 2) {
    const mid = fl[Math.floor(fl.length / 2)];
    add(mid, `Gusts${fl.length < 12 ? ` around ${hourLabel(mid)}` : ""} make the chords flutter like wind against a window.`, fl.length < 12 ? `${hourLabel(mid)}, the chords flutter in the gusts` : null, 1.3);
  }
  const arpBars = [...new Set(layers.arp.map((n) => n.bar))].sort((a, b) => a - b);
  const echoes = layers.automation.echoCarry.filter((c) => c >= 0.5).length >= 3;
  const wetDay = wetParts.length >= 2;
  if (arpBars.length >= 3) add(arpBars[0], `${wetDay ? `When the sky clears around ${hourLabel(arpBars[0])}, a` : "In the clear daylight a"} soft arpeggio starts running over the chords${echoes ? ", and the melody echoes in the still air" : ""}.`, `${hourLabel(arpBars[0])}, the arpeggio starts`, 1.2);
  else if (echoes) add(12, "The melody echoes in the clear, still air.", null, 0.8);

  // Outliers.
  const O = meta.outliers;
  const hours = (xs) => xs.map((x, b) => (x ? b : -1)).filter((b) => b >= 0);
  const hot = hours(O.heat.map((x) => x >= 0.5));
  if (hot.length) add(hot[Math.floor(hot.length / 2)], `The heat turns dangerous${hot.length < 20 ? ` around ${hourLabel(hot[Math.floor(hot.length / 2)])}` : ""}, and the melody wilts: it wavers like air over hot ground, thins out and dulls.`, hot.length < 20 ? `${hourLabel(hot[Math.floor(hot.length / 2)])}, the melody wilts in the heat` : null, 2.5);
  const ice = hours(O.ice);
  if (ice.length) add(ice[0], "Freezing rain glazes everything, and the shakers turn into brittle, glassy ticks.", `${hourLabel(ice[0])}, glassy ticks of freezing rain`, 2.5);
  const eyeAt = hours(O.eye);
  if (eyeAt.length) add(eyeAt[0], `At ${hourLabel(eyeAt[0])} the eye of the storm passes over: the wind drops away and the music almost stops, before the storm slams back.`, `${hourLabel(eyeAt[0])}, the eye of the storm`, 4);
  const white = hours(O.whiteout.map((x) => x >= 0.5));
  if (white.length >= 2) add(white[0], "Snow in a gale makes a whiteout, and the melody is buried in the wind.", `${hourLabel(white[0])}, the whiteout`, 2.5);
  if (O.front != null) add(O.front, `At ${hourLabel(O.front)} a cold front hits: the temperature crashes, a gust tears through and the song turns darker.`, `${hourLabel(O.front)}, the cold front`, 3.5);
  if (layers.rain.length && H.some((h) => M.CODES.hail.includes(h.code))) {
    const hb = H.findIndex((h) => M.CODES.hail.includes(h.code));
    add(hb, "Hail clatters down hard in the storm.", `${hourLabel(hb)}, hail`, 2);
  }
  const hollow = meta.colours.filter((c) => c.susBy === "cold").length;
  if (hollow >= 3) add(6, white.length >= 2 ? "The deep cold hollows the chords out to bare, open intervals."
    : "The deep cold hollows the chords out to bare, open intervals and thins the band, so the melody rings out alone in the frozen air.", null, 2);

  // The sky's one notable thing, placed when it happens (an eclipse at its hour, the rest at night).
  const sky = skyNote(f, meta.sky, layers, units);
  if (sky) {
    const ecl = meta.sky.eclipse ? Math.round(meta.sky.eclipse.hour) : null;
    const auroraAt = meta.sky.aurora?.findIndex((a) => a >= M.AURORA.min);
    const bar = ecl ?? (auroraAt >= 0 ? auroraAt : 21);
    const tag = ecl != null ? `${hourLabel(ecl)}, the eclipse` : auroraAt >= 0 ? `${hourLabel(auroraAt)}, the ${f.lat >= 0 ? "northern" : "southern"} lights` : null;
    add(bar, sky, tag, 2.2);
  }

  // Sunrise only fills in a quiet story.
  if (daylight && events.length <= 4) add(Math.round(f.sunrise), pick([`The melody wakes with the sunrise around ${hourLabel(Math.round(f.sunrise))}.`, "The melody fades in around sunrise and out around sunset."], 12), `${hourLabel(Math.round(f.sunrise))}, sunrise: the melody comes up`, 0.7);

  // The ending (see EVENING), or the night closing as it began.
  const EVE = { rain: "Rain moves in", pop: "The chance of rain climbs", cloud: "Clouds gather", gust: "The wind picks up", pressure: "The pressure falls" };
  const en = meta.ending;
  if (en?.kind === "open") add(23, `${EVE[en.why]} toward evening, so the song ends on an open chord, like a question, instead of coming home.`, "the last chord, left open", 2);
  else if (en?.kind === "hint") add(23, `${EVE[en.why]} toward evening, so the last note stops just short of home.`, "the last note, just short of home", 1.5);
  else if (wet(H[23]) === wet(h0) && events.length <= 5) add(23, wet(h0) ? `The night closes the way it began, with ${snowy(H[23]) ? "snow" : "rain"} still coming down.` : "The night closes the way it began, quiet and still.", null, 0.5);

  // The wind sets the pace; heat or cold can drag it back.
  const harm = A.dayHeat >= A.harsh ? "heat" : "cold";
  const T = M.TEMPO, windBpm = Math.round(clamp(T.base + T.perRootKmh * Math.sqrt(s.wind), T.min, T.max));
  const pace = windBpm - A.bpm >= 5 ? `The wind would push it along, but the ${harm} drags the tempo back.`
    : s.wind < 8 ? pick(["With barely a breeze, it never hurries.", "There's hardly any wind, so it takes its time."], 13)
      : s.wind < 20 ? pick(["A steady breeze keeps it moving.", "A light, steady wind sets an easy pace."], 14)
        : s.wind < 35 ? pick(["The wind keeps it brisk.", "A strong wind pushes the tempo up."], 15)
          : "The gale drives it hard.";

  // A day with dangerous weather isn't "calm", whatever its shape.
  if (events.some((e) => e.weight >= 2.5 && e.weight < 99)) { const k = events.findIndex((e) => e.bar === 13.5); if (k >= 0) events.splice(k, 1); }
  // Keep the story short: the opening, then up to five events by weight, told in time order.
  const [open, ...rest] = events;
  const kept = rest.slice().sort((a, b) => b.weight - a.weight).slice(0, 5).sort((a, b) => a.bar - b.bar || b.weight - a.weight);
  const story = [open, ...kept].map((e) => e.text).filter(Boolean).join(" ") + " " + pace;

  const told = new Set([open, ...kept]);
  const listen = events.filter((e) => e.listen && (told.has(e) || !e.text)).sort((a, b) => b.weight - a.weight)
    .filter((e, i, xs) => xs.findIndex((x) => Math.abs(x.bar - e.bar) < 2) === i).slice(0, 4)
    .sort((a, b) => a.bar - b.bar).map((e) => ({ bar: Math.max(0, Math.min(H.length - 1, e.bar)), text: e.listen }));
  return { lead, paragraphs: [story], listen };
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

/** The notes as plain lines, for tests and the text summary: the story first, then the lead and what to listen for. */
export function notesAsText(liner) {
  return [...liner.paragraphs, liner.lead, ...liner.listen.map((x) => `${hourLabel(x.bar)}: ${x.text}`)];
}
