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

/**
 * A whole song from scratch. `length`: full | short | loop.
 * `variety` picks the newer arranger (links mark it `gen=2`); without it the
 * original one runs unchanged, so links shared before it existed keep their song.
 */
export function autoSong({ style = 'synthwave', seed = Date.now() % 1e6, length = 'full', key, mode, bpm, variety = false } = {}) {
  if (variety) return variedSong({ style, seed, length, key, mode, bpm });
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

// Song forms for the varied arranger: verse/chorus songs, songs that open on
// the hook, double verses, a last chorus that repeats.
const VARIED_FORMS = {
  full: [
    ['intro', 'verse', 'build', 'chorus', 'break', 'build', 'chorus', 'outro', 'hit'],
    ['intro', 'verse', 'chorus', 'verse', 'build', 'chorus', 'outro', 'hit'],
    ['intro', 'verse', 'verse', 'build', 'chorus', 'break', 'chorus', 'chorus', 'outro', 'hit'],
    ['intro', 'chorus', 'verse', 'build', 'chorus', 'break', 'build', 'chorus', 'outro', 'hit'],
    ['intro', 'verse', 'build', 'chorus', 'verse', 'break', 'build', 'chorus', 'outro', 'hit'],
    ['verse', 'chorus', 'verse', 'chorus', 'break', 'build', 'chorus', 'outro', 'hit'],
  ],
  short: [
    ['intro', 'verse', 'chorus', 'outro', 'hit'],
    ['intro', 'chorus', 'verse', 'chorus', 'hit'],
    ['verse', 'build', 'chorus', 'outro', 'hit'],
    ['intro', 'verse', 'build', 'chorus', 'hit'],
  ],
  loop: [['verse', 'chorus'], ['chorus', 'break']],
};

const NO_LAYERS = { pad: false, arp: false, bass: false, drums: 'none', lead: false, counter: false, bells: false, octaves: false, riser: false, crash: false };

// What a break can be, so it isn't always the bells.
const BREAKS = [
  [{ pad: true, arp: true, drums: 'half', counter: true, crash: true }, 3],   // a lighter groove with a counter-line
  [{ pad: true, bass: true, drums: 'none', filter: 'fall' }, 3],             // breakdown: the band drops out
  [{ bass: true, drums: 'full', crash: true }, 2],                           // drum break
  [{ pad: true, arp: true, drums: 'half', bells: true, crash: true }, 1.5],  // the hook, on bells
];

/**
 * The varied arranger: its own form, section lengths and textures for every
 * song, with verses and choruses that each share a hook. Choices come from a
 * separate stream so the blocks' own seeds draw exactly as autoSong's do.
 */
function variedSong({ style, seed, length, key, mode, bpm }) {
  const r = rng(seed), v = rng(`${seed}:variety`);
  const s = STYLES[style];
  const song = { version: 1, title: `${s.name} #${seed}`, style, key: key || s.key, mode: mode || s.mode, bpm: bpm || s.bpm, seed, blocks: [] };
  const form = v.pick(VARIED_FORMS[length] || VARIED_FORMS.full);
  const bars = { intro: v.pick([4, 8, 8]), verse: v.pick([8, 16, 16]), chorus: v.pick([8, 16, 16]), build: v.pick([2, 4, 4]), break: v.pick([4, 8, 8]), outro: v.pick([4, 8]) };

  const chorus = autoBlock(makeBlock('chorus', { bars: bars.chorus }), r, song);
  const verse = autoBlock(makeBlock('verse', { bars: bars.verse }), r, song);
  // Verses and choruses on different changes, so the chorus lifts.
  if (verse.progression && verse.progression === chorus.progression) verse.progression = v.pick(progressionsFor(song.mode).filter((p) => p !== chorus.progression));
  const verseSings = v.chance(0.4); // some verses carry a low melody of their own
  verse.layers = { ...verse.layers, arp: v.chance(0.7), counter: !verseSings && v.chance(0.6), lead: verseSings, drums: v.pick(['full', 'full', 'half']) };
  if (verseSings) verse.melody = { ...verse.melody, octave: 0, density: Math.min(verse.melody.density, 0.45) };
  chorus.layers = { ...chorus.layers, arp: v.chance(0.8), counter: v.chance(0.3) };
  const breakLayers = v.weighted(BREAKS);

  const nChorus = form.filter((t) => t === 'chorus').length;
  let choruses = 0, verses = 0;
  for (const type of form) {
    let b;
    if (type === 'chorus') {
      choruses++;
      b = { ...chorus, id: newId(), layers: { ...chorus.layers } };
      if (choruses > 1) b.layers.counter = b.layers.counter || v.chance(0.5);
      if (choruses === nChorus && nChorus > 1) b.layers.octaves = true;
    } else if (type === 'verse') {
      verses++;
      b = { ...verse, id: newId(), layers: { ...verse.layers } };
      if (verses > 1) Object.assign(b.layers, { arp: true, counter: !b.layers.lead }); // the second verse builds
    } else if (type === 'hit') {
      b = makeBlock('hit', { seed: hitSeed(seed), sparkle: v.chance(0.4) });
    } else {
      b = autoBlock(makeBlock(type, { bars: bars[type] }), r, song);
      if (type === 'break') {
        b.layers = { ...NO_LAYERS, ...breakLayers }; // spelled out: a break's type defaults include bells
        if (b.layers.bells) Object.assign(b, { seed: chorus.seed, melody: chorus.melody, progression: chorus.progression });
      }
      if (type === 'intro') b.layers = { ...b.layers, drums: v.pick(['none', 'none', 'light']), arp: v.chance(0.75), pad: true };
    }
    song.blocks.push(b);
  }
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
