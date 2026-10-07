// Radio: pick a style and Tom plays an endless run of fresh songs in it.
//
// A station is a style (or "mix", which rotates through every style) plus a
// session seed. Track n of a station is a pure function of (station, seed, n),
// and every track is an ordinary auto-built song with its own #song: link, so
// a track you like can be shared or opened in the composer unchanged.
import { rng } from './rng.mjs';
import { STYLES, STYLE_IDS } from './styles.mjs';
import { randomTag, songFromTag } from './share.mjs';
import { timeline } from './arrange.mjs';

export const MIX = 'mix';
export const STATIONS = [...STYLE_IDS, MIX];
const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Only real styles, in catalog order; empty or unknown means every style. */
export function mixStyles(styles) {
  const picked = STYLE_IDS.filter((id) => styles?.includes(id));
  return picked.length ? picked : [...STYLE_IDS];
}

/** The order a mix station visits styles in: a seeded shuffle, so no style repeats back to back. */
function mixOrder(seed, styles) {
  const all = mixStyles(styles);
  const r = rng(`radio:mix-order:${seed}${all.length === STYLE_IDS.length ? '' : `:${all.join(',')}`}`), order = [...all];
  for (let i = order.length - 1; i > 0; i--) { const j = r.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

// With `quickStart`, the first track is a short song, as near 50 s as the
// forms allow (the first of up to 64 candidates that fits, else the shortest;
// picking takes well under a millisecond). Where rendering is slow (Safari in
// Lockdown Mode runs JavaScript without a JIT) that's the wait before anything
// plays; later tracks render while one is playing.
const QUICK_START_SECS = 50, QUICK_START_TRIES = 64;

/**
 * Track `n` (0-based) of a station. Each track varies the key, nudges the
 * tempo within ±6% of the style's feel, is mostly full-length, and comes from
 * the varied arranger (its own form, section lengths and textures). A mix
 * station can be limited to some `styles`.
 */
export function radioTrack(station, seed, n, { styles, quickStart = false } = {}) {
  if (station !== MIX && !STYLES[station]) throw new Error(`Unknown station "${station}". Try: ${STATIONS.join(', ')}`);
  const r = rng(`radio:${station}:${seed}:${n}`);
  const style = station === MIX ? (() => { const o = mixOrder(seed, styles); return o[n % o.length]; })() : station;
  const s = STYLES[style];
  const tag = randomTag(r);
  const key = r.chance(0.35) ? s.key : r.pick(KEYS);
  const bpm = Math.round(s.bpm * r.float(0.94, 1.06));
  const length = r.chance(0.8) ? 'full' : 'short';
  if (!quickStart || n > 0) return songFromTag(tag, { length, style, key, bpm, gen: 3 });
  let best = null;
  for (let k = 0; k < QUICK_START_TRIES; k++) {
    const song = songFromTag(k ? randomTag(r) : tag, { length: 'short', style, key, bpm, gen: 3 });
    const secs = timeline(song).duration;
    if (secs <= QUICK_START_SECS) return song;
    if (!best || secs < best.secs) best = { song, secs };
  }
  return best.song;
}

/** "mellow-gecko-42" → "Mellow Gecko 42". */
export const trackTitle = (song) => String(song.origin?.tag ?? song.title).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const stationName = (station) => (station === MIX ? 'Mix' : STYLES[station].name);
