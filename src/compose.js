// compose(forecast) → score. Pure: no Tone.js, no DOM, no clock.
// Same forecast in, same score out (randomness comes from a seeded RNG).
// Each layer is built in src/score/. Keep them in this order: the melody, the rain beat,
// the crackle and the rain shakers draw from one shared random stream, in turn.

import { scoreContext } from "./score/context.js";
import { melodyLine } from "./score/melody.js";
import { bassLine, stormDrums, rainBeat, dryBeat, vinylCrackle } from "./score/rhythm.js";
import { padChords, arpeggio } from "./score/pad.js";
import { rainAndBells, atmosphereBed, oneOffFx, eyeOfStorm } from "./score/texture.js";
import { skyChimes, skyShimmer } from "./score/skylayers.js";
import { barAutomation, scoreMeta } from "./score/automation.js";

export function compose(f, { units = "metric" } = {}) {
  const ctx = scoreContext(f);
  const { melody, held } = melodyLine(ctx);
  const bass = bassLine(ctx);
  const drums = stormDrums(ctx);
  const garage = rainBeat(ctx);
  const beat = dryBeat(ctx, garage);
  const crackle = vinylCrackle(ctx);
  const pad = padChords(ctx);
  const arp = arpeggio(ctx);
  const { rain, bells } = rainAndBells(ctx);
  const atmosphere = atmosphereBed(ctx);
  const fx = oneOffFx(ctx);
  const chimes = skyChimes(ctx);
  const shimmer = skyShimmer(ctx, melody);
  eyeOfStorm(ctx, { drums, garage, beat, rain, fx, atmosphere });
  const automation = barAutomation(ctx);
  const meta = scoreMeta(ctx, { melody, arp, rain, bells, drums, garage, beat, crackle, atmosphere, fx, automation, chimes, shimmer }, held, units);
  return { meta, melody, bass, pad, arp, drums, garage, beat, crackle, rain, bells, atmosphere, fx, automation, chimes, shimmer };
}
