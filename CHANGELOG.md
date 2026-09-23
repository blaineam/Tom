# Changelog

## 0.2.0 — 2026-09-22

- **Jazz** style: walking upright bass (roots on the downbeat, chord tones between, a chromatic step into every next chord), swung ride with hi-hat on 2 and 4 and brush ghost notes, rootless 3-5-7-9 piano voicings in a Charleston comp, and a swung vibraphone melody over ii–V–I changes.
- **Orchestral** style: divided strings that swell in, a french-horn melody, pizzicato arpeggios, low strings, timpani tuned to the key with timpani rolls for builds, celesta bells, and a concert-hall reverb.
- New instruments: upright bass, ride cymbal, brush snare, vibraphone, jazz piano, string ensemble, pizzicato, french horn, timpani, concert bass drum, celesta. MIDI export adds a Timpani track and GM ride/brush/bass-drum notes.
- **Share links are now a promise.** Bare hashtags pick their style from the original five styles, frozen, so adding styles never changes a link someone already shared. Golden audio hashes in the tests enforce it.

## 0.1.0 — 2026-09-22

First release.

- **Melody Machine** (web): one button for a new melody, with dials for style, key, mode, tempo, bars, busy-ness, syncopation, shape, phrase form, register, chords and backing. Turning a dial keeps the seed, so you shape the same melody.
- **Composer** (web): snap Intro, Verse, Build, Chorus, Break, Outro and Ending blocks together like Lego. Each block has its own layers, drums, filter sweep, chords and melody dials. **Auto** builds a whole song, finishes a partial one, or re-rolls one block; locked blocks are never touched.
- **CLI**: `tom melody`, `tom song`, `tom jingle` (lands a final hit at an exact time, for video end cards), `tom render` (blueprints from the composer), `tom compose`, `tom styles`, `tom doctor`.
- Five styles: Synthwave, Bright Pop, Chiptune, Lo-fi, Marimba.
- Melody generator: motif + phrase form (AABA, ABAB, …) + contour, strong beats on chord tones, gap-filled leaps, no tritone leaps, tonic cadence.
- Export WAV and Standard MIDI (one track per layer, GM drums); ffmpeg adds m4a/mp3 and loudness normalization in the CLI.
- Deterministic: the same blueprint and seed render byte-identical audio.
- Zero dependencies. The same engine runs in Node and in the browser (Web Worker).
