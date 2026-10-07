// Renders songs off the main thread so the UI never stutters.
import { render, renderAsync } from './lib/arrange.mjs';
import { encodeWav } from './lib/wav.mjs';

// With `parallel`, the mix's channel effects (the reverbs: most of a render
// where there's no JIT, as in Lockdown Mode) run at once on a few workers of
// their own. The audio is bit-identical to a plain render.
let pool = null, jobId = 0;
const waiting = new Map();
function fx(job) {
  pool ??= Array.from({ length: Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) }, () => {
    const w = new Worker(new URL('./fx-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { const p = waiting.get(e.data.jid); waiting.delete(e.data.jid); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.x); };
    w.onerror = (e) => { e.preventDefault?.(); for (const p of waiting.values()) p.reject(new Error(e.message || 'An effects worker stopped')); waiting.clear(); pool?.forEach((x) => x.terminate()); pool = null; };
    return w;
  });
  const jid = ++jobId;
  return new Promise((resolve, reject) => {
    waiting.set(jid, { resolve, reject });
    pool[jid % pool.length].postMessage({ jid, job }, [job.x.buffer]);
  });
}

self.onmessage = async (e) => {
  const { id, bp, radio, wav, parallel } = e.data;
  try {
    const out = parallel && typeof Worker === 'function' ? await renderAsync(bp, fx) : render(bp);
    if (radio) {
      // Radio: the pitched notes for the display, plus a ready-to-play WAV — or,
      // where WAV won't play (Lockdown Mode), the samples, for the page to encode.
      const notes = out.events.filter((n) => n.midi != null).map((n) => ({ track: n.track, midi: n.midi, t: n.t, dur: n.dur }));
      const meta = { id, ok: true, duration: out.duration, bpm: out.bpm, notes };
      if (wav) {
        const bytes = encodeWav(out.L, out.R, out.sampleRate);
        self.postMessage({ ...meta, wav: bytes }, [bytes.buffer]);
      } else {
        self.postMessage({ ...meta, L: out.L, R: out.R, sampleRate: out.sampleRate }, [out.L.buffer, out.R.buffer]);
      }
      return;
    }
    self.postMessage({ id, ok: true, L: out.L, R: out.R, sampleRate: out.sampleRate, duration: out.duration, bpm: out.bpm, events: out.events }, [out.L.buffer, out.R.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
