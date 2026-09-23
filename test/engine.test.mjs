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
import { STYLE_IDS } from '../lib/styles.mjs';
import { encodeWav } from '../lib/wav.mjs';
import { toMidi } from '../lib/midi.mjs';
import { tagOf, melodyFromTag, melodyHash, songFromTag, songHash, decodeShare } from '../lib/share.mjs';

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
