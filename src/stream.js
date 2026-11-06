// Plays a song by rendering it ahead of time instead of synthesising it live.
//
// The instruments are hundreds of Tone.js nodes, more than a phone can run in real
// time without crackling. So the song is rendered offline, as fast as the device
// allows, and a tiny worklet at the end of the chain (tap.worklet.js) hands the
// audio over in blocks as it's made. A plain buffer player plays the blocks back
// to back. Playback starts once enough is ready that the rest will stay ahead of
// it: on a fast device that's almost at once, on a slow one after a short wait,
// and never with a crackle. If the render still falls behind (a phone slowing
// down partway), playback pauses once, cleanly, until it can run to the end.
//
// Changing a mute or the 32-bit switch mid-song renders again from where the song
// has got to, then crossfades over once the new audio is ready. That render starts
// a little earlier (see preRoll), so notes still ringing carry on through the switch.

import { Engine, LAYERS, FADE, songSeconds, cueTimes, timeline } from "./engine.js";
import { SUITE, RETRO32 } from "./mapping.js";

export const SAMPLE_RATE = 44100;
const LEAD = 0.75; // seconds of audio ready before playback starts or a new render takes over
const RESUME_LEAD = 2; // after the render falls behind mid-song, wait for this much before carrying on
const RECENT = 3; // render speed is judged over the last few seconds too, so a slowdown shows quickly
const SAFETY = 0.85; // plan as if the render will run this much slower than measured
const MARGIN = 0.12; // how far past "now" the first block is scheduled, seconds
const TAP = new URL("./tap.worklet.js", import.meta.url).href;
const XFADE = 0.1; // crossfade when a new render takes over, seconds
const PREPARE_DELAY = 0.8; // seconds after a song appears before rendering it early, so the page paints first
// A render from partway starts early enough to replay every note still ringing:
const PRE = {
  tailSec: 3.5, // the longest release (the slow pads)
  settleSec: 1.5, // at least this much, so the reverb and echoes are full
  maxSec: 6, // and never more than this, so the switch isn't heard too late
};
const NOTE_LAYERS = ["melody", "pad", "bass", "arp", "drums", "bells", "chimes", "shimmer"];

/** Seconds before `offset` to start rendering, so notes ringing at `offset` are played in full. */
export function preRoll(score, offset) {
  if (offset <= 0) return 0;
  const s16 = (n) => (n * 15) / score.meta.bpm;
  const tl = timeline(score);
  let from = offset - PRE.settleSec;
  for (const l of NOTE_LAYERS) {
    for (const n of score[l] ?? []) {
      const t = s16(tl.at(n));
      if (t < from && t + s16(n.dur) + PRE.tailSec > offset) from = t;
    }
  }
  return Math.max(0, Math.min(offset, PRE.maxSec, offset - from + 0.01));
}

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
    // Rendered first and thrown away: the lead-in before `offset` (see preRoll).
    this.skip = Math.round(preRoll(score, offset) * sampleRate);
    this.skipped = 0;
    this.blocks = []; // { at, data: [left, right] }, back to back from frame 0
    this.marks = []; // recent { wall, got } arrivals, for speed()
    this.got = 0; // frames arrived
    this.done = false;
    this.error = null;
    this.listeners = new Set();
    this.created = performance.now();
    this.first = null; // when audio first arrived, after any lead-in: { wall, got }
    this.began = null; // when the render first produced anything (wall clock)
    this.promise = this.run();
  }

  /** The same song with the same settings? */
  matches(score, retro, muted, sampleRate) {
    return this.score === score && this.retro === retro && this.offset === 0 && this.sampleRate === sampleRate
      && !this.error && LAYERS.every((l) => !!this.muted[l] === !!muted[l]);
  }

  /** Seconds from asking for the render to its first output (the lead-in comes after). */
  get lag() {
    return this.began ? (this.began - this.created) / 1000 : null;
  }

  /**
   * Seconds of audio rendered per second of waiting, once there's enough to tell:
   * the slower of the whole run so far and the last RECENT seconds, so a device
   * that slows down partway is noticed rather than averaged away.
   */
  speed() {
    if (!this.first) return null;
    const now = performance.now();
    const rate = (from) => {
      const secs = (now - from.wall) / 1000;
      const audio = (this.got - from.got) / this.sampleRate;
      return secs > 0.2 && audio > 0 ? audio / secs : null;
    };
    const all = rate(this.first);
    if (!all) return null;
    // Measured up to now, so a render that has gone quiet slows down too.
    const since = this.marks.find((m) => now - m.wall <= RECENT * 1000) ?? this.marks.at(-1);
    if (!since || now - since.wall < 1000) return all;
    return Math.min(all, (this.got - since.got) / this.sampleRate / ((now - since.wall) / 1000));
  }

  /** Could playback from frame `from` start now, with `lead` seconds in hand, and never catch up with the render? */
  ready(from, lead = LEAD) {
    if (this.done) return !this.error;
    const sr = this.sampleRate;
    if ((this.got - from) / sr < lead) return false;
    const speed = this.speed();
    if (!speed) return false;
    const renderLeft = (this.frames - this.got) / sr / (speed * SAFETY);
    return renderLeft <= (this.frames - from) / sr - LEAD;
  }

  /**
   * About how many seconds until ready(from, lead) comes true, or null before there's
   * a speed. For a countdown, so it uses the steadier speed over the whole render
   * (ready() itself is more cautious, so the last second or two may run over).
   */
  waitFor(from, lead = LEAD) {
    if (this.done) return 0;
    if (!this.first || !this.speed()) return null;
    const speed = (this.got - this.first.got) / this.sampleRate / ((performance.now() - this.first.wall) / 1000);
    if (!(speed > 0)) return null;
    const sr = this.sampleRate, total = this.frames / sr, f = from / sr, got = this.got / sr;
    const room = total - f - LEAD;
    const need = room > 0 ? Math.max(f + lead, total - speed * SAFETY * room) : total;
    return Math.max(0, (need - got) / speed);
  }

  /** The whole render as an AudioBuffer-like object (for the WAV download). */
  audio() {
    const ch = [new Float32Array(this.frames), new Float32Array(this.frames)];
    for (const b of this.blocks) for (let c = 0; c < 2; c++) ch[c].set(b.data[c], b.at);
    return { numberOfChannels: 2, sampleRate: this.sampleRate, length: this.frames, getChannelData: (c) => ch[c] };
  }

  add(left, right) {
    if (!this.began) this.began = performance.now();
    if (!this.first) this.first = { wall: this.began, got: 0 };
    if (this.skipped < this.skip) {
      const k = Math.min(left.length, this.skip - this.skipped);
      this.skipped += k;
      if (k === left.length) return;
      left = left.subarray(k);
      right = right.subarray(k);
      this.first = { wall: performance.now(), got: this.got }; // speed() counts from here
    }
    const n = Math.min(left.length, this.frames - this.got);
    if (n <= 0) return;
    this.blocks.push({ at: this.got, data: n === left.length ? [left, right] : [left.subarray(0, n), right.subarray(0, n)] });
    this.got += n;
    const now = performance.now();
    this.marks.push({ wall: now, got: this.got });
    while (this.marks.length > 2 && now - this.marks[1].wall > RECENT * 1000) this.marks.shift();
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
                channelCount: 2, channelCountMode: "explicit", processorOptions: { frames: this.skip + this.frames },
              });
              tap.port.onmessage = (e) => this.add(e.data[0], e.data[1]);
              tap.connect(ctx.rawContext.destination);
            } catch (e) {
              console.warn("Streaming isn't available here, so the song renders in full first.", e);
              tap = undefined;
            }
          }
          const engine = new Engine({ retro: this.retro, output: tap, score: this.score });
          await engine.ready;
          for (const l of LAYERS) engine.setMute(l, !!this.muted[l]);
          engine.load(this.score);
          engine.start(0, this.offset - this.skip / this.sampleRate);
        } finally {
          setTimeout(release, 0); // Tone restores its global context as soon as this returns
        }
      }, (this.skip + this.frames) / this.sampleRate, 2, this.sampleRate);
      // Anything the tap didn't hand over (all of it where worklets aren't available)
      // comes from the finished render.
      const had = this.skipped + this.got;
      if (had < this.skip + this.frames) {
        const buf = out.get();
        const end = this.skip + this.frames;
        this.add(buf.getChannelData(0).slice(had, end), buf.getChannelData(1).slice(had, end));
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

// iPhones mute web audio when the ring/silent switch is on silent, though
// music and video still play. Asking for a "playback" audio session (iOS 17+)
// makes the song play like music. Older iPhones get the same effect from a
// silent looping <audio> element started in the tap.
let silentLoop;
function ignoreSilentSwitch() {
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = "playback";
      return;
    }
  } catch { /* not allowed here */ }
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) return;
  if (!silentLoop) {
    // 0.1 s of 8 kHz mono silence as a WAV.
    const n = 800, v = new DataView(new ArrayBuffer(44 + n * 2));
    const text = (at, t) => { for (let i = 0; i < t.length; i++) v.setUint8(at + i, t.charCodeAt(i)); };
    text(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); text(8, "WAVE"); text(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, n * 2, true);
    silentLoop = new Audio(URL.createObjectURL(new Blob([v], { type: "audio/wav" })));
    silentLoop.loop = true;
    silentLoop.setAttribute("playsinline", "");
  }
  silentLoop.play().catch(() => {});
}

/** Let go of the older-iPhone workaround once nothing is playing. */
function quietSession() {
  silentLoop?.pause();
}

/**
 * Plays scores through renders.
 *   onBar(bar | null)  the hour now playing, for the screen
 *   onEvent(type)      a thunder or swell is sounding
 *   onWait(waiting)    getting ready to play (true), or playing (false)
 *   onEnd(error?)      the song played through and stopped by itself (or couldn't play)
 *   onTrack(i, score)  the next song in a queue (a season suite) has begun
 */
export class Player {
  constructor({ onBar, onEvent, onWait, onEnd, onTrack } = {}) {
    Object.assign(this, { onBar, onEvent, onWait, onEnd, onTrack });
    this.tails = new Set(); // songs still ringing out after the next one has begun
    this.ctx = null;
    this.renders = []; // recent full renders, kept so Play and Download can reuse them
    this.playing = false;
    this.isWaiting = false;
    this.lag = 1; // how long a render takes to start producing audio, seconds
    this.speed = 1; // how fast renders go, audio seconds per second
  }

  /** The audio output, made or woken on first use. Call it from a click. */
  wake() {
    ignoreSilentSwitch();
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

  /**
   * The rate a render is made at: the speakers' own, or in 32-bit mode a lower one
   * (RETRO32.sampleRate) that renders about twice as fast, like the old consoles it
   * imitates. The browser resamples it as it plays.
   */
  rateFor(retro) {
    return retro ? RETRO32.sampleRate : (this.ctx?.sampleRate ?? SAMPLE_RATE);
  }

  /** A full render of the song with these settings: a recent one if it matches, else a new one. */
  render(score, retro, muted) {
    const rate = this.rateFor(retro);
    let r = this.renders.find((x) => x.matches(score, retro, muted, rate));
    if (!r) {
      r = this.makeRender(score, { retro, muted, sampleRate: rate });
      this.renders = [...this.renders.slice(-1), r];
    }
    return r;
  }

  /**
   * Start rendering a song before Play is pressed, so some of it is ready by then
   * (Play and Download reuse it). Renders can't be cancelled, so only one early
   * render runs at a time: a newer request waits for it, and only the latest is kept.
   */
  prepare(score, retro, muted) {
    this.prepared = score;
    if (this.playing) return;
    const want = (this.wanted = { score, retro, muted: { ...muted } });
    clearTimeout(this.prepTimer);
    const go = () => {
      if (this.wanted !== want || this.playing) return;
      const busy = this.renders.find((r) => !r.done);
      if (busy) busy.promise.then(go);
      else this.render(score, retro, muted);
    };
    this.prepTimer = setTimeout(go, PREPARE_DELAY * 1000);
  }

  /**
   * Play `score`, then each score in `queue` in turn (a season suite), each
   * starting as the one before rings out. `track` is the first one's number.
   */
  play(score, { retro = false, muted = {}, queue = [], track = 0 } = {}) {
    if (this.playing) this.stop();
    this.wanted = null;
    this.wake();
    this.queue = [...queue];
    this.track = track;
    this.score = score;
    this.retro = retro;
    this.muted = { ...muted };
    this.cues = cueTimes(score);
    this.t0 = null; // the context time (seconds) where the song's first frame plays
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
    this.dropTails();
    if (this.next) this.drop(this.next);
    this.active = this.next = null;
    quietSession();
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
    if (!this.playing && changed && this.prepared) this.prepare(this.prepared, retro, muted);
    if (!this.playing || !changed) return;
    clearTimeout(this.debounce); // a few quick taps make one new render
    this.debounce = setTimeout(() => this.rerender(), 250);
  }

  rerender() {
    if (!this.playing) return;
    if (this.t0 == null) {
      // Not started yet: start over (keeping the rest of a suite).
      this.play(this.score, { retro: this.retro, muted: this.muted, queue: this.queue, track: this.track });
      return;
    }
    // Start the new render about where the song will be when its audio is ready,
    // allowing for the lead-in it renders first.
    const soon = this.position() + this.lag + LEAD / Math.max(1, this.speed);
    const offset = soon + preRoll(this.score, soon) / Math.max(0.5, this.speed);
    if (offset > this.cues.end - 1) return; // nearly over anyway
    if (this.next) this.drop(this.next);
    this.next = this.stream(this.makeRender(this.score, { retro: this.retro, muted: this.muted, offset, sampleRate: this.rateFor(this.retro) }));
  }

  makeRender(score, options) {
    return new Render(score, options);
  }

  /** Seconds into the song that are reaching the speakers now. */
  position() {
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return (this.ctx.currentTime - latency) - this.t0;
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
    if (!this.playing || (st !== this.active && st !== this.next && !this.tails.has(st))) return;
    const r = st.render;
    const sr = r.sampleRate;
    const offF = Math.round(r.offset * sr);
    if (r.lag != null && st === this.next) this.lag = r.lag; // a render from partway, like the next one will be
    this.speed = r.speed() ?? this.speed;
    // Once this song is fully rendered, get the next one in the queue ready.
    if (st === this.active && r.done && this.queue.length) this.render(this.queue[0], this.retro, this.muted);
    if (!st.live) {
      if (r.error) {
        if (st === this.next) { this.drop(st); this.next = null; return; } // keep playing as it was
        this.finish(r.error);
        return;
      }
      const now = this.ctx.currentTime + MARGIN;
      if (st === this.active) {
        if (!r.ready(0)) return;
        this.t0 = now;
        this.waiting(false);
      } else {
        // A new render taking over: as soon as it can, but not before it begins.
        // Frames here are this render's own, which may differ from the playing one's.
        const from = Math.max(Math.round((now - this.t0) * sr), offF) - offF;
        if (!r.ready(from)) return;
        st.from = from;
        this.splice(st, this.t0 + (offF + from) / sr);
      }
      st.live = true;
      st.scheduled = st.from;
    }
    // A song ringing out under the next one keeps its own start frame.
    const tail = this.tails.has(st);
    for (; st.block < r.blocks.length; st.block++) {
      const b = r.blocks[st.block];
      const end = b.at + b.data[0].length;
      if (end <= st.scheduled) continue;
      const start = Math.max(b.at, st.scheduled);
      let when = (tail ? st.t0 : this.t0) + (offF + start) / sr; // seconds
      const late = this.ctx.currentTime + 0.02 - when;
      if (late > 0 || (st.stalled && st === this.active)) {
        if (tail) break; // too late to matter: it's fading out under the next song
        // The render fell behind. Pause here once, rather than stuttering block by
        // block, and carry on when there's enough in hand to reach the end.
        if (!st.stalled) {
          st.stalled = true;
          if (st === this.active) this.waiting(true);
        }
        if (!r.ready(start, RESUME_LEAD)) break;
        st.stalled = false;
        this.t0 = this.ctx.currentTime + MARGIN - (offF + start) / sr;
        when = this.t0 + (offF + start) / sr;
        if (st === this.active) this.waiting(false);
      }
      const buf = this.ctx.createBuffer(2, end - start, sr);
      for (let c = 0; c < 2; c++) buf.getChannelData(c).set(b.data[c].subarray(start - b.at));
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(st.gain);
      src.onended = () => { st.sources.delete(src); src.disconnect(); };
      src.start(when);
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
    const st = this.active;
    if (st && st.live && !st.stalled && !st.render.done && this.t0 != null) {
      // Played everything that has arrived and the render hasn't caught up: pause.
      const at = Math.round((this.ctx.currentTime - this.t0 - st.render.offset) * st.render.sampleRate);
      if (at >= st.scheduled) {
        st.stalled = true;
        this.waiting(true);
      }
    }
    if (st?.stalled) this.pump(st);
    if (this.t0 != null && !this.active?.stalled) {
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
      if (this.queue.length && pos >= c.end - SUITE.overlapSec) {
        this.advance();
      } else if (pos >= c.end) {
        this.finish();
        return;
      }
    }
    this.timer = setTimeout(() => this.loop(), 40);
  }

  /** The next song in the queue takes over while this one rings out. */
  advance() {
    const old = this.active;
    old.t0 = this.t0;
    this.tails.add(old);
    const left = Math.max(0, this.cues.end - this.position());
    setTimeout(() => { this.tails.delete(old); this.drop(old); }, (left + 0.5) * 1000);
    if (this.next) { this.drop(this.next); this.next = null; }
    clearTimeout(this.debounce);
    this.score = this.queue.shift();
    this.track++;
    this.cues = cueTimes(this.score);
    this.t0 = null;
    this.bar = undefined;
    this.fx = 0;
    this.onBar?.(null);
    this.onTrack?.(this.track, this.score);
    this.active = this.stream(this.render(this.score, this.retro, this.muted));
    if (!this.active.render.ready(0)) this.waiting(true);
  }

  dropTails() {
    for (const st of this.tails) this.drop(st);
    this.tails.clear();
  }

  finish(error) {
    this.playing = false;
    quietSession();
    clearTimeout(this.debounce);
    this.dropTails();
    for (const st of [this.active, this.next]) if (st) this.drop(st);
    this.active = this.next = null;
    this.waiting(false);
    this.onBar?.(null);
    this.onEnd?.(error);
  }

  /**
   * While waiting to start or resume: { seconds, fraction } for a countdown and a
   * progress fill, either null until the render's speed is known. Null when not waiting.
   */
  waitInfo() {
    const st = this.active;
    if (!this.isWaiting || !st) return null;
    const secs = st.render.waitFor(st.stalled ? st.scheduled : 0, st.stalled ? RESUME_LEAD : LEAD);
    const waited = (performance.now() - this.waitSince) / 1000;
    return { seconds: secs, fraction: secs == null ? null : Math.min(1, waited / Math.max(0.001, waited + secs)) };
  }

  waiting(on) {
    if (this.isWaiting === on) return;
    if (on) this.waitSince = performance.now();
    this.isWaiting = on;
    this.onWait?.(on);
  }
}
