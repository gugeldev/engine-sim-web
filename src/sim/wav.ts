/**
 * Minimal WAV decoder used for impulse responses. Accepts PCM 8/16/24/32-bit
 * and IEEE float, any channel count (mixed down to mono), any sample rate
 * (linearly resampled). Returns 16-bit samples, which is what the
 * synthesizer expects.
 */
export function decodeWavToInt16(buffer: ArrayBuffer, targetRate = 44100): Int16Array {
  const view = new DataView(buffer);
  const tag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );

  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");

  let format = 0;
  let channels = 1;
  let sampleRate = 44100;
  let bits = 16;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      dataOffset = body;
      dataLength = Math.min(size, view.byteLength - body);
      break;
    }
    offset = body + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error("WAV has no data chunk");
  if (format !== 1 && format !== 3) throw new Error(`Unsupported WAV format ${format}`);

  const bytes = bits / 8;
  const frames = Math.floor(dataLength / (bytes * channels));
  const mono = new Float32Array(frames);

  const read = (p: number): number => {
    if (format === 3) return bits === 64 ? view.getFloat64(p, true) : view.getFloat32(p, true);
    switch (bits) {
      case 8:
        return (view.getUint8(p) - 128) / 128;
      case 16:
        return view.getInt16(p, true) / 32768;
      case 24: {
        const v = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16);
        return v / 8388608;
      }
      case 32:
        return view.getInt32(p, true) / 2147483648;
      default:
        throw new Error(`Unsupported bit depth ${bits}`);
    }
  };

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read(dataOffset + (i * channels + c) * bytes);
    mono[i] = sum / channels;
  }

  const resampled = sampleRate === targetRate ? mono : resample(mono, sampleRate, targetRate);
  const out = new Int16Array(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(resampled[i] * 32767)));
  }
  return out;
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = x - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

/** Encodes mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = 44100): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s * 32767, true);
  }
  return buffer;
}
