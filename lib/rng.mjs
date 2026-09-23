// Seeded randomness. Everything Lizard does draws from one of these, so the
// same seed + parameters always produce byte-identical audio.

/** Hash any string/number into a 32-bit seed. */
export function seedOf(v) {
  const s = String(v);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** mulberry32 — small, fast, good enough for music. */
export function rng(seed) {
  let a = seedOf(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    float: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** Pick from [[value, weight], ...]. */
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; }
      return pairs[pairs.length - 1][0];
    },
    noise: () => next() * 2 - 1,
    /** Independent child stream, so adding a layer never reshuffles another. */
    fork: (label) => rng(`${seedOf(seed)}:${label}`),
  };
  return r;
}
