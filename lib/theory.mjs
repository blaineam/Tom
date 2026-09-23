// Music theory + Tom's melody generator.
//
// Melodies are randomized but *parameterized*: a phrase form (AABA, ABAB…)
// decides which bars reuse a motif, a contour (arch, rise, fall, wave) steers
// the pitch line, density sets how busy the rhythm is, and strong beats land
// on chord tones. Repeating a motif is what makes a tune hummable instead of
// a random walk — the same idea every pop hook uses.

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
};

const NOTE = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "A" → 57 (A3), "C4" → 60, 62 → 62. Bare letters land in octave 3/4 around the bass-friendly range. */
export function parseKey(k) {
  if (typeof k === 'number' || /^\d+$/.test(String(k))) return Number(k);
  const m = /^([a-g][#b]?)(-?\d)?$/i.exec(String(k).trim());
  if (!m) throw new Error(`Bad key "${k}" — use a note name like A, F#, Eb or C4`);
  const pc = NOTE[m[1].toLowerCase()];
  const oct = m[2] !== undefined ? Number(m[2]) : (pc >= 5 ? 3 : 4); // F..B → oct 3, C..E → oct 4
  return 12 * (oct + 1) + pc;
}
export const noteName = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

/** MIDI note for a scale-degree index (0-based, may be negative / beyond 7). */
export function degreeNote(root, scale, idx) {
  const L = scale.length, o = Math.floor(idx / L), d = ((idx % L) + L) % L;
  return root + scale[d] + 12 * o;
}

/** Triad (or 7th) on a 1-based scale degree. */
export function chord(root, scale, degree, sevenths = false) {
  const i = degree - 1, idx = [i, i + 2, i + 4, ...(sevenths ? [i + 6] : [])];
  return idx.map((k) => degreeNote(root, scale, k));
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };
/**
 * "1-5-6-4", "vi-IV-I-V", or "6:4,7:4,1:8" (degree:beats). Default 4 beats each.
 * Returns [{degree, beats}].
 */
export function parseProgression(spec) {
  return String(spec).split(/[\s,\-]+/).filter(Boolean).map((tok) => {
    const [d, b] = tok.split(':');
    const degree = /^\d$/.test(d) ? Number(d) : ROMAN[d.toLowerCase().replace(/[^iv]/g, '')];
    if (!degree) throw new Error(`Bad chord "${tok}" in progression "${spec}"`);
    return { degree, beats: b ? Number(b) : 4 };
  });
}

/** Expand a progression to cover `bars` bars (4/4), cycling as needed. Returns per-chord spans with beat offsets. */
export function layoutChords(prog, bars) {
  const spans = [];
  let beat = 0, k = 0;
  while (beat < bars * 4) {
    const { degree, beats } = prog[k % prog.length];
    const len = Math.min(beats, bars * 4 - beat);
    spans.push({ degree, start: beat, beats: len });
    beat += len; k++;
  }
  return spans;
}
export const chordAt = (spans, beat) => spans.find((s) => beat >= s.start && beat < s.start + s.beats) || spans[spans.length - 1];

// ─── Melody ────────────────────────────────────────────────────────────────

const CONTOURS = {
  arch: (x) => Math.sin(Math.PI * x),                 // up then home
  rise: (x) => x,                                      // climbs to the end
  fall: (x) => 1 - x,                                  // starts high, settles
  wave: (x) => 0.5 + 0.5 * Math.sin(2 * Math.PI * x),  // two humps
  flat: () => 0.5,
};
export const CONTOUR_NAMES = Object.keys(CONTOURS);

/** One bar of rhythm in eighth notes (sums to 8). density 0..1, syncopation 0..1. */
function rhythmMotif(r, density, syncopation) {
  const w = [[1, 0.3 + 1.6 * density], [2, 1.2], [3, 0.4 + 0.8 * syncopation], [4, 1.2 - density]];
  const out = [];
  let left = 8;
  if (r.chance(syncopation * 0.35)) { out.push({ dur: 1, rest: true }); left -= 1; }
  while (left > 0) {
    const d = Math.min(left, r.weighted(w.filter(([v]) => v <= left)));
    out.push({ dur: d, rest: out.length > 0 && r.chance(0.08) });
    left -= d;
  }
  return out;
}

/**
 * Generate a melody over chord spans.
 * @returns [{ beat, beats, midi }]
 */
export function generateMelody(r, {
  root, scale, spans, bars,
  register = [root + 12, root + 24],
  density = 0.5, syncopation = 0.3,
  form = 'AABA', contour = 'arch', phraseBars = 4,
}) {
  const S = SCALES[scale] || scale;
  const lo = register[0], hi = register[1];
  const shape = CONTOURS[contour] || CONTOURS.arch;
  const motifs = {}; // letter → { rhythm, steps }
  const notes = [];
  let prev = Math.round((lo + hi) / 2);

  const nearestScale = (m) => { // snap to scale
    for (let d = 0; d < 12; d++) for (const s of [m - d, m + d]) if (S.includes(((s - root) % 12 + 12) % 12)) return s;
    return m;
  };
  const chordTones = (beat) => {
    const c = chordAt(spans, beat);
    return chord(root, S, c.degree).map((n) => ((n % 12) + 12) % 12);
  };
  const nearestChordTone = (m, beat) => {
    const pcs = chordTones(beat);
    for (let d = 0; d < 12; d++) for (const s of [m - d, m + d]) if (pcs.includes(((s % 12) + 12) % 12)) return s;
    return m;
  };
  const fold = (m) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };

  for (let bar = 0; bar < bars; bar++) {
    const letter = form[bar % Math.min(phraseBars, form.length)] || 'A';
    const x = bars <= 1 ? 0.5 : bar / (bars - 1);
    const target = lo + (hi - lo) * (0.25 + 0.6 * shape(x));
    let motif = motifs[letter];
    if (!motif) { // invent it: rhythm + melodic steps guided by the contour
      const rhythm = rhythmMotif(r, density, syncopation);
      // Mostly steps, some skips, rare leaps — and every leap is answered by a
      // step back the other way (the "gap-fill" rule melodies live by).
      const steps = [];
      for (let k = 0; k < rhythm.length; k++) {
        const prevStep = steps[k - 1] ?? 0;
        steps.push(Math.abs(prevStep) >= 3
          ? -Math.sign(prevStep)
          : r.weighted([[0, 0.8], [1, 3], [-1, 3], [2, 1.4], [-2, 1.4], [3, 0.45], [-3, 0.45], [4, 0.15], [-4, 0.1]]));
      }
      motif = motifs[letter] = { rhythm, steps };
    }
    // Replay the motif: first note leans toward the contour target, later
    // notes follow the stored steps; strong beats snap to chord tones.
    let eighth = 0, m = nearestChordTone(fold(Math.round((prev * 0.6 + target * 0.4))), bar * 4);
    motif.rhythm.forEach((ev, k) => {
      const beat = bar * 4 + eighth / 2;
      if (k > 0) {
        let dir = Math.sign(motif.steps[k]);
        const size = Math.abs(motif.steps[k]);
        const walk = (d) => { let c = nearestScale(m); for (let s = 0; s < size; s++) c = stepScale(c, d, S, root); return c; };
        let cand = walk(dir);
        if (cand > hi || cand < lo) cand = walk(-dir); // bounce off the edge of the register instead of wrapping
        // gentle pull toward the contour so repeats of a motif still travel
        if (Math.abs(cand - target) > 7) cand = stepScale(cand, Math.sign(target - cand), S, root);
        if (Math.abs(cand - m) === 6) cand = stepScale(cand, Math.sign(cand - m), S, root); // no tritone leaps
        m = Math.min(hi, Math.max(lo, cand));
      }
      const strong = eighth % 4 === 0;
      if (strong) { const c = nearestChordTone(m, beat); m = c > hi || c < lo ? fold(c) : c; }
      if (!ev.rest) notes.push({ beat, beats: ev.dur / 2 * 0.95, midi: m });
      eighth += ev.dur;
    });
    prev = m;
  }
  // Cadence: last note resolves to the tonic and rings to the end of the bar.
  if (notes.length) {
    const last = notes[notes.length - 1];
    const tonic = fold(nearestTo(last.midi, root));
    const endBeat = bars * 4;
    last.midi = tonic;
    last.beats = Math.max(last.beats, endBeat - last.beat - 0.05);
  }
  // Smoothing pass: no tritone leaps, nothing wider than an octave. The final
  // tonic stays put; the note before it moves instead.
  for (let i = 1; i < notes.length; i++) {
    const isLast = i === notes.length - 1;
    const a = notes[i - 1], b = notes[i];
    let d = b.midi - a.midi;
    if (Math.abs(d) > 12) {
      if (isLast) a.midi += 12 * Math.sign(d); else b.midi -= 12 * Math.sign(d);
      d = b.midi - a.midi;
    }
    if (Math.abs(d) === 6) {
      if (isLast) a.midi = stepScale(a.midi, Math.sign(d), S, root);  // move the approach note closer
      else b.midi = stepScale(b.midi, -Math.sign(d), S, root);       // shrink the leap by a scale step
    }
  }
  return notes;
}

function stepScale(m, dir, S, root) {
  if (!dir) return m;
  let c = m + dir;
  while (!S.includes(((c - root) % 12 + 12) % 12)) c += dir;
  return c;
}
function nearestTo(m, root) {
  const pc = ((root % 12) + 12) % 12;
  let best = m;
  for (let d = 0; d < 12; d++) {
    if (((m - d) % 12 + 12) % 12 === pc) { best = m - d; break; }
    if (((m + d) % 12 + 12) % 12 === pc) { best = m + d; break; }
  }
  return best;
}
