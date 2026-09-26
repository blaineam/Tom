// The sound pool: melodic voices a song can swap in for its melody (lead),
// counter-line and bells, so two songs in one style don't always sound alike.
// Each style lists the sounds that suit it; its own voice ('style') comes
// first. A song carries its picks as `sounds: { lead, counter, bells }`; a song
// without them plays the style's own voices, exactly as before.
import * as I from './instruments.mjs';

// voice(m, d, r) → mono samples. `gain` levels each sound against the others;
// `shift` moves a voice to where it sings best (in semitones).
export const SOUNDS = {
  sawLead:    { name: 'Saw lead',       voice: (m, d) => I.lead(m, d), gain: 0.8 },
  square:     { name: 'Square',         voice: (m, d) => I.sqlead(m, d, 0.5), gain: 0.6 },
  pulse:      { name: 'Thin pulse',     voice: (m, d) => I.sqlead(m, d, 0.125), gain: 0.6 },
  triangle:   { name: 'Triangle',       voice: (m, d) => I.tribass(m, d), gain: 0.5 },
  softSynth:  { name: 'Soft synth',     voice: (m, d) => I.softSynth(m, d), gain: 0.62 },
  synthBrass: { name: 'Synth brass',    voice: (m, d) => I.synthBrass(m, d), gain: 0.8 },
  supersaw:   { name: 'Supersaw',       voice: (m, d) => I.supersaw(m, Math.max(d, 0.15), 5200), gain: 0.55 },
  sawPluck:   { name: 'Saw pluck',      voice: (m, d) => I.sawPluck(m, Math.min(Math.max(d, 0.15), 0.5)), gain: 0.6 },
  pluck:      { name: 'Pluck',          voice: (m, d, r) => I.pluck(r, m, Math.max(d, 0.4), 0.7), gain: 0.7 },
  nylon:      { name: 'Nylon guitar',   voice: (m, d, r) => I.nylon(r, m, d), gain: 0.75 },
  harp:       { name: 'Harp',           voice: (m, d, r) => I.harp(r, m, d), gain: 0.7 },
  epiano:     { name: 'Electric piano', voice: (m, d) => I.epiano(m, Math.max(d, 0.3)), gain: 0.6 },
  wurli:      { name: 'Wurlitzer',      voice: (m, d) => I.wurli(m, d), gain: 0.6 },
  piano:      { name: 'Piano',          voice: (m, d) => I.piano(m, Math.max(d, 0.3)), gain: 0.7 },
  vibes:      { name: 'Vibraphone',     voice: (m, d) => I.vibes(m, d), gain: 0.6 },
  marimba:    { name: 'Marimba',        voice: (m, d) => I.marimba(m, Math.max(d, 0.5)), gain: 0.6 },
  kalimba:    { name: 'Kalimba',        voice: (m, d) => I.kalimba(m, d), gain: 0.5 },
  steelPan:   { name: 'Steel pan',      voice: (m, d) => I.steelPan(m, d), gain: 0.65 },
  musicBox:   { name: 'Music box',      voice: (m, d) => I.musicBox(m, d), gain: 0.55 },
  celesta:    { name: 'Celesta',        voice: (m, d) => I.celesta(m, d), gain: 0.55 },
  glass:      { name: 'Glass chime',    voice: (m, d) => I.glass(m, d), gain: 0.55 },
  chipBell:   { name: '8-bit ding',     voice: (m, d) => I.chipBell(m, d), gain: 0.55 },
  flute:      { name: 'Flute',          voice: (m, d, r) => I.flute(r, m, d), gain: 0.75 },
  whistle:    { name: 'Whistle',        voice: (m, d, r) => I.whistle(r, m, d), gain: 0.65 },
  clarinet:   { name: 'Clarinet',       voice: (m, d) => I.clarinet(m, d), gain: 0.55 },
  sax:        { name: 'Saxophone',      voice: (m, d, r) => I.sax(r, m, d), gain: 0.75, shift: -12 },
  horn:       { name: 'French horn',    voice: (m, d) => I.horn(m, Math.max(d, 0.35)), gain: 0.75, shift: -12 },
  brass:      { name: 'Brass',          voice: (m, d) => I.brass(m, d), gain: 0.8 },
  strings:    { name: 'Strings',        voice: (m, d) => I.strings([m], Math.max(d, 0.4), 3400), gain: 0.6 },
  pizz:       { name: 'Pizzicato',      voice: (m, d) => I.pizz(m, d), gain: 0.6 },
  fiddle:     { name: 'Fiddle',         voice: (m, d) => I.fiddle(m, d), gain: 0.7 },
  steel:      { name: 'Pedal steel',    voice: (m, d) => I.steel(m, d), gain: 0.8 },
  harmonica:  { name: 'Harmonica',      voice: (m, d) => I.harmonica(m, d), gain: 0.7 },
  melodica:   { name: 'Melodica',       voice: (m, d, r) => I.melodica(r, m, d), gain: 0.75 },
  organ:      { name: 'Organ',          voice: (m, d) => I.organLead(m, d), gain: 0.6 },
  clav:       { name: 'Clavinet',       voice: (m, d) => I.clav(m, Math.min(Math.max(d, 0.1), 0.4)), gain: 0.6 },
  leadGuitar: { name: 'Lead guitar',    voice: (m, d) => I.leadGuitar(m, d), gain: 0.8 },
};
export const SOUND_IDS = Object.keys(SOUNDS);
export const SLOTS = ['lead', 'counter', 'bells'];
export const SLOT_NAMES = { lead: 'Melody', counter: 'Counter-line', bells: 'Bells' };
// A slot's level relative to the melody, and bells ring an octave up.
const SLOT = { lead: { gain: 1, shift: 0 }, counter: { gain: 0.55, shift: 0 }, bells: { gain: 0.6, shift: 12 } };

// What suits each style, beyond its own voice. `own` names the style's voice for the menus.
export const PALETTES = {
  synthwave:  { own: { lead: 'Saw lead', counter: 'Square', bells: 'Glass chime' },
    lead: ['synthBrass', 'softSynth', 'square', 'supersaw', 'epiano'], counter: ['softSynth', 'sawPluck', 'epiano', 'strings'], bells: ['musicBox', 'sawPluck', 'celesta'] },
  pop:        { own: { lead: 'Pluck', counter: 'Marimba', bells: 'Glass chime' },
    lead: ['softSynth', 'whistle', 'marimba', 'kalimba', 'nylon', 'epiano', 'piano'], counter: ['pluck', 'epiano', 'kalimba', 'strings', 'nylon'], bells: ['musicBox', 'kalimba', 'celesta', 'marimba'] },
  chip:       { own: { lead: 'Square', counter: 'Thin pulse', bells: '8-bit ding' },
    lead: ['pulse', 'triangle', 'softSynth'], counter: ['square', 'triangle'], bells: ['musicBox', 'square'] },
  lofi:       { own: { lead: 'Electric piano', counter: 'Vibraphone', bells: 'Electric piano' },
    lead: ['wurli', 'vibes', 'nylon', 'kalimba', 'sax', 'clarinet', 'flute', 'piano'], counter: ['wurli', 'kalimba', 'nylon', 'whistle', 'flute'], bells: ['musicBox', 'kalimba', 'glass', 'vibes'] },
  marimba:    { own: { lead: 'Marimba', counter: 'Kalimba', bells: 'Marimba' },
    lead: ['kalimba', 'steelPan', 'vibes', 'pluck', 'whistle', 'flute', 'nylon'], counter: ['vibes', 'pluck', 'nylon', 'flute', 'marimba'], bells: ['musicBox', 'kalimba', 'glass', 'steelPan'] },
  jazz:       { own: { lead: 'Vibraphone', counter: 'Piano', bells: 'Vibraphone' },
    lead: ['piano', 'sax', 'clarinet', 'flute', 'nylon', 'wurli'], counter: ['vibes', 'sax', 'clarinet', 'nylon'], bells: ['celesta', 'glass', 'piano'] },
  orchestral: { own: { lead: 'French horn', counter: 'Strings', bells: 'Celesta' },
    lead: ['strings', 'flute', 'clarinet', 'harp', 'piano'], counter: ['flute', 'clarinet', 'harp', 'pizz', 'horn'], bells: ['harp', 'glass', 'musicBox'] },
  hiphop:     { own: { lead: 'Flute', counter: 'Electric piano', bells: 'Glass chime' },
    lead: ['epiano', 'whistle', 'sax', 'kalimba', 'wurli', 'softSynth', 'piano', 'strings'], counter: ['wurli', 'vibes', 'flute', 'strings', 'piano'], bells: ['musicBox', 'kalimba', 'vibes'] },
  rock:       { own: { lead: 'Lead guitar', counter: 'Lead guitar', bells: 'Lead guitar' },
    lead: ['organ', 'synthBrass', 'harmonica'], counter: ['organ', 'pluck', 'strings'], bells: ['glass', 'organ', 'piano'] },
  reggae:     { own: { lead: 'Melodica', counter: 'Organ', bells: 'Steel pan' },
    lead: ['organ', 'sax', 'steelPan', 'whistle', 'harmonica', 'flute'], counter: ['steelPan', 'melodica', 'nylon', 'brass'], bells: ['glass', 'kalimba', 'marimba'] },
  edm:        { own: { lead: 'Supersaw', counter: 'Saw pluck', bells: 'Saw pluck' },
    lead: ['sawPluck', 'softSynth', 'synthBrass', 'whistle', 'piano'], counter: ['supersaw', 'softSynth', 'piano'], bells: ['glass', 'musicBox', 'kalimba'] },
  country:    { own: { lead: 'Pedal steel', counter: 'Fiddle', bells: 'Fiddle' },
    lead: ['fiddle', 'harmonica', 'nylon', 'whistle', 'piano'], counter: ['harmonica', 'steel', 'nylon', 'piano'], bells: ['glass', 'pluck', 'harp'] },
  funk:       { own: { lead: 'Brass', counter: 'Clavinet', bells: 'Clavinet' },
    lead: ['sax', 'synthBrass', 'clav', 'organ', 'wurli', 'whistle'], counter: ['wurli', 'organ', 'sax', 'brass'], bells: ['glass', 'synthBrass', 'vibes'] },
};

// General MIDI programs, for MIDI export.
const GM = { sawLead: 81, square: 80, pulse: 80, triangle: 80, softSynth: 80, synthBrass: 62, supersaw: 81, sawPluck: 81, pluck: 25, nylon: 24, harp: 46, epiano: 4, wurli: 4, piano: 0, vibes: 11, marimba: 12, kalimba: 108, steelPan: 114, musicBox: 10, celesta: 8, glass: 14, chipBell: 80, flute: 73, whistle: 78, clarinet: 71, sax: 65, horn: 60, brass: 61, strings: 48, pizz: 45, fiddle: 110, steel: 27, harmonica: 22, melodica: 22, organ: 16, clav: 7, leadGuitar: 30 };
export const soundProgram = (id) => GM[id];

/** The voice a slot plays in a song: the picked sound, or null for the style's own. */
export function slotVoice(slot, id) {
  const s = id && SOUNDS[id];
  if (!s) return null;
  const shift = SLOT[slot].shift + (s.shift ?? 0);
  return { voice: (m, d, r) => s.voice(m + shift, d, r), gain: s.gain * SLOT[slot].gain, name: id };
}

/** Pick a song's sounds: each slot keeps the style's own voice about a third of the time. */
export function pickSounds(style, r) {
  const p = PALETTES[style];
  if (!p) return undefined;
  const out = {};
  for (const slot of SLOTS) if (p[slot]?.length && !r.chance(0.35)) out[slot] = r.pick(p[slot]);
  return Object.keys(out).length ? out : undefined;
}
