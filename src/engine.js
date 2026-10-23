// Plays a score with Tone.js (loaded globally from vendor/tone-15.1.22.js).
//
// Signal flow:
//   melody → panner ─┐
//   bass ────────────┤
//   pad → lowpass ───┼→ bus → EQ3 → filter → delay → reverb → master → limiter → out
//   shaker → highpass┤
//   bells ───────────┤
//   white/pink/brown noise → gains → lowpass (atmosphere)
//   pink noise → auto-filter → gain (wind)
//   thunder, swell (one-shots)

const Tone = () => window.Tone;

export const LAYERS = ["melody", "bass", "pad", "rain", "atmosphere", "fx"];
export const DEFAULT_LEVELS = { melody: 0, bass: -17, pad: -17, rain: -2, atmosphere: -8, fx: -10 };

export class Engine {
  constructor({ onBar } = {}) {
    const T = Tone();
    this.onBar = onBar;
    this.transport = T.getTransport();
    this.score = null;

    // ---- Master chain ----
    this.bus = new T.Gain(1);
    this.eq = new T.EQ3({ low: 0, mid: 0, high: 0 });
    this.filter = new T.Filter({ type: "lowpass", frequency: 6000, Q: 0.7, rolloff: -12 });
    this.delay = new T.FeedbackDelay({ delayTime: "8n.", feedback: 0.25, wet: 0.12 });
    this.reverb = new T.Reverb({ decay: 4, preDelay: 0.02, wet: 0.3 });
    this.master = new T.Volume(0);
    this.limiter = new T.Limiter(-1);
    this.bus.chain(this.eq, this.filter, this.delay, this.reverb, this.master, this.limiter, T.getDestination());
    this.ready = this.reverb.ready;

    // ---- Layer volumes (one fader + mute per layer) ----
    this.vol = {};
    for (const l of LAYERS) this.vol[l] = new T.Volume(DEFAULT_LEVELS[l]).connect(this.bus);

    // ---- Instruments ----
    this.melodyPan = new T.Panner(0).connect(this.vol.melody);
    this.melody = new T.PolySynth(T.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.6 },
    }).connect(this.melodyPan);
    this.melody.maxPolyphony = 8;

    this.bass = new T.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 2, rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4 },
      filterEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.5, baseFrequency: 120, octaves: 2.5 },
    }).connect(this.vol.bass);

    this.padFilter = new T.Filter({ type: "lowpass", frequency: 1400, rolloff: -12 }).connect(this.vol.pad);
    this.pad = new T.PolySynth(T.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 20 },
      envelope: { attack: 1.2, decay: 0.5, sustain: 0.8, release: 2.5 },
    }).connect(this.padFilter);
    this.pad.maxPolyphony = 8;

    this.shakerFilter = new T.Filter({ type: "highpass", frequency: 4000 }).connect(this.vol.rain);
    this.shaker = new T.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03 },
    }).connect(this.shakerFilter);
    this.bells = new T.PolySynth(T.FMSynth, {
      harmonicity: 3.01, modulationIndex: 14,
      envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.5 },
      modulation: { type: "square" },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
    }).connect(new T.Volume(6).connect(this.vol.rain));
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
    this.swellFilter = new T.Filter({ type: "highpass", frequency: 4000 }).connect(this.vol.fx);
    this.swellLevel = new T.Volume(-12).connect(this.swellFilter);
    this.swell = new T.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 2.5, decay: 0.1, sustain: 1, release: 1.5, attackCurve: "exponential" },
    }).connect(this.swellLevel);
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
    tr.bpm.value = score.meta.bpm;
    tr.loop = true;
    tr.loopStart = 0;
    tr.loopEnd = `${score.meta.bars + 1}:0:0`; // a bar of silence before it repeats
    this.reverb.wet.value = score.automation.reverbWet;

    const at = (bar, pos) => `${bar}:${Math.floor(pos / 4)}:${pos % 4}`;

    for (const n of score.melody) {
      tr.schedule((t) => this.melody.triggerAttackRelease(n.note, this.s16(n.dur) * 0.9, t, n.vel), at(n.bar, n.pos));
    }
    for (const n of score.bass) {
      tr.schedule((t) => this.bass.triggerAttackRelease(n.note, this.s16(n.dur) * 0.85, t, n.vel), at(n.bar, n.pos));
    }
    for (const c of score.pad) {
      tr.schedule((t) => this.pad.triggerAttackRelease(c.notes, this.s16(c.dur) * 0.95, t, c.vel), at(c.bar, c.pos));
    }
    for (const n of score.rain) {
      tr.schedule((t) => this.shaker.triggerAttackRelease(0.05, t, n.vel), at(n.bar, n.pos));
    }
    for (const n of score.bells) {
      tr.schedule((t) => this.bells.triggerAttackRelease(n.note, this.s16(n.dur), t, n.vel), at(n.bar, n.pos));
    }
    for (const f of score.fx) {
      if (f.type === "thunder") tr.schedule((t) => this.thunder.triggerAttackRelease(3, t, 0.9), at(f.bar, f.pos));
      if (f.type === "swell") tr.schedule((t) => this.swell.triggerAttackRelease(2.5, t, 0.6), at(f.bar, f.pos));
    }

    // Per-bar automation and the playhead.
    const A = score.automation;
    score.atmosphere.forEach((a, bar) => {
      tr.schedule((t) => {
        const ramp = this.s16(4);
        this.melodyPan.pan.rampTo(A.pan[bar], ramp, t);
        this.filter.frequency.rampTo(A.cutoff[bar], ramp * 2, t);
        for (const c of ["white", "pink", "brown"]) {
          this.noiseGain[c].gain.rampTo(a.color === c ? a.level : 0, ramp * 2, t);
        }
        this.atmosFilter.frequency.rampTo(a.cutoff, ramp * 2, t);
        this.windGain.gain.rampTo(a.wind, ramp * 2, t);
        if (this.onBar) Tone().getDraw().schedule(() => this.onBar(bar), t);
      }, at(bar, 0));
    });
    // Fade the beds out in the gap bar before the loop restarts.
    tr.schedule((t) => {
      for (const g of Object.values(this.noiseGain)) g.gain.rampTo(0, this.s16(8), t);
      this.windGain.gain.rampTo(0, this.s16(8), t);
      if (this.onBar) Tone().getDraw().schedule(() => this.onBar(null), t);
    }, at(score.meta.bars, 0));
  }

  start(when) {
    for (const n of Object.values(this.noise)) if (n.state !== "started") n.start(when);
    if (this.windNoise.state !== "started") {
      this.windNoise.start(when);
      this.windFilter.start(when);
    }
    this.transport.start(when, 0);
  }

  stop() {
    this.transport.stop();
    this.melody.releaseAll();
    this.pad.releaseAll();
    this.bells.releaseAll();
    for (const g of Object.values(this.noiseGain)) g.gain.rampTo(0, 0.3);
    this.windGain.gain.rampTo(0, 0.3);
    if (this.onBar) this.onBar(null);
  }

  get playing() {
    return this.transport.state === "started";
  }

  setMute(layer, muted) {
    this.vol[layer].mute = muted;
  }
}
