// The record's pressing and the cover's extras (flag sticker, aurora).
import { test, assert, equal } from "./harness.js";
import { normalizeForecast } from "../src/weather.js";
import { compose } from "../src/compose.js";
import { pressing, pressingKind, keyColour } from "../src/vinyl.js";
import { coverArt, coverStyle, landform } from "../src/cover.js";

const load = async (n) => normalizeForecast(await (await fetch(`../samples/${n}.json`)).json());
const day = {};
for (const n of ["kyoto-spring", "phoenix-heat", "houston-storms", "mcmurdo-cold", "london-drizzle", "honolulu-flat"]) {
  const f = await load(n);
  day[n] = { f, meta: compose(f, { stretch: false }).meta };
}
const kind = (n) => pressingKind(day[n].f, day[n].meta);

test("most days press on black vinyl", () => {
  for (const n of ["kyoto-spring", "london-drizzle", "honolulu-flat"]) equal(kind(n), "black", n);
});

test("notable days get a special pressing", () => {
  equal(kind("phoenix-heat"), "heat");
  equal(kind("houston-storms"), "storm");
  equal(kind("mcmurdo-cold"), "aurora", "the lights outrank the cold");
});

test("a holiday presses in the song's key colour; same day, same record", () => {
  const { f, meta } = day["kyoto-spring"];
  const m = { ...meta, sky: { ...meta.sky, holiday: { name: "Test Day" } } };
  const p = pressing(f, m);
  equal(p.kind, "holiday");
  equal(p.base, keyColour(meta.root, meta.mode));
  equal(JSON.stringify(pressing(f, m)), JSON.stringify(p), "deterministic");
  assert(keyColour(0, "ionian") !== keyColour(7, "ionian"), "keys differ");
  assert(keyColour(0, "ionian") !== keyColour(0, "aeolian"), "modes differ");
});

test("cover: flag sticker only with a country code, aurora only when the lights show", () => {
  const { f, meta } = day["mcmurdo-cold"];
  const svg = coverArt(f, meta);
  assert(/flags\/aq\.svg/.test(svg), "Antarctica flag");
  assert(svg.includes("cv-aur"), "aurora curtains");
  assert(!coverArt({ ...f, country: null }, meta).includes("flags/"), "no country, no flag");
  assert(!coverArt({ ...f, country: "../x" }, meta).includes("flags/"), "codes are checked");
  assert(!coverArt(day["kyoto-spring"].f, day["kyoto-spring"].meta).includes("cv-aur"), "no aurora in Kyoto");
});

test("cover design follows the weather", () => {
  const design = (n) => coverStyle(day[n].f, day[n].meta);
  equal(design("houston-storms"), "storm", "a stormy day");
  equal(design("mcmurdo-cold"), "clock", "polar night under the aurora");
  equal(design("phoenix-heat"), "stripes", "a big swing between night and afternoon");
  for (const n of Object.keys(day)) {
    const svg = coverArt(day[n].f, day[n].meta);
    assert(svg.includes(`data-design="${design(n)}"`), `${n} draws its design`);
    assert(!/NaN|undefined/.test(svg), `${n} has no broken numbers`);
    equal(svg, coverArt(day[n].f, day[n].meta), `${n} is the same every time`);
  }
});

test("horizon land from elevation: mountains, a shoreline at sea level, plains between", () => {
  equal(landform(2230), "mountains", "Mexico City");
  equal(landform(0), "shore", "a point that rounds onto open water");
  equal(landform(6), "shore", "Miami");
  equal(landform(-82), "plains", "Death Valley is land below sea level, not water");
  equal(landform(174), "plains", "Chicago");
  equal(landform(null), "plains", "unknown");
  // Find a name that gets the horizon design on a calm sample day, then draw it three ways.
  const { f, meta } = day["honolulu-flat"];
  let m = meta;
  for (let k = 0; coverStyle(f, m) !== "horizon" && k < 200; k++) m = { ...meta, name: `Town ${k}` };
  equal(coverStyle(f, m), "horizon");
  for (const elevation of [0, 6, 120, 2000]) {
    const svg = coverArt({ ...f, elevation }, m);
    assert(!/NaN|undefined/.test(svg), `${elevation} m has no broken numbers`);
    equal(svg.includes("cv-water"), landform(elevation) === "shore", `${elevation} m: water only on the shore`);
  }
});
