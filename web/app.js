// Tom — web music machine. Melody Machine, Lego-style Composer and Radio, all
// driven by the same engine as the CLI (rendered in a Web Worker).
import { STYLES, STYLE_IDS } from './lib/styles.mjs';
import { SCALES, CONTOUR_NAMES, chord, parseKey, noteName, spell, parseProgression, layoutChords } from './lib/theory.mjs';
import {
  BLOCK_TYPES, BLOCK_ORDER, DRUM_LEVELS, FORMS, makeBlock, emptySong, autoSong, autoFill, autoBlock,
  melodySong, validate,
} from './lib/blueprint.mjs';
import { blockMelody, timeline, resolve } from './lib/arrange.mjs';
import { rng } from './lib/rng.mjs';
import { encodeWav } from './lib/wav.mjs';
import { toMidi } from './lib/midi.mjs';
import { tagOf, randomTag, melodyFromTag, melodyHash, songHash, songFromTag, decodeShare } from './lib/share.mjs';
import { STATIONS, MIX, stationName } from './lib/radio.mjs';
import { createRadio, radioLog, radioLogText, clearRadioLog } from './radio.js';

export const VERSION = '0.8.1';
const BUILD = new URL(import.meta.url).searchParams.get('v'); // the deploy's commit, stamped by scripts/stamp.mjs

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), sv);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PRESETS = {
  major: [['1-5-6-4', 'I–V–vi–IV · anthem'], ['1-6-4-5', 'I–vi–IV–V · doo-wop'], ['6-4-1-5', 'vi–IV–I–V · heartfelt'], ['1-4-5-1', 'I–IV–V–I · classic'], ['4-5-1-6', 'IV–V–I–vi · lift'], ['2-5-1-6', 'ii–V–I–vi · jazzy'], ['1-3-4-5', 'I–iii–IV–V · bright']],
  minor: [['6-7-1-1', 'VI–VII–i · synthwave'], ['1-6-3-7', 'i–VI–III–VII · epic'], ['1-4-6-5', 'i–iv–VI–v · moody'], ['6-4-1-5', 'VI–iv–i–v · drift'], ['4-6-7-7', 'iv–VI–VII · rise'], ['1-7-6-7', 'i–VII–VI–VII · run']],
};
const CONTOUR_PATHS = { arch: 'M2 12 Q13 -4 24 12', rise: 'M2 12 L24 2', fall: 'M2 2 L24 12', wave: 'M2 7 Q7 -1 13 7 T24 7', flat: 'M2 7 L24 7' };
const LAYER_LABELS = { pad: 'Chords', arp: 'Arp', bass: 'Bass', lead: 'Melody', counter: 'Counter', bells: 'Bells', octaves: 'Octaves', riser: 'Riser', crash: 'Crash' };
const LAYER_ABBR = { pad: 'CH', arp: 'AR', bass: 'BS', lead: 'MEL', counter: 'CTR', bells: 'BEL', octaves: '8VA', riser: 'RSR' };

// ─── persistence ────────────────────────────────────────────────────────────
const store = {
  get(k, d) { try { const v = localStorage.getItem(`tom:${k}`); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`tom:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
const randSeed = () => Math.floor(Math.random() * 999999) + 1;
const showTag = (t) => `#${t}`;

const state = {
  view: store.get('view', 'melody'),
  melody: store.get('melody', null) || melodyFromTag(randomTag()),
  song: store.get('song', null) || songFromTag('neon-gecko-57', { length: 'short', style: 'synthwave' }),
  selected: null,
  station: store.get('station', null),
};

// ─── rendering (worker) + playback ──────────────────────────────────────────
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error)); } };
const renderInWorker = (bp) => new Promise((resolve, reject) => { const id = ++reqId; pending.set(id, { resolve, reject }); worker.postMessage({ id, bp }); });

const cache = { key: null, result: null };
async function renderCached(bp) {
  const key = JSON.stringify(bp);
  if (cache.key === key) return cache.result;
  setStatus('rendering…');
  const result = await renderInWorker(bp);
  cache.key = key; cache.result = result;
  setStatus('');
  return result;
}

let ac = null, src = null, playing = null;
// Rendering takes a moment, so a press of Play is pending until its audio is
// ready. Stop (or switching tabs) bumps the token, and a render that finishes
// for an old token never starts: only one source can ever be playing.
let playToken = 0, loading = false;
async function startPlayback(bp, { loop = false, view = state.view } = {}) {
  stopPlayback();
  radio.stop();
  const my = playToken;
  loading = true; setPlayButton(true);
  ac ??= new AudioContext(); // created inside the tap, so Safari lets it start
  const resumed = ac.state === 'suspended' ? ac.resume() : null;
  let r;
  try { r = await renderCached(bp); await resumed; } finally { if (my === playToken) loading = false; }
  if (my !== playToken) return;
  const buf = ac.createBuffer(2, r.L.length, r.sampleRate);
  buf.copyToChannel(r.L, 0); buf.copyToChannel(r.R, 1);
  src = ac.createBufferSource();
  src.buffer = buf; src.loop = loop; src.connect(ac.destination);
  src.onended = () => { if (playing && !loop) stopPlayback(); };
  src.start();
  playing = { t0: ac.currentTime, duration: r.duration, loop, view, bp };
  setPlayButton(true);
  requestAnimationFrame(tick);
}
function stopPlayback() {
  playToken++; loading = false;
  if (src) { src.onended = null; try { src.stop(); } catch { /* already stopped */ } src = null; }
  playing = null;
  setPlayButton(state.view === 'radio' && radio.active);
  $('#playhead').hidden = true;
  drawRoll();
  updateClock(0);
}
function setPlayButton(on) {
  const b = $('#play'), label = on ? (state.view === 'radio' ? 'Pause' : 'Stop') : 'Play';
  b.classList.toggle('on', on); $('.ico', b).textContent = on ? (state.view === 'radio' ? '❚❚' : '■') : '▶'; $('.lbl', b).textContent = label; b.setAttribute('aria-label', label);
}
function position() {
  if (!playing) return 0;
  const t = ac.currentTime - playing.t0;
  return playing.loop ? t % playing.duration : Math.min(t, playing.duration);
}
function tick() {
  if (!playing) return;
  const t = position();
  updateClock(t);
  if (playing.view === 'melody') drawRoll(t);
  else if (playing.view === 'compose') movePlayhead(t);
  requestAnimationFrame(tick);
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function updateClock(t) {
  if (state.view === 'radio') { $('#clock').textContent = `${fmt(radio.position)} / ${fmt(radio.duration)}`; return; }
  const total = playing ? playing.duration : currentDuration();
  $('#clock').textContent = `${fmt(t)} / ${fmt(total)}`;
}
function currentDuration() {
  if (state.view === 'radio') return radio.duration;
  try { return timeline(state.view === 'melody' ? melodyBlueprint() : state.song).duration; } catch { return 0; }
}
function setStatus(s) { $('#status').textContent = s; }
function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t); setTimeout(() => t.remove(), 2200);
}

// ─── Melody Machine ─────────────────────────────────────────────────────────
function melodyBlueprint({ ending = false } = {}) {
  const m = state.melody;
  return melodySong({ ...m, progression: m.progression || undefined, range: 1, ending });
}

function segmented(el, options, current, onPick, { color } = {}) {
  el.replaceChildren(...options.map(([value, label, extra]) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(value === current),
    style: color ? { '--chip': color(value) } : {},
    on: { click: () => onPick(value) },
  }, extra || null, label)));
}
const contourIcon = (c) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 26 14'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', CONTOUR_PATHS[c]); s.append(p); return s; };
const swatch = () => h('span', { class: 'swatch' });

function fillSelect(sel, items, value) {
  sel.replaceChildren(...items.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

function renderMelodyControls() {
  const m = state.melody;
  document.documentElement.style.setProperty('--style', STYLES[m.style].color);
  segmented($('#m-style'), Object.entries(STYLES).map(([id, s]) => [id, s.name, swatch()]), m.style, (v) => {
    const s = STYLES[v]; Object.assign(state.melody, { style: v, key: s.key, mode: s.mode, bpm: Math.round(s.bpm), progression: '' }); changedMelody();
  }, { color: (v) => STYLES[v].color });
  fillSelect($('#m-key'), KEYS.map((k) => [k, k]), m.key);
  fillSelect($('#m-mode'), Object.keys(SCALES).map((k) => [k, k]), m.mode);
  $('#m-bpm').value = m.bpm; $('#m-bpm-v').textContent = `${Math.round(m.bpm)} bpm`;
  segmented($('#m-bars'), [[4, '4'], [8, '8'], [16, '16']], m.bars, (v) => set({ bars: v }));
  $('#m-density').value = m.density; $('#m-density-v').textContent = Math.round(m.density * 100) + '%';
  $('#m-sync').value = m.syncopation; $('#m-sync-v').textContent = Math.round(m.syncopation * 100) + '%';
  segmented($('#m-contour'), CONTOUR_NAMES.map((c) => [c, c, contourIcon(c)]), m.contour, (v) => set({ contour: v }));
  segmented($('#m-form'), FORMS.map((f) => [f, f]), m.form, (v) => set({ form: v }));
  segmented($('#m-octave'), [[0, 'Low'], [1, 'Mid'], [2, 'High']], m.octave, (v) => set({ octave: v }));
  const presets = /minor|dorian/.test(m.mode) ? PRESETS.minor : PRESETS.major;
  fillSelect($('#m-prog'), [['', `Style default (${STYLES[m.style].progressions.chorus || STYLES[m.style].progressions.default})`], ...presets], m.progression);
  segmented($('#m-backing'), [['chords', 'Chords'], ['bass', 'Bass']], null, (v) => set({ [v]: !m[v] }));
  [...$('#m-backing').children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0 ? m.chords : m.bass)));
  segmented($('#m-drums'), ['none', 'light', 'half', 'full'].map((d) => [d, d]), m.drums, (v) => set({ drums: v }));
  $('#m-seed').value = showTag(m.seed);
  const bp = melodyBlueprint(), r = resolve(bp);
  $('#meta-line').textContent = `${STYLES[m.style].name.toUpperCase()} · ${spell(r.root, r.root, r.scale)} ${m.mode} · ${Math.round(r.bpm)} BPM · ${m.bars} BARS · ${showTag(m.seed)}`;
  updateClock(position());
}
function set(patch) { Object.assign(state.melody, patch); changedMelody(); }

let melodyTimer = null;
function changedMelody() {
  store.set('melody', state.melody);
  syncHash();
  renderMelodyControls();
  drawRoll();
  clearTimeout(melodyTimer);
  melodyTimer = setTimeout(() => { if (playing?.view === 'melody' || (loading && state.view === 'melody')) startPlayback(melodyBlueprint(), { loop: true, view: 'melody' }); else renderCached(melodyBlueprint()).catch(showError); }, 180);
}

function chordLabel(root, S, degree) {
  const ch = chord(root, S, degree);
  const third = (ch[1] - ch[0] + 12) % 12, fifth = (ch[2] - ch[0] + 12) % 12;
  return spell(ch[0], root, S) + (fifth === 6 ? '°' : third === 3 ? 'm' : '');
}

function drawRoll(t = null) {
  const cv = $('#roll'); if (!cv || state.view !== 'melody') return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const bp = melodyBlueprint(), r = resolve(bp), notes = blockMelody(bp, 0);
  const beats = bp.blocks[0].bars * 4, color = STYLES[bp.style].color;
  const lo = Math.min(...notes.map((n) => n.midi)) - 2, hi = Math.max(...notes.map((n) => n.midi)) + 2;
  const top = 8, bottom = H - 26, rowH = (bottom - top) / Math.max(1, hi - lo);
  const x = (b) => 8 + (b / beats) * (W - 16);
  // grid: beats and bars
  for (let b = 0; b <= beats; b++) { g.fillStyle = b % 4 === 0 ? 'rgba(159,242,184,.22)' : 'rgba(159,242,184,.07)'; g.fillRect(x(b), top, 1, bottom - top); }
  for (let m = lo; m <= hi; m++) if ([1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(8, bottom - (m - lo + 1) * rowH, W - 16, rowH); }
  // chords
  const spans = layoutChords(parseProgression(bp.blocks[0].progression || STYLES[bp.style].progressions.chorus || STYLES[bp.style].progressions.default), bp.blocks[0].bars);
  g.font = '600 11px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(159,242,184,.7)';
  for (const s of spans) g.fillText(chordLabel(r.root, r.scale, s.degree), x(s.start) + 4, H - 8);
  // notes
  const now = t == null ? -1 : (t / (60 / r.bpm));
  for (const n of notes) {
    const nx = x(n.beat), nw = Math.max(4, x(n.beat + n.beats) - nx - 2), ny = bottom - (n.midi - lo + 1) * rowH;
    const active = now >= n.beat && now < n.beat + n.beats;
    g.fillStyle = active ? '#ffffff' : color;
    g.shadowColor = color; g.shadowBlur = active ? 16 : 6;
    roundRect(g, nx, ny + 1, nw, Math.max(4, rowH - 2), 3); g.fill();
  }
  g.shadowBlur = 0;
  if (t != null) { g.fillStyle = '#ffd23f'; g.fillRect(x(Math.min(beats, now)), top, 2, bottom - top); }
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// ─── Composer ───────────────────────────────────────────────────────────────
function songChanged({ keepSelection = true, edited = true } = {}) {
  if (edited) state.song.edited = true;
  if (!keepSelection || !state.song.blocks.some((b) => b.id === state.selected)) state.selected = state.song.blocks[0]?.id ?? null;
  store.set('song', state.song);
  syncHash();
  renderComposer();
  if (playing?.view === 'compose') stopPlayback();
}

function renderComposer() {
  const s = state.song, st = STYLES[s.style];
  document.documentElement.style.setProperty('--style', st.color);
  $('#c-title').value = s.title || '';
  segmented($('#c-style'), Object.entries(STYLES).map(([id, x]) => [id, x.name, swatch()]), s.style, (v) => {
    const x = STYLES[v]; Object.assign(state.song, { style: v, key: x.key, mode: x.mode, bpm: Math.round(x.bpm) }); songChanged();
  }, { color: (v) => STYLES[v].color });
  fillSelect($('#c-key'), KEYS.map((k) => [k, k]), s.key);
  fillSelect($('#c-mode'), Object.keys(SCALES).map((k) => [k, k]), s.mode);
  $('#c-bpm').value = Math.round(s.bpm);
  let dur = 0; try { dur = timeline(s).duration; } catch { /* empty */ }
  $('#c-length').textContent = `${s.blocks.length} blocks · ${fmt(dur)}`;
  renderPalette(); renderTimeline(); renderInspector(); updateClock(position());
}

function renderPalette() {
  $('#palette').replaceChildren(...BLOCK_ORDER.map((type) => {
    const t = BLOCK_TYPES[type];
    return h('button', {
      class: 'brick', type: 'button', draggable: 'true', style: { '--c': t.color },
      title: `Add ${t.label}`,
      on: {
        click: () => insertBlock(type),
        dragstart: (e) => { e.dataTransfer.setData('text/tom-new', type); e.dataTransfer.effectAllowed = 'copy'; },
      },
    }, t.label, h('small', {}, type === 'hit' ? 'final hit' : `${t.bars} bars`));
  }));
}

function insertBlock(type, at = null) {
  const b = autoBlock(makeBlock(type), rng(randSeed()), state.song);
  const blocks = state.song.blocks;
  let i = at ?? (blocks.findIndex((x) => x.id === state.selected) + 1 || blocks.length);
  const hitAt = blocks.findIndex((x) => x.type === 'hit');
  if (type !== 'hit' && hitAt >= 0 && i > hitAt) i = hitAt; // keep the ending last
  blocks.splice(i, 0, b);
  state.selected = b.id;
  songChanged();
}

let dragId = null;
function renderTimeline() {
  const tl = $('#timeline');
  $('#empty').hidden = state.song.blocks.length > 0;
  tl.replaceChildren(...state.song.blocks.map((b) => {
    const t = BLOCK_TYPES[b.type];
    const L = { ...t.layers, ...b.layers };
    const on = Object.keys(LAYER_ABBR).filter((k) => L[k]);
    const el = h('div', {
      class: `brick${b.locked ? ' locked' : ''}`, role: 'button', tabindex: '0', draggable: 'true',
      'aria-selected': String(b.id === state.selected), 'aria-label': `${t.label}, ${b.type === 'hit' ? 'ending' : b.bars + ' bars'}`,
      style: { '--c': t.color, width: `${b.type === 'hit' ? 80 : Math.max(84, b.bars * 10)}px` },
      on: {
        click: () => { state.selected = b.id; renderTimeline(); renderInspector(); },
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.selected = b.id; renderTimeline(); renderInspector(); }
          if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeBlock(b.id); }
          if (e.key === 'ArrowLeft' && e.altKey) moveBlock(b.id, -1);
          if (e.key === 'ArrowRight' && e.altKey) moveBlock(b.id, 1);
        },
        dragstart: (e) => { dragId = b.id; e.dataTransfer.setData('text/tom-move', b.id); e.dataTransfer.effectAllowed = 'move'; },
        dragover: (e) => { e.preventDefault(); el.classList.add('drop-before'); },
        dragleave: () => el.classList.remove('drop-before'),
        drop: (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('drop-before'); dropAt(e, state.song.blocks.findIndex((x) => x.id === b.id)); },
      },
    },
    h('span', { class: 'b-name' }, t.label),
    h('span', { class: 'b-bars' }, b.type === 'hit' ? `${Number(b.tail ?? 2.35).toFixed(1)}s` : `${b.bars} bars${L.drums && L.drums !== 'none' ? ` · ${L.drums}` : ''}`),
    h('span', { class: 'b-layers' }, on.map((k) => h('i', {}, LAYER_ABBR[k]))));
    return el;
  }));
}
function dropAt(e, index) {
  const nt = e.dataTransfer.getData('text/tom-new');
  if (nt) return insertBlock(nt, index);
  const id = e.dataTransfer.getData('text/tom-move') || dragId;
  const blocks = state.song.blocks, from = blocks.findIndex((x) => x.id === id);
  if (from < 0) return;
  const [b] = blocks.splice(from, 1);
  blocks.splice(index > from ? index - 1 : index, 0, b);
  state.selected = b.id; songChanged();
}
function moveBlock(id, d) {
  const blocks = state.song.blocks, i = blocks.findIndex((x) => x.id === id), j = i + d;
  if (j < 0 || j >= blocks.length) return;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; songChanged();
}
function removeBlock(id) {
  state.song.blocks = state.song.blocks.filter((x) => x.id !== id); songChanged({ keepSelection: false });
}

function movePlayhead(t) {
  const ph = $('#playhead'), bricks = [...$('#timeline').children];
  const { starts, duration } = timeline(playing.bp);
  let i = starts.findIndex((s, k) => t >= s && (k === starts.length - 1 || t < starts[k + 1]));
  if (i < 0 || !bricks[i]) { ph.hidden = true; return; }
  const end = i === starts.length - 1 ? duration : starts[i + 1];
  const frac = (t - starts[i]) / Math.max(0.001, end - starts[i]);
  ph.hidden = false;
  // offsetLeft is already measured from .timeline-wrap (the playhead's containing block, padding included),
  // and the playhead scrolls with the bricks, so no padding or scroll correction belongs here.
  ph.style.left = `${bricks[i].offsetLeft + frac * bricks[i].offsetWidth - ph.offsetWidth / 2}px`;
}

function renderInspector() {
  const ins = $('#inspector');
  const b = state.song.blocks.find((x) => x.id === state.selected);
  if (!b) { ins.replaceChildren(h('p', { class: 'hint' }, 'Select a block on the timeline to shape it. Every change keeps its seed, so you are tuning this block, not replacing it.')); return; }
  const t = BLOCK_TYPES[b.type], L = { ...t.layers, ...b.layers }, M = b.melody || {};
  const upd = (patch) => { Object.assign(b, patch); songChanged(); };
  const updL = (patch) => upd({ layers: { ...b.layers, ...patch } });
  const updM = (patch) => upd({ melody: { ...b.melody, ...patch } });
  const field = (label, ...kids) => h('div', { class: 'dial' }, h('span', { class: 'dial-label' }, label), ...kids);
  const seg = (opts, cur, pick) => { const el = h('div', { class: 'seg' }); segmented(el, opts, cur, pick); return el; };
  const slider = (label, v, pick) => h('div', { class: 'dial' },
    h('label', { class: 'dial-label' }, label, h('b', {}, `${Math.round(v * 100)}%`)),
    h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: v, on: { change: (e) => pick(Number(e.target.value)) } }));
  const stepper = (v, min, max, stepBy, fmtv, pick) => h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': 'decrease', on: { click: () => pick(Math.max(min, +(v - stepBy).toFixed(2))) } }, '−'),
    h('output', {}, fmtv(v)),
    h('button', { type: 'button', 'aria-label': 'increase', on: { click: () => pick(Math.min(max, +(v + stepBy).toFixed(2))) } }, '+'));

  const kids = [h('h3', {}, h('span', { class: 'tag', style: { '--c': t.color } }), `${t.label}`, b.locked ? ' 🔒' : '')];
  if (b.type === 'hit') {
    kids.push(field('Ring-out', stepper(Number(b.tail ?? 2.35), 0.5, 8, 0.25, (v) => `${v.toFixed(2)}s`, (v) => upd({ tail: v }))),
      h('p', { class: 'hint' }, 'The ending lands a tonic chord, a crash and a rising bell sparkle, then rings out.'));
  } else {
    const presets = /minor|dorian/.test(state.song.mode) ? PRESETS.minor : PRESETS.major;
    const st = STYLES[state.song.style];
    const progSel = h('select', { on: { change: (e) => upd({ progression: e.target.value || undefined }) } });
    fillSelect(progSel, [['', `Style default (${st.progressions[b.type] || st.progressions.default})`], ...presets, ...(b.progression && !presets.some(([p]) => p === b.progression) ? [[b.progression, b.progression]] : [])], b.progression || '');
    const layerSeg = h('div', { class: 'seg' }, ...Object.keys(LAYER_LABELS).map((k) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(!!L[k]), on: { click: () => updL({ [k]: !L[k] }) },
    }, LAYER_LABELS[k])));
    kids.push(
      field('Length', stepper(b.bars, 1, 32, 1, (v) => `${v} bars`, (v) => upd({ bars: v }))),
      field('Chords', progSel),
      h('div', { class: 'dial wide' }, h('span', { class: 'dial-label' }, 'Layers'), layerSeg),
      field('Drums', seg(DRUM_LEVELS.map((d) => [d, d]), L.drums || 'none', (v) => updL({ drums: v }))),
      field('Filter sweep', seg([['none', 'none'], ['rise', 'open up'], ['fall', 'close down']], L.filter || 'none', (v) => updL({ filter: v === 'none' ? undefined : v }))),
      slider('Melody busy-ness', M.density ?? 0.5, (v) => updM({ density: v })),
      slider('Syncopation', M.syncopation ?? 0.3, (v) => updM({ syncopation: v })),
      field('Melody shape', seg(CONTOUR_NAMES.map((c) => [c, c, contourIcon(c)]), M.contour, (v) => updM({ contour: v }))),
      field('Phrase form', seg(FORMS.map((f) => [f, f]), M.form, (v) => updM({ form: v }))),
      field('Register', seg([[0, 'Low'], [1, 'Mid'], [2, 'High']], M.octave ?? 1, (v) => updM({ octave: v }))),
      field('Seed', h('input', { class: 'lcd-input', value: b.seed, inputmode: 'numeric', on: { change: (e) => upd({ seed: Number(e.target.value) || 1 }) } })),
    );
  }
  kids.push(h('div', { class: 'actions' },
    h('button', { class: 'btn', type: 'button', on: { click: () => soloBlock(b) } }, '▶ Play this block'),
    b.type !== 'hit' && h('button', { class: 'btn', type: 'button', disabled: b.locked, on: { click: () => { Object.assign(b, autoBlock({ ...b, locked: false }, rng(randSeed()), state.song), { locked: false }); songChanged(); } } }, '✨ Surprise me'),
    h('button', { class: 'btn', type: 'button', 'aria-pressed': String(!!b.locked), on: { click: () => upd({ locked: !b.locked }) } }, b.locked ? 'Unlock' : 'Lock'),
    h('button', { class: 'btn', type: 'button', on: { click: () => moveBlock(b.id, -1) } }, '←'),
    h('button', { class: 'btn', type: 'button', on: { click: () => moveBlock(b.id, 1) } }, '→'),
    h('button', { class: 'btn', type: 'button', on: { click: () => { const i = state.song.blocks.indexOf(b); const copy = { ...structuredClone(b), id: `${b.id}c${Date.now().toString(36)}`, locked: false }; state.song.blocks.splice(i + 1, 0, copy); state.selected = copy.id; songChanged(); } } }, 'Duplicate'),
    h('button', { class: 'btn ghost', type: 'button', on: { click: () => removeBlock(b.id) } }, 'Delete')));
  ins.replaceChildren(...kids.filter(Boolean));
}

function soloBlock(b) {
  const bp = { ...state.song, blocks: [b] };
  startPlayback(bp, { loop: false, view: 'solo' }).catch(showError);
}

// ─── Radio ──────────────────────────────────────────────────────────────────
const radio = createRadio({ onChange: () => { renderRadio(); if (radio.active) stopPlayback(); }, onTrack: remember });

// Which styles the Mix plays (null = all), kept between visits like the station.
state.mixStyles = store.get('mixStyles', null);
const mixList = () => (state.mixStyles?.length ? state.mixStyles : STYLE_IDS);
const radioOpts = (station) => ({ styles: station === MIX && state.mixStyles?.length < STYLE_IDS.length ? state.mixStyles : null });

function tuneIn(station) {
  stopPlayback();
  state.station = station; store.set('station', station);
  radio.tune(station, radioOpts(station));
  syncHash();
}
function radioToggle() {
  const st = radio.state;
  if (radio.active) return radio.pause();
  if (st.station === state.station && st.status === 'paused') return radio.resume();
  if (state.station) return tuneIn(state.station);
  toast('Pick a station below');
}
function toggleMixStyle(id) {
  const now = new Set(mixList());
  if (now.has(id)) { if (now.size === 1) return toast('The Mix needs at least one style'); now.delete(id); } else now.add(id);
  state.mixStyles = STYLE_IDS.filter((x) => now.has(x));
  if (state.mixStyles.length === STYLE_IDS.length) state.mixStyles = null;
  store.set('mixStyles', state.mixStyles);
  if (radio.state.station === MIX) radio.setStyles(radioOpts(MIX).styles);
  syncHash(); renderRadio();
}

// ─── history: every song Radio plays, kept on this device ───
const HISTORY_MAX = 200; // unsaved entries; saved ones are kept forever
state.history = store.get('radioHistory', []);
state.historyFilter = store.get('historyFilter', 'recent');
function remember(track) {
  const link = songHash(track.song), song = track.song;
  const old = state.history.find((e) => e.link === link);
  const entry = { link, title: track.title, style: song.style, key: song.key, mode: song.mode, bpm: Math.round(song.bpm), at: Date.now(), saved: !!old?.saved };
  state.history = [entry, ...state.history.filter((e) => e.link !== link)];
  let unsaved = 0;
  state.history = state.history.filter((e) => e.saved || ++unsaved <= HISTORY_MAX);
  store.set('radioHistory', state.history);
}
function toggleSaved(link) {
  const e = state.history.find((x) => x.link === link);
  if (!e) return;
  e.saved = !e.saved;
  store.set('radioHistory', state.history);
  toast(e.saved ? `☆ Saved ${e.title}` : `Removed ${e.title} from saved`);
  renderRadio();
}
const entrySong = (e) => decodeShare(e.link).song;
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
async function copyLink(url, what) { try { await navigator.clipboard.writeText(url); toast(`${what} copied`); } catch { prompt('Copy this link', url); } }
const songUrl = (link) => `${location.origin}${location.pathname}${link}`;
function openInComposer(song, title) {
  radio.pause();
  state.song = structuredClone(song); state.selected = null; store.set('song', state.song);
  switchView('compose'); toast(`Opened ${title} in the composer`);
}

function renderHistory(nowLink) {
  segmented($('#history-filter'), [['recent', 'Recent'], ['saved', `☆ Saved (${state.history.filter((e) => e.saved).length})`]], state.historyFilter, (v) => { state.historyFilter = v; store.set('historyFilter', v); renderRadio(); });
  const list = state.historyFilter === 'saved' ? state.history.filter((e) => e.saved) : state.history;
  $('#history-empty').hidden = list.length > 0;
  if (!list.length) $('#history-empty').textContent = state.historyFilter === 'saved' ? 'Songs you save (☆) stay here for good.' : "Every song Radio plays shows up here, so you can play it again, save it, or take it into the composer. It's all kept on this device.";
  $('#history').replaceChildren(...list.slice(0, 100).map((e) => h('li', { class: e.link === nowLink ? 'now' : null, style: { '--c': STYLES[e.style]?.color || '#888' } },
    h('button', { class: 'h-play', type: 'button', 'aria-label': `Play ${e.title}`, on: { click: () => { stopPlayback(); radio.playSong(entrySong(e)); } } }, '▶'),
    h('div', { style: { minWidth: '0' } }, h('div', { class: 'h-title' }, e.title), h('span', { class: 'h-meta' }, `${STYLES[e.style]?.name ?? e.style} · ${e.key} ${e.mode} · ${e.bpm} BPM · ${ago(e.at)}`)),
    h('div', { class: 'h-actions' },
      h('button', { type: 'button', 'aria-pressed': String(e.saved), 'aria-label': e.saved ? 'Unsave' : 'Save', title: e.saved ? 'Saved' : 'Save', on: { click: () => toggleSaved(e.link) } }, e.saved ? '★' : '☆'),
      h('button', { type: 'button', class: 'h-extra', title: 'Open in the composer', on: { click: () => openInComposer(entrySong(e), e.title) } }, 'Edit'),
      h('button', { type: 'button', title: 'Copy link', on: { click: () => copyLink(songUrl(e.link), 'Song link') } }, 'Link')))));
}

function renderRadio() {
  const st = radio.state, t = st.current, onAir = radio.active;
  $('.tabs').classList.toggle('on-air', onAir);
  if (state.view === 'radio') setPlayButton(onAir);
  $('#r-tap').hidden = !(st.error && /^Tap play/.test(st.error));
  if ($('#r-tap').hidden === false) $('#r-tap').textContent = `▶ Tap anywhere to start ${stationName(st.station)} Radio`;
  if (state.view !== 'radio') return;
  const station = st.station ?? state.station;
  document.documentElement.style.setProperty('--style', t ? STYLES[t.song.style].color : station && station !== MIX ? STYLES[station].color : '#ffd23f');
  $('#stations').replaceChildren(...STATIONS.map((id) => h('button', {
    class: `station${id === MIX ? ' mix' : ''}`, type: 'button', 'aria-pressed': String(id === station),
    style: id === MIX ? {} : { '--c': STYLES[id].color },
    on: { click: () => (id === st.station && onAir ? null : tuneIn(id)) },
  }, h('b', {}, `${stationName(id)} Radio`), h('small', {}, id === MIX ? (state.mixStyles ? `${state.mixStyles.length} styles you picked, one after another.` : 'Every style, one after another.') : STYLES[id].blurb))));
  $('#mix-styles').hidden = station !== MIX;
  if (station === MIX) {
    const on = new Set(mixList());
    $('#mix-chips').replaceChildren(...STYLE_IDS.map((id) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(on.has(id)), style: { '--chip': STYLES[id].color },
      on: { click: () => toggleMixStyle(id) },
    }, swatch(), STYLES[id].name)));
  }

  $('#r-station').textContent = station ? `📻 ${stationName(station).toUpperCase()} RADIO${onAir ? ' · ON AIR' : ''}` : '📻 TOM RADIO';
  const between = !t && st.played > 0 && st.station === station;
  $('#r-status').textContent = st.error || (st.status === 'tuning' ? (between ? 'writing the next song…' : 'writing your first song…') : '');
  $('#r-title').textContent = t ? t.title : station ? (st.status === 'tuning' ? (between ? 'Up next…' : 'Tuning in…') : `${stationName(station)} Radio`) : 'Pick a station';
  $('#r-meta').textContent = t ? `${STYLES[t.song.style].name.toUpperCase()} · ${t.song.key} ${t.song.mode} · ${Math.round(t.song.bpm)} BPM · ${t.song.origin.length === 'short' ? 'SHORT' : 'FULL'} SONG` : 'Pick a style and Tom writes an endless run of new songs in it.';
  $('#r-next').textContent = st.upcoming ? `next: ${st.upcoming.title}` : t && st.status === 'playing' ? 'writing the next song…' : '';
  const playing = st.status === 'playing' || st.status === 'tuning';
  const btn = $('#r-play');
  btn.disabled = !station;
  $('.ico', btn).textContent = playing ? '❚❚' : '▶';
  $('.lbl', btn).textContent = playing ? 'Pause' : st.station === station && (t || st.played) ? 'Resume' : 'Tune in';
  $('#r-skip').disabled = !t || st.status === 'tuning';
  $('#r-prev').disabled = !radio.canGoBack;
  $('#r-keep').disabled = $('#r-link').disabled = $('#r-save').disabled = !t;
  const nowLink = t ? songHash(t.song) : null, saved = !!(nowLink && state.history.find((e) => e.link === nowLink)?.saved);
  $('#r-save').textContent = saved ? '★ Saved' : '☆ Save this song';
  $('#r-save').setAttribute('aria-pressed', String(saved));
  $('#r-shortcut').disabled = !station;
  renderHistory(nowLink);
  drawRadio();
  if (onAir && !radioFrame) radioFrame = requestAnimationFrame(radioTick);
}

let radioFrame = 0;
function radioTick() {
  radioFrame = 0;
  if (state.view !== 'radio' || !radio.active) { drawRadio(); return; }
  drawRadio();
  radioFrame = requestAnimationFrame(radioTick);
}

const MELODIC = new Set(['lead', 'counter', 'bells', 'octaves']);
/** A scrolling window of the notes around "now": melody bright, everything else as a glow. */
function drawRadio() {
  if (state.view !== 'radio') return;
  const t = radio.state.current, now = radio.position, dur = radio.duration;
  $('#r-bar').style.width = dur ? `${Math.min(100, (now / dur) * 100)}%` : '0';
  $('#r-time').textContent = `${fmt(now)} / ${fmt(dur)}`;
  updateClock(now);
  const cv = $('#r-roll'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (!t) return;
  const color = STYLES[t.song.style].color, span = 8, t0 = now - span * 0.35, x = (s) => ((s - t0) / span) * W;
  const lo = 28, hi = 100, y = (m) => H - 6 - ((m - lo) / (hi - lo)) * (H - 12);
  for (const n of t.notes) {
    if (n.t > t0 + span || n.t + n.dur < t0) continue;
    const lead = MELODIC.has(n.track), on = now >= n.t && now < n.t + Math.min(n.dur, 1.5);
    g.globalAlpha = lead ? 1 : 0.28;
    g.fillStyle = on && lead ? '#ffffff' : lead ? color : 'rgba(159,242,184,1)';
    g.shadowColor = color; g.shadowBlur = on && lead ? 14 : 0;
    const nx = x(n.t), nw = Math.max(3, x(n.t + Math.min(n.dur, lead ? 2 : 1)) - nx - 1);
    roundRect(g, nx, y(n.midi) - (lead ? 3 : 1.5), nw, lead ? 6 : 3, lead ? 3 : 1.5); g.fill();
  }
  g.globalAlpha = 1; g.shadowBlur = 0;
  g.fillStyle = '#ffd23f'; g.fillRect(x(now), 0, 2, H);
}

$('#r-play').addEventListener('click', radioToggle);
$('#r-skip').addEventListener('click', () => radio.skip());
$('#r-prev').addEventListener('click', () => radio.previous());
$('#r-save').addEventListener('click', () => { const t = radio.state.current; if (t) toggleSaved(songHash(t.song)); });
$('#r-keep').addEventListener('click', () => { const t = radio.state.current; if (t) openInComposer(t.song, t.title); });
$('#r-link').addEventListener('click', () => { const t = radio.state.current; if (t) copyLink(songUrl(songHash(t.song)), 'Song link'); });
$('#r-shortcut').addEventListener('click', () => { if (state.station) copyLink(`${location.origin}${location.pathname}${radioHash()}&play`, `${stationName(state.station)} Radio start link`); });
// A start link (…&play) can't make sound until the first tap, so any tap counts.
$('#r-tap').addEventListener('click', () => radio.resume());
// Diagnostics: the radio's own log (kept across reloads), for bug reports.
const showLog = () => { $('#r-log').textContent = radioLogText() || '(empty)'; };
$('#r-diag').addEventListener('toggle', showLog);
$('#r-log-copy').addEventListener('click', () => copyLink(`Tom ${VERSION} (${BUILD || 'dev'})\n${radioLogText()}`, 'Diagnostics'));
$('#r-log-clear').addEventListener('click', () => { clearRadioLog(); showLog(); });
$('#version').textContent = `v${VERSION}${BUILD ? ` · ${BUILD}` : ''}`;
radioLog('Tom', VERSION, BUILD || 'dev');
document.addEventListener('pointerdown', (e) => { if (!$('#r-tap').hidden && !e.target.closest('#r-tap')) radio.resume(); }, true);
// Siri / Shortcuts / CarPlay: a start link can also be resumed from the lock screen.

// ─── export / import / share ────────────────────────────────────────────────
const slug = (s) => (s || 'tom').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tom';
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportBlueprint() { return state.view === 'melody' ? melodyBlueprint({ ending: true }) : state.view === 'radio' ? radio.state.current?.song : state.song; }
async function doExport(kind) {
  const bp = exportBlueprint();
  if (!bp) return toast('Tune in to a station first');
  const name = slug(bp.title);
  if (kind === 'json') return download(JSON.stringify(bp, null, 2), `${name}.json`, 'application/json');
  if (kind === 'link') {
    syncHash();
    const url = location.href;
    try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch { prompt('Copy this link', url); }
    return;
  }
  setStatus('rendering…');
  const r = await renderInWorker(bp);
  setStatus('');
  if (kind === 'wav') download(encodeWav(r.L, r.R, r.sampleRate), `${name}.wav`, 'audio/wav');
  if (kind === 'midi') download(toMidi(r.events, r.bpm, bp.title), `${name}.mid`, 'audio/midi');
}

function radioHash() {
  if (!state.station) return '#radio';
  const styles = radioOpts(state.station).styles;
  return `#radio:${state.station}${styles ? `&styles=${styles.join(',')}` : ''}`;
}
function viewHash() {
  if (state.view === 'radio') return radioHash();
  return state.view === 'melody' ? melodyHash(state.melody) : songHash(state.song);
}
function syncHash() {
  const hash = viewHash();
  if (location.hash !== hash || location.search) history.replaceState(null, '', `${location.pathname}${hash}`); // also drops ?v= left by an update
}
function loadFromHash() {
  if (!location.hash || location.hash === '#') return false;
  // #radio, #radio:jazz, #radio:mix&styles=jazz,funk, and &play to start at once (Siri / Shortcuts)
  const radioLink = /^#radio(?::([\w-]+))?((?:&[\w-]+(?:=[\w,-]*)?)*)$/.exec(location.hash);
  if (radioLink) {
    const q = Object.fromEntries(radioLink[2].split('&').filter(Boolean).map((kv) => kv.split('=')));
    if (radioLink[1] && STATIONS.includes(radioLink[1])) { state.station = radioLink[1]; store.set('station', state.station); }
    if (q.styles) {
      const picked = STYLE_IDS.filter((id) => q.styles.split(',').includes(id));
      state.mixStyles = picked.length && picked.length < STYLE_IDS.length ? picked : null;
      store.set('mixStyles', state.mixStyles);
    }
    if ('play' in q && state.station) state.autoplay = true;
    state.view = 'radio';
    return true;
  }
  try {
    const d = decodeShare(location.hash);
    if (!d) return false;
    if (d.kind === 'melody') { state.melody = d.params; state.view = 'melody'; store.set('melody', state.melody); }
    else { state.song = d.song; state.selected = null; state.view = 'compose'; store.set('song', state.song); }
    return true;
  } catch (e) { toast(`That link could not be opened: ${e.message}`); return false; }
}
function showError(e) { console.error(e); setStatus(''); toast(e.message || String(e)); }

// ─── wiring ─────────────────────────────────────────────────────────────────
function switchView(v) {
  stopPlayback();
  state.view = v; store.set('view', v);
  for (const k of ['melody', 'compose', 'radio']) {
    $(`#tab-${k}`).setAttribute('aria-selected', String(v === k));
    $(`#view-${k}`).hidden = v !== k;
  }
  // The radio keeps playing while you browse the other tabs; their Play button takes over from it.
  setPlayButton(v === 'radio' && radio.active);
  if (v === 'melody') { renderMelodyControls(); drawRoll(); } else if (v === 'compose') renderComposer(); else renderRadio();
  updateClock(0);
  syncHash();
}

$('#tab-melody').addEventListener('click', () => switchView('melody'));
$('#tab-compose').addEventListener('click', () => switchView('compose'));
$('#tab-radio').addEventListener('click', () => switchView('radio'));
$('#play').addEventListener('click', () => {
  if (state.view === 'radio') return radioToggle();
  if (playing || loading) return stopPlayback();
  const p = state.view === 'melody' ? startPlayback(melodyBlueprint(), { loop: true, view: 'melody' }) : state.song.blocks.length ? startPlayback(state.song, { view: 'compose' }) : Promise.resolve(toast('Add some blocks first'));
  p.catch(showError);
});
$('#dice').addEventListener('click', () => { state.melody.seed = randomTag(); changedMelody(); if (!playing) startPlayback(melodyBlueprint(), { loop: true, view: 'melody' }).catch(showError); });
$('#m-seed').addEventListener('change', (e) => set({ seed: tagOf(e.target.value) }));
$('#m-key').addEventListener('change', (e) => set({ key: e.target.value }));
$('#m-mode').addEventListener('change', (e) => set({ mode: e.target.value, progression: '' }));
$('#m-bpm').addEventListener('input', (e) => { $('#m-bpm-v').textContent = `${e.target.value} bpm`; });
$('#m-bpm').addEventListener('change', (e) => set({ bpm: Number(e.target.value) }));
$('#m-density').addEventListener('input', (e) => { $('#m-density-v').textContent = Math.round(e.target.value * 100) + '%'; });
$('#m-density').addEventListener('change', (e) => set({ density: Number(e.target.value) }));
$('#m-sync').addEventListener('input', (e) => { $('#m-sync-v').textContent = Math.round(e.target.value * 100) + '%'; });
$('#m-sync').addEventListener('change', (e) => set({ syncopation: Number(e.target.value) }));
$('#m-prog').addEventListener('change', (e) => set({ progression: e.target.value }));
$('#to-composer').addEventListener('click', () => {
  const m = state.melody;
  if (!state.song.blocks.length) Object.assign(state.song, { style: m.style, key: m.key, mode: m.mode, bpm: m.bpm });
  const b = makeBlock('chorus', { bars: m.bars, seed: m.seed, progression: m.progression || undefined, melody: { density: m.density, syncopation: m.syncopation, contour: m.contour, form: m.form, octave: m.octave, range: 1 } });
  const hitAt = state.song.blocks.findIndex((x) => x.type === 'hit');
  state.song.blocks.splice(hitAt >= 0 ? hitAt : state.song.blocks.length, 0, b);
  state.selected = b.id; store.set('song', state.song);
  switchView('compose'); toast('Added as a Chorus block');
});

$('#c-title').addEventListener('change', (e) => { state.song.title = e.target.value; state.song.edited = true; store.set('song', state.song); syncHash(); });
$('#c-key').addEventListener('change', (e) => { state.song.key = e.target.value; songChanged(); });
$('#c-mode').addEventListener('change', (e) => { state.song.mode = e.target.value; songChanged(); });
$('#c-bpm').addEventListener('change', (e) => { state.song.bpm = Math.min(200, Math.max(50, Number(e.target.value) || 100)); songChanged(); });
$('#auto-song').addEventListener('click', () => { const tag = randomTag(); state.song = songFromTag(tag, { length: $('#auto-length').value, style: state.song.style, gen: 2 }); songChanged({ keepSelection: false, edited: false }); toast(`✨ A fresh song: ${showTag(tag)}`); });
$('#auto-finish').addEventListener('click', () => { state.song = autoFill(state.song, { seed: randSeed(), length: $('#auto-length').value }); songChanged(); toast('✨ Finished the arrangement'); });
$('#auto-block').addEventListener('click', () => {
  const b = state.song.blocks.find((x) => x.id === state.selected);
  if (!b) return toast('Select a block first');
  if (b.locked) return toast('That block is locked');
  Object.assign(b, autoBlock(b, rng(randSeed()), state.song)); songChanged();
});
$('#auto-all').addEventListener('click', () => { const r = rng(randSeed()); state.song.blocks = state.song.blocks.map((b) => autoBlock(b, r, state.song)); songChanged(); toast('✨ Re-rolled every unlocked block'); });
$('#clear-song').addEventListener('click', () => { state.song = { ...emptySong(state.song.style), title: 'Untitled' }; songChanged({ keepSelection: false }); });

const tlWrap = $('.timeline-wrap');
tlWrap.addEventListener('dragover', (e) => e.preventDefault());
tlWrap.addEventListener('drop', (e) => { e.preventDefault(); dropAt(e, state.song.blocks.length); });

const menuBtn = $('#export-btn'), menu = $('#export-menu');
menuBtn.addEventListener('click', () => { menu.hidden = !menu.hidden; menuBtn.setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); } });
menu.addEventListener('click', (e) => { const k = e.target.closest('[data-export]')?.dataset.export; if (k) { menu.hidden = true; doExport(k).catch(showError); } });
$('#import').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { state.song = { ...validate(JSON.parse(await f.text())), edited: true }; state.selected = null; store.set('song', state.song); switchView('compose'); toast(`Opened ${f.name}`); } catch (err) { toast(`Could not open that file: ${err.message}`); }
  e.target.value = '';
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); $('#play').click(); }
  if (e.key === 'n' && state.view === 'melody') $('#dice').click();
  if (e.key === 'n' && state.view === 'radio') radio.skip();
  if (e.key === 'p' && state.view === 'radio') radio.previous();
});
window.addEventListener('resize', () => { drawRoll(playing ? position() : null); drawRadio(); });

// When a newer Tom is deployed while this page is cached, offer it.
// iOS keeps a tab or Home Screen app alive for days without reloading it, so
// this runs at load, whenever Tom comes back on screen, and every 30 minutes.
// Nothing playing: it just reloads into the new version (everything is saved).
let offered = false;
async function checkForUpdate() {
  const mine = BUILD;
  if (!mine || offered) return; // local/dev builds aren't stamped
  try {
    const html = await fetch(location.pathname, { cache: 'no-store' }).then((r) => r.text());
    const latest = (html.match(/app\.js\?v=([\w-]+)/) || [])[1];
    if (!latest || latest === mine) return;
    const go = () => { syncHash(); location.href = `${location.pathname}?v=${latest}${location.hash}`; };
    if (!playing && !loading && !radio.active) return go();
    offered = true;
    const bar = h('div', { class: 'toast update', role: 'status' }, 'A new version of Tom is here. ',
      h('button', { class: 'btn', type: 'button', on: { click: go } }, 'Update'));
    document.body.append(bar);
  } catch { /* offline: keep playing */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
setInterval(checkForUpdate, 30 * 60e3);

// Offline: a service worker caches the app (it all renders on the device anyway).
if ('serviceWorker' in navigator && isSecureContext) {
  const first = !navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (first) reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', (e) => { if (e.target.state === 'activated') toast('🦎 Tom now works offline'); }));
  }).catch(() => { /* private mode or blocked: still works online */ });
}

loadFromHash();
switchView(state.view);
// A start link (#radio:jazz&play): write the first song and try to play it; iOS will
// usually hold it until a tap (see #r-tap), or play on the lock screen / CarPlay.
if (state.autoplay) { state.autoplay = false; tuneIn(state.station); }
checkForUpdate();
// Paste any #hashtag into the address bar and Tom plays that song.
window.addEventListener('hashchange', () => {
  if (location.hash === viewHash()) return;
  if (loadFromHash()) {
    stopPlayback(); switchView(state.view);
    if (state.view !== 'radio') toast(`Loaded ${decodeURIComponent(location.hash)}`);
    else if (state.autoplay) { state.autoplay = false; tuneIn(state.station); }
  }
});
