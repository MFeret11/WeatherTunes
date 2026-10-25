import { test, assert, equal } from "./harness.js";
import { retroVoice } from "../src/engine.js";
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
