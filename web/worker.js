// Renders songs off the main thread so the UI never stutters.
import { render } from './lib/arrange.mjs';

self.onmessage = (e) => {
  const { id, bp } = e.data;
  try {
    const out = render(bp);
    self.postMessage({ id, ok: true, L: out.L, R: out.R, sampleRate: out.sampleRate, duration: out.duration, bpm: out.bpm, events: out.events }, [out.L.buffer, out.R.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
