// Radio playback. Tracks play through an <audio> element, not Web Audio: iOS
// keeps a media element playing with the screen locked or Safari in the
// background (and ignores the ringer switch), while an AudioContext is
// suspended. The lock screen / Control Center get titles, artwork and
// play/pause/next through the Media Session API.
//
// Three rules keep it going on a locked iPhone, where the page gets little CPU
// and iOS only lets it start audio while its audio is already playing:
//  1. Render ahead. Songs are written on a worker, AHEAD of the one playing,
//     so minutes of music are ready before the screen ever locks.
//  2. Never go quiet. If the next song isn't ready when one ends, the same
//     element loops silence until it is, so the page keeps its audio session
//     (and keeps running), and the switch to the song is allowed.
//  3. Don't wait forever. A render that errors or stalls (a worker iOS froze
//     or killed) is retried on a fresh worker.
//
// The lock screen and CarPlay get previous/next track buttons (not ±10 s):
// Previous restarts a song past its first few seconds, otherwise it goes back
// (the last song stays rendered, so that's instant).
import { radioTrack, trackTitle, stationName, MIX } from './lib/radio.mjs';
import { STYLES } from './lib/styles.mjs';
import { encodeWav } from './lib/wav.mjs';

const AHEAD = 2;              // songs kept rendered beyond the one playing
const RENDER_TIMEOUT = 150e3; // a full song renders in seconds; this means the worker is gone
const RETRIES = 2;
const BACK_KEPT = 1;          // previous songs kept rendered, for an instant Previous
const RESTART_AFTER = 4;      // seconds into a song after which Previous restarts it
const SILENCE = URL.createObjectURL(new Blob([encodeWav(new Float32Array(44100), new Float32Array(44100), 44100)], { type: 'audio/wav' }));
const cancelled = (why) => Object.assign(new Error(why), { cancelled: true });

export function createRadio({ onChange = () => {}, onTrack = () => {} } = {}) {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');

  // ─── the render worker ───
  let worker = null, reqId = 0;
  const pending = new Map();
  function spawn() {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error)); };
    worker.onerror = (e) => { e.preventDefault?.(); resetWorker(new Error(e.message || 'The renderer stopped')); };
  }
  /** Drop the worker (and whatever it was doing); the next render starts a fresh one. */
  function resetWorker(err = cancelled('cancelled')) {
    worker?.terminate(); worker = null;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  }
  function renderWav(bp) {
    if (!worker) spawn();
    const id = ++reqId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (pending.has(id)) resetWorker(new Error('The renderer stalled')); }, RENDER_TIMEOUT);
      pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      worker.postMessage({ id, bp, wav: true });
    });
  }

  // ─── the queue ───
  const s = { station: null, seed: null, styles: null, current: null, upcoming: null, status: 'idle', error: null, played: 0 };
  let gen = 0;          // bumps on every retune; work for an older station is dropped
  let ready = [];       // rendered songs waiting their turn
  let nextN = 0;        // index of the next song to render
  let rendering = false;
  let waiting = false;  // a song should be playing but none is ready yet
  let back = [];        // songs already played, newest last (only the last BACK_KEPT keep their audio)
  let oneOff = 0;       // bumps for each song asked for by name (history, Previous)

  const prepare = (n, g) => renderTrack(radioTrack(s.station, s.seed, n, { styles: s.styles }), n, g);
  async function renderTrack(song, n, g) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await renderWav(song);
        if (g !== gen) throw cancelled('stale');
        return { n, song, title: trackTitle(song), url: URL.createObjectURL(new Blob([r.wav], { type: 'audio/wav' })), duration: r.duration, notes: r.notes };
      } catch (e) {
        if (e.cancelled || g !== gen || attempt >= RETRIES) throw e;
        console.warn(`Radio: retrying song ${n + 1} (${e.message})`);
      }
    }
  }
  function fill() {
    if (rendering || ready.length >= AHEAD || !s.station) return;
    const g = gen, n = nextN++;
    rendering = true;
    prepare(n, g).then((t) => {
      if (g !== gen) return URL.revokeObjectURL(t.url);
      rendering = false;
      ready.push(t); s.upcoming = ready[0];
      if (waiting) play(ready.shift()); else onChange();
      fill();
    }, (e) => {
      if (g !== gen || e.cancelled) return;
      rendering = false; nextN = n;
      fail(e);
    });
  }

  /** A played song goes on the back stack; only the newest keep their audio. */
  function retire(t) {
    if (!t) return;
    back.push(t);
    if (back.length > 50) back.shift();
    for (const x of back.slice(0, -BACK_KEPT)) if (x.url) { URL.revokeObjectURL(x.url); x.url = null; }
  }
  function blocked(e) {
    s.status = 'paused';
    s.error = e.name === 'NotAllowedError' ? 'Tap play to start listening' : e.message;
    onChange();
  }

  function play(track, { retireOld = true } = {}) {
    const old = s.current;
    waiting = false;
    s.current = track; s.upcoming = ready[0] ?? null; s.status = 'playing'; s.error = null; s.played++;
    audio.loop = false;
    audio.src = track.url;
    audio.play().catch((e) => { if (s.current === track) blocked(e); });
    if (retireOld && old !== track) retire(old);
    updateSession();
    onTrack(track);
    fill();
    onChange();
  }

  /** Hold the audio session with silence until the next song is ready. */
  function holdWithSilence() {
    audio.loop = true;
    audio.src = SILENCE;
    audio.play().catch(() => {});
  }

  /** On to the next song: at once if it's ready, otherwise as soon as it is. */
  function advance() {
    if (ready.length) return play(ready.shift());
    retire(s.current);
    s.current = null; s.status = 'tuning'; waiting = true;
    holdWithSilence();
    updateSession();
    fill();
    onChange();
  }
  function fail(e) {
    console.error(e);
    waiting = false;
    if (!s.current) { audio.loop = false; audio.pause(); }
    s.status = 'paused'; s.error = `Couldn't write the next song (${e.message || e}). Tap play to try again.`;
    onChange();
  }

  audio.addEventListener('ended', () => { if (s.status === 'playing' && !audio.loop) advance(); });
  audio.addEventListener('pause', () => { if (s.status === 'playing' && audio.paused && !audio.ended) { s.status = 'paused'; onChange(); } });
  audio.addEventListener('play', () => { if (s.current && s.status === 'paused') { s.status = 'playing'; onChange(); } });
  audio.addEventListener('loadedmetadata', positionState);
  audio.addEventListener('seeked', positionState);

  // ─── lock screen / Control Center ───
  const art = new Map();
  function artwork(style) {
    if (!art.has(style)) art.set(style, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 512;
        const g = cv.getContext('2d'), color = style === MIX ? '#ffd23f' : STYLES[style].color;
        const grad = g.createLinearGradient(0, 0, 512, 512); grad.addColorStop(0, color); grad.addColorStop(1, '#14161b');
        g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
        g.drawImage(img, 96, 96, 320, 320);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = new URL('./gecko.svg', import.meta.url).href;
    }));
    return art.get(style);
  }
  async function updateSession() {
    if (!('mediaSession' in navigator) || !s.station) return;
    const t = s.current, g = gen, artist = `Tom · ${stationName(s.station)} Radio`;
    const meta = t
      ? { title: t.title, artist, album: `${STYLES[t.song.style].name} · ${t.song.key} ${t.song.mode} · ${Math.round(t.song.bpm)} BPM` }
      : { title: 'Writing the next song…', artist, album: '' };
    navigator.mediaSession.metadata = new MediaMetadata(meta);
    const src = await artwork(t ? t.song.style : s.station);
    if (src && g === gen && s.current === t) navigator.mediaSession.metadata = new MediaMetadata({ ...meta, artwork: [{ src, sizes: '512x512', type: 'image/png' }] });
  }
  function positionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !s.current || !(audio.duration > 0) || audio.loop) return;
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch { /* not supported */ }
  }
  if ('mediaSession' in navigator) {
    const on = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ } };
    on('play', () => resume());
    on('pause', () => pause());
    on('nexttrack', () => skip());
    on('previoustrack', () => previous());
    on('seekto', (d) => { if (s.current) { audio.currentTime = d.seekTime; positionState(); } });
    // iOS shows ±10 s buttons unless these are cleared explicitly; cleared, it shows previous/next.
    on('seekbackward', null);
    on('seekforward', null);
  }

  /** Must run inside a tap: it unlocks the audio element for later play() calls. */
  function unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
    if (!s.current) holdWithSilence();
  }

  function clearQueue({ keepCurrent = false } = {}) {
    for (const t of ready) URL.revokeObjectURL(t.url);
    ready = []; rendering = false; waiting = false; s.upcoming = null;
    if (keepCurrent) return;
    for (const t of back) if (t.url) URL.revokeObjectURL(t.url);
    if (s.current) URL.revokeObjectURL(s.current.url);
    back = [];
  }

  function tune(station, { seed = Math.random().toString(36).slice(2, 8), styles = null } = {}) {
    gen++;
    resetWorker();
    clearQueue();
    Object.assign(s, { station, seed, styles, current: null, upcoming: null, status: 'tuning', error: null, played: 0 });
    nextN = 0; waiting = true;
    unlock();
    updateSession();
    fill();
    onChange();
  }
  function pause() {
    if (s.status === 'tuning') { waiting = false; audio.loop = false; audio.pause(); s.status = 'paused'; onChange(); return; }
    if (s.status !== 'playing') return;
    audio.pause(); s.status = 'paused'; onChange();
  }
  function resume() {
    if (!s.station) return;
    if (s.current) { unlock(); s.status = 'playing'; s.error = null; audio.play().catch(blocked); onChange(); return; }
    // Between songs (or after a failed render): pick up where the queue is.
    unlock();
    s.error = null;
    if (ready.length) return play(ready.shift());
    s.status = 'tuning'; waiting = true;
    fill();
    onChange();
  }
  function skip() { if (s.current) { oneOff++; audio.pause(); advance(); } }

  /** Previous: restart this song, or (in its first seconds) go back one. Next then returns to it. */
  function previous() {
    if (s.current && audio.currentTime > RESTART_AFTER) { audio.currentTime = 0; positionState(); return; }
    const t = back.pop();
    if (!t) { if (s.current) { audio.currentTime = 0; positionState(); } return; }
    if (s.current) { ready.unshift(s.current); s.current = null; }
    if (t.url) { oneOff++; play(t, { retireOld: false }); } else playSong(t.song, { n: t.n, retireCurrent: false });
  }

  /** Play one particular song now (from history, or Previous past what's kept); the station carries on after it. */
  function playSong(song, { n = -1, retireCurrent = true } = {}) {
    if (!s.station) Object.assign(s, { station: song.style, seed: Math.random().toString(36).slice(2, 8), styles: null });
    unlock();
    const g = gen, token = ++oneOff;
    if (s.current) { if (retireCurrent) retire(s.current); else URL.revokeObjectURL(s.current.url); s.current = null; }
    s.status = 'tuning'; s.error = null; waiting = false;
    holdWithSilence(); updateSession(); onChange();
    renderTrack(song, n, g).then((t) => {
      if (g !== gen || token !== oneOff) return URL.revokeObjectURL(t.url);
      play(t, { retireOld: false });
    }, (e) => { if (g === gen && token === oneOff && !e.cancelled) fail(e); });
  }

  /** Change which styles a mix plays. The song playing finishes; the queue is rewritten. */
  function setStyles(styles) {
    s.styles = styles;
    if (s.station !== MIX) return;
    gen++;
    resetWorker();
    clearQueue({ keepCurrent: true });
    if (!s.current && s.status === 'tuning') waiting = true;
    fill();
    onChange();
  }
  function stop() { if (s.status === 'playing' || s.status === 'tuning') pause(); }

  return {
    state: s,
    tune, pause, resume, skip, previous, stop, playSong, setStyles,
    get canGoBack() { return back.length > 0 || (!!s.current && audio.currentTime > RESTART_AFTER); },
    get active() { return s.status === 'playing' || s.status === 'tuning'; },
    get position() { return s.current ? audio.currentTime || 0 : 0; },
    get duration() { return s.current?.duration || 0; },
  };
}
