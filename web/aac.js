// Playback without Web Audio. Safari in Lockdown Mode has no AudioContext and
// won't play WAV, but its <audio> element plays AAC, and WebCodecs'
// AudioEncoder still encodes it. So there a rendered song is encoded to AAC and
// handed to an <audio> element. Each AAC frame gets a 7-byte ADTS header, which
// is the whole container: no MP4 muxer needed.

/** Whether an <audio> element here plays WAV (false in Lockdown Mode). */
export const wavPlayable = new Audio().canPlayType('audio/wav') !== '';
/** Whether the page can play rendered audio through Web Audio. */
export const webAudio = typeof AudioContext === 'function';
/** Whether this browser can encode AAC for the <audio> fallback. */
export const aacEncodable = typeof AudioEncoder === 'function' && typeof AudioData === 'function';

// The encoder starts every stream with this many samples of priming, which an
// ADTS stream keeps: the music begins this late on the element's clock.
const PRIMING = 2112;
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const CHUNK = 44100; // frames per AudioData handed to the encoder

/**
 * Encode stereo PCM as an ADTS AAC-LC stream.
 * @returns {Promise<{ blob: Blob, offset: number }>} offset = seconds of priming before the music
 */
export async function encodeAac(L, R, sampleRate, bitrate = 192000) {
  const rateIndex = RATES.indexOf(sampleRate);
  if (rateIndex < 0) throw new Error(`AAC can't carry a ${sampleRate} Hz song`);
  const frames = [];
  let failed = null;
  const encoder = new AudioEncoder({
    output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); frames.push(b); },
    error: (e) => { failed = e; },
  });
  encoder.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate });
  for (let at = 0; at < L.length; at += CHUNK) {
    const n = Math.min(CHUNK, L.length - at);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(at, at + n), 0);
    data.set(R.subarray(at, at + n), n);
    encoder.encode(new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(at / sampleRate * 1e6), data }));
  }
  await encoder.flush();
  encoder.close();
  if (failed) throw failed;

  const parts = frames.map((f) => {
    const len = f.length + 7, out = new Uint8Array(len);
    // syncword, MPEG-4, no CRC · AAC-LC (profile 1), rate index, 2 channels · frame length · buffer fullness 0x7FF
    out[0] = 0xFF; out[1] = 0xF1;
    out[2] = (1 << 6) | (rateIndex << 2);
    out[3] = (2 << 6) | (len >> 11);
    out[4] = (len >> 3) & 0xFF;
    out[5] = ((len & 7) << 5) | 0x1F;
    out[6] = 0xFC;
    out.set(f, 7);
    return out;
  });
  return { blob: new Blob(parts, { type: 'audio/aac' }), offset: PRIMING / sampleRate };
}
