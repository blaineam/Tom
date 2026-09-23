// Radio playback. Tracks play through an <audio> element, not Web Audio: iOS
// keeps a media element playing with the screen locked or Safari in the
// background (and ignores the ringer switch), while an AudioContext is
// suspended. The lock screen / Control Center get titles, artwork and
// play/pause/next through the Media Session API.
//
// Radio renders on its own worker, one track ahead, so the next song is ready
// before this one ends and can start from the `ended` event without waiting
// (iOS only lets a backgrounded page start the next track promptly).
import { radioTrack, trackTitle, stationName, MIX } from './lib/radio.mjs';
import { STYLES } from './lib/styles.mjs';
import { encodeWav } from './lib/wav.mjs';

const SILENCE = URL.createObjectURL(new Blob([encodeWav(new Float32Array(2205), new Float32Array(2205), 44100)], { type: 'audio/wav' }));

export function createRadio({ onChange = () => {} } = {}) {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');

  let worker = null, busy = false, reqId = 0;
  const pending = new Map();
  function spawn() {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); busy = pending.size > 0; e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error)); };
  }
  const renderWav = (bp) => new Promise((resolve, reject) => { if (!worker) spawn(); const id = ++reqId; pending.set(id, { resolve, reject }); busy = true; worker.postMessage({ id, bp, wav: true }); });
  /** Abandon whatever the worker is rendering (a station change mid-render). */
  function cancelRenders() {
    if (!busy) return;
    worker.terminate(); worker = null; busy = false;
    for (const p of pending.values()) p.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    pending.clear();
  }

  const s = { station: null, seed: null, current: null, upcoming: null, status: 'idle', error: null };
  let gen = 0; // bumps on every retune; results from an older station are dropped
  let upcomingPromise = null;

  async function prepare(n, g) {
    const song = radioTrack(s.station, s.seed, n);
    const r = await renderWav(song);
    const track = { n, song, title: trackTitle(song), url: URL.createObjectURL(new Blob([r.wav], { type: 'audio/wav' })), duration: r.duration, notes: r.notes };
    if (g !== gen) { URL.revokeObjectURL(track.url); throw Object.assign(new Error('stale'), { cancelled: true }); }
    return track;
  }
  function prefetch(n) {
    const g = gen;
    s.upcoming = null;
    upcomingPromise = prepare(n, g).then((t) => { if (g === gen) { s.upcoming = t; onChange(); } return t; });
    upcomingPromise.catch(() => {});
    return upcomingPromise;
  }

  function play(track) {
    const old = s.current;
    s.current = track; s.upcoming = null; s.status = 'playing'; s.error = null;
    audio.src = track.url;
    audio.play().catch((e) => { s.status = 'paused'; s.error = e.name === 'NotAllowedError' ? 'Tap play to keep listening' : e.message; onChange(); });
    if (old) URL.revokeObjectURL(old.url);
    updateSession();
    prefetch(track.n + 1);
    onChange();
  }

  /** Move to the next track: at once if it's ready, otherwise as soon as it is. */
  async function advance() {
    if (s.upcoming) return play(s.upcoming);
    const g = gen;
    s.status = 'tuning'; onChange();
    try { const t = await upcomingPromise; if (g === gen) play(t); } catch (e) { if (!e.cancelled) fail(e); }
  }
  function fail(e) { console.error(e); s.status = 'paused'; s.error = e.message || String(e); onChange(); }

  audio.addEventListener('ended', () => { if (s.status === 'playing') advance(); });
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
    if (!('mediaSession' in navigator) || !s.current) return;
    const t = s.current, song = t.song, g = gen;
    const meta = { title: t.title, artist: `Tom · ${stationName(s.station)} Radio`, album: `${STYLES[song.style].name} · ${song.key} ${song.mode} · ${Math.round(song.bpm)} BPM` };
    navigator.mediaSession.metadata = new MediaMetadata(meta);
    const src = await artwork(song.style);
    if (src && g === gen && s.current === t) navigator.mediaSession.metadata = new MediaMetadata({ ...meta, artwork: [{ src, sizes: '512x512', type: 'image/png' }] });
  }
  function positionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !(audio.duration > 0)) return;
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch { /* not supported */ }
  }
  if ('mediaSession' in navigator) {
    const on = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ } };
    on('play', () => resume());
    on('pause', () => pause());
    on('nexttrack', () => skip());
    on('previoustrack', () => { audio.currentTime = 0; positionState(); });
    on('seekto', (d) => { audio.currentTime = d.seekTime; positionState(); });
  }

  /** Must be called from a tap: it unlocks the audio element for later play() calls. */
  function unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
    if (!s.current) { audio.src = SILENCE; audio.play().catch(() => {}); }
  }

  function tune(station, seed = Math.random().toString(36).slice(2, 8)) {
    unlock();
    gen++;
    cancelRenders();
    if (s.current) { audio.pause(); URL.revokeObjectURL(s.current.url); }
    if (s.upcoming) URL.revokeObjectURL(s.upcoming.url);
    Object.assign(s, { station, seed, current: null, upcoming: null, status: 'tuning', error: null });
    onChange();
    const g = gen;
    prefetch(0).then((t) => { if (g === gen) play(t); }).catch((e) => { if (!e.cancelled) fail(e); });
  }
  function pause() { if (s.status !== 'playing') return; audio.pause(); s.status = 'paused'; onChange(); }
  function resume() {
    if (!s.current) return s.station && s.status !== 'tuning' ? tune(s.station) : undefined;
    unlock();
    s.status = 'playing'; s.error = null;
    audio.play().catch((e) => fail(e));
    onChange();
  }
  function skip() { if (s.current && s.status !== 'tuning') { audio.pause(); advance(); } }
  function stop() { if (s.status === 'playing' || s.status === 'tuning') { if (s.status === 'tuning') { gen++; cancelRenders(); s.status = 'idle'; } else pause(); onChange(); } }

  return {
    state: s,
    tune, pause, resume, skip, stop,
    get active() { return s.status === 'playing' || s.status === 'tuning'; },
    get position() { return audio.currentTime || 0; },
    get duration() { return s.current?.duration || 0; },
  };
}
