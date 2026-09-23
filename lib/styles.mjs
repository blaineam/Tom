// Styles: a sound palette + how each layer plays. The arranger decides WHICH
// layers a block uses; the style decides HOW they sound. Five styles, ported
// from the prototype that scored the fall-2026 Shorts.
//
// Layer hooks receive `ctx` (see arrange.mjs) and play through ctx.play /
// ctx.drum, which both synthesize and log MIDI events.
import * as I from './instruments.mjs';
import { scale, mul, expdec, samples } from './dsp.mjs';

const arpOf = (ch) => [...ch, ch[0] + 12];

// Shared drum grids. level: 'light' | 'full' | 'half' | 'build'
function fourOnFloor(ctx, t, beat, level, { clapVoice = false, openHat = false, snareTone = 200, snareTail = 0.15, snareBus = 'snare' } = {}) {
  if (level === 'half') { ctx.drum('kick', t, 0.8); ctx.drum('hat', t + beat * 2.5, 0.25); return; }
  for (let q = 0; q < 4; q++) {
    const bt = t + q * beat;
    if (level === 'full') ctx.drum('kick', bt, 0.85);
    else if (level === 'light' && q % 2 === 0) ctx.drum('kick', bt, 0.7);
    if (level === 'full' && q % 2 === 1) {
      if (clapVoice) ctx.drum('clap', bt, 0.7);
      else ctx.drum('snare', bt, 0.7, { tone: snareTone, tail: snareTail, bus: snareBus });
    }
    ctx.drum('hat', bt + beat / 2, level === 'full' ? 0.4 : 0.25, { open: openHat && q % 2 === 1 });
  }
}

/** Snare roll that tightens and rises across a build block. */
function buildRoll(ctx, t, beat, barInBlock, blockBars) {
  const steps = barInBlock < blockBars / 2 ? 8 : 16;
  for (let k = 0; k < steps; k++) {
    const frac = (barInBlock * 16 + k * (16 / steps)) / (blockBars * 16);
    ctx.drum('snare', t + k * (4 * beat) / steps, 0.35 + 0.5 * frac, { tone: 200 + 120 * frac, tail: 0.08, bus: 'snare' });
  }
}

export const STYLES = {
  synthwave: {
    name: 'Synthwave', blurb: 'Saw arps, gated reverb snare, pumping pad — night-drive neon.',
    mode: 'minor', key: 'A', bpm: 106.67, jingleBars: 3, color: '#b36bff',
    progressions: { default: '6-7-1-1', verse: '6-7-1-1', chorus: '4-6-7-7', build: '6-7', break: '6-7-1-1', intro: '6-7-1-1', outro: '6-7-1-1' },
    leadVoice: (m, d) => I.lead(m, d), leadGain: 0.8, bellGain: 0.8, counterVoice: (m, d) => I.sqlead(m, d, 0.25), counterGain: 0.6,
    pad: (ctx, ch, t, dur, fc) => ctx.play('pad', 'pad', ch, t, I.pad(ch, dur, fc ?? 2400), 0.38, 0, 'pads'),
    arp: (ctx, ch, t, beats, beat) => {
      const a = arpOf(ch);
      for (let k = 0; k < beats * 4; k++) ctx.play('arp', 'sqlead', a[k % 4] + 12, t + k * beat / 4, scale(I.sqlead(a[k % 4] + 12, beat / 4 * 0.7, 0.5), 1.2), 0.33, k % 2 ? 0.25 : -0.25);
    },
    bass: (ctx, ch, t, beats, beat, energy) => {
      for (let k = 0; k < beats * 2; k++) ctx.play('bass', 'sawbass', ch[0] - 24, t + k * beat / 2, I.sawbass(ch[0] - 24, beat / 2 * 0.85, 600 + 400 * (k % 2) + 500 * energy), 0.75);
    },
    drums: (ctx, t, beat, level) => fourOnFloor(ctx, t, beat, level, { openHat: true }),
    snareReverb: { size: 0.8, mix: 0.45 },
    hitVoice: (ctx, ch, t, dur) => ctx.play('pad', 'pad', ch, t, scale(I.pad(ch, dur, 2400), 1.5), 0.5),
  },

  pop: {
    name: 'Bright Pop', blurb: 'Plucked arps, claps and a sidechained supersaw — upbeat and friendly.',
    mode: 'major', key: 'C', bpm: 106.67, jingleBars: 3, color: '#ff8a3d',
    progressions: { default: '1:4,6:2,4:2,5:4', verse: '1-6-4-5', chorus: '4-5-1-6', build: '4-5', intro: '1-6-4-5', outro: '4-5-1-1' },
    leadVoice: (m, d, r) => I.pluck(r, m, Math.max(d, 0.4), 0.7), leadGain: 0.7, bellGain: 0.7,
    counterVoice: (m, d) => I.marimba(m, Math.max(d, 0.3)), counterGain: 0.5,
    pad: (ctx, ch, t, dur, fc) => {
      ctx.play('pad', 'supersaw', [ch[0]], t, I.supersaw(ch[0], dur, fc ?? 2600), 0.22, -0.3, 'pads');
      ch.slice(1).forEach((m) => ctx.play('pad', 'supersaw', [m], t, I.supersaw(m, dur, fc ?? 2600), 0.18, 0.3, 'pads'));
    },
    arp: (ctx, ch, t, beats, beat) => {
      const a = arpOf(ch), r = ctx.rng('arp');
      for (let k = 0; k < beats * 2; k++) { const m = r.pick(a) + 12; ctx.play('arp', 'pluck', m, t + k * beat / 2, I.pluck(r, m, 0.5, 0.6), 0.5, r.float(-0.5, 0.5)); }
    },
    bass: (ctx, ch, t, beats, beat) => {
      for (let k = 0; k < beats * 2; k++) ctx.play('bass', 'sawbass', ch[0] - 24, t + k * beat / 2, I.sawbass(ch[0] - 24, beat / 2 * 0.9, 700), 0.8);
    },
    drums: (ctx, t, beat, level) => fourOnFloor(ctx, t, beat, level, { clapVoice: true }),
    hitVoice: (ctx, ch, t, dur) => ch.forEach((m, k) => ctx.play('pad', 'supersaw', [m], t, scale(I.supersaw(m, dur, 2600), 0.6), 0.5, (k - 1) * 0.4)),
  },

  chip: {
    name: 'Chiptune', blurb: 'Square-wave lead, triangle bass, noise drums — 8-bit bounce.',
    mode: 'major', key: 'C', bpm: 142.22, jingleBars: 4, color: '#3ddc84',
    progressions: { default: '1-5-6-4:2,5:2', verse: '1-5-6-4', chorus: '4-5-1-6', build: '4-5', intro: '1-5', outro: '4-5-1-1' },
    leadVoice: (m, d) => I.sqlead(m, d, 0.5), leadGain: 0.55, bellGain: 0.6,
    counterVoice: (m, d) => I.sqlead(m, d, 0.125), counterGain: 0.4,
    pad: () => {}, // chip has no pad; arps carry the harmony
    arp: (ctx, ch, t, beats, beat) => {
      for (let k = 0; k < beats * 4; k++) ctx.play('arp', 'sqlead', ch[k % 3] + 12, t + k * beat / 4, I.sqlead(ch[k % 3] + 12, beat / 4 * 0.8, 0.125), 0.25, 0.3);
    },
    bass: (ctx, ch, t, beats, beat) => {
      for (let k = 0; k < beats * 2; k++) { const m = k % 2 ? ch[0] : ch[0] - 12; ctx.play('bass', 'tribass', m, t + k * beat / 2, I.tribass(m, beat / 2 * 0.9), 0.7); }
    },
    drums: (ctx, t, beat, level) => {
      if (level === 'half') { ctx.drum('kick', t, 0.7); return; }
      for (let q = 0; q < 4; q++) {
        const bt = t + q * beat;
        if (level !== 'light' || q === 0) { if (q % 2 === 0) ctx.drum('kick', bt, 0.8); }
        if (level === 'full' && q % 2 === 1) ctx.drum('snare', bt, 0.6, { tone: 250, tail: 0.06 });
        ctx.drum('hat', bt + beat / 2, 0.45);
      }
    },
    hitVoice: (ctx, ch, t, dur) => ch.forEach((m) => ctx.play('lead', 'sqlead', m + 12, t, mul(I.sqlead(m + 12, dur, 0.5), expdec(samples(dur), 0.6)), 0.5)),
  },

  lofi: {
    name: 'Lo-fi', blurb: 'Swung FM electric piano, soft drums and vinyl crackle.',
    mode: 'major', key: 'F', bpm: 106.67, swing: 0.16, jingleBars: 3, color: '#e0b36a', sevenths: true, crackle: true,
    progressions: { default: '4:4,3:2,6:2,2:2,5:2', verse: '4-3-6-2', chorus: '2-5-1-6', build: '2-5', intro: '4-3', outro: '4-5-1-1' },
    leadVoice: (m, d) => I.epiano(m, Math.max(d, 0.3)), leadGain: 0.55, bellGain: 0.6,
    counterVoice: (m, d) => I.bell(m, Math.max(d, 0.6)), counterGain: 0.4,
    pad: (ctx, ch, t, dur) => ch.forEach((m, k) => ctx.play('pad', 'epiano', m, t + k * 0.012, I.epiano(m, dur * 0.95), 0.35, (k - 1.5) * 0.25)),
    arp: () => {}, // lo-fi keeps it sparse; the melody fills the space
    bass: (ctx, ch, t, beats, beat) => {
      ctx.play('bass', 'subbass', ch[0] - 24, t, I.subbass(ch[0] - 24, beat * 1.5), 0.8);
      if (beats > 2) ctx.play('bass', 'subbass', ch[0] - 24, t + beat * 2.5 + ctx.swing, I.subbass(ch[0] - 24, beat * 0.9), 0.6);
    },
    drums: (ctx, t, beat, level) => {
      if (level === 'half') { ctx.drum('kick', t, 0.6); return; }
      ctx.drum('kick', t, 0.8);
      if (level === 'full') { ctx.drum('kick', t + beat * 2.5 + ctx.swing, 0.6); ctx.drum('snare', t + beat, 0.5, { tone: 180, tail: 0.1, lp: 5000 }); ctx.drum('snare', t + beat * 3, 0.5, { tone: 180, tail: 0.1, lp: 5000 }); }
      for (let q = 0; q < 4; q++) { ctx.drum('hat', t + q * beat, 0.25); ctx.drum('hat', t + (q + 0.5) * beat + ctx.swing, 0.2); }
    },
    hitVoice: (ctx, ch, t, dur) => ch.forEach((m, k) => ctx.play('pad', 'epiano', m, t, scale(I.epiano(m, dur), 1.4), 0.5, (k - 1) * 0.4)),
  },

  marimba: {
    name: 'Marimba', blurb: 'Warm marimba melody, shaker and soft pad — sunny and kind.',
    mode: 'major', key: 'G', bpm: 106.67, jingleBars: 3, color: '#ffc93d',
    progressions: { default: '1-4-5-1', verse: '1-4-5-1', chorus: '4-5-1-6', build: '4-5', intro: '1-4', outro: '4-5-1-1' },
    leadVoice: (m, d) => I.marimba(m, Math.max(d, 0.5)), leadGain: 0.6, bellGain: 0.6,
    counterVoice: (m, d) => I.bell(m, Math.max(d, 0.6)), counterGain: 0.35,
    pad: (ctx, ch, t, dur, fc) => ctx.play('pad', 'pad', ch, t, I.pad(ch, dur, fc ?? 1400), 0.25, 0, 'pads'),
    arp: (ctx, ch, t, beats, beat) => { for (let k = 0; k < beats * 2; k++) ctx.play('arp', 'marimba', ch[k % 3], t + k * beat / 2, I.marimba(ch[k % 3]), 0.25, 0.4); },
    bass: (ctx, ch, t, beats, beat) => ctx.play('bass', 'subbass', ch[0] - 24, t, I.subbass(ch[0] - 24, beats * beat * 0.95), 0.5),
    drums: (ctx, t, beat, level) => {
      if (level === 'full' || level === 'light') { ctx.drum('kick', t, 0.6); ctx.drum('kick', t + 2 * beat, 0.6); }
      if (level === 'half') ctx.drum('kick', t, 0.5);
      for (let s = 0; s < 16; s++) ctx.drum('shaker', t + s * beat / 4, s % 2 ? 0.6 : 0.35);
    },
    hitVoice: (ctx, ch, t, dur) => ch.forEach((m, k) => ctx.play('lead', 'marimba', m, t, scale(I.marimba(m, dur), 1.2), 0.5, (k - 1) * 0.4)),
  },

  jazz: {
    name: 'Jazz', blurb: 'Walking upright bass, swung ride and brushes, rootless piano comping, vibes on the melody.',
    mode: 'major', key: 'Bb', bpm: 132, swing: 0.17, swingLead: true, color: '#4aa3df', sevenths: true,
    progressions: { default: '2-5-1-1', verse: '1-6-2-5', chorus: '2-5-1-6', build: '2-5', break: '4-4-3-6', intro: '2-5', outro: '2-5-1-1' },
    leadVoice: (m, d) => I.vibes(m, d), leadGain: 0.75,
    bellVoice: (m, d) => I.vibes(m + 12, d), bellGain: 0.45,
    counterVoice: (m, d) => I.piano(m, Math.max(d, 0.3)), counterGain: 0.35,
    // Rootless voicings (3-5-7-9) in the Charleston rhythm: on 1, and the "and" of 2.
    pad: (ctx, ch, t, dur) => {
      const v = jazzVoicing(ch);
      const bars = Math.max(1, Math.round(dur / (4 * ctx.beat)));
      for (let b = 0; b < bars; b++) {
        const tb = t + b * 4 * ctx.beat;
        v.forEach((m, k) => ctx.play('pad', 'piano', m, tb + k * 0.008, I.piano(m, ctx.beat * 1.3), 0.28, (k - 1.5) * 0.2));
        if (dur >= 2 * ctx.beat) v.forEach((m, k) => ctx.play('pad', 'piano', m, tb + 1.5 * ctx.beat + ctx.swing + k * 0.008, I.piano(m, ctx.beat * 0.45), 0.22, (k - 1.5) * 0.2));
      }
    },
    arp: () => {}, // the comping carries the harmony
    // Walking bass: root on the downbeat, chord tones between, a chromatic step into the next chord.
    bass: (ctx, ch, t, beats, beat, energy, next) => {
      const r = ctx.rng(`walk:${Math.round(t * 1000)}`);
      const root = low(ch[0]), target = low((next || ch)[0]);
      let m = root;
      for (let q = 0; q < beats; q++) {
        if (q === 0) m = root;
        else if (q === beats - 1) m = target + (m > target ? 1 : -1);
        else m = low(r.pick([ch[1], ch[2], ch[3] ?? ch[2], ch[0] + 12]));
        ctx.play('bass', 'upright', m, t + q * beat, I.upright(m, beat * 0.95), 0.85);
      }
    },
    drums: (ctx, t, beat, level) => {
      const sw = ctx.swing;
      const ride = level === 'half' ? [0, 2] : [0, 1, 1.5, 2, 3, 3.5];
      for (const q of ride) ctx.drum('ride', t + q * beat + (q % 1 ? sw : 0), q % 1 ? 0.55 : 0.8);
      if (level !== 'none') { ctx.drum('hat', t + beat, 0.35); ctx.drum('hat', t + 3 * beat, 0.35); }
      if (level === 'full') {
        for (let q = 0; q < 4; q++) ctx.drum('kick', t + q * beat, 0.22); // feathered
        const r = ctx.rng(`comp:${Math.round(t * 1000)}`);
        for (const q of [0.5, 1.5, 2.5, 3.5]) if (r.chance(0.3)) ctx.drum('brush', t + q * beat + sw, 0.6);
        ctx.drum('brush', t + beat, 0.45); ctx.drum('brush', t + 3 * beat, 0.45);
      }
    },
    hitVoice: (ctx, ch, t, dur) => {
      jazzVoicing([...ch, ch[0] + 11]).forEach((m, k) => ctx.play('pad', 'piano', m, t + k * 0.03, I.piano(m, dur), 0.4, (k - 1.5) * 0.25));
      ctx.play('lead', 'vibes', ch[0] + 12, t + 0.1, I.vibes(ch[0] + 12, dur), 0.5);
    },
    hall: { size: 0.6, mix: 0.18 },
  },

  orchestral: {
    name: 'Orchestral', blurb: 'Swelling strings, a french-horn melody, pizzicato, timpani and a concert-hall reverb.',
    mode: 'major', key: 'D', bpm: 92, color: '#d9534f',
    progressions: { default: '1-5-6-4', verse: '1-6-4-5', chorus: '6-4-1-5', build: '4-5', break: '6-4-1-5', intro: '1-4', outro: '4-5-1-1' },
    leadVoice: (m, d) => I.horn(m - 12, Math.max(d, 0.35)), leadGain: 0.8,
    bellVoice: (m, d) => I.celesta(m + 12, d), bellGain: 0.5,
    counterVoice: (m, d) => I.strings([m], Math.max(d, 0.4), 3400), counterGain: 0.45,
    pad: (ctx, ch, t, dur, fc) => ctx.play('pad', 'strings', [ch[0] - 12, ch[0], ch[1], ch[2]], t, I.strings([ch[0] - 12, ch[0], ch[1], ch[2]], dur, fc ?? 2600), 0.55, 0, 'pads'),
    arp: (ctx, ch, t, beats, beat) => {
      const up = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1]];
      for (let k = 0; k < beats * 2; k++) { const m = up[k % up.length] + 12; ctx.play('arp', 'pizz', m, t + k * beat / 2, I.pizz(m, beat / 2), 0.42, k % 2 ? 0.3 : -0.3); }
    },
    bass: (ctx, ch, t, beats, beat) => ctx.play('bass', 'strings', ch[0] - 24, t, I.strings([ch[0] - 24], beats * beat, 900), 0.7),
    drums: (ctx, t, beat, level) => {
      const m = low(ctx.root) - 12 >= 36 ? low(ctx.root) - 12 : low(ctx.root);
      const r = ctx.rng(`timp:${Math.round(t * 1000)}`);
      if (level === 'full') {
        ctx.drum('bassdrum', t, 0.5);
        ctx.play('timpani', 'timpani', m, t, I.timpani(r, m), 0.7);
        ctx.play('timpani', 'timpani', m + 7, t + 2 * beat, I.timpani(r, m + 7), 0.55);
      } else if (level === 'light') ctx.play('timpani', 'timpani', m, t, I.timpani(r, m, 0.7), 0.5);
      else if (level === 'half') ctx.drum('bassdrum', t, 0.35);
    },
    // Builds are a timpani roll that swells, not a snare roll.
    buildRoll: (ctx, t, beat, barInBlock, blockBars) => {
      const m = low(ctx.root), r = ctx.rng(`roll:${Math.round(t * 1000)}`);
      for (let k = 0; k < 16; k++) {
        const frac = (barInBlock * 16 + k) / (blockBars * 16);
        ctx.play('timpani', 'timpani', m, t + k * beat / 4, I.timpani(r, m, 0.4), 0.2 + 0.6 * frac);
      }
    },
    hitVoice: (ctx, ch, t, dur) => {
      ctx.play('pad', 'strings', [ch[0] - 12, ...ch, ch[0] + 12], t, I.strings([ch[0] - 12, ...ch, ch[0] + 12], dur, 3000), 0.75, 0, 'pads');
      ctx.play('lead', 'horn', ch[0], t, I.horn(ch[0], dur), 0.55);
      ctx.play('timpani', 'timpani', low(ch[0]), t, I.timpani(ctx.rng('hit'), low(ch[0])), 0.8);
    },
    hall: { size: 0.9, mix: 0.3 },
  },
};

/** Fold a note into the upright/timpani range (E1–D#3). */
function low(m) { while (m > 51) m -= 12; while (m < 40) m += 12; return m; }
/** Rootless jazz voicing: 3rd, 5th, 7th and 9th, kept around middle C. */
function jazzVoicing(ch) {
  const v = [ch[1], ch[2], ch[3] ?? ch[2] + 3, ch[0] + 14];
  return v.map((m) => { while (m > 72) m -= 12; while (m < 55) m += 12; return m; }).sort((a, b) => a - b);
}

// Shared build roll + riser, used by every style for 'build' drums.
export { buildRoll };

export const STYLE_IDS = Object.keys(STYLES);
