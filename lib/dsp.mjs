// DSP core: oscillators, envelopes, filters, reverb, and the stereo mix bus.
// Pure JavaScript on Float32Arrays — no dependencies, so the same engine runs
// under Node and in a browser (e.g. inside Monkr's editor later).

export const SR = 44100;
export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const TAU = Math.PI * 2;

export const samples = (secs) => Math.max(0, Math.round(secs * SR));

// ─── Oscillators (polyBLEP band-limited saw/square) ─────────────────────────

// One loop per waveform, with the polyBLEP written out in it: without a JIT
// (Safari in Lockdown Mode) a function call per sample costs more than the
// sample. Same arithmetic in the same order as a shared phasor + callback, so
// the audio is bit-identical.
//
// `freq` may be a number or a per-sample Float32Array (for vibrato/glides).

export function saw(n, freq, phase0 = 0) {
  const out = new Float32Array(n), perSample = typeof freq !== 'number';
  let ph = phase0, dt = perSample ? 0 : freq / SR, t;
  for (let i = 0; i < n; i++) {
    if (perSample) dt = freq[i] / SR;
    let v = 2 * ph - 1;
    if (ph < dt) { t = ph / dt; v -= t + t - t * t - 1; }
    else if (ph > 1 - dt) { t = (ph - 1) / dt; v -= t * t + t + t + 1; }
    out[i] = v;
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return out;
}
export function square(n, freq, duty = 0.5) {
  const out = new Float32Array(n), perSample = typeof freq !== 'number';
  let ph = 0, dt = perSample ? 0 : freq / SR, t, q;
  for (let i = 0; i < n; i++) {
    if (perSample) dt = freq[i] / SR;
    let v = ph < duty ? 1 : -1;
    if (ph < dt) { t = ph / dt; v += t + t - t * t - 1; }
    else if (ph > 1 - dt) { t = (ph - 1) / dt; v += t * t + t + t + 1; }
    q = (ph + 1 - duty) % 1;
    if (q < dt) { t = q / dt; v -= t + t - t * t - 1; }
    else if (q > 1 - dt) { t = (q - 1) / dt; v -= t * t + t + t + 1; }
    out[i] = v;
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return out;
}
export function sine(n, freq, phase0 = 0) {
  const out = new Float32Array(n), perSample = typeof freq !== 'number';
  let ph = phase0, dt = perSample ? 0 : freq / SR;
  for (let i = 0; i < n; i++) {
    if (perSample) dt = freq[i] / SR;
    out[i] = Math.sin(TAU * ph);
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return out;
}
export function tri(n, freq) {
  const out = new Float32Array(n), perSample = typeof freq !== 'number';
  let ph = 0, dt = perSample ? 0 : freq / SR;
  for (let i = 0; i < n; i++) {
    if (perSample) dt = freq[i] / SR;
    out[i] = 1 - 4 * Math.abs(ph - 0.5);
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return out;
}

export function noise(n, r) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r.noise();
  return out;
}

// ─── Envelopes & arithmetic ─────────────────────────────────────────────────

export function adsr(n, a = 0.005, d = 0.1, s = 0.6, r = 0.1) {
  const e = new Float32Array(n);
  const an = samples(a), dn = samples(d), rn = Math.min(samples(r), n);
  const relStart = n - rn;
  for (let i = 0; i < n; i++) {
    let v;
    if (i < an) v = i / an;
    else if (i < an + dn) v = 1 - (1 - s) * ((i - an) / dn);
    else v = s;
    if (i >= relStart) {
      const at = relStart <= 0 ? 1 : (relStart < an ? relStart / an : relStart < an + dn ? 1 - (1 - s) * ((relStart - an) / dn) : s);
      v = at * (1 - (i - relStart) / Math.max(1, rn));
    }
    e[i] = v;
  }
  return e;
}
export function expdec(n, tau) {
  const e = new Float32Array(n);
  const k = Math.exp(-1 / (tau * SR));
  let v = 1;
  for (let i = 0; i < n; i++) { e[i] = v; v *= k; }
  return e;
}
export function mul(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) a[i] *= b[i]; return a; }
export function scale(a, g) { for (let i = 0; i < a.length; i++) a[i] *= g; return a; }
export function addInto(a, b, g = 1) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) a[i] += b[i] * g; return a; }

// ─── Filters (RBJ biquads, Butterworth Q by default) ────────────────────────

function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float32Array(x.length);
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function coeffs(fc, q) {
  const w = TAU * Math.min(fc, SR / 2 - 200) / SR;
  return { cw: Math.cos(w), alpha: Math.sin(w) / (2 * q) };
}
export function lowpass(x, fc, q = Math.SQRT1_2) {
  const { cw, alpha } = coeffs(fc, q);
  return biquad(x, (1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}
export function highpass(x, fc, q = Math.SQRT1_2) {
  const { cw, alpha } = coeffs(fc, q);
  return biquad(x, (1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}

// ─── Reverb (Freeverb: 8 combs + 4 allpasses per channel) ───────────────────

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];

// With `mix`, the dry/wet blend is written back into `x` instead of returning
// a new wet signal. The wet sample is rounded to float32 first, exactly as if it
// had been stored, so both paths give bit-identical audio.
// Unrolled by hand, with every comb and allpass in its own local: Safari in
// Lockdown Mode runs this without a JIT, where per-sample object and iterator
// access costs more than the arithmetic. Same operations in the same order as
// the plain loop, so the audio is bit-identical.
function freeverbChannel(x, spread, room, damp, mix = null) {
  const fb = 0.7 + room * 0.28, d1 = damp * 0.4, d2 = 1 - d1;
  const out = mix == null ? new Float32Array(x.length) : x;
  const dry = mix == null ? 0 : 1 - mix;
  const c0 = new Float32Array(COMBS[0] + spread), n0 = c0.length; let i0 = 0, s0 = 0;
  const c1 = new Float32Array(COMBS[1] + spread), n1 = c1.length; let i1 = 0, s1 = 0;
  const c2 = new Float32Array(COMBS[2] + spread), n2 = c2.length; let i2 = 0, s2 = 0;
  const c3 = new Float32Array(COMBS[3] + spread), n3 = c3.length; let i3 = 0, s3 = 0;
  const c4 = new Float32Array(COMBS[4] + spread), n4 = c4.length; let i4 = 0, s4 = 0;
  const c5 = new Float32Array(COMBS[5] + spread), n5 = c5.length; let i5 = 0, s5 = 0;
  const c6 = new Float32Array(COMBS[6] + spread), n6 = c6.length; let i6 = 0, s6 = 0;
  const c7 = new Float32Array(COMBS[7] + spread), n7 = c7.length; let i7 = 0, s7 = 0;
  const a0 = new Float32Array(ALLPASSES[0] + spread), m0 = a0.length; let j0 = 0;
  const a1 = new Float32Array(ALLPASSES[1] + spread), m1 = a1.length; let j1 = 0;
  const a2 = new Float32Array(ALLPASSES[2] + spread), m2 = a2.length; let j2 = 0;
  const a3 = new Float32Array(ALLPASSES[3] + spread), m3 = a3.length; let j3 = 0;
  for (let n = 0; n < x.length; n++) {
    const input = x[n] * 0.015;
    let acc = 0, y, b;
    y = c0[i0]; s0 = y * d2 + s0 * d1; c0[i0] = input + s0 * fb; if (++i0 >= n0) i0 = 0; acc += y;
    y = c1[i1]; s1 = y * d2 + s1 * d1; c1[i1] = input + s1 * fb; if (++i1 >= n1) i1 = 0; acc += y;
    y = c2[i2]; s2 = y * d2 + s2 * d1; c2[i2] = input + s2 * fb; if (++i2 >= n2) i2 = 0; acc += y;
    y = c3[i3]; s3 = y * d2 + s3 * d1; c3[i3] = input + s3 * fb; if (++i3 >= n3) i3 = 0; acc += y;
    y = c4[i4]; s4 = y * d2 + s4 * d1; c4[i4] = input + s4 * fb; if (++i4 >= n4) i4 = 0; acc += y;
    y = c5[i5]; s5 = y * d2 + s5 * d1; c5[i5] = input + s5 * fb; if (++i5 >= n5) i5 = 0; acc += y;
    y = c6[i6]; s6 = y * d2 + s6 * d1; c6[i6] = input + s6 * fb; if (++i6 >= n6) i6 = 0; acc += y;
    y = c7[i7]; s7 = y * d2 + s7 * d1; c7[i7] = input + s7 * fb; if (++i7 >= n7) i7 = 0; acc += y;
    b = a0[j0]; a0[j0] = acc + b * 0.5; if (++j0 >= m0) j0 = 0; acc = b - acc;
    b = a1[j1]; a1[j1] = acc + b * 0.5; if (++j1 >= m1) j1 = 0; acc = b - acc;
    b = a2[j2]; a2[j2] = acc + b * 0.5; if (++j2 >= m2) j2 = 0; acc = b - acc;
    b = a3[j3]; a3[j3] = acc + b * 0.5; if (++j3 >= m3) j3 = 0; acc = b - acc;
    out[n] = mix == null ? acc : x[n] * dry + Math.fround(acc) * mix * 3;
  }
  return out;
}

/** Stereo reverb, returns new [L, R]. `size` ~0..1, `mix` wet share. */
export function reverb(L, R, { size = 0.6, damp = 0.4, mix = 0.25 } = {}) {
  const wl = freeverbChannel(L, 0, size, damp), wr = freeverbChannel(R, 23, size, damp);
  const oL = new Float32Array(L.length), oR = new Float32Array(R.length);
  for (let i = 0; i < L.length; i++) {
    oL[i] = L[i] * (1 - mix) + wl[i] * mix * 3;
    oR[i] = R[i] * (1 - mix) + wr[i] * mix * 3;
  }
  return [oL, oR];
}

/**
 * reverb() without the extra buffers: mixes into L and R in place and returns
 * them. A song-length stereo mix is ~30 MB per channel, so this matters on phones.
 */
export function reverbInPlace(L, R, { size = 0.6, damp = 0.4, mix = 0.25 } = {}) {
  freeverbChannel(L, 0, size, damp, mix);
  freeverbChannel(R, 23, size, damp, mix);
  return [L, R];
}

/** One channel of reverbInPlace() (`spread` 0 for left, 23 for right), so the two can run apart. */
export function reverbChannelInPlace(x, spread, { size = 0.6, damp = 0.4, mix = 0.25 } = {}) {
  return freeverbChannel(x, spread, size, damp, mix);
}

/** echo() in place: walks backwards so every tap still reads the dry signal. Bit-identical to echo(). */
export function echoInPlace(x, secs, feedback = 0.35, mix = 0.3) {
  const d = samples(secs), g = [1, 2, 3, 4, 5].map((k) => mix * feedback ** (k - 1));
  for (let i = x.length - 1; i >= 0; i--) {
    let v = x[i];
    for (let k = 1; k <= 5 && i >= d * k; k++) v = Math.fround(v + x[i - d * k] * g[k - 1]);
    x[i] = v;
  }
  return x;
}

/** Feedback delay (echo), in place-safe copy. */
export function echo(x, secs, feedback = 0.35, mix = 0.3) {
  const d = samples(secs), y = Float32Array.from(x);
  for (let k = 1; k <= 5; k++) {
    const g = mix * feedback ** (k - 1);
    for (let i = d * k; i < x.length; i++) y[i] += x[i - d * k] * g;
  }
  return y;
}

// ─── Mix bus ────────────────────────────────────────────────────────────────

export class Bus {
  constructor(secs) { this.n = samples(secs); this.L = new Float32Array(this.n); this.R = new Float32Array(this.n); }
  /** Mix a mono signal in at `at` seconds with gain and pan (-1..1). */
  add(sig, at, gain = 1, pan = 0) {
    const i0 = samples(at);
    if (i0 >= this.n || !sig) return;
    const th = (pan + 1) * Math.PI / 4, gl = Math.cos(th) * Math.SQRT2 * gain, gr = Math.sin(th) * Math.SQRT2 * gain;
    const m = Math.min(sig.length, this.n - i0);
    for (let i = 0; i < m; i++) { this.L[i0 + i] += sig[i] * gl; this.R[i0 + i] += sig[i] * gr; }
  }
  mixIn(other, gainCurve = null, g = 1) {
    for (let i = 0; i < this.n; i++) {
      const k = (gainCurve ? gainCurve[i] : 1) * g;
      this.L[i] += other.L[i] * k; this.R[i] += other.R[i] * k;
    }
  }
}

/** Kick-driven ducking curve: 1 everywhere, dipping after each kick time. */
export function sidechain(n, kickTimes, beat, depth = 0.65) {
  const g = new Float32Array(n).fill(1);
  const tau = beat * 0.25 * SR, len = Math.round(beat * 0.9 * SR);
  for (const t of kickTimes) {
    const i0 = samples(t);
    for (let i = 0; i < len && i0 + i < n; i++) {
      const v = 1 - depth * Math.exp(-i / tau);
      if (v < g[i0 + i]) g[i0 + i] = v;
    }
  }
  return g;
}

/** Final polish: fade in/out, normalize, gentle tanh saturation. Returns [L, R]. */
export function master(L, R, { fadeIn = 0.02, fadeOut = 0.45, drive = 1.4, ceiling = 0.89 } = {}) {
  const n = L.length, fi = samples(fadeIn), fo = samples(fadeOut);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    let f = 1;
    if (i < fi) f *= i / fi;
    if (i > n - fo) f *= ((n - i) / fo) ** 1.5;
    L[i] *= f; R[i] *= f;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh((L[i] / peak) * drive) / norm * ceiling;
    R[i] = Math.tanh((R[i] / peak) * drive) / norm * ceiling;
  }
  return [L, R];
}
