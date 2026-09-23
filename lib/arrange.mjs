// The arranger: renders a blueprint (a song as a list of blocks) to stereo
// audio plus a log of note events (for MIDI export and the piano roll).
//
// A block says WHICH layers play (pad, arp, bass, drums, lead, …) and how the
// melody is shaped; the style says HOW each layer sounds. Same blueprint +
// same seed = the same notes everywhere (and byte-identical audio on one machine).
import {
  SR, Bus, samples, sidechain, reverb, echo, master, scale, mul, expdec,
  lowpass, highpass, noise, addInto,
} from './dsp.mjs';
import * as I from './instruments.mjs';
import { STYLES, buildRoll } from './styles.mjs';
import { SCALES, parseKey, chord, parseProgression, layoutChords, generateMelody } from './theory.mjs';
import { rng } from './rng.mjs';
import { BLOCK_TYPES, melodyDefaults } from './blueprint.mjs';

export const DEFAULT_TAIL = 2.35;

const DRUMS = {
  kick: (r) => I.kick(r),
  snare: (r, o) => I.snare(r, o.tone ?? 190, 1, o.tail ?? 0.12),
  clap: (r) => I.clap(r),
  hat: (r, o) => I.hat(r, 1, !!o.open),
  shaker: (r) => I.shaker(r),
  crash: (r) => I.crash(r),
  ride: (r) => I.ride(r),
  brush: (r) => I.brush(r),
  bassdrum: (r) => I.bassdrum(r),
  tom: (r, o) => I.tomDrum(r, o.tone ?? 120),
};

/** Resolve tempo/key/mode/scale for a blueprint. */
export function resolve(bp) {
  const style = STYLES[bp.style];
  if (!style) throw new Error(`Unknown style "${bp.style}". Try: ${Object.keys(STYLES).join(', ')}`);
  const mode = bp.mode || style.mode;
  const scaleArr = SCALES[mode];
  if (!scaleArr) throw new Error(`Unknown mode "${mode}". Try: ${Object.keys(SCALES).join(', ')}`);
  const bpm = Number(bp.bpm || style.bpm);
  return { style, mode, scale: scaleArr, root: parseKey(bp.key || style.key), bpm, beat: 60 / bpm };
}

/** Seconds each block starts at, and total length. */
export function timeline(bp) {
  const { beat } = resolve(bp);
  let t = 0;
  const starts = bp.blocks.map((b) => {
    const s = t;
    t += b.type === 'hit' ? Number(b.tail ?? bp.tail ?? DEFAULT_TAIL) : b.bars * 4 * beat;
    return s;
  });
  return { starts, duration: t };
}

/** The melody a block will play (also used by the piano roll). */
export function blockMelody(bp, blockIndex) {
  const { root, scale: S, mode } = resolve(bp);
  const b = bp.blocks[blockIndex];
  const spans = blockSpans(bp, b);
  const m = { ...melodyDefaults(b.type), ...(b.melody || {}) };
  const r = rng(`${bp.seed ?? 1}:${b.seed ?? blockIndex}:melody`);
  const base = root + 12 * (m.octave ?? 1);
  return generateMelody(r, {
    root: base, scale: mode, spans, bars: b.bars,
    register: [base, base + 12 * (m.range ?? 1) + 4],
    density: m.density, syncopation: m.syncopation, form: m.form, contour: m.contour,
  });
}

function blockSpans(bp, b) {
  const { style } = resolve(bp);
  const spec = b.progression || style.progressions[b.type] || style.progressions.default;
  return layoutChords(parseProgression(spec), b.bars);
}

export function render(bp, { onProgress } = {}) {
  const { style, scale: S, root, bpm, beat } = resolve(bp);
  const { starts, duration } = timeline(bp);
  const main = new Bus(duration), pads = new Bus(duration), snares = new Bus(duration), leads = new Bus(duration);
  const buses = { main, pads, snare: snares, leads };
  const events = [];
  const kicks = [];
  const R = rng(bp.seed ?? 1);
  const drumRng = R.fork('drums');
  const drumCache = new Map();

  const ctx = {
    beat,
    root,
    swing: (style.swing || 0) * beat * (bp.swing ?? 1),
    rng: (label) => R.fork(`${label}:${ctx.blockKey}`),
    blockKey: 0,
    /** Mix a synthesized note and log it. `midi` may be one note or a chord array. */
    play(track, voice, midi, t, sig, gain = 1, pan = 0, bus = 'main') {
      buses[bus].add(sig, t, gain, pan);
      const dur = sig.length / SR;
      for (const m of [].concat(midi)) events.push({ track, voice, midi: m, t, dur, vel: Math.min(1, gain) });
    },
    /** Drum hit from a per-render sample cache (drums are the same sample every time, like a drum machine). */
    drum(name, t, vel = 1, opts = {}) {
      const key = `${name}:${opts.tone ?? ''}:${opts.tail ?? ''}:${opts.open ?? ''}:${opts.lp ?? ''}`;
      let sig = drumCache.get(key);
      if (!sig) {
        const make = DRUMS[name];
        if (!make) throw new Error(`Unknown drum ${name}`);
        sig = make(drumRng, opts);
        if (opts.lp) sig = lowpass(sig, opts.lp);
        drumCache.set(key, sig);
      }
      buses[opts.bus || (name === 'snare' ? 'snare' : 'main')].add(sig, t, vel);
      if (name === 'kick') kicks.push(t);
      events.push({ track: 'drums', voice: name, drum: name, t, dur: 0.1, vel: Math.min(1, vel), open: !!opts.open });
    },
  };

  bp.blocks.forEach((b, bi) => {
    const t0 = starts[bi];
    ctx.blockKey = b.seed ?? bi;
    if (b.type === 'hit') { ending(ctx, bp, { style, S, root, beat }, t0, Number(b.tail ?? bp.tail ?? DEFAULT_TAIL)); onProgress?.((bi + 1) / bp.blocks.length); return; }
    const L = { ...(BLOCK_TYPES[b.type]?.layers || {}), ...(b.layers || {}) };
    const energy = b.energy ?? BLOCK_TYPES[b.type]?.energy ?? 0.5;
    const spans = blockSpans(bp, b);
    const total = b.bars * 4;
    ctx.energy = energy; ctx.blockBars = b.bars;

    spans.forEach((span, si) => {
      const ch = chord(root, S, span.degree, !!style.sevenths);
      const next = spans[si + 1] ? chord(root, S, spans[si + 1].degree, !!style.sevenths) : ch;
      const ts = t0 + span.start * beat, dur = span.beats * beat;
      const pos = span.start / total;
      const fc = L.filter === 'rise' ? 500 + 1900 * pos : L.filter === 'fall' ? 2400 - 1800 * pos : undefined;
      if (L.pad) style.pad(ctx, ch, ts, dur, fc);
      if (L.arp) style.arp(ctx, ch, ts, span.beats, beat);
      if (L.bass) style.bass(ctx, ch, ts, span.beats, beat, energy, next);
    });
    for (let k = 0; k < b.bars; k++) {
      const tb = t0 + k * 4 * beat;
      ctx.bar = k;
      if (L.drums === 'build') (style.buildRoll || buildRoll)(ctx, tb, beat, k, b.bars);
      else if (L.drums && L.drums !== 'none') style.drums(ctx, tb, beat, L.drums);
    }
    if (L.riser) main.add(I.riser(ctx.rng('riser'), b.bars * 4 * beat), t0, 1);
    if (L.crash) ctx.drum('crash', t0, 0.9);

    if (L.lead || L.bells || L.counter) {
      const mel = blockMelody(bp, bi);
      const r = ctx.rng('lead');
      for (const n of mel) {
        // Swung styles push off-beat eighths late (a triplet feel).
        const offbeat = style.swingLead && Math.abs((n.beat % 1) - 0.5) < 1e-6;
        const t = t0 + n.beat * beat + (offbeat ? ctx.swing : 0), d = n.beats * beat;
        if (L.lead) {
          ctx.play('lead', 'lead', n.midi, t, style.leadVoice(n.midi, d, r), style.leadGain ?? 0.7, 0, 'leads');
          if (L.octaves) {
            ctx.play('lead', 'lead', n.midi + 12, t, style.leadVoice(n.midi + 12, d, r), (style.leadGain ?? 0.7) * 0.45, 0.3, 'leads');
            ctx.play('lead', 'lead', n.midi - 12, t, style.leadVoice(n.midi - 12, d, r), (style.leadGain ?? 0.7) * 0.4, -0.3, 'leads');
          }
        }
        if (L.bells) ctx.play('bells', 'bell', n.midi, t, style.bellVoice ? style.bellVoice(n.midi, d + 0.6) : I.bell(n.midi, d + 0.6), style.bellGain ?? 0.6, 0.1, 'leads');
      }
      if (L.counter) {
        const cr = rng(`${bp.seed ?? 1}:${b.seed ?? bi}:counter`);
        const counter = generateMelody(cr, {
          root: root + 12, scale: bp.mode || style.mode, spans, bars: b.bars,
          register: [root + 7, root + 19], density: 0.2, syncopation: 0.5, form: 'ABAB', contour: 'wave',
        });
        for (const n of counter) {
          const t = t0 + n.beat * beat, d = n.beats * beat;
          ctx.play('counter', 'counter', n.midi, t, style.counterVoice(n.midi, d, r), style.counterGain ?? 0.4, -0.2, 'leads');
        }
      }
    }
    onProgress?.((bi + 1) / bp.blocks.length);
  });

  // ── mix ──
  const sc = sidechain(main.n, kicks, beat);
  main.mixIn(pads, sc);
  const sr = style.snareReverb || { size: 0.5, mix: 0.2 };
  const [sL, sR] = reverb(snares.L, snares.R, sr);
  addInto(main.L, sL); addInto(main.R, sR);
  const [lL, lR] = reverb(echo(leads.L, beat * 0.75), echo(leads.R, beat * 0.75 + 0.012), { size: 0.75, mix: 0.3 });
  addInto(main.L, lL); addInto(main.R, lR);
  if (style.crackle) {
    const cr = rng(`${bp.seed ?? 1}:crackle`), c = new Float32Array(main.n);
    for (let k = 0; k < main.n / 441; k++) c[cr.int(0, main.n - 1)] = cr.noise();
    const crackle = addInto(scale(lowpass(highpass(c, 1500), 6000), 0.25), scale(lowpass(noise(main.n, cr), 3000), 0.004));
    addInto(main.L, crackle); addInto(main.R, crackle);
  }
  const [L, Rr] = reverb(main.L, main.R, style.hall || { size: 0.7, mix: 0.15 });
  master(L, Rr, { fadeOut: Math.min(0.45, duration * 0.1) });
  return { L, R: Rr, sampleRate: SR, duration, bpm, events };
}

/** Tonic hit + rising bell sparkle — the signature ending. */
function ending(ctx, bp, { style, S, root, beat }, t, tail) {
  const tonic = chord(root, S, 1);
  ctx.drum('kick', t, 0.9);
  ctx.drum('crash', t, 1.0);
  style.hitVoice(ctx, tonic, t, tail);
  ctx.play('bass', 'subbass', root - 24, t, I.subbass(root - 24, tail), 0.8);
  [...tonic, tonic[0] + 12].forEach((m, k) => {
    ctx.play('bells', 'bell', m + 12, t + 0.35 + k * beat / 2, style.bellVoice ? style.bellVoice(m + 12, 2.0) : I.bell(m + 12, 2.0), 0.4, 0.3 - k * 0.2, 'leads');
  });
}
