// Plays a score with Tone.js (loaded globally from vendor/tone-15.1.22.js).
//
// Signal flow (melody and pad instruments are chosen per song from score.meta.voices):
//   melody → trim → vibrato → lowpass → panner → comp ─┐
//   bass, drums, 2-step kit ────────────────────────────┼→ band ─┐   (band swells with the weather, then a distortion whose mix follows it)
//   pad → trim → tremolo → lowpass → comp ─────────────┘        │
//   shaker → highpass ──────────────────────────────────────────┼→ bus → EQ3 → filter → delay → reverb → master → limiter → out
//   bells ──────────────────────────────────────────────────────┘
//   white/pink/brown noise → gains → lowpass (atmosphere); vinyl crackle → bandpass
//   pink noise → auto-filter → gain (wind)
//   thunder, swell (one-shots)

const Tone = () => window.Tone;

export const LAYERS = ["melody", "bass", "pad", "drums", "rain", "atmosphere", "fx"];
const BAND = ["melody", "bass", "pad", "drums"];
export const DEFAULT_LEVELS = { melody: 0, bass: -17, pad: -17, drums: -8, rain: -2, atmosphere: -8, fx: -10 };

export class Engine {
  constructor({ onBar, onEvent } = {}) {
    const T = Tone();
    this.onBar = onBar;
    this.onEvent = onEvent; // (type) for visuals: "thunder", "swell"
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
    this.melodyComp = new T.Compressor({ threshold: -18, ratio: 3, attack: 0.02, release: 0.25, knee: 6 }).connect(this.melodyLevel);
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

    // Storm drums: a low, timpani-like membrane.
    this.drums = new T.MembraneSynth({
      pitchDecay: 0.06, octaves: 3,
      envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.4 },
    }).connect(new T.Filter({ type: "lowpass", frequency: 900 }).connect(this.vol.drums));

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

  /** Build the melody and pad synths a score asks for (kept if they haven't changed). */
  setVoices({ melody, pad }) {
    const T = Tone();
    const build = (v, out) => {
      const synth = new T.PolySynth(T[v.synth || "Synth"], v.options).connect(out);
      synth.maxPolyphony = 8;
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
    tr.swing = score.meta.swing ?? 0;
    tr.swingSubdivision = "16n";
    tr.loop = true;
    tr.loopStart = 0;
    const steps = score.meta.steps ?? 16; // sixteenths per hour slot
    const realBars = Math.ceil((score.meta.bars * steps) / 16);
    tr.loopEnd = `${realBars + 1}:0:0`; // a bar of silence before it repeats
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
      tr.schedule((t) => this.pad.triggerAttackRelease(c.notes, this.s16(c.dur) * 0.95, t, c.vel), at(c.bar, c.pos));
    }
    for (const n of score.drums ?? []) {
      tr.schedule((t) => this.drums.triggerAttackRelease(n.note, this.s16(n.dur) * 2, t, n.vel), at(n.bar, n.pos));
    }
    for (const n of score.garage ?? []) {
      const play = { kick: (t) => this.kick.triggerAttackRelease("A1", "16n", t, n.vel),
        snare: (t) => this.rim.triggerAttackRelease(0.1, t, n.vel),
        hat: (t) => this.hat.triggerAttackRelease(0.03, t, n.vel),
        ghost: (t) => this.hat.triggerAttackRelease(0.03, t, n.vel) }[n.kind];
      tr.schedule(play, at(n.bar, n.pos));
    }
    // Crackle sits between the sixteenths, so it's placed in ticks.
    const ticks16 = tr.PPQ / 4;
    for (const n of score.crackle ?? []) {
      tr.schedule((t) => this.crackle.triggerAttackRelease(0.004, t, n.vel), `${Math.round((n.bar * steps + n.pos) * ticks16)}i`);
    }
    for (const n of score.rain) {
      tr.schedule((t) => this.shaker.triggerAttackRelease(0.05, t, n.vel), at(n.bar, n.pos));
    }
    for (const n of score.bells) {
      tr.schedule((t) => this.bells.triggerAttackRelease(n.note, this.s16(n.dur), t, n.vel), at(n.bar, n.pos));
    }
    for (const f of score.fx) {
      const note = (t) => { if (this.onEvent) Tone().getDraw().schedule(() => this.onEvent(f.type), t); };
      if (f.type === "thunder") tr.schedule((t) => { this.thunder.triggerAttackRelease(3, t, 0.9); note(t); }, at(f.bar, f.pos));
      if (f.type === "swell") tr.schedule((t) => { this.swell.triggerAttackRelease(2.5, t, 0.6); note(t); }, at(f.bar, f.pos));
    }

    // Per-hour automation and the playhead.
    const A = score.automation;
    score.atmosphere.forEach((a, bar) => {
      tr.schedule((t) => {
        const ramp = this.s16(2); // an hour is 8 sixteenths
        this.melodyPan.pan.rampTo(A.pan[bar], ramp, t);
        if (bar === 0) this.band.volume.setValueAtTime(A.gainDb[0], t);
        else this.band.volume.rampTo(A.gainDb[bar], ramp * 2, t);
        const mDb = A.melodyDb?.[bar] ?? 0;
        if (bar === 0) this.melodyLevel.volume.setValueAtTime(mDb, t);
        else this.melodyLevel.volume.rampTo(mDb, ramp * 2, t);
        this.padFilter.frequency.rampTo(this.padBaseTone * 2 ** A.padOpen[bar], ramp * 2, t);
        this.filter.frequency.rampTo(A.cutoff[bar], ramp * 2, t);
        this.drive.wet.rampTo(A.driveWet[bar], ramp * 2, t);
        this.reverb.wet.rampTo(Math.min(0.85, A.reverbWet + (A.reverbLift?.[bar] ?? 0)), ramp * 3, t);
        this.eq.high.rampTo(A.eqHigh[bar], ramp * 2, t);
        this.eq.low.rampTo(A.eqLow[bar], ramp * 2, t);
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
    }, `${realBars}:0:0`);
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
    this.melody?.releaseAll();
    this.pad?.releaseAll();
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
