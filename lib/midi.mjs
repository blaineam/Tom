// Standard MIDI File (type 1) export: one track per layer, General MIDI
// programs, drums on channel 10. Open it in Logic, GarageBand, Ableton…

const PPQ = 480;
const TRACKS = [
  { name: 'Lead', track: 'lead', program: 81, ch: 0 },
  { name: 'Counter', track: 'counter', program: 80, ch: 1 },
  { name: 'Bells', track: 'bells', program: 14, ch: 2 },
  { name: 'Arp', track: 'arp', program: 25, ch: 3 },
  { name: 'Chords', track: 'pad', program: 89, ch: 4 },
  { name: 'Bass', track: 'bass', program: 38, ch: 5 },
  { name: 'Drums', track: 'drums', program: 0, ch: 9 },
];
const GM_DRUMS = { kick: 36, snare: 38, clap: 39, hat: 42, openhat: 46, shaker: 70, crash: 49 };

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s) => [...new TextEncoder().encode(s)];

function chunk(type, data) { return [...text(type), ...u32(data.length), ...data]; }

function trackChunk(name, program, ch, notes, secToTick) {
  const ev = [];
  for (const n of notes) {
    const on = secToTick(n.t), off = Math.max(on + 1, secToTick(n.t + n.dur));
    const vel = Math.max(1, Math.min(127, Math.round(40 + 87 * (n.vel ?? 0.8))));
    ev.push([on, 1, [0x90 | ch, n.midi, vel]], [off, 0, [0x80 | ch, n.midi, 0]]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // note-offs before note-ons at the same tick
  const data = [0, 0xff, 0x03, ...vlq(text(name).length), ...text(name)];
  if (ch !== 9) data.push(0, 0xc0 | ch, program);
  let last = 0;
  for (const [tick, , bytes] of ev) { data.push(...vlq(tick - last), ...bytes); last = tick; }
  data.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', data);
}

/** events from arrange.render(); returns Uint8Array. */
export function toMidi(events, bpm, title = 'Tom') {
  const secToTick = (s) => Math.round((s * bpm / 60) * PPQ);
  const usPerBeat = Math.round(60e6 / bpm);
  const tempo = chunk('MTrk', [
    0, 0xff, 0x03, ...vlq(text(title).length), ...text(title),
    0, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255,
    0, 0xff, 0x58, 0x04, 4, 2, 24, 8,
    0, 0xff, 0x2f, 0,
  ]);
  const tracks = TRACKS.map((T) => {
    const notes = events.filter((e) => e.track === T.track).map((e) =>
      T.track === 'drums' ? { ...e, midi: GM_DRUMS[e.open ? 'openhat' : e.drum] ?? 38, dur: 0.1 } : e);
    return notes.length ? trackChunk(T.name, T.program, T.ch, notes, secToTick) : null;
  }).filter(Boolean);
  const header = chunk('MThd', [0, 1, 0, tracks.length + 1, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...tempo, ...tracks.flat()]);
}
