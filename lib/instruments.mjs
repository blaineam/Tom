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

// ─── Jazz ───────────────────────────────────────────────────────────────────

/** Upright bass: plucked thump with a woody body. */
export function upright(m, dur) {
  const n = samples(Math.max(dur, 0.25)), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = (Math.sin(2 * Math.PI * f * t) + 0.45 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.08)) * Math.exp(-t / 0.55);
  }
  return scale(mul(lowpass(out, 900), adsr(n, 0.004, 0.05, 1, 0.06)), 0.7);
}

/** Ride cymbal: inharmonic square partials, bandpassed, with a long shimmer. */
export function ride(r, g = 1) {
  const n = samples(1.1), out = new Float32Array(n);
  for (const f of [320, 481, 562, 757, 919, 1147]) addInto(out, square(n, f), 1 / 6);
  const ping = mul(highpass(lowpass(out, 11000), 5200), expdec(n, 0.45));
  const wash = mul(highpass(noise(n, r), 7000), expdec(n, 0.25));
  return scale(addInto(ping, wash, 0.25), 0.22 * g);
}

/** Brush snare: a soft swish rather than a crack. */
export function brush(r, g = 1) {
  const n = samples(0.28), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / n; e[i] = Math.min(1, t * 12) * Math.exp(-t * 5); }
  return scale(mul(lowpass(highpass(noise(n, r), 1800), 6500), e), 0.32 * g);
}

/** Vibraphone: bar tone + a bright partial, with the motor's tremolo. */
export function vibes(m, dur) {
  const n = samples(Math.max(dur, 0.6) + 0.4), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, trem = 0.82 + 0.18 * Math.sin(2 * Math.PI * 5.2 * t);
    out[i] = (Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t / 0.15)) * Math.exp(-t / 0.9) * trem;
  }
  return scale(out, 0.42);
}

/** Warm jazz piano: soft-hammer FM with a gentle release. */
export function piano(m, dur) {
  const n = samples(dur), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, idx = 0.9 * Math.exp(-t / 0.25);
    out[i] = Math.sin(2 * Math.PI * f * t + idx * Math.sin(2 * Math.PI * f * 2 * t)) * Math.exp(-t / 1.2);
  }
  return scale(mul(lowpass(out, 3200), adsr(n, 0.003, 0.3, 0.7, 0.12)), 0.42);
}

// ─── Orchestral ─────────────────────────────────────────────────────────────

/** String ensemble: many slightly detuned bowed voices with a slow swell and vibrato. */
export function strings(notes, dur, fc = 2600) {
  const n = samples(dur), s = new Float32Array(n);
  for (const m of [].concat(notes)) {
    const f0 = midiHz(m);
    for (const [k, d] of [[0, -0.006], [1, -0.002], [2, 0.003], [3, 0.007]]) {
      const freq = new Float32Array(n);
      for (let i = 0; i < n; i++) freq[i] = f0 * (1 + d) * (1 + 0.0035 * Math.sin(2 * Math.PI * (5 + k * 0.3) * (i / SR) + k));
      addInto(s, saw(n, freq, k * 0.21), 1);
    }
  }
  return scale(mul(lowpass(lowpass(s, fc), fc * 1.4), adsr(n, 0.45, 0.3, 0.85, 0.5)), 0.9 / (4 * [].concat(notes).length));
}

/** Pizzicato: a short, round plucked string. */
export function pizz(m, dur = 0.35) {
  const n = samples(Math.max(0.25, dur)), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) + 0.1 * Math.sin(6 * Math.PI * f * t)) * Math.exp(-t / 0.13);
  }
  return scale(mul(lowpass(out, 2600), adsr(n, 0.003, 0.05, 1, 0.03)), 0.5);
}

/** French horn: round brass that swells in and blooms with vibrato. */
export function horn(m, dur) {
  const n = samples(dur), f0 = midiHz(m), freq = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, depth = Math.min(1, Math.max(0, (t - 0.25) / 0.3)) * 0.0045;
    freq[i] = f0 * (1 + depth * Math.sin(2 * Math.PI * 5 * t));
  }
  const s = addInto(saw(n, freq), square(n, freq, 0.5), 0.35);
  return scale(mul(lowpass(lowpass(s, 1500), 1900), adsr(n, 0.08, 0.2, 0.85, 0.12)), 0.6);
}

/** Timpani: a tuned drum head with a falling pitch and a soft mallet thud. */
export function timpani(r, m, g = 1) {
  const n = samples(1.6), f0 = midiHz(m), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += f0 * (1 + 0.08 * Math.exp(-t / 0.05)) / SR;
    out[i] = (Math.sin(2 * Math.PI * ph) + 0.35 * Math.sin(2 * Math.PI * ph * 1.5) * Math.exp(-t / 0.3)) * Math.exp(-t / 0.7);
  }
  const thud = mul(lowpass(noise(n, r), 400), expdec(n, 0.03));
  return scale(addInto(out, thud, 0.6), 0.6 * g);
}

/** Concert bass drum: a deep boom. */
export function bassdrum(r, g = 1) {
  const n = samples(1.4), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += (48 + 30 * Math.exp(-t / 0.06)) / SR; out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.5); }
  return scale(addInto(out, mul(lowpass(noise(n, r), 250), expdec(n, 0.08)), 0.4), 0.8 * g);
}

/** Celesta: a small, sparkly bell. */
export function celesta(m, dur = 1) {
  const n = samples(Math.max(dur, 0.8)), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t / 0.2)) * Math.exp(-t / 0.6);
  }
  return scale(out, 0.35);
}

// ─── Hip-hop ────────────────────────────────────────────────────────────────

/** 808 bass: a sine that drops into pitch, sustains, and saturates warmly. */
export function eight08(m, dur) {
  const n = samples(Math.max(dur, 0.2)), f = midiHz(m), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += f * (1 + 0.5 * Math.exp(-t / 0.03)) / SR;
    out[i] = Math.tanh(1.8 * Math.sin(2 * Math.PI * ph)) * Math.exp(-t / 1.1);
  }
  return scale(mul(out, adsr(n, 0.002, 0.05, 1, 0.05)), 0.75);
}

/** Flute: a round sine with a little breath and a delayed vibrato. */
export function flute(r, m, dur) {
  const n = samples(Math.max(dur, 0.2)), f0 = midiHz(m), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, vib = 1 + Math.min(1, Math.max(0, (t - 0.2) / 0.3)) * 0.005 * Math.sin(2 * Math.PI * 5 * t);
    ph += f0 * vib / SR;
    out[i] = Math.sin(2 * Math.PI * ph) + 0.12 * Math.sin(4 * Math.PI * ph);
  }
  const breath = mul(highpass(lowpass(noise(n, r), f0 * 3), f0 * 0.8), expdec(n, 0.25));
  return scale(mul(addInto(out, breath, 0.25), adsr(n, 0.05, 0.1, 0.85, 0.08)), 0.3);
}

// ─── Rock ───────────────────────────────────────────────────────────────────

/** Overdriven rhythm guitar: chord (usually a power chord) through a tanh amp and a cab. */
export function guitar(notes, dur, { mute = false } = {}) {
  const n = samples(dur), s = new Float32Array(n);
  for (const m of [].concat(notes)) for (const d of [-0.004, 0.004]) addInto(s, saw(n, midiHz(m) * (1 + d), Math.abs(d) * 90), 0.5);
  const env = mute ? expdec(n, 0.09) : adsr(n, 0.004, 0.4, 0.7, 0.08);
  mul(s, env);
  for (let i = 0; i < n; i++) s[i] = Math.tanh(s[i] * 5);
  return scale(highpass(lowpass(lowpass(s, mute ? 1500 : 3400), mute ? 2200 : 4800), 90), mute ? 0.4 : 0.32);
}

/** Lead guitar: singing overdrive with vibrato. */
export function leadGuitar(m, dur) {
  const n = samples(Math.max(dur, 0.15)), f0 = midiHz(m), freq = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, depth = Math.min(1, Math.max(0, (t - 0.15) / 0.2)) * 0.006;
    freq[i] = f0 * (1 + depth * Math.sin(2 * Math.PI * 5.8 * t));
  }
  const s = mul(saw(n, freq), adsr(n, 0.006, 0.2, 0.85, 0.08));
  for (let i = 0; i < n; i++) s[i] = Math.tanh(s[i] * 7);
  return scale(highpass(lowpass(lowpass(s, 3000), 4200), 200), 0.22);
}

/** Tom drum: a pitched head that drops into its note. */
export function tomDrum(r, tone = 120, g = 1) {
  const n = samples(0.45), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += tone * (1 + 0.6 * Math.exp(-t / 0.04)) / SR; out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.28); }
  return scale(addInto(out, mul(lowpass(noise(n, r), 3000), expdec(n, 0.01)), 0.3), 0.7 * g);
}

// ─── Reggae ─────────────────────────────────────────────────────────────────

/** Rimshot / cross-stick: a woody click. */
export function rim(r, g = 1) {
  const n = samples(0.12), out = mul(sine(n, 820), expdec(n, 0.018));
  return scale(addInto(out, mul(highpass(noise(n, r), 2500), expdec(n, 0.008)), 0.6), 0.55 * g);
}

/** Melodica: a reedy, slightly breathy free-reed voice. */
export function melodica(r, m, dur) {
  const n = samples(Math.max(dur, 0.15)), f0 = midiHz(m), freq = new Float32Array(n);
  for (let i = 0; i < n; i++) freq[i] = f0 * (1 + 0.003 * Math.sin(2 * Math.PI * 4.5 * (i / SR)));
  const reed = addInto(square(n, freq, 0.38), saw(n, freq), 0.4);
  const breath = mul(highpass(noise(n, r), 2000), expdec(n, 0.12));
  return scale(mul(lowpass(addInto(reed, breath, 0.15), 2400), adsr(n, 0.03, 0.1, 0.85, 0.07)), 0.28);
}

/** Organ bubble: a short drawbar chord (fundamental, octave, twelfth). */
export function organ(notes, dur) {
  const n = samples(dur), s = new Float32Array(n);
  for (const m of [].concat(notes)) { const f = midiHz(m); for (const [h, g] of [[1, 1], [2, 0.5], [3, 0.3]]) addInto(s, sine(n, f * h), g); }
  return scale(mul(s, adsr(n, 0.004, 0.05, 0.8, 0.03)), 0.35 / [].concat(notes).length);
}

/** Skank: a tight, bright, muted guitar chop. */
export function chop(notes, dur = 0.12) {
  const n = samples(dur), s = new Float32Array(n);
  for (const m of [].concat(notes)) addInto(s, saw(n, midiHz(m)), 1);
  return scale(mul(highpass(lowpass(s, 4200), 900), expdec(n, 0.045)), 0.5 / [].concat(notes).length);
}

/** Dub bass: deep, round, and a little woolly. */
export function dubBass(m, dur) {
  const n = samples(Math.max(dur, 0.1)), f = midiHz(m), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; out[i] = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t); }
  return scale(mul(lowpass(out, 380), adsr(n, 0.01, 0.1, 0.9, 0.06)), 0.8);
}

// ─── EDM ────────────────────────────────────────────────────────────────────

/** Saw pluck: a bright saw whose filter snaps shut — the house/trance arp. */
export function sawPluck(m, dur = 0.2) {
  const n = samples(Math.max(dur, 0.12)), s = addInto(saw(n, midiHz(m)), saw(n, midiHz(m) * 1.007), 1);
  // filter envelope approximated in two stages: bright attack, darker body
  const bright = mul(lowpass(s, 5000), expdec(n, 0.03)), body = mul(lowpass(s, 1400), expdec(n, 0.12));
  return scale(addInto(bright, body, 0.8), 0.28);
}

/** Registry used by styles and the MIDI exporter (General MIDI programs). */
export const VOICES = {
  pluck: { gm: 25 }, supersaw: { gm: 81 }, epiano: { gm: 4 }, marimba: { gm: 12 },
  bell: { gm: 14 }, sqlead: { gm: 80 }, tribass: { gm: 38 }, sawbass: { gm: 38 },
  subbass: { gm: 38 }, pad: { gm: 89 }, lead: { gm: 81 },
  upright: { gm: 32 }, vibes: { gm: 11 }, piano: { gm: 0 },
  strings: { gm: 48 }, pizz: { gm: 45 }, horn: { gm: 60 }, celesta: { gm: 8 },
  eight08: { gm: 38 }, flute: { gm: 73 }, guitar: { gm: 29 }, leadGuitar: { gm: 30 },
  melodica: { gm: 22 }, organ: { gm: 17 }, chop: { gm: 28 }, dubBass: { gm: 33 }, sawPluck: { gm: 81 },
};
