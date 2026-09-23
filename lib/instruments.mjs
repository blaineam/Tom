// Instruments: each returns a mono Float32Array. `r` is a seeded rng (for
// noise), `m` a MIDI note, `dur` seconds. Ported from the Python prototype
// that scored the fall-2026 Shorts, so the styles sound the same.
import {
  SR, samples, midiHz, saw, square, sine, tri, noise, adsr, expdec,
  mul, scale, addInto, lowpass, highpass,
} from './dsp.mjs';

// ─── Drums ──────────────────────────────────────────────────────────────────

export function kick(r, g = 1) {
  const n = samples(0.35), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (45 + 110 * Math.exp(-t / 0.04)) / SR;
    out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.12);
  }
  const click = mul(highpass(noise(n, r), 3000), expdec(n, 0.004));
  return scale(addInto(out, click, 0.3), g);
}

export function snare(r, tone = 190, g = 1, tail = 0.12) {
  const n = samples(0.3);
  const nz = mul(highpass(noise(n, r), 1200), expdec(n, tail));
  const body = mul(sine(n, tone), expdec(n, 0.05));
  return scale(addInto(scale(nz, 0.6), body, 0.5), g);
}

export function clap(r, g = 1) {
  const n = samples(0.3), out = new Float32Array(n);
  [0, 0.011, 0.022].forEach((off, k) => {
    const i0 = samples(off), m = n - i0;
    const burst = mul(highpass(noise(m, r), 900), expdec(m, k < 2 ? 0.012 : 0.09));
    for (let i = 0; i < m; i++) out[i0 + i] += burst[i];
  });
  return scale(lowpass(out, 7000), 0.7 * g);
}

export function hat(r, g = 1, open = false) {
  const n = samples(open ? 0.25 : 0.06);
  return scale(mul(highpass(noise(n, r), 7000), expdec(n, open ? 0.08 : 0.015)), 0.35 * g);
}

export function shaker(r, g = 1) {
  const n = samples(0.09), e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = Math.sin((i / n) * Math.PI) ** 2;
  return scale(mul(highpass(noise(n, r), 5000), e), 0.18 * g);
}

export function crash(r, g = 1) {
  const n = samples(2.2);
  return scale(mul(highpass(noise(n, r), 5000), expdec(n, 0.7)), 0.25 * g);
}

/** Rising filtered-noise swell for builds. */
export function riser(r, dur) {
  const n = samples(dur), out = new Float32Array(n), seg = samples(0.05), src = noise(n, r);
  for (let i = 0; i < n; i += seg) {
    const fc = 400 + 7000 * (i / n) ** 2;
    const chunk = highpass(lowpass(src.subarray(i, i + seg), fc * 1.6), fc);
    for (let k = 0; k < chunk.length; k++) out[i + k] = chunk[k] * ((i + k) / n) ** 2 * 0.35;
  }
  return out;
}

// ─── Pitched ────────────────────────────────────────────────────────────────

/** Karplus–Strong plucked string. */
export function pluck(r, m, dur, bright = 0.5) {
  const n = samples(dur), p = Math.max(2, Math.round(SR / midiHz(m)));
  const buf = new Float32Array(p); for (let i = 0; i < p; i++) buf[i] = r.noise();
  const out = new Float32Array(n), k = 0.5 + 0.49 * bright;
  for (let i = 0; i < n; i++) {
    const v = buf[i % p]; out[i] = v;
    buf[i % p] = i >= p ? k * v + (1 - k) * buf[(i + 1) % p] : v * 0.996;
  }
  return scale(lowpass(out, 6000), 0.8);
}

export function supersaw(m, dur, fc = 3000, voices = 5) {
  const n = samples(dur), s = new Float32Array(n);
  for (let v = 0; v < voices; v++) addInto(s, saw(n, midiHz(m) * (1 + (v - (voices >> 1)) * 0.006), v / voices), 1 / voices);
  return mul(lowpass(s, fc), adsr(n, 0.03, 0.2, 0.8, 0.15));
}

/** Two-operator FM electric piano. */
export function epiano(m, dur) {
  const n = samples(dur), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, idx = 1.8 * Math.exp(-t / 0.35);
    out[i] = Math.sin(2 * Math.PI * f * t + idx * Math.sin(2 * Math.PI * f * t));
  }
  return scale(mul(out, adsr(n, 0.004, 0.6, 0.35, 0.2)), 0.5);
}

export function marimba(m, dur = 0.5) {
  const n = samples(dur), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.28)
      + 0.35 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t / 0.05)
      + 0.1 * Math.sin(2 * Math.PI * f * 9.2 * t) * Math.exp(-t / 0.02);
  }
  return scale(out, 0.6);
}

export function bell(m, dur = 1.2) {
  const n = samples(dur), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = Math.sin(2 * Math.PI * f * t + 2.5 * Math.exp(-t / 0.3) * Math.sin(2 * Math.PI * f * 3.5 * t)) * Math.exp(-t / 0.45);
  }
  return scale(out, 0.35);
}

export function sqlead(m, dur, duty = 0.25) {
  const n = samples(dur);
  return scale(mul(lowpass(square(n, midiHz(m), duty), 5000), adsr(n, 0.002, 0.05, 0.5, 0.03)), 0.25);
}

export function tribass(m, dur) {
  const n = samples(dur);
  return scale(mul(tri(n, midiHz(m)), adsr(n, 0.002, 0.05, 0.8, 0.02)), 0.5);
}

export function sawbass(m, dur, fc = 900) {
  const n = samples(dur), f = midiHz(m);
  const s = addInto(saw(n, f), square(n, f / 2), 0.5);
  return scale(mul(lowpass(s, fc), adsr(n, 0.003, 0.1, 0.7, 0.04)), 0.4);
}

export function subbass(m, dur) {
  const n = samples(dur);
  return scale(mul(sine(n, midiHz(m)), adsr(n, 0.01, 0.1, 0.9, 0.06)), 0.55);
}

export function pad(notes, dur, fc = 1800) {
  const n = samples(dur), s = new Float32Array(n);
  for (const m of notes) for (const dt of [-0.004, 0, 0.005]) addInto(s, saw(n, midiHz(m) * (1 + dt), Math.abs(dt) * 50), 1);
  return scale(mul(lowpass(s, fc), adsr(n, 0.3, 0.3, 0.8, 0.4)), 1 / (3 * notes.length));
}

/** Detuned saw lead with delayed vibrato — the synthwave hook voice. */
export function lead(m, dur) {
  const n = samples(dur), f0 = midiHz(m), freq = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, depth = Math.min(1, Math.max(0, (t - 0.18) / 0.25)) * 0.004;
    freq[i] = f0 * (1 + depth * Math.sin(2 * Math.PI * 5.5 * t));
  }
  const s = new Float32Array(n);
  for (const d of [-0.005, 0, 0.006]) {
    const fd = freq.map((v) => v * (1 + d));
    addInto(s, saw(n, fd), 1 / 3);
  }
  return scale(mul(lowpass(s, 3800), adsr(n, 0.01, 0.15, 0.75, 0.08)), 0.3);
}

/** Registry used by styles and the MIDI exporter (General MIDI programs). */
export const VOICES = {
  pluck: { gm: 25 }, supersaw: { gm: 81 }, epiano: { gm: 4 }, marimba: { gm: 12 },
  bell: { gm: 14 }, sqlead: { gm: 80 }, tribass: { gm: 38 }, sawbass: { gm: 38 },
  subbass: { gm: 38 }, pad: { gm: 89 }, lead: { gm: 81 },
};
