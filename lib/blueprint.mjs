// Blueprints: a song is a list of blocks, like Lego bricks.
//
//   { version, title, style, key, mode, bpm, seed, blocks: [
//       { id, type: 'verse', bars: 16, progression: '6-7-1-1',
//         layers: { pad, arp, bass, drums: 'full', lead, ... },
//         melody: { density, contour, form, syncopation, octave, range },
//         seed, locked } ] }
//
// Auto modes build whole songs, finish partial ones, or re-roll one block,
// always leaving locked blocks alone.
import { rng, seedOf } from './rng.mjs';
import { STYLES } from './styles.mjs';
import { CONTOUR_NAMES } from './theory.mjs';

export const LAYER_NAMES = ['pad', 'arp', 'bass', 'drums', 'lead', 'counter', 'bells', 'octaves', 'riser', 'crash', 'filter'];
export const DRUM_LEVELS = ['none', 'light', 'half', 'full', 'build'];
export const FORMS = ['AABA', 'ABAB', 'AAAB', 'ABAC', 'ABCD'];

export const BLOCK_TYPES = {
  intro:  { label: 'Intro',  color: '#5b8def', bars: 8,  energy: 0.2, layers: { pad: true, arp: true, drums: 'none', filter: 'rise' } },
  verse:  { label: 'Verse',  color: '#34c7a5', bars: 16, energy: 0.5, layers: { pad: true, arp: true, bass: true, drums: 'full', counter: true, crash: true } },
  build:  { label: 'Build',  color: '#f5a524', bars: 4,  energy: 0.7, layers: { pad: true, bass: true, drums: 'build', riser: true } },
  chorus: { label: 'Chorus', color: '#f25f5c', bars: 16, energy: 0.9, layers: { pad: true, arp: true, bass: true, drums: 'full', lead: true, crash: true } },
  break:  { label: 'Break',  color: '#9b7bf2', bars: 8,  energy: 0.3, layers: { pad: true, arp: true, drums: 'half', bells: true, crash: true } },
  outro:  { label: 'Outro',  color: '#6c7a96', bars: 8,  energy: 0.3, layers: { pad: true, arp: true, bass: true, drums: 'light', filter: 'fall', crash: true } },
  hit:    { label: 'Ending', color: '#ffd23f', bars: 0,  energy: 1.0, layers: {} },
};
export const BLOCK_ORDER = ['intro', 'verse', 'build', 'chorus', 'break', 'outro', 'hit'];

export function melodyDefaults(type) {
  return {
    chorus: { density: 0.55, contour: 'arch', form: 'AABA', syncopation: 0.35, octave: 1, range: 1 },
    verse: { density: 0.4, contour: 'wave', form: 'ABAB', syncopation: 0.3, octave: 1, range: 1 },
    break: { density: 0.35, contour: 'fall', form: 'AABA', syncopation: 0.2, octave: 1, range: 1 },
  }[type] || { density: 0.5, contour: 'arch', form: 'AABA', syncopation: 0.3, octave: 1, range: 1 };
}

// The ending's seed comes from the song's, without drawing from its rng, so
// endings that use randomness (timpani, strums) render the same every time.
const hitSeed = (seed) => seedOf(`${seed}:hit`) % 1e6;

let counter = 0;
export const newId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makeBlock(type, overrides = {}) {
  const t = BLOCK_TYPES[type];
  if (!t) throw new Error(`Unknown block "${type}". Try: ${BLOCK_ORDER.join(', ')}`);
  return {
    id: newId(), type, bars: t.bars,
    layers: { ...t.layers }, melody: melodyDefaults(type),
    seed: Math.floor(Math.random() * 1e6), locked: false,
    ...(type === 'hit' ? { tail: 2.35 } : {}),
    ...overrides,
  };
}

export function emptySong(style = 'synthwave') {
  return { version: 1, title: 'Untitled', style, key: STYLES[style].key, mode: STYLES[style].mode, bpm: STYLES[style].bpm, seed: 1, blocks: [] };
}

const PROGRESSIONS = {
  major: ['1-5-6-4', '1-6-4-5', '6-4-1-5', '1-4-5-1', '4-5-1-6', '1-4-6-5', '2-5-1-6', '1-3-4-5'],
  minor: ['6-7-1-1', '1-6-3-7', '1-4-6-5', '6-4-1-5', '4-6-7-7', '1-7-6-7', '1-6-7-1'],
};
const progressionsFor = (mode) => (/minor|dorian/.test(mode) ? PROGRESSIONS.minor : PROGRESSIONS.major);

/** Re-roll one block's creative choices (seed, progression, melody shape). */
export function autoBlock(block, r, song) {
  if (block.locked || block.type === 'hit') return block;
  const mode = song.mode || STYLES[song.style].mode;
  return {
    ...block,
    seed: r.int(0, 999999),
    progression: r.chance(0.6) ? r.pick(progressionsFor(mode)) : undefined,
    melody: {
      ...block.melody,
      density: +r.float(0.3, 0.75).toFixed(2),
      syncopation: +r.float(0.1, 0.55).toFixed(2),
      contour: r.pick(CONTOUR_NAMES.filter((c) => c !== 'flat')),
      form: r.pick(FORMS.slice(0, 4)),
    },
  };
}

const TEMPLATES = {
  full: ['intro', 'verse', 'build', 'chorus', 'break', 'build', 'chorus', 'outro', 'hit'],
  short: ['intro', 'verse', 'chorus', 'outro', 'hit'],
  loop: ['verse', 'chorus'],
};

/** A whole song from scratch. `length`: full | short | loop. */
export function autoSong({ style = 'synthwave', seed = Date.now() % 1e6, length = 'full', key, mode, bpm } = {}) {
  const r = rng(seed);
  const s = STYLES[style];
  const song = { version: 1, title: `${s.name} #${seed}`, style, key: key || s.key, mode: mode || s.mode, bpm: bpm || s.bpm, seed, blocks: [] };
  const chorusShape = autoBlock(makeBlock('chorus'), r, song); // choruses share one hook
  (TEMPLATES[length] || TEMPLATES.full).forEach((type, i, all) => {
    let b = type === 'chorus' ? { ...chorusShape, id: newId() } : autoBlock(makeBlock(type), r, song);
    const isLastChorus = type === 'chorus' && all.indexOf('chorus') !== all.lastIndexOf('chorus') && i === all.lastIndexOf('chorus');
    if (isLastChorus) b = { ...b, layers: { ...b.layers, octaves: true } };
    if (type === 'break' && b.layers.bells) b = { ...b, seed: chorusShape.seed, melody: chorusShape.melody, progression: chorusShape.progression };
    if (type === 'hit') b = { ...b, seed: hitSeed(seed) };
    song.blocks.push(b);
  });
  return song;
}

/**
 * Finish a partial song: keep what's there, re-roll unlocked blocks only if
 * `reroll`, and append the rest of the arrangement so it ends properly.
 */
export function autoFill(song, { seed = Date.now() % 1e6, reroll = false, length = 'full' } = {}) {
  const r = rng(seed);
  const body = song.blocks.filter((b) => b.type !== 'hit').map((b) => (reroll ? autoBlock(b, r, song) : b));
  const tpl = (TEMPLATES[length] || TEMPLATES.full).filter((t) => t !== 'hit');
  // Walk the template alongside the blocks that exist, then add what's left.
  let k = 0;
  for (const b of body) { const at = tpl.indexOf(b.type, k); if (at >= 0) k = at + 1; }
  const chorus = body.find((b) => b.type === 'chorus');
  for (const type of tpl.slice(k)) {
    body.push(type === 'chorus' && chorus ? { ...chorus, id: newId(), locked: false } : autoBlock(makeBlock(type), r, song));
  }
  if (body[body.length - 1]?.type !== 'outro') body.push(autoBlock(makeBlock('outro'), r, song));
  return { ...song, blocks: [...body, makeBlock('hit')] };
}

/**
 * Short music bed that lands a final hit at `hit` seconds (e.g. when an end
 * card appears) and rings out to `length`. Tempo is solved so the hit falls
 * exactly on a bar line.
 */
export function jingle({ style = 'synthwave', seed = 1, length = 9.1, hit = 6.75, key, mode, lead } = {}) {
  const s = STYLES[style];
  if (!s) throw new Error(`Unknown style "${style}"`);
  if (!(hit > 0) || !(length > 0)) throw new Error('jingle: length and hit must be positive seconds');
  // As many whole bars as fit near the style's tempo, then solve the exact
  // tempo so the hit lands on a bar line (e.g. 6.75 s → 3 bars at ~107 bpm).
  const bars = Math.min(16, Math.max(1, Math.round((hit * s.bpm) / 240)));
  const bpm = (60 * bars * 4) / hit;
  const r = rng(seed);
  const tail = Math.max(0.5, length - hit);
  const song = { version: 1, title: `${s.name} jingle`, style, key: key || s.key, mode: mode || s.mode, bpm, seed, blocks: [] };
  const groove = autoBlock(makeBlock('chorus', { bars: bars > 1 ? bars - 1 : 1 }), r, song);
  groove.layers = { pad: true, arp: true, bass: true, drums: 'full', lead: lead ?? style !== 'synthwave' };
  const intro = makeBlock('intro', { bars: 1, seed: r.int(0, 1e6), layers: { pad: true, arp: true, filter: 'rise' } });
  return { ...song, tail, blocks: [...(bars > 1 ? [intro] : []), groove, makeBlock('hit', { tail, seed: hitSeed(seed) })] };
}

/** One quick melody over a backing loop — the Melody Machine. */
export function melodySong({
  style = 'lofi', seed = 1, bars = 8, key, mode, bpm, progression,
  density = 0.5, syncopation = 0.3, contour = 'arch', form = 'AABA', octave = 1, range = 1,
  chords = true, bass = true, drums = 'light', ending = true,
} = {}) {
  const s = STYLES[style];
  const block = makeBlock('chorus', {
    bars, seed, progression,
    layers: { pad: chords, arp: false, bass, drums, lead: true },
    melody: { density, syncopation, contour, form, octave, range },
  });
  return {
    version: 1, title: `${s.name} melody #${seed}`, style, key: key || s.key, mode: mode || s.mode, bpm: bpm || s.bpm, seed,
    blocks: ending ? [block, makeBlock('hit', { tail: 2, seed: hitSeed(seed) })] : [block],
  };
}

/** Light validation with friendly errors (used by `tom render` and the web import). */
export function validate(song) {
  if (!song || !Array.isArray(song.blocks)) throw new Error('Not a Tom blueprint: missing "blocks"');
  if (!STYLES[song.style]) throw new Error(`Unknown style "${song.style}"`);
  song.blocks.forEach((b, i) => {
    if (!BLOCK_TYPES[b.type]) throw new Error(`Block ${i + 1}: unknown type "${b.type}"`);
    if (b.type !== 'hit' && !(b.bars >= 1 && b.bars <= 64)) throw new Error(`Block ${i + 1}: bars must be 1–64`);
  });
  return song;
}
