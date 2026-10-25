import { test, assert, equal } from "./harness.js";
import { retroVoice, cueTimes, songSeconds } from "../src/engine.js";
import { MELODY_VOICES, PAD_VOICES, RETRO32 } from "../src/mapping.js";

test("32-bit mode: every voice becomes plain waves with its own envelope", () => {
  for (const v of [...MELODY_VOICES, ...PAD_VOICES]) {
    const r = retroVoice(v);
    assert((r.synth || "Synth") !== "FMSynth", `${v.id} is not FM`);
    const type = r.options.oscillator?.type;
    assert(!type || !type.startsWith("fat"), `${v.id} is not fat`);
    assert(r.options.oscillator?.count === undefined, `${v.id} has one oscillator`);
    equal(JSON.stringify(r.options.envelope), JSON.stringify(v.options.envelope), `${v.id} keeps its envelope`);
    assert(Number.isFinite(r.gain), `${v.id} gain`);
    equal(r.id, v.id);
  }
  const glass = retroVoice(MELODY_VOICES.find((v) => v.id === "glass"));
  equal(glass.options.oscillator.type, RETRO32.fm);
  const storm = retroVoice(PAD_VOICES.find((v) => v.id === "storm"));
  equal(storm.options.oscillator.type, "sawtooth");
  const keys = MELODY_VOICES.find((v) => v.id === "keys");
  equal(retroVoice(keys), keys, "plain voices are left alone");
});

test("cue times follow the score: one per hour, flashes in order, ending with the song", () => {
  const steps = 8, bpm = 120;
  const score = {
    meta: { bars: 24, steps, bpm },
    atmosphere: Array.from({ length: 24 }, () => ({})),
    fx: [{ type: "swell", bar: 12, pos: 0 }, { type: "thunder", bar: 3, pos: 4 }],
  };
  const c = cueTimes(score);
  const hour = (steps * 15) / bpm;
  equal(c.bars.length, 24);
  equal(c.bars[1], hour, "an hour is `steps` sixteenths");
  equal(c.fx.map((f) => f.type), ["thunder", "swell"], "flashes in time order");
  equal(c.fx[0].t, ((3 * steps + 4) * 15) / bpm);
  assert(c.barsEnd >= c.bars[23] + hour - 1e-9, "the highlight lasts through the last hour");
  assert(Math.abs(songSeconds(score) - c.end - 0.3) < 1e-9, "the song ends just after the last cue");
});
