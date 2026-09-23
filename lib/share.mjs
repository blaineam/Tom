// Share links: a #hashtag is a seed, so a link IS the song.
//
//   #sunset-drive                    a melody whose style, key, tempo and shape
//                                    all come from the tag itself
//   #sunset-drive&style=chip&bars=16 the same tag with dials turned (only the
//                                    dials that differ from the tag's recipe)
//   #song:sunset-drive&length=short  an auto-built song from the tag
//   #song=<base64 JSON>              an edited song, carried in full
//
// Everything is deterministic: the web app and the CLI decode the same link
// to the same blueprint, and the same blueprint renders the same audio.
import { rng } from './rng.mjs';
import { STYLES, STYLE_IDS } from './styles.mjs';
import { CONTOUR_NAMES } from './theory.mjs';
import { FORMS, autoSong, validate } from './blueprint.mjs';

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ADJ = ['mellow', 'sunny', 'neon', 'sleepy', 'bouncy', 'dusty', 'velvet', 'cosmic', 'lucky', 'fizzy', 'golden', 'midnight', 'breezy', 'plucky', 'humble', 'dreamy', 'zippy', 'misty', 'jolly', 'sly'];
const NOUN = ['gecko', 'comet', 'lagoon', 'arcade', 'harbor', 'meadow', 'rocket', 'teacup', 'lantern', 'canyon', 'pixel', 'orchard', 'marble', 'firefly', 'tide', 'waffle', 'owl', 'cassette', 'kite', 'cactus'];

/** Normalize anything into a hashtag-friendly seed: "#Sunset Drive!" → "sunset-drive". Numbers stay numbers. */
export function tagOf(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/^#/, '');
  if (/^\d+$/.test(s)) return Number(s);
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tom';
}

/** A memorable random tag like "mellow-gecko-42". */
export function randomTag(r = rng(Math.random())) {
  return `${r.pick(ADJ)}-${r.pick(NOUN)}-${r.int(1, 99)}`;
}

/** The full melody recipe a tag implies on its own. */
export function melodyFromTag(tag) {
  const t = tagOf(tag);
  const r = rng(`tag:${t}`);
  const style = r.pick(STYLE_IDS);
  const s = STYLES[style];
  return {
    style, key: r.chance(0.5) ? s.key : r.pick(KEYS), mode: s.mode, bpm: Math.round(s.bpm),
    bars: 8, density: +(r.float(0.3, 0.7)).toFixed(2), syncopation: +(r.float(0.15, 0.5)).toFixed(2),
    contour: r.pick(CONTOUR_NAMES.filter((c) => c !== 'flat')), form: r.pick(FORMS.slice(0, 4)),
    octave: 1, progression: '', chords: true, bass: true, drums: 'light', seed: t,
  };
}

// Short keys keep links tidy.
const KEYMAP = { style: 'style', key: 'key', mode: 'mode', bpm: 'bpm', bars: 'bars', density: 'busy', syncopation: 'sync', contour: 'shape', form: 'form', octave: 'reg', progression: 'chords', chords: 'pad', bass: 'bass', drums: 'drums' };
const REVERSE = Object.fromEntries(Object.entries(KEYMAP).map(([k, v]) => [v, k]));
const BOOL = new Set(['chords', 'bass']);
const NUM = new Set(['bpm', 'bars', 'density', 'syncopation', 'octave']);

/** Melody params → "#tag&k=v…" (only the dials that differ from the tag's recipe). */
export function melodyHash(params) {
  const tag = tagOf(params.seed);
  const base = melodyFromTag(tag);
  const parts = [encodeURIComponent(String(tag))];
  for (const [k, short] of Object.entries(KEYMAP)) {
    const v = params[k], b = base[k];
    if (v === undefined || String(v) === String(b)) continue;
    parts.push(`${short}=${encodeURIComponent(BOOL.has(k) ? (v ? 1 : 0) : v)}`);
  }
  return `#${parts.join('&')}`;
}

const b64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return typeof Buffer !== 'undefined' ? Buffer.from(t, 'base64').toString('utf8') : decodeURIComponent(escape(atob(t))); };

/** Song → shortest faithful link. Songs still exactly as Auto built them travel as a tag. */
export function songHash(song) {
  const o = song.origin;
  if (o && !song.edited) {
    const parts = [`song:${encodeURIComponent(String(o.tag))}`];
    const s = STYLES[o.style];
    const fromTag = songOriginFromTag(o.tag);
    if (o.length !== 'full') parts.push(`length=${o.length}`);
    if (o.style !== fromTag.style) parts.push(`style=${o.style}`);
    if (o.key && o.key !== s.key) parts.push(`key=${encodeURIComponent(o.key)}`);
    if (o.bpm && Math.round(o.bpm) !== Math.round(s.bpm)) parts.push(`bpm=${Math.round(o.bpm)}`);
    return `#${parts.join('&')}`;
  }
  const { origin, edited, ...bp } = song;
  return `#song=${b64(JSON.stringify(bp))}`;
}

function songOriginFromTag(tag) {
  return { style: rng(`songtag:${tagOf(tag)}`).pick(STYLE_IDS) };
}

/** Build the song a "#song:tag…" link describes. */
export function songFromTag(tag, { length = 'full', style, key, bpm } = {}) {
  const t = tagOf(tag);
  const st = style || songOriginFromTag(t).style;
  const song = autoSong({ style: st, seed: t, length, key, bpm: bpm ? Number(bpm) : undefined });
  return { ...song, origin: { tag: t, length, style: st, key, bpm }, edited: false };
}

/**
 * Decode a hash or full URL.
 * @returns {{kind:'melody', params}|{kind:'song', song}|null}
 */
export function decodeShare(input) {
  if (!input) return null;
  let h = String(input);
  const at = h.indexOf('#');
  h = at >= 0 ? h.slice(at + 1) : h;
  if (!h) return null;
  if (h.startsWith('song=')) return { kind: 'song', song: validate(JSON.parse(unb64(h.slice(5)))) };
  const [head, ...rest] = h.split('&');
  const q = Object.fromEntries(rest.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; }));
  if (head.startsWith('song:')) {
    return { kind: 'song', song: songFromTag(decodeURIComponent(head.slice(5)), { length: q.length || 'full', style: q.style, key: q.key, bpm: q.bpm }) };
  }
  const tag = tagOf(decodeURIComponent(head));
  const params = melodyFromTag(tag);
  for (const [short, raw] of Object.entries(q)) {
    const k = REVERSE[short];
    if (!k) continue;
    params[k] = BOOL.has(k) ? raw === '1' : NUM.has(k) ? Number(raw) : raw;
  }
  if (!STYLES[params.style]) throw new Error(`Unknown style "${params.style}" in link`);
  return { kind: 'melody', params };
}

export const HOSTED_URL = 'https://tom.wemiller.com/';
export const shareUrl = (hash) => `${HOSTED_URL}${hash}`;
