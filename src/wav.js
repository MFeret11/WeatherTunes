// AudioBuffer → 16-bit PCM WAV file (a Blob). Pure, no Tone.js.

export function toWav(buffer) {
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const frames = buffer.length;
  const bytes = frames * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };

  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);              // fmt chunk size
  view.setUint16(20, 1, true);               // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true); // bytes per second
  view.setUint16(32, channels * 2, true);    // bytes per frame
  view.setUint16(34, 16, true);              // bits per sample
  text(36, "data");
  view.setUint32(40, bytes, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i] || 0));
      view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

/** A safe file name: "WeatherTunes - Kyoto - 2026-10-23.wav". */
export function wavName(place, date) {
  const clean = (s) => String(s ?? "").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return [`WeatherTunes`, clean(place.split(",")[0]), clean(date)].filter(Boolean).join(" - ") + ".wav";
}
