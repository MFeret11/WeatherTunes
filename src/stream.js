// Plays a song by rendering it ahead of time instead of synthesising it live.
//
// The instruments are hundreds of Tone.js nodes, more than a phone can run in real
// time without crackling. So the song is rendered offline, as fast as the device
// allows, and a tiny worklet at the end of the chain (tap.worklet.js) hands the
// audio over in blocks as it's made. A plain buffer player plays the blocks back
// to back. Playback starts once enough is ready that the rest will stay ahead of
// it: on a fast device that's almost at once, on a slow one after a short wait,
// and never with a crackle.
//
// Changing a mute or the 32-bit switch mid-song renders again from where the song
// has got to, then crossfades over once the new audio is ready.

import { Engine, LAYERS, FADE, songSeconds, cueTimes } from "./engine.js";

export const SAMPLE_RATE = 44100;
const LEAD = 0.75; // seconds of audio ready before playback starts or a new render takes over
const MARGIN = 0.12; // how far past "now" the first block is scheduled, seconds
const XFADE = 0.05; // crossfade when a new render takes over, seconds
const TAP = new URL("./tap.worklet.js", import.meta.url).href;

// Tone.Offline swaps Tone's global context while a render is set up, so set up one
// render at a time (once started, they run side by side).
let queue = Promise.resolve();

/** A render of `score` from `offset` seconds in, its audio arriving in blocks. */
export class Render {
  constructor(score, { retro = false, muted = {}, offset = 0, sampleRate = SAMPLE_RATE } = {}) {
    this.score = score;
    this.retro = retro;
    this.muted = { ...muted };
    this.offset = offset;
    this.sampleRate = sampleRate;
    this.frames = Math.ceil((songSeconds(score) - offset) * sampleRate);
    this.blocks = []; // { at, data: [left, right] }, back to back from frame 0
    this.got = 0; // frames arrived
    this.done = false;
    this.error = null;
    this.listeners = new Set();
    this.created = performance.now();
    this.first = null; // when audio first arrived: { wall, got }
    this.promise = this.run();
  }

  /** The same song with the same settings? */
  matches(score, retro, muted, sampleRate) {
    return this.score === score && this.retro === retro && this.offset === 0 && this.sampleRate === sampleRate
      && !this.error && LAYERS.every((l) => !!this.muted[l] === !!muted[l]);
  }

  /** Seconds from asking for the render to its first audio. */
  get lag() {
    return this.first ? (this.first.wall - this.created) / 1000 : null;
  }

  /** Seconds of audio rendered per second of waiting, once there's enough to tell. */
  speed() {
    if (!this.first) return null;
    const secs = (performance.now() - this.first.wall) / 1000;
    const audio = (this.got - this.first.got) / this.sampleRate;
    return secs > 0.2 && audio > 0 ? audio / secs : null;
  }

  /** Could playback from frame `from` start now and never catch up with the render? */
  ready(from) {
    if (this.done) return !this.error;
    const sr = this.sampleRate;
    if ((this.got - from) / sr < LEAD) return false;
    const speed = this.speed();
    if (!speed) return false;
    const renderLeft = (this.frames - this.got) / sr / (speed * 0.85);
    return renderLeft <= (this.frames - from) / sr - LEAD;
  }

  /** The whole render as an AudioBuffer-like object (for the WAV download). */
  audio() {
    const ch = [new Float32Array(this.frames), new Float32Array(this.frames)];
    for (const b of this.blocks) for (let c = 0; c < 2; c++) ch[c].set(b.data[c], b.at);
    return { numberOfChannels: 2, sampleRate: this.sampleRate, length: this.frames, getChannelData: (c) => ch[c] };
  }

  add(left, right) {
    const n = Math.min(left.length, this.frames - this.got);
    if (n <= 0) return;
    this.blocks.push({ at: this.got, data: n === left.length ? [left, right] : [left.subarray(0, n), right.subarray(0, n)] });
    this.got += n;
    if (!this.first) this.first = { wall: performance.now(), got: this.got };
    if (this.got >= this.frames) this.done = true;
    this.emit();
  }

  emit() {
    for (const f of this.listeners) f();
  }

  async run() {
    const T = window.Tone;
    const prev = queue;
    let release;
    queue = new Promise((r) => (release = r));
    await prev;
    try {
      const out = await T.Offline(async (ctx) => {
        try {
          let tap;
          if (window.isSecureContext && ctx.rawContext.audioWorklet) {
            try {
              await ctx.addAudioWorkletModule(TAP);
              tap = ctx.createAudioWorkletNode("wt-tap", {
                numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
                channelCount: 2, channelCountMode: "explicit", processorOptions: { frames: this.frames },
              });
              tap.port.onmessage = (e) => this.add(e.data[0], e.data[1]);
              tap.connect(ctx.rawContext.destination);
            } catch (e) {
              console.warn("Streaming isn't available here, so the song renders in full first.", e);
              tap = undefined;
            }
          }
          const engine = new Engine({ retro: this.retro, output: tap });
          await engine.ready;
          for (const l of LAYERS) engine.setMute(l, !!this.muted[l]);
          engine.load(this.score);
          engine.start(0, this.offset);
        } finally {
          setTimeout(release, 0); // Tone restores its global context as soon as this returns
        }
      }, this.frames / this.sampleRate, 2, this.sampleRate);
      // Anything the tap didn't hand over (all of it where worklets aren't available)
      // comes from the finished render.
      if (this.got < this.frames) {
        const buf = out.get();
        this.add(buf.getChannelData(0).slice(this.got, this.frames), buf.getChannelData(1).slice(this.got, this.frames));
      }
    } catch (e) {
      console.warn(e);
      this.error = e;
    } finally {
      release();
    }
    this.done = true;
    this.emit();
  }
}

/**
 * Plays scores through renders.
 *   onBar(bar | null)  the hour now playing, for the screen
 *   onEvent(type)      a thunder or swell is sounding
 *   onWait(waiting)    getting ready to play (true), or playing (false)
 *   onEnd(error?)      the song played through and stopped by itself (or couldn't play)
 */
export class Player {
  constructor({ onBar, onEvent, onWait, onEnd } = {}) {
    Object.assign(this, { onBar, onEvent, onWait, onEnd });
    this.ctx = null;
    this.renders = []; // recent full renders, kept so Play and Download can reuse them
    this.playing = false;
    this.isWaiting = false;
    this.lag = 1; // how long a render takes to start producing audio, seconds
    this.speed = 1; // how fast renders go, audio seconds per second
  }

  /** The audio output, made or woken on first use. Call it from a click. */
  wake() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try {
        this.ctx = new AC({ latencyHint: "playback", sampleRate: SAMPLE_RATE });
      } catch {
        this.ctx = new AC({ latencyHint: "playback" });
      }
    }
    if (this.ctx.state !== "running") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** A full render of the song with these settings: a recent one if it matches, else a new one. */
  render(score, retro, muted) {
    const rate = this.ctx?.sampleRate ?? SAMPLE_RATE;
    let r = this.renders.find((x) => x.matches(score, retro, muted, rate));
    if (!r) {
      r = this.makeRender(score, { retro, muted, sampleRate: rate });
      this.renders = [...this.renders.slice(-1), r];
    }
    return r;
  }

  play(score, { retro = false, muted = {} } = {}) {
    if (this.playing) this.stop();
    this.wake();
    this.score = score;
    this.retro = retro;
    this.muted = { ...muted };
    this.cues = cueTimes(score);
    this.t0 = null; // the context frame where the song's first frame plays
    this.bar = undefined;
    this.fx = 0;
    this.playing = true;
    this.next = null;
    this.waiting(true);
    this.active = this.stream(this.render(score, retro, muted));
    this.loop();
  }

  /** Fade out quickly and stop. */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this.debounce);
    clearTimeout(this.timer);
    const st = this.active;
    if (this.next) this.drop(this.next);
    this.active = this.next = null;
    const now = this.ctx.currentTime;
    const g = st.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + FADE.stopSec);
    setTimeout(() => this.drop(st), FADE.stopSec * 1000 + 50);
    this.waiting(false);
    this.onBar?.(null);
  }

  /** New mutes or 32-bit setting: heard from a moment later if a song is playing. */
  update(retro, muted) {
    const changed = retro !== this.retro || LAYERS.some((l) => !!muted[l] !== !!this.muted?.[l]);
    this.retro = retro;
    this.muted = { ...muted };
    if (!this.playing || !changed) return;
    clearTimeout(this.debounce); // a few quick taps make one new render
    this.debounce = setTimeout(() => this.rerender(), 250);
  }

  rerender() {
    if (!this.playing) return;
    if (this.t0 == null) {
      this.play(this.score, { retro: this.retro, muted: this.muted }); // not started yet: start over
      return;
    }
    // Start the new render about where the song will be when its audio is ready.
    const offset = this.position() + this.lag + LEAD / Math.max(1, this.speed);
    if (offset > this.cues.end - 1) return; // nearly over anyway
    if (this.next) this.drop(this.next);
    this.next = this.stream(this.makeRender(this.score, { retro: this.retro, muted: this.muted, offset, sampleRate: this.ctx.sampleRate }));
  }

  makeRender(score, options) {
    return new Render(score, options);
  }

  /** Seconds into the song that are reaching the speakers now. */
  position() {
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return (this.ctx.currentTime - latency) - this.t0 / this.ctx.sampleRate;
  }

  stream(render) {
    const gain = this.ctx.createGain();
    gain.connect(this.ctx.destination);
    const st = { render, gain, sources: new Set(), live: false, from: 0, scheduled: 0, block: 0 };
    const f = () => this.pump(st);
    render.listeners.add(f);
    st.off = () => render.listeners.delete(f);
    queueMicrotask(f); // it may be ready already
    return st;
  }

  /** Start a stream once it's ready, and schedule whatever audio it has. */
  pump(st) {
    if (!this.playing || (st !== this.active && st !== this.next)) return;
    const r = st.render;
    const sr = r.sampleRate;
    const offF = Math.round(r.offset * sr);
    if (r.lag != null && st === this.next) this.lag = r.lag; // a render from partway, like the next one will be
    this.speed = r.speed() ?? this.speed;
    if (!st.live) {
      if (r.error) {
        if (st === this.next) { this.drop(st); this.next = null; return; } // keep playing as it was
        this.finish(r.error);
        return;
      }
      const nowF = Math.round((this.ctx.currentTime + MARGIN) * sr);
      if (st === this.active) {
        if (!r.ready(0)) return;
        this.t0 = nowF;
        this.waiting(false);
      } else {
        // A new render taking over: as soon as it can, but not before it begins.
        const from = Math.max(nowF - this.t0, offF) - offF;
        if (!r.ready(from)) return;
        st.from = from;
        this.splice(st, (this.t0 + offF + from) / sr);
      }
      st.live = true;
      st.scheduled = st.from;
    }
    for (; st.block < r.blocks.length; st.block++) {
      const b = r.blocks[st.block];
      const end = b.at + b.data[0].length;
      if (end <= st.scheduled) continue;
      const start = Math.max(b.at, st.scheduled);
      let when = this.t0 + offF + start;
      const late = Math.round((this.ctx.currentTime + 0.02) * sr) - when;
      if (late > 0) {
        // The render fell behind: leave a short gap rather than a glitch, and carry on from there.
        this.t0 += late + Math.round(MARGIN * sr);
        when = this.t0 + offF + start;
      }
      const buf = this.ctx.createBuffer(2, end - start, sr);
      for (let c = 0; c < 2; c++) buf.getChannelData(c).set(b.data[c].subarray(start - b.at));
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(st.gain);
      src.onended = () => { st.sources.delete(src); src.disconnect(); };
      src.start(when / sr);
      st.sources.add(src);
      st.scheduled = end;
    }
  }

  /** Crossfade from the playing stream to `st` at context time `t`. */
  splice(st, t) {
    const old = this.active;
    old.off();
    old.gain.gain.setValueAtTime(1, t);
    old.gain.gain.linearRampToValueAtTime(0, t + XFADE);
    st.gain.gain.setValueAtTime(0, t);
    st.gain.gain.linearRampToValueAtTime(1, t + XFADE);
    setTimeout(() => this.drop(old), (t + XFADE - this.ctx.currentTime) * 1000 + 100);
    this.active = st;
    this.next = null;
  }

  drop(st) {
    st.off();
    for (const src of st.sources) {
      try { src.stop(); } catch { /* never started */ }
      src.disconnect();
    }
    st.sources.clear();
    st.gain.disconnect();
  }

  /** Keep the screen with the song, take over with a pending render, and notice the end. */
  loop() {
    if (!this.playing) return;
    if (this.next) this.pump(this.next);
    if (this.t0 != null) {
      const pos = this.position();
      const c = this.cues;
      let bar = null;
      if (pos >= 0 && pos < c.barsEnd) {
        bar = 0;
        while (bar + 1 < c.bars.length && c.bars[bar + 1] <= pos) bar++;
      }
      if (bar !== this.bar) {
        this.bar = bar;
        this.onBar?.(bar);
      }
      for (; this.fx < c.fx.length && c.fx[this.fx].t <= pos; this.fx++) {
        if (pos - c.fx[this.fx].t < 0.5) this.onEvent?.(c.fx[this.fx].type);
      }
      if (pos >= c.end) {
        this.finish();
        return;
      }
    }
    this.timer = setTimeout(() => this.loop(), 40);
  }

  finish(error) {
    this.playing = false;
    clearTimeout(this.debounce);
    for (const st of [this.active, this.next]) if (st) this.drop(st);
    this.active = this.next = null;
    this.waiting(false);
    this.onBar?.(null);
    this.onEnd?.(error);
  }

  waiting(on) {
    if (this.isWaiting === on) return;
    this.isWaiting = on;
    this.onWait?.(on);
  }
}
