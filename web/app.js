// Tom — web music machine. Melody Machine + Lego-style Composer, both driven
// by the same engine as the CLI (rendered in a Web Worker).
import { STYLES } from './lib/styles.mjs';
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
async function startPlayback(bp, { loop = false, view = state.view } = {}) {
  stopPlayback();
  const r = await renderCached(bp);
  ac ??= new AudioContext();
  if (ac.state === 'suspended') await ac.resume();
  const buf = ac.createBuffer(2, r.L.length, r.sampleRate);
  buf.copyToChannel(r.L, 0); buf.copyToChannel(r.R, 1);
  src = ac.createBufferSource();
  src.buffer = buf; src.loop = loop; src.connect(ac.destination);
  src.onended = () => { if (playing && !loop) stopPlayback(); };
  src.start();
  playing = { t0: ac.currentTime, duration: r.duration, loop, view, bp };
  $('#play').classList.add('on'); $('#play .ico').textContent = '■'; $('#play .lbl').textContent = 'Stop'; $('#play').setAttribute('aria-label', 'Stop');
  requestAnimationFrame(tick);
}
function stopPlayback() {
  if (src) { src.onended = null; try { src.stop(); } catch { /* already stopped */ } src = null; }
  playing = null;
  $('#play').classList.remove('on'); $('#play .ico').textContent = '▶'; $('#play .lbl').textContent = 'Play'; $('#play').setAttribute('aria-label', 'Play');
  $('#playhead').hidden = true;
  drawRoll();
  updateClock(0);
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
  const total = playing ? playing.duration : currentDuration();
  $('#clock').textContent = `${fmt(t)} / ${fmt(total)}`;
}
function currentDuration() {
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
  melodyTimer = setTimeout(() => { if (playing?.view === 'melody') startPlayback(melodyBlueprint(), { loop: true, view: 'melody' }); else renderCached(melodyBlueprint()).catch(showError); }, 180);
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
  ph.style.left = `${bricks[i].offsetLeft + frac * bricks[i].offsetWidth - $('.timeline-wrap').scrollLeft + 14}px`;
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

// ─── export / import / share ────────────────────────────────────────────────
const slug = (s) => (s || 'tom').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tom';
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportBlueprint() { return state.view === 'melody' ? melodyBlueprint({ ending: true }) : state.song; }
async function doExport(kind) {
  const bp = exportBlueprint();
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

function syncHash() {
  const hash = state.view === 'melody' ? melodyHash(state.melody) : songHash(state.song);
  if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${hash}`);
}
function loadFromHash() {
  if (!location.hash || location.hash === '#') return false;
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
  if (playing) stopPlayback();
  state.view = v; store.set('view', v);
  $('#tab-melody').setAttribute('aria-selected', String(v === 'melody'));
  $('#tab-compose').setAttribute('aria-selected', String(v === 'compose'));
  $('#view-melody').hidden = v !== 'melody';
  $('#view-compose').hidden = v !== 'compose';
  if (v === 'melody') { renderMelodyControls(); drawRoll(); } else renderComposer();
  syncHash();
}

$('#tab-melody').addEventListener('click', () => switchView('melody'));
$('#tab-compose').addEventListener('click', () => switchView('compose'));
$('#play').addEventListener('click', () => {
  if (playing) return stopPlayback();
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
$('#auto-song').addEventListener('click', () => { const tag = randomTag(); state.song = songFromTag(tag, { length: $('#auto-length').value, style: state.song.style }); songChanged({ keepSelection: false, edited: false }); toast(`✨ A fresh song: ${showTag(tag)}`); });
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
});
window.addEventListener('resize', () => drawRoll(playing ? position() : null));

loadFromHash();
switchView(state.view);
// Paste any #hashtag into the address bar and Tom plays that song.
window.addEventListener('hashchange', () => {
  const before = state.view === 'melody' ? melodyHash(state.melody) : songHash(state.song);
  if (location.hash === before) return;
  if (loadFromHash()) { stopPlayback(); switchView(state.view); toast(`Loaded ${decodeURIComponent(location.hash)}`); }
});
