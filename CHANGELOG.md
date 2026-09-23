# Changelog

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
