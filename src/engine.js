// Builds a score's instruments with Tone.js (loaded globally from vendor/tone-15.1.22.js).
// It always runs inside Tone.Offline: src/stream.js renders the song ahead of
// playback and plays the result, and Download saves it.
//
// Signal flow (melody and pad instruments are chosen per song from score.meta.voices):
//   melody → trim → vibrato → lowpass → panner → comp → echo ─┐
//   bass, drums, kit (rain + dry beat)──────────────────────┼→ band ─┐   (band swells with the weather, then a distortion whose mix follows it)
//   pad → trim → tremolo → lowpass → comp ─────────────┘        │   (arp → lowpass joins the pad's fader)
//   shaker → highpass ──────────────────────────────────────────┼→ bus → EQ3 → filter → delay → reverb → master → fade → limiter → out
//   bells ──────────────────────────────────────────────────────┘
//   white/pink/brown noise → gains → lowpass (atmosphere); vinyl crackle → bandpass
//   pink noise → auto-filter → gain (wind)
//   thunder, swell (one-shots)
//   sky bells (moonrise, meteors, frost, holiday, solstice), UV sparkle, aurora chord → fx

import { SOFT_CLIP, STORM_DRUMS_DB, MIX, ECHO, ARP, ARP_VOICE, SWELL, RETRO32 } from "./mapping.js";

const Tone = () => window.Tone;

/**
 * Soft-clip transfer curve for a WaveShaper fed through a 1/headroom gain:
 * x in [-1, 1] stands for an input of x × headroom. Straight up to the knee,
 * then a tanh shoulder that approaches the ceiling and never passes it.
 */
export function softClipCurve({ knee, ceiling, headroom }) {
  return (x) => {
    const u = Math.abs(x * headroom);
    const y = u <= knee ? u : knee + (ceiling - knee) * Math.tanh((u - knee) / (ceiling - knee));
    return Math.sign(x) * y;
  };
}

export const LAYERS = ["melody", "bass", "pad", "drums", "rain", "atmosphere", "fx"];
const BAND = ["melody", "bass", "pad", "drums"];
// The song plays once, fading in and out so it never starts or stops abruptly:
//   inSec     fade-in from silence at the start
//   outHours  the fade-out starts this many hour slots before the end...
//   outGap    ...and reaches silence this far (in sixteenths) past the last bar,
//             so the last note and the reverb tail die away instead of being cut;
//             the song then stops by itself
//   stopSec   pressing Stop fades out over this long first
export const FADE = { inSec: 1.2, outHours: 1, outGap: 10, stopSec: 0.3 };
export const DEFAULT_LEVELS = MIX; // see mapping.js

/** How long a score plays, in seconds, from the start to the end of its fade-out. */
export function songSeconds(score) {
  const steps = score.meta.steps ?? 16;
  return ((score.meta.bars * steps + FADE.outGap + 2) * 15) / score.meta.bpm + 0.3;
}

/**
 * When the screen should follow the song, in seconds from its start:
 *   bars     the start of each hour slot
 *   barsEnd  the hour highlight clears (the last bar is over)
 *   fx       flashes for thunder and swells, in time order
 *   end      the fade-out is done and the song is over
 */
export function cueTimes(score) {
  const steps = score.meta.steps ?? 16;
  const s16 = (n) => (n * 15) / score.meta.bpm;
  return {
    bars: score.atmosphere.map((_, bar) => s16(bar * steps)),
    barsEnd: s16(Math.ceil((score.meta.bars * steps) / 16) * 16),
    fx: score.fx.map((f) => ({ t: s16(f.bar * steps + f.pos), type: f.type })).sort((a, b) => a.t - b.t),
    end: s16(score.meta.bars * steps + FADE.outGap + 2),
  };
}

/** A voice as 32-bit mode plays it (see RETRO32): FM → one plain wave, "fat" → plain. */
export function retroVoice(v) {
  if (v.synth === "FMSynth") {
    return { ...v, synth: "Synth", gain: v.gain + (RETRO32.trim[v.id] ?? 0), options: { oscillator: { type: RETRO32.fm }, envelope: v.options.envelope } };
  }
  const o = v.options?.oscillator;
  if (o?.type?.startsWith("fat")) {
    const { count, spread, ...rest } = o;
    return { ...v, gain: v.gain + (RETRO32.trim[v.id] ?? 0), options: { ...v.options, oscillator: { ...rest, type: o.type.slice(3) } } };
  }
  return v;
}

export class Engine {
  /**
   * `retro`: build the lighter 32-bit instruments (see RETRO32).
   * `output`: where the finished mix goes (default: the context's speakers).
   */
  constructor({ retro = false, output } = {}) {
    const T = Tone();
    this.retro = retro;
    this.context = T.getContext();
    this.transport = T.getTransport();
    this.score = null;

    // ---- Master chain ----
    this.bus = new T.Gain(1);
    this.eq = new T.EQ3({ low: 0, mid: 0, high: 0 });
    this.filter = new T.Filter({ type: "lowpass", frequency: 6000, Q: 0.7, rolloff: -12 });
    this.delay = new T.FeedbackDelay({ delayTime: "8n.", feedback: 0.25, wet: 0.12 });
    this.reverb = new T.Reverb(retro ? RETRO32.reverb : { decay: 4, preDelay: 0.02, wet: 0.3 });
    this.master = new T.Volume(0);
    this.fade = new T.Gain(0); // silent until the transport fades it in
    this.limiter = new T.Limiter(-1);
    // Soft clip: the limiter is too slow for drum hits, so whatever gets past it
    // is rounded off here (see SOFT_CLIP in mapping.js).
    this.clipIn = new T.Gain(1 / SOFT_CLIP.headroom);
    this.softClip = new T.WaveShaper(softClipCurve(SOFT_CLIP), 4096);
    this.softClip.oversample = retro ? "none" : "4x";
    this.bus.chain(this.eq, this.filter, this.delay, this.reverb, this.master, this.fade, this.limiter,
      this.clipIn, this.softClip, output ?? T.getDestination());
    this.ready = this.reverb.ready;

    // ---- Layer volumes (one fader + mute per layer) ----
    // Melody, bass and pad share a "band" volume that swells with the weather.
    // Distortion between the band and the bus; its wet mix follows the weather.
    this.drive = new T.Distortion({ distortion: 0.25, oversample: "2x", wet: 0 }).connect(this.bus);
    this.band = new T.Volume(0).connect(this.drive);
    this.vol = {};
    for (const l of LAYERS) {
      this.vol[l] = new T.Volume(DEFAULT_LEVELS[l]).connect(BAND.includes(l) ? this.band : this.bus);
    }
    // Gentle compressors on the two weather-chosen instruments. They only catch the
    // loud ends, so the temperature and cloud dynamics still come through.
    // The melody's per-hour level (cloud turns it down) sits after its compressor.
    this.melodyLevel = new T.Volume(0).connect(this.vol.melody);
    // The melody's echo (ECHO): its wet mix and feedback follow each hour's air.
    this.melodyEcho = new T.FeedbackDelay({ delayTime: 0.3, feedback: ECHO.feedback[0], wet: ECHO.wet[0] }).connect(this.melodyLevel);
    this.melodyComp = new T.Compressor({ threshold: -18, ratio: 3, attack: 0.02, release: 0.25, knee: 6 }).connect(this.melodyEcho);
    this.padComp = new T.Compressor({ threshold: -24, ratio: 3, attack: 0.05, release: 0.4, knee: 6 }).connect(this.vol.pad);

    // ---- Instruments ----
    // Melody and pad synths are built per song from score.meta.voices (see setVoices).
    //   melody → trim → vibrato → tone filter → panner → compressor
    //   pad    → trim → tremolo → tone filter → compressor
    this.melodyPan = new T.Panner(0).connect(this.melodyComp);
    this.melodyTone = new T.Filter({ type: "lowpass", frequency: 8000, rolloff: -12 }).connect(this.melodyPan);
    this.melodyVibrato = new T.Vibrato({ frequency: 5, depth: 0 }).connect(this.melodyTone);
    this.melodyTrim = new T.Volume(0).connect(this.melodyVibrato);
    this.padFilter = new T.Filter({ type: "lowpass", frequency: 1400, rolloff: -12 }).connect(this.padComp);
    this.padTremolo = new T.Tremolo({ frequency: 4, depth: 0, spread: 0 }).connect(this.padFilter).start();
    this.padTrim = new T.Volume(0).connect(this.padTremolo);
    this.melody = null;
    this.pad = null;
    this.voiceIds = {};

    this.bass = new T.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 2, rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4 },
      filterEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.5, baseFrequency: 120, octaves: 2.5 },
    }).connect(this.vol.bass);

    // Arpeggio (ARP): a soft pulse wave, like an old game console's square channel.
    this.arp = new T.Synth({
      oscillator: { type: "pulse", width: ARP_VOICE.width },
      envelope: { attack: 0.003, decay: 0.12, sustain: 0.3, release: 0.08 },
    }).connect(new T.Filter({ type: "lowpass", frequency: ARP_VOICE.tone, rolloff: -12 })
      .connect(new T.Volume(ARP_VOICE.gain).connect(this.vol.pad)));

    // Storm drums: a low, timpani-like membrane.
    this.drums = new T.MembraneSynth({
      pitchDecay: 0.06, octaves: 3,
      envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.4 },
    }).connect(new T.Filter({ type: "lowpass", frequency: 900 }).connect(new T.Volume(STORM_DRUMS_DB).connect(this.vol.drums)));

    // Rain-beat kit: a short deep kick, a rimshot and hats.
    this.kick = new T.MembraneSynth({
      pitchDecay: 0.03, octaves: 5,
      envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.1 },
    }).connect(new T.Volume(2).connect(this.vol.drums));
    this.rimFilter = new T.Filter({ type: "bandpass", frequency: 1800, Q: 1.2 }).connect(new T.Volume(4).connect(this.vol.drums));
    this.rim = new T.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
    }).connect(this.rimFilter);
    this.hatFilter = new T.Filter({ type: "highpass", frequency: 7500 }).connect(new T.Volume(-2).connect(this.vol.drums));
    this.hat = new T.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 },
    }).connect(this.hatFilter);
    // Vinyl crackle: tiny clicks of noise.
    this.crackleFilter = new T.Filter({ type: "bandpass", frequency: 3000, Q: 0.6 }).connect(new T.Volume(-4).connect(this.vol.atmosphere));
    this.crackle = new T.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.0005, decay: 0.004, sustain: 0, release: 0.002 },
    }).connect(this.crackleFilter);

    this.shakerFilter = new T.Filter({ type: "highpass", frequency: 4000 }).connect(this.vol.rain);
    this.shaker = new T.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03 },
    }).connect(this.shakerFilter);
    const bellVoice = this.asPlayed({
      id: "bells", synth: "FMSynth", gain: 6, options: {
        harmonicity: 3.01, modulationIndex: 14,
        envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.5 },
        modulation: { type: "square" },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
      },
    });
    this.bells = new T.PolySynth(T[bellVoice.synth], bellVoice.options).connect(new T.Volume(bellVoice.gain).connect(this.vol.rain));
    this.bells.maxPolyphony = 6;

    // Atmosphere: three noise colours, crossfaded per bar.
    this.atmosFilter = new T.Filter({ type: "lowpass", frequency: 6000, rolloff: -12 }).connect(this.vol.atmosphere);
    this.noise = {};
    this.noiseGain = {};
    for (const c of ["white", "pink", "brown"]) {
      this.noiseGain[c] = new T.Gain(0).connect(this.atmosFilter);
      this.noise[c] = new T.Noise(c).connect(this.noiseGain[c]);
    }
    // Wind: pink noise through a slowly sweeping band-pass.
    this.windGain = new T.Gain(0).connect(this.vol.atmosphere);
    this.windFilter = new T.AutoFilter({
      frequency: 0.12, baseFrequency: 250, octaves: 3.5,
      filter: { type: "bandpass", Q: 1.5, rolloff: -12 },
    }).connect(this.windGain);
    this.windNoise = new T.Noise("pink").connect(this.windFilter);

    // One-shots.
    this.thunderFilter = new T.Filter({ type: "lowpass", frequency: 220, rolloff: -24 }).connect(this.vol.fx);
    this.thunder = new T.NoiseSynth({
      noise: { type: "brown" },
      envelope: { attack: 0.08, decay: 3.5, sustain: 0, release: 1 },
    }).connect(this.thunderFilter);
    // Swell (SWELL): noise band-passed between the highpass and lowpass.
    this.swellFilter = new T.Filter({ type: "highpass", frequency: SWELL.highpass })
      .connect(new T.Filter({ type: "lowpass", frequency: SWELL.lowpass, rolloff: -12 }).connect(this.vol.fx));
    this.swellLevel = new T.Volume(SWELL.db).connect(this.swellFilter);
    this.swell = new T.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: SWELL.attack, decay: SWELL.decay, sustain: SWELL.sustain, release: SWELL.release, attackCurve: "sine" },
    }).connect(this.swellLevel);

    // Sky bells: glassy FM bells, a little brighter and longer than the snow bells.
    const chimeVoice = this.asPlayed({
      id: "chimes", synth: "FMSynth", gain: 7, options: {
        harmonicity: 2.01, modulationIndex: 5,
        oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.002, decay: 2.2, sustain: 0, release: 2.2 },
        modulationEnvelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.4 },
      },
    });
    this.chimes = new T.PolySynth(T[chimeVoice.synth], chimeVoice.options).connect(new T.Volume(chimeVoice.gain).connect(this.vol.fx));
    this.chimes.maxPolyphony = 8;
    // UV: a soft sine an octave over the melody.
    this.sparkle = new T.PolySynth(T.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.005, decay: 0.35, sustain: 0.15, release: 0.6 },
    }).connect(new T.Volume(-2).connect(this.vol.fx));
    this.sparkle.maxPolyphony = 6;
    // Aurora: a slow, wavering high chord.
    this.auroraVibrato = new T.Vibrato({ frequency: 0.35, depth: 0.25 }).connect(new T.Volume(-4).connect(this.vol.fx));
    this.aurora = new T.PolySynth(T.Synth, this.asPlayed({
      id: "aurora", gain: 0, options: {
        oscillator: { type: "fatsine", count: 3, spread: 22 },
        envelope: { attack: 2.2, decay: 0.5, sustain: 0.9, release: 3 },
      },
    }).options).connect(this.auroraVibrato);
    this.aurora.maxPolyphony = 6;
  }

  /** A voice as this engine plays it: unchanged, or simplified in 32-bit mode. */
  asPlayed(v) {
    return this.retro ? retroVoice(v) : v;
  }

  /** Build the melody and pad synths a score asks for (kept if they haven't changed). */
  setVoices(voices) {
    const T = Tone();
    const melody = this.asPlayed(voices.melody);
    const pad = this.asPlayed(voices.pad);
    const build = (v, out) => {
      const synth = new T.PolySynth({ context: this.context, voice: T[v.synth || "Synth"], options: v.options }).connect(out);
      synth.maxPolyphony = 12; // a pad chord with colour is 5 notes, and its release overlaps the next
      return synth;
    };
    if (this.voiceIds.melody !== melody.id) {
      this.melody?.dispose();
      this.melody = build(melody, this.melodyTrim);
      this.melodyTrim.volume.value = melody.gain;
      this.melodyTone.frequency.value = melody.tone;
      this.melodyVibrato.frequency.value = melody.vibrato[0];
      this.melodyVibrato.depth.value = melody.vibrato[1];
      this.voiceIds.melody = melody.id;
    }
    this.padBaseTone = pad.tone;
    if (this.voiceIds.pad !== pad.id) {
      this.pad?.dispose();
      this.pad = build(pad, this.padTrim);
      this.padTrim.volume.value = pad.gain;
      this.padFilter.frequency.value = pad.tone;
      this.padTremolo.frequency.value = pad.tremolo[0];
      this.padTremolo.depth.value = pad.tremolo[1];
      this.voiceIds.pad = pad.id;
    }
  }

  /** Seconds for n sixteenth notes at the transport's current tempo. */
  s16(n) {
    return (n * 15) / this.transport.bpm.value;
  }

  /** Schedule a score on the transport (replaces any previous one). */
  load(score) {
    const tr = this.transport;
    tr.cancel(0);
    this.score = score;
    this.setVoices(score.meta.voices);
    tr.bpm.value = score.meta.bpm;
    // Tempo-synced delays, set now that the tempo is known.
    this.delay.delayTime.value = (60 / score.meta.bpm) * 0.75; // a dotted eighth
    this.melodyEcho.delayTime.value = (60 / score.meta.bpm) * ECHO.beats;
    tr.swing = score.meta.swing ?? 0;
    tr.swingSubdivision = "16n";
    tr.loop = false; // plays once; pressing Play again starts it over
    const steps = score.meta.steps ?? 16; // sixteenths per hour slot
    const realBars = Math.ceil((score.meta.bars * steps) / 16);

    this.reverb.wet.value = score.automation.reverbWet;
    this.drive.distortion = score.meta.drive ?? 0.25;
    // Cloud rounds the bass off (meta.bassSub 0–1): the saw's upper harmonics
    // fade out, leaving a sine with a touch of the second harmonic so small
    // speakers still carry it.
    const sub = score.meta.bassSub ?? 0;
    this.bass.oscillator.partials = Array.from({ length: 16 }, (_, i) =>
      (i === 0 ? 1 : i === 1 ? Math.max(0.18, 0.5 * (1 - sub)) : (1 - sub) / (i + 1)));
    this.bass.filterEnvelope.baseFrequency = 120 + 60 * sub;
    this.bass.filterEnvelope.octaves = 2.5 - 1.5 * sub;
    this.bass.volume.value = 5 * sub;

    // `bar` in the score is an hour slot of `steps` sixteenths.
    const at = (bar, pos) => {
      const t = bar * steps + pos;
      return `${Math.floor(t / 16)}:${Math.floor((t % 16) / 4)}:${t % 4}`;
    };

    for (const n of score.melody) {
      tr.schedule((t) => this.melody.triggerAttackRelease(n.note, this.s16(n.dur) * (n.gate ?? 0.9), t, n.vel), at(n.bar, n.pos));
    }
    for (const n of score.bass) {
      tr.schedule((t) => this.bass.triggerAttackRelease(n.note, this.s16(n.dur) * (n.gate ?? 0.85), t, n.vel), at(n.bar, n.pos));
    }
    for (const c of score.pad) {
      tr.schedule((t) => {
        this.pad.triggerAttackRelease(c.notes, this.s16(c.dur) * 0.95, t, c.vel);
        // Colour notes (7th, 9th) each at their own, weather-set level.
        for (const x of c.colour ?? []) this.pad.triggerAttackRelease(x.note, this.s16(c.dur) * 0.95, t, x.vel);
      }, at(c.bar, c.pos));
    }
    for (const n of score.arp ?? []) {
      tr.schedule((t) => this.arp.triggerAttackRelease(n.note, this.s16(n.dur) * ARP.gate, t, n.vel), at(n.bar, n.pos));
    }
    for (const n of score.drums ?? []) {
      tr.schedule((t) => this.drums.triggerAttackRelease(n.note, this.s16(n.dur) * 2, t, n.vel), at(n.bar, n.pos));
    }
    // The rain beat and the dry beat share one kit.
    for (const n of [...(score.garage ?? []), ...(score.beat ?? [])]) {
      const play = { kick: (t) => this.kick.triggerAttackRelease("A1", "16n", t, n.vel),
        snare: (t) => this.rim.triggerAttackRelease(0.1, t, n.vel),
        hat: (t) => this.hat.triggerAttackRelease(0.03, t, n.vel),
        ghost: (t) => this.hat.triggerAttackRelease(0.03, t, n.vel) }[n.kind];
      tr.schedule(play, at(n.bar, n.pos));
    }
    // Crackle sits between the sixteenths, so it's placed in ticks.
    const ticks16 = tr.PPQ / 4;
    // Two clicks can't share a start time on one synth. Clicks a tick or two apart
    // can still collide: the transport may handle both in one audio block and give
    // them the same time, which throws. So keep clicks at least 10 ms apart (a click
    // is ~7 ms long, so nothing audible is lost).
    const gap = Math.max(1, Math.ceil(0.01 * (score.meta.bpm / 60) * tr.PPQ));
    let last = -Infinity;
    const clicks = (score.crackle ?? []).map((n) => ({ n, tick: Math.round((n.bar * steps + n.pos) * ticks16) }))
      .sort((a, b) => a.tick - b.tick);
    for (const { n, tick: at16 } of clicks) {
      const tick = Math.max(at16, last + gap);
      last = tick;
      tr.schedule((t) => this.crackle.triggerAttackRelease(0.004, t, n.vel), `${tick}i`);
    }
    for (const n of score.rain) {
      tr.schedule((t) => this.shaker.triggerAttackRelease(0.05, t, n.vel), at(n.bar, n.pos));
    }
    for (const n of score.bells) {
      tr.schedule((t) => this.bells.triggerAttackRelease(n.note, this.s16(n.dur), t, n.vel), at(n.bar, n.pos));
    }
    for (const c of score.chimes ?? []) {
      tr.schedule((t) => this.chimes.triggerAttackRelease(c.note, this.s16(c.dur), t, c.vel), at(c.bar, c.pos));
    }
    for (const x of score.shimmer ?? []) {
      const synth = x.kind === "aurora" ? this.aurora : this.sparkle;
      tr.schedule((t) => synth.triggerAttackRelease(x.notes, this.s16(x.dur) * (x.kind === "aurora" ? 0.9 : 0.8), t, x.vel), at(x.bar, x.pos));
    }
    for (const f of score.fx) {
      if (f.type === "thunder") tr.schedule((t) => this.thunder.triggerAttackRelease(3, t, 0.9), at(f.bar, f.pos));
      if (f.type === "swell") tr.schedule((t) => this.swell.triggerAttackRelease(SWELL.attack + SWELL.decay + SWELL.hold, t, SWELL.vel), at(f.bar, f.pos));
    }

    // Per-hour automation.
    score.atmosphere.forEach((_, bar) => tr.schedule((t) => this.applyBar(bar, t), at(bar, 0)));
    // Fade in at the top of every pass; fade out across the last hour into the gap.
    const g = this.fade.gain;
    tr.schedule((t) => {
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(1, t + FADE.inSec);
    }, "0:0:0");
    tr.schedule((t) => {
      g.cancelScheduledValues(t);
      g.setValueAtTime(1, t);
      g.linearRampToValueAtTime(0, t + this.s16(FADE.outHours * steps + FADE.outGap));
    }, at(score.meta.bars - FADE.outHours, 0));
    // Fade the beds out after the last bar.
    tr.schedule((t) => {
      for (const g of Object.values(this.noiseGain)) g.gain.rampTo(0, this.s16(8), t);
      this.windGain.gain.rampTo(0, this.s16(8), t);
    }, `${realBars}:0:0`);
  }

  /** One hour slot's settings, gliding from the last hour's (or set at once when `instant`). */
  applyBar(bar, t, instant = false) {
    const A = this.score.automation;
    const a = this.score.atmosphere[bar];
    const ramp = instant ? 0.005 : this.s16(2); // an hour is 8 sixteenths
    this.melodyPan.pan.rampTo(A.pan[bar], ramp, t);
    if (bar === 0 || instant) this.band.volume.setValueAtTime(A.gainDb[bar], t);
    else this.band.volume.rampTo(A.gainDb[bar], ramp * 2, t);
    const mDb = (A.melodyDb?.[bar] ?? 0) + (A.melodyDayDb?.[bar] ?? 0);
    if (bar === 0 || instant) this.melodyLevel.volume.setValueAtTime(mDb, t);
    else this.melodyLevel.volume.rampTo(mDb, ramp * 2, t);
    this.padFilter.frequency.rampTo(this.padBaseTone * 2 ** A.padOpen[bar], ramp * 2, t);
    this.filter.frequency.rampTo(A.cutoff[bar], ramp * 2, t);
    this.drive.wet.rampTo(A.driveWet[bar], ramp * 2, t);
    const carry = A.echoCarry?.[bar] ?? 0;
    this.melodyEcho.wet.rampTo(ECHO.wet[0] + (ECHO.wet[1] - ECHO.wet[0]) * carry, ramp * 2, t);
    this.melodyEcho.feedback.rampTo(ECHO.feedback[0] + (ECHO.feedback[1] - ECHO.feedback[0]) * carry, ramp * 2, t);
    this.reverb.wet.rampTo(Math.min(0.85, A.reverbWet + (A.reverbLift?.[bar] ?? 0)), ramp * 3, t);
    this.eq.high.rampTo(A.eqHigh[bar], ramp * 2, t);
    this.eq.low.rampTo(A.eqLow[bar], ramp * 2, t);
    for (const c of ["white", "pink", "brown"]) {
      this.noiseGain[c].gain.rampTo(a.color === c ? a.level : 0, ramp * 2, t);
    }
    this.atmosFilter.frequency.rampTo(a.cutoff, ramp * 2, t);
    this.windGain.gain.rampTo(a.wind, ramp * 2, t);
  }

  /**
   * Start the loaded score at `when`, from `offset` seconds into the song.
   * Starting partway (after a mute or 32-bit change mid-song) skips everything
   * scheduled earlier, so the current hour's settings and the fade are set here.
   * Notes still ringing from before `offset` aren't replayed.
   */
  start(when, offset = 0) {
    for (const n of Object.values(this.noise)) n.start(when);
    this.windNoise.start(when);
    this.windFilter.start(when);
    if (offset > 0) {
      const steps = this.score.meta.steps ?? 16;
      const bars = this.score.meta.bars;
      this.applyBar(Math.min(bars - 1, Math.floor(offset / this.s16(steps))), when, true);
      const outStart = this.s16((bars - FADE.outHours) * steps);
      const outEnd = outStart + this.s16(FADE.outHours * steps + FADE.outGap);
      const g = this.fade.gain;
      g.cancelScheduledValues(when);
      if (offset < outStart) g.setValueAtTime(1, when);
      else {
        g.setValueAtTime(Math.max(0, (outEnd - offset) / (outEnd - outStart)), when);
        g.linearRampToValueAtTime(0, when + Math.max(0.01, outEnd - offset));
      }
    }
    this.transport.start(when, offset);
  }

  setMute(layer, muted) {
    this.vol[layer].mute = muted;
  }
}
