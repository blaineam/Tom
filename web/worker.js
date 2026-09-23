// Renders songs off the main thread so the UI never stutters.
import { render } from './lib/arrange.mjs';
import { encodeWav } from './lib/wav.mjs';

self.onmessage = (e) => {
  const { id, bp, wav } = e.data;
  try {
    const out = render(bp);
    if (wav) {
      // Radio: hand back a ready-to-play WAV plus the pitched notes for the display.
      const bytes = encodeWav(out.L, out.R, out.sampleRate);
      const notes = out.events.filter((n) => n.midi != null).map((n) => ({ track: n.track, midi: n.midi, t: n.t, dur: n.dur }));
      self.postMessage({ id, ok: true, wav: bytes, duration: out.duration, bpm: out.bpm, notes }, [bytes.buffer]);
      return;
    }
    self.postMessage({ id, ok: true, L: out.L, R: out.R, sampleRate: out.sampleRate, duration: out.duration, bpm: out.bpm, events: out.events }, [out.L.buffer, out.R.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
