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

  hiphop: {
    name: 'Hip-Hop', blurb: 'Boom-bap drums with swung hats, a sliding 808, dusty keys and a breathy flute hook.',
    mode: 'minor', key: 'C', bpm: 90, swing: 0.12, color: '#e256a8', sevenths: true,
    progressions: { default: '1-6-4-5', verse: '1-6', chorus: '6-4-1-5', build: '4-5', break: '1-6', intro: '1-6', outro: '1-6' },
    leadVoice: (m, d, r) => I.flute(r, m, d), leadGain: 0.75,
    bellVoice: (m, d) => I.bell(m, d), bellGain: 0.45,
    counterVoice: (m, d) => I.epiano(m, Math.max(d, 0.3)), counterGain: 0.35,
    pad: (ctx, ch, t, dur) => ch.forEach((m, k) => ctx.play('pad', 'epiano', m, t + k * 0.01, I.epiano(m, dur * 0.95), 0.3, (k - 1.5) * 0.25)),
    arp: (ctx, ch, t, beats, beat) => { // sparse keys stabs on the off-beats
      for (let q = 0; q < beats; q += 2) ctx.play('arp', 'epiano', ch[2] + 12, t + (q + 1.5) * beat + ctx.swing, I.epiano(ch[2] + 12, beat * 0.4), 0.2, 0.3);
    },
    // The 808 follows the kick pattern, sustaining until the next hit.
    bass: (ctx, ch, t, beats, beat) => {
      const m = fold(ch[0], 28, 39);
      const hits = [0, 1.75, 2.5];
      for (let b = 0; b < beats; b += 4) {
        const live = hits.filter((h) => b + h < beats);
        live.forEach((h, k) => {
          const end = k + 1 < live.length ? live[k + 1] : Math.min(4, beats - b);
          ctx.play('bass', 'eight08', m, t + (b + h) * beat, I.eight08(m, (end - h) * beat * 0.95), 0.8);
        });
      }
    },
    drums: (ctx, t, beat, level) => {
      const sw = ctx.swing;
      const at = (q) => t + q * beat;
      if (level === 'full') {
        for (const q of [0, 1.75, 2.5]) ctx.drum('kick', at(q), 0.95);
        for (const q of [1, 3]) { ctx.drum('snare', at(q), 0.75, { tone: 200, tail: 0.14 }); ctx.drum('clap', at(q), 0.45); }
        for (let e = 0; e < 8; e++) ctx.drum('hat', at(e / 2) + (e % 2 ? sw : 0), e % 2 ? 0.28 : 0.4);
        ctx.drum('hat', at(3.75) + sw / 2, 0.18); // ghost
      } else if (level === 'light') {
        for (const q of [0, 2.5]) ctx.drum('kick', at(q), 0.8);
        for (const q of [1, 3]) ctx.drum('snare', at(q), 0.5, { tone: 200, tail: 0.14 });
        for (let q = 0; q < 4; q++) ctx.drum('hat', at(q), 0.3);
      } else if (level === 'half') {
        ctx.drum('kick', at(0), 0.8); ctx.drum('snare', at(2), 0.55, { tone: 200, tail: 0.14 });
        for (let q = 0; q < 4; q++) ctx.drum('hat', at(q), 0.25);
      }
    },
    hitVoice: (ctx, ch, t, dur) => {
      ch.forEach((m, k) => ctx.play('pad', 'epiano', m, t + k * 0.02, scale(I.epiano(m, dur), 1.3), 0.45, (k - 1.5) * 0.3));
      ctx.play('bass', 'eight08', fold(ch[0], 28, 39), t, I.eight08(fold(ch[0], 28, 39), dur), 0.8);
    },
    snareReverb: { size: 0.4, mix: 0.15 },
    hall: { size: 0.5, mix: 0.1 },
  },

  rock: {
    name: 'Rock', blurb: 'Distorted power chords (palm-muted verses, open choruses), driving bass, a roomy kit with tom fills, and a lead guitar hook.',
    mode: 'major', key: 'E', bpm: 124, color: '#7d8ea3',
    progressions: { default: '1-5-6-4', verse: '1-4-1-5', chorus: '4-5-1-6', build: '4-5', break: '6-4-1-5', intro: '1-4', outro: '4-5-1-1' },
    leadVoice: (m, d) => I.leadGuitar(m, d), leadGain: 0.8,
    bellVoice: (m, d) => I.leadGuitar(m + 12, Math.min(d, 0.5)), bellGain: 0.35,
    counterVoice: (m, d) => I.leadGuitar(m - 12, d), counterGain: 0.35,
    // Power chords: root, fifth, octave — thirds would turn to mud under distortion.
    pad: (ctx, ch, t, dur) => {
      const pc = power(ch);
      if ((ctx.energy ?? 0.5) >= 0.8) { // open, ringing chords: hit on 1 and the "and" of 2 each bar
        for (let b = 0; b < dur - 1e-6; b += 4 * ctx.beat) {
          ctx.play('pad', 'guitar', pc, t + b, I.guitar(pc, Math.min(1.5 * ctx.beat, dur - b)), 0.5, -0.35);
          ctx.play('pad', 'guitar', pc, t + b + 1.5 * ctx.beat, I.guitar(pc, Math.min(2.5 * ctx.beat, dur - b - 1.5 * ctx.beat)), 0.5, 0.35);
        }
      } else { // palm-muted eighth-note chugs
        for (let k = 0; k < Math.round(dur / (ctx.beat / 2)); k++) ctx.play('pad', 'guitar', pc, t + k * ctx.beat / 2, I.guitar(pc, ctx.beat / 2, { mute: true }), 0.45, k % 2 ? 0.3 : -0.3);
      }
    },
    arp: (ctx, ch, t, beats, beat) => { // a clean-ish picked riff on top in quiet sections
      const up = [ch[0], ch[2], ch[0] + 12, ch[2]];
      for (let k = 0; k < beats * 2; k++) { const m = fold(up[k % 4], 52, 71); ctx.play('arp', 'pluck', m, t + k * beat / 2, I.pluck(ctx.rng('riff'), m, beat, 0.4), 0.3, 0.4); }
    },
    bass: (ctx, ch, t, beats, beat) => {
      const m = fold(ch[0], 28, 40);
      for (let k = 0; k < beats * 2; k++) ctx.play('bass', 'sawbass', m, t + k * beat / 2, I.sawbass(m, beat / 2 * 0.85, 1200), 0.75);
    },
    drums: (ctx, t, beat, level) => {
      const at = (q) => t + q * beat;
      const fillBar = level === 'full' && ctx.bar % 4 === 3;
      if (level === 'full') {
        for (const q of fillBar ? [0, 1] : [0, 2, 2.5]) ctx.drum('kick', at(q), 0.95);
        ctx.drum('snare', at(1), 0.85, { tone: 180, tail: 0.2 });
        if (!fillBar) ctx.drum('snare', at(3), 0.85, { tone: 180, tail: 0.2 });
        for (let e = 0; e < (fillBar ? 4 : 8); e++) ctx.drum('hat', at(e / 2), e % 2 ? 0.3 : 0.45, { open: (ctx.energy ?? 0) >= 0.8 && e % 4 === 2 });
        if (fillBar) { // tom fill down the kit across beats 3–4
          const toms = [220, 220, 180, 180, 150, 150, 120, 120];
          toms.forEach((tone, k) => ctx.drum('tom', at(2 + k / 4), 0.7 + k * 0.03, { tone }));
        }
      } else if (level === 'light') {
        ctx.drum('kick', at(0), 0.8); ctx.drum('kick', at(2), 0.7);
        for (const q of [1, 3]) ctx.drum('snare', at(q), 0.55, { tone: 180, tail: 0.2 });
        for (let q = 0; q < 4; q++) ctx.drum('hat', at(q), 0.35);
      } else if (level === 'half') {
        ctx.drum('kick', at(0), 0.8); ctx.drum('snare', at(2), 0.7, { tone: 180, tail: 0.2 });
        for (let q = 0; q < 4; q++) ctx.drum('hat', at(q), 0.3);
      }
    },
    hitVoice: (ctx, ch, t, dur) => {
      const pc = power(ch);
      ctx.play('pad', 'guitar', pc, t, I.guitar(pc, dur), 0.55, -0.3);
      ctx.play('pad', 'guitar', pc, t + 0.01, I.guitar(pc, dur), 0.55, 0.3);
      ctx.play('bass', 'sawbass', fold(ch[0], 28, 40), t, I.sawbass(fold(ch[0], 28, 40), dur, 1200), 0.7);
    },
    snareReverb: { size: 0.65, mix: 0.3 },
    hall: { size: 0.55, mix: 0.12 },
  },

  reggae: {
    name: 'Reggae', blurb: 'One-drop drums, guitar skank on 2 and 4, organ bubble, a deep dub bass and a melodica lead with dub echo.',
    mode: 'major', key: 'G', bpm: 76, swing: 0.08, color: '#2fbf71',
    progressions: { default: '1-4', verse: '1-4', chorus: '1-5-6-4', build: '4-5', break: '1-4', intro: '1-4', outro: '1-4' },
    leadVoice: (m, d, r) => I.melodica(r, m, d), leadGain: 0.8,
    bellVoice: (m, d) => I.bell(m, d), bellGain: 0.4,
    counterVoice: (m, d) => I.organ([m], Math.max(d, 0.2)), counterGain: 0.35,
    // Skank on beats 2 and 4, bubble organ on every off-beat eighth.
    pad: (ctx, ch, t, dur) => {
      const v = ch.map((m) => fold(m, 60, 76)).sort((a, b) => a - b);
      for (let q = 0; q < Math.round(dur / ctx.beat); q++) {
        const tq = t + q * ctx.beat;
        if (q % 2 === 1) ctx.play('pad', 'chop', v, tq, I.chop(v), 0.6, 0.35);
        ctx.play('pad', 'organ', v, tq + ctx.beat / 2 + ctx.swing, I.organ(v, ctx.beat * 0.3), 0.35, -0.3);
      }
    },
    arp: () => {}, // skank + bubble already carry the harmony
    // Bass that breathes: leans on the root and fifth, leaves the "one" open every other bar.
    bass: (ctx, ch, t, beats, beat) => {
      const root = fold(ch[0], 36, 47), fifth = root + 7, oct = root + 12;
      const bars = [
        [[0, root, 1.4], [1.5, fifth, 0.45], [2, root, 0.9], [3, oct, 0.45], [3.5, fifth, 0.45]],
        [[0.5, root, 0.9], [1.5, root, 0.45], [2, fifth, 0.9], [3, root, 0.9]],
      ];
      for (let b = 0; b < beats; b += 4) {
        const pat = bars[Math.round(t / (4 * beat) + b / 4) % 2];
        for (const [q, m, len] of pat) if (b + q < beats) ctx.play('bass', 'dubBass', m, t + (b + q) * beat, I.dubBass(m, len * beat), 0.85);
      }
    },
    // One drop: nothing on 1 — kick and rim land together on 3.
    drums: (ctx, t, beat, level) => {
      const at = (q) => t + q * beat, sw = ctx.swing;
      if (level === 'full' || level === 'light') {
        ctx.drum('kick', at(2), level === 'full' ? 0.9 : 0.7);
        ctx.drum('rim', at(2), level === 'full' ? 0.8 : 0.6);
        for (let e = 0; e < 8; e++) ctx.drum('hat', at(e / 2) + (e % 2 ? sw : 0), e % 2 ? 0.22 : 0.32);
        if (level === 'full' && ctx.bar % 4 === 3) ctx.drum('snare', at(3.5), 0.5, { tone: 210, tail: 0.1 }); // turnaround
      } else if (level === 'half') {
        ctx.drum('rim', at(2), 0.5);
        for (let q = 0; q < 4; q++) ctx.drum('hat', at(q + 0.5) + sw, 0.2);
      }
    },
    hitVoice: (ctx, ch, t, dur) => {
      const v = ch.map((m) => fold(m, 60, 76)).sort((a, b) => a - b);
      ctx.play('pad', 'organ', v, t, I.organ(v, dur), 0.5);
      ctx.play('bass', 'dubBass', fold(ch[0], 36, 47), t, I.dubBass(fold(ch[0], 36, 47), dur), 0.8);
    },
    snareReverb: { size: 0.7, mix: 0.35 },
    hall: { size: 0.65, mix: 0.2 },
  },

  edm: {
    name: 'EDM', blurb: 'Four-on-the-floor, pumping supersaw chords, off-beat house bass, 16th saw-pluck arps and a supersaw lead.',
    mode: 'minor', key: 'F', bpm: 126, color: '#18c8ff', pump: 0.85,
    progressions: { default: '1-6-3-7', verse: '1-6-3-7', chorus: '6-7-1-1', build: '4-5', break: '6-4-1-5', intro: '1-6-3-7', outro: '1-6-3-7' },
    leadVoice: (m, d) => I.supersaw(m, Math.max(d, 0.15), 5200), leadGain: 0.55,
    bellVoice: (m, d) => I.sawPluck(m + 12, Math.min(d, 0.4)), bellGain: 0.35,
    counterVoice: (m, d) => I.sawPluck(m, Math.min(d, 0.3)), counterGain: 0.3,
    pad: (ctx, ch, t, dur, fc) => {
      const v = [ch[0] - 12, ...ch];
      v.forEach((m, k) => ctx.play('pad', 'supersaw', m, t, I.supersaw(m, dur, fc ?? 3200), 0.2, (k - 1.5) * 0.35, 'pads'));
    },
    arp: (ctx, ch, t, beats, beat) => {
      const up = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1], ch[0] + 12, ch[1] + 12];
      for (let k = 0; k < beats * 4; k++) { const m = up[k % up.length] + 12; ctx.play('arp', 'sawPluck', m, t + k * beat / 4, I.sawPluck(m, beat / 4), 0.28, k % 2 ? 0.3 : -0.3, 'pads'); }
    },
    // House bass on every off-beat eighth (the kick owns the downbeats).
    bass: (ctx, ch, t, beats, beat) => {
      const m = fold(ch[0], 33, 44);
      for (let q = 0; q < beats; q++) ctx.play('bass', 'sawbass', m, t + (q + 0.5) * beat, I.sawbass(m, beat * 0.45, 900), 0.85);
    },
    drums: (ctx, t, beat, level) => {
      const at = (q) => t + q * beat;
      if (level === 'full') {
        for (let q = 0; q < 4; q++) { ctx.drum('kick', at(q), 1); ctx.drum('hat', at(q + 0.5), 0.45, { open: true }); }
        for (const q of [1, 3]) ctx.drum('clap', at(q), 0.8);
        for (let s = 0; s < 16; s++) ctx.drum('shaker', at(s / 4), s % 2 ? 0.5 : 0.3);
      } else if (level === 'light') {
        for (let q = 0; q < 4; q++) ctx.drum('kick', at(q), 0.85);
        for (let q = 0; q < 4; q++) ctx.drum('hat', at(q + 0.5), 0.3);
      } else if (level === 'half') {
        ctx.drum('kick', at(0), 0.8); ctx.drum('clap', at(2), 0.6);
      }
    },
    hitVoice: (ctx, ch, t, dur) => {
      [ch[0] - 12, ...ch, ch[0] + 12].forEach((m, k) => ctx.play('pad', 'supersaw', m, t, I.supersaw(m, dur, 4000), 0.28, (k - 2) * 0.3, 'pads'));
      ctx.play('bass', 'sawbass', fold(ch[0], 33, 44), t, I.sawbass(fold(ch[0], 33, 44), dur, 900), 0.8);
    },
    hall: { size: 0.75, mix: 0.2 },
  },
};

/** Fold a note into [lo, hi] by octaves. */
function fold(m, lo, hi) { while (m > hi) m -= 12; while (m < lo) m += 12; return m; }
/** Power chord: root, fifth, octave, voiced low like a guitar (E2–E3). */
function power(ch) { const r = fold(ch[0], 40, 51); return [r, r + 7, r + 12]; }
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
