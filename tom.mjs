#!/usr/bin/env node
// Tom 🦎 — a music machine. Seeded, parameterized, royalty-free melodies and
// songs from the command line (and the same engine in the browser).
//
//   tom melody      a quick melody over a backing loop
//   tom song        a whole auto-arranged song
//   tom jingle      a short bed with a final hit at an exact time (video end cards)
//   tom render      render a blueprint saved from the web composer
//   tom radio       render the next few songs of a style's radio station
//   tom compose     open the Lego-style web composer locally
//   tom styles      list styles
//   tom doctor      check the environment
//
// Zero dependencies; Node >= 18. ffmpeg is optional (m4a/mp3 + loudness).
import { writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { c, mascot, ok, info, warn, err, step, quip, quips, pick } from './lib/brand.mjs';
import { render } from './lib/arrange.mjs';
import { jingle, melodySong, validate } from './lib/blueprint.mjs';
import { tagOf, randomTag, melodyFromTag, melodyHash, songFromTag, songHash, decodeShare, shareUrl, HOSTED_URL } from './lib/share.mjs';
import { STYLES } from './lib/styles.mjs';
import { STATIONS, MIX, radioTrack, trackTitle, stationName } from './lib/radio.mjs';
import { SCALES, CONTOUR_NAMES } from './lib/theory.mjs';
import { encodeWav } from './lib/wav.mjs';
import { toMidi } from './lib/midi.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
const HOSTED = HOSTED_URL;

const HELP = `${mascot()}
${c.bold('Usage')}
  tom melody  [options]              a quick melody over a backing loop
  tom song    [options]              a whole auto-arranged song
  tom jingle  [options]              short bed with a final hit (video end cards)
  tom render  <song.json | link | #tag>  render a composer song or any share link
  tom radio   [--station <style|mix>] [--count 3] [--seed s] [--out dir] [--format wav|m4a|mp3]
                                     the next few songs of a radio station, one file each
  tom compose [--port 5178] [--no-open]  open the Lego-style composer locally
  tom styles                         list styles
  tom doctor                         check node / ffmpeg

${c.bold('Common options')}
  --style <id>        ${Object.keys(STYLES).join(' | ')}
  --seed <#tag>       any word or #hashtag; a tag alone picks the whole recipe,
                      and every render prints its share link
  --key <note>        e.g. A, F#, Eb, C4        --mode <m>  ${Object.keys(SCALES).join(' | ')}
  --bpm <n>           tempo (defaults per style)
  --out <file>        .wav (default), or .m4a/.mp3 via ffmpeg
  --midi <file>       also write a Standard MIDI File
  --blueprint <file>  also save the song as JSON (open it in the composer)
  --loudness <LUFS>   loudness target when ffmpeg is present (default -14)

${c.bold('Melody dials')} (tom melody)
  --bars <4|8|16>     --density <0-1>   --syncopation <0-1>
  --contour <${CONTOUR_NAMES.join('|')}>   --form <AABA|ABAB|AAAB|ABAC|ABCD>
  --octave <0-2>      --range <1|2>     --progression <"1-5-6-4" | "vi-IV-I-V">
  --no-chords --no-bass --drums <none|light|half|full>

${c.bold('Song / jingle')}
  tom song --length <full|short|loop>
  tom jingle --length 9.1 --hit 6.75 [--lead]

${c.bold('Examples')}
  tom melody --seed '#sunset-drive' --out hook.wav --midi hook.mid
  tom render 'https://tom.wemiller.com/#sunset-drive&busy=0.8'
  tom melody --style chip --density 0.8 --contour rise --form AAAB
  tom song --style synthwave --seed 57 --out night-drive.m4a --blueprint night-drive.json
  tom jingle --style synthwave --length 9.1 --hit 6.75 --out bed.wav

Web composer: ${HOSTED}  (or run: tom compose)
`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--no-')) a[t.slice(5)] = false;
    else if (t.startsWith('--')) {
      const k = t.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[k] = true; else { a[k] = next; i++; }
    } else a._.push(t);
  }
  return a;
}
const num = (v, d) => (v === undefined || v === true ? d : Number(v));

function hasFfmpeg() {
  try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; }
}

async function writeOutputs(bp, a, defaultName, link = null) {
  step(`Rendering ${c.bold(bp.title)} ${c.dim(`(${bp.style}, ${bp.key} ${bp.mode}, ${Math.round(bp.bpm)} bpm, seed ${bp.seed})`)}`);
  quip(pick(quips.start));
  const t0 = performance.now();
  const out = render(bp);
  info(`${out.duration.toFixed(1)} s of audio in ${((performance.now() - t0) / 1000).toFixed(2)} s`);

  const target = resolve(a.out && a.out !== true ? a.out : defaultName);
  await mkdir(dirname(target), { recursive: true });
  const wav = encodeWav(out.L, out.R, out.sampleRate);
  const ext = extname(target).toLowerCase();
  const ff = hasFfmpeg();
  const lufs = num(a.loudness, -14);
  if (ext === '.wav' && (!ff || a.loudness === false)) {
    await writeFile(target, wav);
  } else if (!ff) {
    const fallback = target.replace(/\.[^.]+$/, '.wav');
    await writeFile(fallback, wav);
    warn(`ffmpeg not found — wrote WAV instead: ${fallback}`);
  } else {
    const tmp = join(tmpdir(), `tom-${process.pid}-${Date.now()}.wav`);
    await writeFile(tmp, wav);
    const codec = ext === '.mp3' ? ['-c:a', 'libmp3lame', '-b:a', '256k'] : ext === '.m4a' || ext === '.aac' ? ['-c:a', 'aac', '-b:a', '256k'] : [];
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', `loudnorm=I=${lufs}:TP=-1:LRA=11`, '-ar', '44100', ...codec, target], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
  }
  ok(`audio  → ${target}`);
  if (a.midi) {
    const p = resolve(a.midi === true ? target.replace(/\.[^.]+$/, '.mid') : a.midi);
    await writeFile(p, toMidi(out.events, out.bpm, bp.title));
    ok(`midi   → ${p}`);
  }
  if (a.blueprint) {
    const p = resolve(a.blueprint === true ? target.replace(/\.[^.]+$/, '.json') : a.blueprint);
    await writeFile(p, JSON.stringify(bp, null, 2));
    ok(`song   → ${p} ${c.dim('(open in the composer to keep editing)')}`);
  }
  if (link) info(`share  → ${c.bold(shareUrl(link))}`);
  quip(pick(quips.done));
}

function common(a) {
  const style = a.style && a.style !== true ? a.style : undefined;
  if (style && !STYLES[style]) throw new Error(`Unknown style "${style}". Try: ${Object.keys(STYLES).join(', ')}`);
  return {
    style, seed: a.seed !== undefined && a.seed !== true ? tagOf(a.seed) : randomTag(),
    key: a.key !== true ? a.key : undefined, mode: a.mode !== true ? a.mode : undefined,
    bpm: a.bpm !== undefined && a.bpm !== true ? Number(a.bpm) : undefined,
  };
}

async function serve(port, open = true) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // The site ships web/ at the root with lib/ beside it — same layout as GitHub Pages.
    const file = p.startsWith('/lib/') ? join(ROOT, p) : join(ROOT, 'web', p);
    if (!file.startsWith(ROOT) || !existsSync(file) || (await stat(file)).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${port}/`;
  ok(`Composer running at ${c.bold(url)}  ${c.dim('(Ctrl-C to stop)')}`);
  if (open && process.platform === 'darwin') spawnSync('open', [url]);
}

/** Render the next few songs of a radio station into a folder. */
async function radioCmd(a) {
  const station = a.station && a.station !== true ? a.station : a.style && a.style !== true ? a.style : MIX;
  if (!STATIONS.includes(station)) throw new Error(`Unknown station "${station}". Try: ${STATIONS.join(', ')}`);
  const seed = a.seed !== undefined && a.seed !== true ? String(tagOf(a.seed)) : randomTag();
  const count = Math.max(1, Math.min(50, num(a.count, 3)));
  const dir = a.out && a.out !== true ? a.out : `tom-radio-${station}-${seed}`;
  const ext = a.format && a.format !== true ? a.format.replace(/^\./, '') : 'wav';
  info(`${stationName(station)} Radio ${c.dim(`(station seed ${seed}; the same seed plays the same songs)`)}`);
  for (let n = 0; n < count; n++) {
    const bp = radioTrack(station, seed, n);
    await writeOutputs(bp, { ...a, out: join(dir, `${String(n + 1).padStart(2, '0')} ${trackTitle(bp)}.${ext}`) }, '', songHash(bp));
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  switch (cmd) {
    case undefined: case 'help': case '-h': case '--help':
      process.stdout.write(HELP); return;
    case '--version': case 'version':
      console.log(VERSION); return;
    case 'styles':
      console.log(mascot());
      for (const [id, s] of Object.entries(STYLES)) console.log(`  ${c.bold(id.padEnd(10))} ${s.name.padEnd(12)} ${c.dim(`${s.key} ${s.mode}, ${Math.round(s.bpm)} bpm`)}  ${s.blurb}`);
      return;
    case 'doctor': {
      console.log(mascot());
      const major = Number(process.versions.node.split('.')[0]);
      (major >= 18 ? ok : err)(`node ${process.versions.node} ${major >= 18 ? '' : '(need >= 18)'}`);
      hasFfmpeg() ? ok('ffmpeg found — m4a/mp3 export and loudness normalization available') : warn('ffmpeg not found — WAV only, no loudness normalization (brew install ffmpeg)');
      info(`web composer: ${HOSTED}`);
      return;
    }
    case 'melody': {
      const o = common(a);
      const p = melodyFromTag(o.seed); // the tag's own recipe; flags below override it
      const flag = (k, v) => { if (v !== undefined && v !== true) p[k] = v; };
      // Choosing a style brings its key, mode and tempo — like tapping a style in the web app.
      if (o.style && o.style !== p.style) { const st = STYLES[o.style]; Object.assign(p, { style: o.style, key: st.key, mode: st.mode, bpm: Math.round(st.bpm), progression: '' }); }
      flag('key', o.key); flag('mode', o.mode); flag('bpm', o.bpm);
      flag('bars', a.bars !== undefined ? num(a.bars) : undefined);
      flag('density', a.density !== undefined ? num(a.density) : undefined);
      flag('syncopation', a.syncopation !== undefined ? num(a.syncopation) : undefined);
      flag('contour', a.contour); flag('form', a.form);
      flag('octave', a.octave !== undefined ? num(a.octave) : undefined);
      flag('progression', a.progression);
      if (a.chords === false) p.chords = false;
      if (a.bass === false) p.bass = false;
      if (a.drums !== undefined) p.drums = a.drums === false ? 'none' : a.drums;
      const bp = melodySong({ ...p, progression: p.progression || undefined, ending: a.ending !== false });
      return writeOutputs(bp, a, `tom-melody-${p.seed}.wav`, melodyHash(p));
    }
    case 'song': {
      const o = common(a);
      const bp = songFromTag(o.seed, { length: a.length && a.length !== true ? a.length : 'full', style: o.style, key: o.key, bpm: o.bpm });
      return writeOutputs(bp, a, `tom-song-${bp.origin.tag}.wav`, songHash(bp));
    }
    case 'jingle': {
      const o = common(a);
      const bp = jingle({ ...o, style: o.style || 'synthwave', length: num(a.length, 9.1), hit: num(a.hit, 6.75), lead: a.lead === undefined ? undefined : !!a.lead });
      return writeOutputs(bp, a, `tom-jingle-${bp.style}-${bp.seed}.wav`);
    }
    case 'render': {
      const src = a._[0];
      if (!src) throw new Error('Usage: tom render <song.json | share link | #hashtag> [--out file]');
      if (/^https?:|^#/.test(src) || (!existsSync(src) && !src.endsWith('.json'))) {
        const d = decodeShare(src.includes('#') ? src : `#${src}`);
        if (!d) throw new Error(`Nothing to render in "${src}"`);
        if (d.kind === 'radio') return radioCmd({ ...a, station: d.station || a.station });
        if (d.kind === 'melody') return writeOutputs(melodySong({ ...d.params, progression: d.params.progression || undefined, ending: true }), a, `tom-melody-${d.params.seed}.wav`, melodyHash(d.params));
        return writeOutputs(d.song, a, `tom-song-${d.song.origin?.tag ?? 'shared'}.wav`, songHash(d.song));
      }
      const bp = validate(JSON.parse(await readFile(src, 'utf8')));
      return writeOutputs(bp, a, src.replace(/\.json$/i, '') + '.wav', songHash({ ...bp, edited: true }));
    }
    case 'radio':
      return radioCmd(a);
    case 'compose':
      console.log(mascot());
      return serve(num(a.port, 5178), a.open !== false);
    default:
      throw new Error(`Unknown command "${cmd}". Run: tom help`);
  }
}

main().catch((e) => { err(e.message || String(e)); process.exit(1); });
