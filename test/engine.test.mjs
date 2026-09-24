import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { render, timeline, blockMelody } from '../lib/arrange.mjs';
import { jingle, melodySong, autoSong, autoFill, makeBlock, emptySong, validate } from '../lib/blueprint.mjs';
import { parseProgression, parseKey, noteName } from '../lib/theory.mjs';
import { STYLES, STYLE_IDS } from '../lib/styles.mjs';
import { encodeWav } from '../lib/wav.mjs';
import { toMidi } from '../lib/midi.mjs';
import { tagOf, melodyFromTag, melodyHash, songFromTag, songHash, decodeShare } from '../lib/share.mjs';
import { radioTrack, STATIONS, MIX } from '../lib/radio.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (a) => createHash('sha1').update(Buffer.from(a.buffer)).digest('hex');

test('same blueprint renders byte-identical audio', () => {
  const bp = melodySong({ style: 'pop', seed: 42 });
  const a = render(bp), b = render(bp);
  assert.equal(hash(a.L), hash(b.L));
  assert.equal(hash(a.R), hash(b.R));
});

test('different seeds give different melodies', () => {
  const m1 = blockMelody(melodySong({ seed: 1 }), 0).map((n) => n.midi).join();
  const m2 = blockMelody(melodySong({ seed: 2 }), 0).map((n) => n.midi).join();
  assert.notEqual(m1, m2);
});

test('every style renders without clipping or NaN', () => {
  for (const style of STYLE_IDS) {
    const out = render(melodySong({ style, seed: 3, bars: 4 }));
    let peak = 0;
    for (const v of out.L) { assert.ok(Number.isFinite(v), `${style}: non-finite sample`); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.1 && peak <= 0.9, `${style}: peak ${peak}`);
  }
});

test('jingle lands its final hit exactly on time', () => {
  for (const style of STYLE_IDS) {
    const bp = jingle({ style, seed: 5, length: 9.1, hit: 6.75 });
    const { starts, duration } = timeline(bp);
    assert.ok(Math.abs(starts[starts.length - 1] - 6.75) < 1e-9, `${style}: hit at ${starts.at(-1)}`);
    assert.ok(Math.abs(duration - 9.1) < 1e-9);
  }
  for (const [len, hit] of [[3, 2.2], [15, 12], [30, 27.5]]) {
    const bp = jingle({ style: 'pop', seed: 1, length: len, hit });
    assert.ok(Math.abs(timeline(bp).starts.at(-1) - hit) < 1e-9);
    assert.ok(bp.bpm > 60 && bp.bpm < 180, `bpm ${bp.bpm} for hit ${hit}`);
  }
});

test('melodies stay singable: no tritone leaps, no leaps over an octave, inside the register', () => {
  for (const style of STYLE_IDS) for (let seed = 1; seed <= 25; seed++) {
    const bp = melodySong({ style, seed, bars: 8, density: (seed % 5) / 5 });
    const notes = blockMelody(bp, 0);
    assert.ok(notes.length >= 8, `${style}/${seed}: only ${notes.length} notes`);
    for (let i = 1; i < notes.length; i++) {
      const leap = Math.abs(notes[i].midi - notes[i - 1].midi);
      assert.notEqual(leap, 6, `${style}/${seed}: tritone leap at note ${i}`);
      assert.ok(leap <= 12, `${style}/${seed}: leap of ${leap}`);
    }
  }
});

test('melody ends on the tonic', () => {
  const bp = melodySong({ style: 'lofi', seed: 9, key: 'F' });
  const last = blockMelody(bp, 0).at(-1);
  assert.equal(noteName(last.midi).replace(/-?\d+$/, ''), 'F');
});

test('autoFill finishes a partial song and keeps locked blocks', () => {
  const song = { ...emptySong('chip'), blocks: [makeBlock('verse', { locked: true, seed: 111 })] };
  const done = autoFill(song, { seed: 1 });
  const types = done.blocks.map((b) => b.type);
  assert.equal(types[0], 'verse');
  assert.equal(done.blocks[0].seed, 111);
  assert.ok(types.includes('chorus'));
  assert.deepEqual(types.slice(-2), ['outro', 'hit']);
  validate(done);
});

test('autoSong full arrangement is ~3 minutes and ends with a hit', () => {
  const bp = autoSong({ style: 'synthwave', seed: 57 });
  const { duration } = timeline(bp);
  assert.ok(duration > 150 && duration < 220, `duration ${duration}`);
  assert.equal(bp.blocks.at(-1).type, 'hit');
});

test('progressions parse arabic, roman and timed forms', () => {
  assert.deepEqual(parseProgression('1-5-6-4').map((c) => c.degree), [1, 5, 6, 4]);
  assert.deepEqual(parseProgression('vi-IV-I-V').map((c) => c.degree), [6, 4, 1, 5]);
  assert.deepEqual(parseProgression('6:4,7:2,1:2'), [{ degree: 6, beats: 4 }, { degree: 7, beats: 2 }, { degree: 1, beats: 2 }]);
  assert.equal(parseKey('A'), 57); assert.equal(parseKey('C4'), 60); assert.equal(parseKey('F#'), 54);
});

test('validate rejects broken blueprints with a clear message', () => {
  assert.throws(() => validate({}), /missing "blocks"/);
  assert.throws(() => validate({ style: 'nope', blocks: [] }), /Unknown style/);
  assert.throws(() => validate({ style: 'pop', blocks: [{ type: 'verse', bars: 0 }] }), /bars must be/);
});

test('WAV and MIDI files are well-formed', () => {
  const out = render(melodySong({ seed: 4, bars: 4 }));
  const wav = encodeWav(out.L, out.R, out.sampleRate);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(wav.length, 44 + out.L.length * 4);

  const mid = toMidi(out.events, out.bpm, 'test');
  const dv = new DataView(mid.buffer);
  assert.equal(new TextDecoder().decode(mid.slice(0, 4)), 'MThd');
  const ntracks = dv.getUint16(10);
  let off = 14, seen = 0;
  while (off < mid.length) {
    assert.equal(new TextDecoder().decode(mid.slice(off, off + 4)), 'MTrk');
    off += 8 + dv.getUint32(off + 4); seen++;
  }
  assert.equal(off, mid.length);
  assert.equal(seen, ntracks);
});

test('CLI renders a melody to WAV + MIDI + blueprint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tom-test-'));
  const out = join(dir, 'm.wav');
  const r = spawnSync(process.execPath, [join(ROOT, 'tom.mjs'), 'melody', '--seed', '1', '--bars', '4', '--out', out, '--midi', '--blueprint', '--no-loudness'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  for (const f of ['m.wav', 'm.mid', 'm.json']) assert.ok(existsSync(join(dir, f)), `${f} missing`);
  validate(JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')));
  const bad = spawnSync(process.execPath, [join(ROOT, 'tom.mjs'), 'melody', '--style', 'polka'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Unknown style "polka"/);
});


test('a #hashtag is a deterministic song', () => {
  assert.equal(tagOf('#Sunset Drive!'), 'sunset-drive');
  assert.equal(tagOf('#42'), 42);
  assert.deepEqual(melodyFromTag('sunset-drive'), melodyFromTag('#Sunset Drive'));
  const a = render(melodySong({ ...melodyFromTag('sunset-drive'), ending: true }));
  const d = decodeShare('https://tom.wemiller.com/#sunset-drive');
  const b = render(melodySong({ ...d.params, ending: true }));
  assert.equal(hash(a.L), hash(b.L));
});

test('share links carry only the dials that differ, and round-trip exactly', () => {
  const p = { ...melodyFromTag('road-trip'), density: 0.8, style: 'chip', chords: false };
  const link = melodyHash(p);
  assert.match(link, /^#road-trip&/);
  assert.equal(melodyHash(melodyFromTag('road-trip')), '#road-trip');
  const back = decodeShare(link).params;
  for (const k of ['style', 'density', 'chords', 'key', 'contour', 'form', 'bars']) assert.equal(back[k], p[k], k);
});

test('song links: tag while untouched, full blueprint once edited', () => {
  const s = songFromTag('road-trip', { length: 'short' });
  assert.match(songHash(s), /^#song:road-trip&length=short/);
  const again = decodeShare(songHash(s)).song;
  assert.equal(hash(render(again).L), hash(render(s).L));
  const edited = { ...s, edited: true, blocks: s.blocks.map((b, i) => (i === 1 ? { ...b, bars: 4 } : b)) };
  const link = songHash(edited);
  assert.match(link, /^#song=/);
  assert.equal(decodeShare(link).song.blocks[1].bars, 4);
});

// Share links are promises: once a link is out in the world it must keep
// playing the same song. These hashes pin the song itself (every note's
// track, instrument, pitch, timing, length and velocity), recorded at 0.1.0.
// Raw audio samples are only compared on one machine (see the first test):
// sin/exp may differ in the last bit across CPU architectures, which changes
// PCM bytes without changing a single note.
const GOLDEN = {
  '#sunset-drive': '8655a1072b6ffd2700e849e9',
  '#birthday-song': '10a5868e7753019b891c516e',
  '#road-trip&style=chip&busy=0.8': '517f59b4ee28cd38c30221b8',
  '#song:road-trip&length=short': 'f6954b28d8d4d5fed1e1fc3d',
};
test('existing share links still play exactly the same song', () => {
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  for (const [link, want] of Object.entries(GOLDEN)) {
    const d = decodeShare(link);
    const bp = d.kind === 'melody' ? melodySong({ ...d.params, progression: d.params.progression || undefined, ending: true }) : d.song;
    const ev = render(bp).events.map((e) => [e.track, e.voice, e.midi ?? e.drum, r6(e.t), r6(e.dur), r6(e.vel)]);
    assert.equal(createHash('sha1').update(JSON.stringify(ev)).digest('hex').slice(0, 24), want, `${link} changed`);
  }
});

test('jazz walks: a note on every beat, stepping chromatically into each new chord', () => {
  const bp = { ...melodySong({ style: 'jazz', seed: 'walk', bars: 8, drums: 'none', ending: false }) };
  const { events, bpm } = render(bp);
  const beat = 60 / bpm;
  const bass = events.filter((e) => e.track === 'bass').sort((a, b) => a.t - b.t);
  assert.equal(bass.length, 8 * 4, 'one bass note per beat');
  let approaches = 0, changes = 0;
  for (let i = 1; i < bass.length; i++) {
    const beatIdx = Math.round(bass[i].t / beat);
    if (beatIdx % 4 === 0 && bass[i].midi !== bass[i - 1].midi) { changes++; if (Math.abs(bass[i].midi - bass[i - 1].midi) === 1) approaches++; }
  }
  assert.ok(changes > 0 && approaches === changes, `${approaches}/${changes} chord changes approached by a half step`);
});

test('orchestral builds roll on timpani, not snare', () => {
  const song = { ...emptySong('orchestral'), blocks: [makeBlock('build', { seed: 1 })] };
  const { events } = render(song);
  assert.ok(events.some((e) => e.track === 'timpani'));
  assert.ok(!events.some((e) => e.drum === 'snare'));
});

test('hip-hop: the 808 lands with the kick', () => {
  const song = { ...emptySong('hiphop'), blocks: [makeBlock('chorus', { bars: 4, seed: 2 })] };
  const { events } = render(song);
  const kicks = new Set(events.filter((e) => e.drum === 'kick').map((e) => e.t.toFixed(6)));
  const bass = events.filter((e) => e.track === 'bass');
  assert.ok(bass.length >= 12);
  for (const b of bass) assert.ok(kicks.has(b.t.toFixed(6)), `808 at ${b.t} without a kick`);
});

test('rock: power chords, palm-muted verses, open choruses, tom fills every 4th bar', () => {
  const song = { ...emptySong('rock'), blocks: [makeBlock('verse', { bars: 8, seed: 3 }), makeBlock('chorus', { bars: 8, seed: 4 })] };
  const { events, bpm } = render(song);
  const bar = (60 / bpm) * 4;
  const guitar = events.filter((e) => e.voice === 'guitar');
  const byTime = new Map();
  for (const g of guitar) byTime.set(g.t, [...(byTime.get(g.t) || []), g.midi].sort((a, b) => a - b));
  for (const notes of byTime.values()) assert.deepEqual(notes.map((n) => n - notes[0]), [0, 7, 12]);
  const verseHits = guitar.filter((g) => g.t < 8 * bar).length, chorusHits = guitar.filter((g) => g.t >= 8 * bar).length;
  assert.ok(verseHits > chorusHits * 3, `verse chugs ${verseHits} vs chorus strums ${chorusHits}`);
  const fillBars = new Set(events.filter((e) => e.drum === 'tom').map((e) => Math.floor(e.t / bar + 1e-9) % 8));
  assert.deepEqual([...fillBars].sort(), [3, 7]);
});

test('reggae: one drop (nothing on 1; kick + rim on 3) and the skank on 2 and 4', () => {
  const song = { ...emptySong('reggae'), blocks: [makeBlock('verse', { bars: 4, seed: 5 })] };
  const { events, bpm } = render(song);
  const beat = 60 / bpm, pos = (e) => (Math.round((e.t / beat) * 1000) / 1000) % 4;
  const kicks = events.filter((e) => e.drum === 'kick').map(pos);
  assert.ok(kicks.length === 4 && kicks.every((q) => q === 2), `kicks at ${kicks}`);
  assert.deepEqual([...new Set(events.filter((e) => e.drum === 'rim').map(pos))], [2]);
  assert.deepEqual([...new Set(events.filter((e) => e.voice === 'chop').map(pos))].sort(), [1, 3]);
});

test('edm: four on the floor with the bass on every off-beat, and a harder pump', () => {
  const song = { ...emptySong('edm'), blocks: [makeBlock('chorus', { bars: 4, seed: 6 })] };
  const { events, bpm } = render(song);
  const beat = 60 / bpm, frac = (e) => (Math.round((e.t / beat) * 1000) / 1000) % 1;
  assert.equal(events.filter((e) => e.drum === 'kick').length, 16);
  assert.ok(events.filter((e) => e.drum === 'kick').every((e) => frac(e) === 0));
  const bass = events.filter((e) => e.track === 'bass');
  assert.equal(bass.length, 16);
  assert.ok(bass.every((e) => frac(e) === 0.5));
});

test('country: boom-chick (bass root/fifth on 1 and 3, strum on 2 and 4)', () => {
  const song = { ...emptySong('country'), blocks: [makeBlock('verse', { bars: 4, seed: 7, progression: '1-1-1-1' })] };
  const { events, bpm } = render(song);
  const beat = 60 / bpm, pos = (e) => (Math.round((e.t / beat) * 1000) / 1000) % 4;
  const bass = events.filter((e) => e.track === 'bass');
  assert.deepEqual([...new Set(bass.map(pos))].sort(), [0, 2]);
  assert.equal(new Set(bass.map((e) => e.midi % 12)).size, 2, 'alternates root and fifth');
  const downStrums = events.filter((e) => e.voice === 'strum' && Number.isInteger(pos(e)));
  assert.deepEqual([...new Set(downStrums.map(pos))].sort(), [1, 3]);
});

test('funk: ghost notes, an open hat on the "and" of 4, and slap bass that pops the octave', () => {
  const song = { ...emptySong('funk'), blocks: [makeBlock('verse', { bars: 2, seed: 8 })] };
  const { events, bpm } = render(song);
  const beat = 60 / bpm, pos = (e) => (Math.round((e.t / beat) * 1000) / 1000) % 4;
  const snares = events.filter((e) => e.drum === 'snare');
  assert.ok(snares.some((e) => e.vel < 0.3 && ![1, 3].includes(pos(e))), 'ghost notes');
  assert.ok(events.some((e) => e.drum === 'hat' && e.open && pos(e) === 3.5));
  const bass = events.filter((e) => e.track === 'bass').map((e) => e.midi);
  assert.ok(bass.some((m) => bass.includes(m - 12)), 'octave pops');
});

test('radio: a station plays its style, varies every track, and repeats for the same seed', () => {
  for (const station of STATIONS.filter((s) => s !== MIX)) {
    const tracks = [0, 1, 2, 3].map((n) => radioTrack(station, 'demo', n));
    assert.ok(tracks.every((t) => t.style === station), `${station}: stays on style`);
    assert.equal(new Set(tracks.map((t) => t.origin.tag)).size, 4, `${station}: fresh song each track`);
    const again = radioTrack(station, 'demo', 2), noIds = (song) => ({ ...song, blocks: song.blocks.map(({ id, ...b }) => b) });
    assert.deepEqual(noIds(again), noIds(tracks[2]), `${station}: same seed, same song`);
    assert.notEqual(radioTrack(station, 'other', 0).origin.tag, tracks[0].origin.tag);
    for (const t of tracks) {
      assert.ok(Math.abs(t.bpm / STYLES[station].bpm - 1) <= 0.07, `${station}: tempo stays in the style's feel`);
      assert.equal(t.blocks.at(-1).type, 'hit', 'every track ends properly');
    }
  }
});

test('radio: mix visits every style before repeating one', () => {
  const styles = STYLE_IDS.map((_, n) => radioTrack(MIX, 'demo', n).style);
  assert.deepEqual([...styles].sort(), [...STYLE_IDS].sort());
  for (let n = 1; n < STYLE_IDS.length * 3; n++) assert.notEqual(radioTrack(MIX, 's', n).style, radioTrack(MIX, 's', n - 1).style);
});

test('radio: every track has a link that rebuilds the same song', () => {
  const strip = (song) => song.blocks.map(({ id, ...b }) => b);
  for (const station of [MIX, 'jazz', 'edm']) for (let n = 0; n < 4; n++) {
    const t = radioTrack(station, 'links', n);
    const d = decodeShare(songHash(t));
    assert.equal(d.kind, 'song');
    assert.deepEqual(strip(d.song), strip(t));
    assert.equal(d.song.key, t.key); assert.equal(d.song.bpm, t.bpm); assert.equal(d.song.style, t.style);
  }
  assert.deepEqual(decodeShare('#radio:jazz'), { kind: 'radio', station: 'jazz' });
  assert.deepEqual(decodeShare('https://tom.wemiller.com/#radio'), { kind: 'radio', station: null });
});

test('in-place reverb and echo are bit-identical to the copying versions', async () => {
  const { reverb, reverbInPlace, echo, echoInPlace } = await import('../lib/dsp.mjs');
  const r = (await import('../lib/rng.mjs')).rng('fx');
  const sig = () => Float32Array.from({ length: 30000 }, () => r.noise() * 0.5);
  const L = sig(), R = sig();
  const [a, b] = reverb(L, R, { size: 0.7, mix: 0.3 });
  const [c, d] = reverbInPlace(Float32Array.from(L), Float32Array.from(R), { size: 0.7, mix: 0.3 });
  assert.equal(hash(a), hash(c)); assert.equal(hash(b), hash(d));
  assert.equal(hash(echo(L, 0.05)), hash(echoInPlace(Float32Array.from(L), 0.05)));
});

test('varied arranger: new songs differ in form, texture and ending; old links keep theirs', () => {
  const songs = Array.from({ length: 24 }, (_, n) => radioTrack('synthwave', 'variety', n));
  const forms = new Set(songs.map((s) => s.blocks.map((b) => b.type).join(' ')));
  assert.ok(forms.size >= 5, `only ${forms.size} song forms`);
  const breaks = songs.flatMap((s) => s.blocks.filter((b) => b.type === 'break'));
  assert.ok(breaks.length && breaks.filter((b) => b.layers.bells).length / breaks.length < 0.5, 'bells in most breaks');
  const sparkles = songs.map((s) => s.blocks.at(-1).sparkle !== false);
  assert.ok(sparkles.includes(true) && sparkles.includes(false), 'endings vary');
  for (const s of songs) {
    const choruses = s.blocks.filter((b) => b.type === 'chorus');
    assert.ok(choruses.every((c) => c.seed === choruses[0].seed), 'choruses share one hook');
  }
  // a link without gen stays on the original arranger
  const old = decodeShare('#song:road-trip&length=short').song, v2 = decodeShare('#song:road-trip&length=short&gen=2').song;
  assert.deepEqual(old.blocks.map((b) => b.type), ['intro', 'verse', 'chorus', 'outro', 'hit']);
  assert.equal(songHash(v2), '#song:road-trip&length=short&gen=2');
});

test('varied songs render cleanly in every style', () => {
  for (const style of STYLE_IDS) {
    const out = render(songFromTag('clean-check', { style, length: 'short', gen: 2 }));
    let peak = 0;
    for (const v of out.L) { assert.ok(Number.isFinite(v), `${style}: non-finite sample`); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.1 && peak <= 0.9, `${style}: peak ${peak}`);
  }
});

test('radio: a mix limited to some styles plays only those, still without back-to-back repeats', () => {
  const pick = ['jazz', 'funk', 'rock'];
  const styles = Array.from({ length: 12 }, (_, n) => radioTrack(MIX, 'subset', n, { styles: pick }).style);
  assert.deepEqual([...new Set(styles)].sort(), [...pick].sort());
  for (let n = 1; n < styles.length; n++) assert.notEqual(styles[n], styles[n - 1]);
  assert.ok(Array.from({ length: 5 }, (_, n) => radioTrack(MIX, 'one', n, { styles: ['reggae'] }).style).every((s) => s === 'reggae'));
  assert.equal(radioTrack(MIX, 'all', 3, { styles: [] }).style, radioTrack(MIX, 'all', 3).style, 'empty means every style');
});

test('the web app shows the same version as package.json', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(readFileSync(join(ROOT, 'web/app.js'), 'utf8'), new RegExp(`export const VERSION = '${pkg.version.replace(/\./g, '\\.')}'`));
});
