// Sits at the end of an offline render and posts the audio to the page as it's made,
// in blocks of BLOCK frames, so playback can start before the render is finished.
// processorOptions.frames: the render's length, so the last, shorter block is sent too.

const BLOCK = 8192;

registerProcessor("wt-tap", class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frames = options.processorOptions.frames;
    this.fresh();
  }

  fresh() {
    this.buf = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    this.n = 0;
  }

  send() {
    const [l, r] = this.buf;
    const data = this.n === BLOCK ? [l, r] : [l.slice(0, this.n), r.slice(0, this.n)];
    this.port.postMessage(data, data.map((c) => c.buffer));
    this.fresh();
  }

  process(inputs, outputs) {
    const input = inputs[0];
    for (let c = 0; c < 2; c++) {
      const src = input[c] ?? input[0]; // an input with no sound can arrive with no channels
      if (src) {
        this.buf[c].set(src, this.n);
        outputs[0][c].set(src); // pass it on too, so the finished render holds the song as well
      } else this.buf[c].fill(0, this.n, this.n + 128);
    }
    this.n += 128;
    if (this.n === BLOCK || currentFrame + 128 >= this.frames) this.send();
    return true;
  }
});
