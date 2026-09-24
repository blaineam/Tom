# Changelog

## 0.7.0 — 2026-09-23

- **Radio keeps going with the screen locked.** A station that had started one song could stall at the next on a locked iPhone: the next song hadn't finished rendering before the lock, the page went quiet when the song ended, and iOS wouldn't let it start the next one. Now:
  - it renders **two songs ahead**, so minutes of music are ready before the screen locks;
  - if the next song still isn't ready, it **plays silence instead of stopping**, so iOS keeps the page running and allows the switch when the song is ready (the lock screen says "Writing the next song…");
  - a render that **stalls or loses its worker** is retried on a fresh one, and if it still fails, play picks up where the queue left off.
- **Renders use about half the memory.** Reverb and echo now run in place, and each mix bus is dropped once it's mixed. A 3-minute song peaks around 430 MB instead of 810 MB. The audio is bit-identical (test).
- **Songs vary much more.** New auto-built songs (Radio, **Build a whole song**, `tom song`) come from a new arranger: six song forms (verse–chorus–verse, songs that open on the chorus, double verses, a repeated last chorus…), different section lengths, verses that sometimes carry their own low melody, second verses and later choruses that build, breaks that can be a breakdown, a drum break, a counter-line or (less often) the hook on bells, and an ending sparkle in about 40% of songs. Their links say `&gen=2`; links without it keep the original arranger, note for note.
- **No more church bells.** Synthwave, Bright Pop, Chiptune, Lo-fi and Marimba had no bell voice of their own, so they fell back to an FM bell tuned to a clangy 3.5:1 ratio. Synthwave played it louder than any other style, through echo and a big reverb. Now Synthwave and Pop use a glassy, in-tune chime at about half the level, Chiptune an 8-bit ding, Lo-fi a high electric piano, and Marimba a high marimba. Existing links keep every note and its timing; only the timbre changed.
- `tom song --gen 1` builds with the original arranger.

## 0.6.0 — 2026-09-23

- **Radio.** Pick a station (any style, or **Mix**, which rotates through every style without repeats) and Tom writes an endless run of new songs, each with a fresh tag, key and tempo (within ±6% of the style's feel). The next song renders while the current one plays.
- **Background playback on iOS.** Radio plays through an audio element, so it keeps going with the screen locked, with Safari in the background, and with the ringer switch on silent. The lock screen and Control Center show the song, station and artwork, with play, pause, next and scrubbing (Media Session).
- Every radio song is an ordinary auto-built song: **Open in the composer** keeps editing it, and **Copy link** shares its `#song:` link. `#radio:<style>` opens a station.
- **Works offline.** A service worker caches the app on your first visit, and Add to Home Screen installs it (manifest and icons). Stamped deploy files are cached for good, the page itself is network-first, and files from older deploys are pruned.
- CLI: `tom radio --station <style|mix> --count N` renders the next songs of a station into a folder. `tom render '#radio:…'` does the same.
- Fixed: the composer's play cursor ran ahead of the blocks (it counted the timeline's padding twice, and drifted further once the timeline scrolled).
- Fixed: Play could start several songs at once if pressed while a song was still rendering, which left audio that Stop couldn't reach, and switching tabs mid-render let the song start on the other tab. Play now shows Stop at once, and Stop or a tab switch cancels a render that's still in progress.
- Fixed: Orchestral and Country endings (timpani, strum) drew from a random seed, so the same link's final hit could differ slightly between renders. The ending's seed now comes from the song's. The notes are unchanged (golden test).

## 0.5.0 — 2026-09-22

- **Country** style: boom-chick (bass alternating root and fifth on 1 and 3, walking up into each chord change; a strummed acoustic guitar on 2 and 4 with an up-strum on the "and" of 4), a brushed two-step kit, banjo forward rolls, a pedal-steel melody that swells in and slides up into its notes, and a fiddle counter-line, in G major at 112 BPM.
- **Funk** style: a syncopated 16th groove (kick on 1, the "a" of 1, the "and" of 3 and the "e" of 4; snare on 2 and 4 with ghost notes; 16th hats with an open hat on the "and" of 4), slap bass that pops the octave and leans on the flat seven, chicken-scratch guitar on 9th chords with dead strokes between accents, keys in the verses and horn-section stabs in the choruses, and a brass lead, in E dorian at 104 BPM.
- New instruments: acoustic strum, pedal steel, fiddle, slap bass, clavinet, brass, scratch guitar.
- Existing links are unchanged (golden note-level test).

## 0.4.0 — 2026-09-22

- **Reggae** style: one-drop drums (nothing on the one; kick and rimshot together on three, a turnaround every fourth bar), a muted guitar skank on 2 and 4, an organ bubble on every off-beat, a deep dub bass that alternates two breathing patterns, and a melodica lead through dub echo, in G major at 76 BPM.
- **EDM** style: four-on-the-floor kick with claps, off-beat open hats and 16th shakers, supersaw chords pumping hard against the kick, an off-beat house bassline, 16th-note saw-pluck arps and a supersaw lead, in F minor at 126 BPM.
- New instruments: rimshot, melodica, drawbar organ, skank chop, dub bass, saw pluck. MIDI maps the rimshot to GM side stick (37).
- Styles can set their own sidechain depth (`pump`); older styles keep the original 0.65. Existing links are unchanged (golden note-level test).

## 0.3.0 — 2026-09-22

- **Hip-Hop** style: boom-bap drums (kick on 1, the "and" of 2 and 3; snare layered with a clap on 2 and 4; swung hats with a ghost note), an 808 that slides into pitch and sustains from each kick to the next, dusty electric-piano chords with off-beat stabs, and a breathy flute hook, in C minor at 90 BPM.
- **Rock** style: distorted power chords (root–fifth–octave, since thirds turn to mud under distortion) that chug palm-muted in quiet sections and ring open in choruses, a driving eighth-note bass, a roomy kit with a tom fill every fourth bar, and an overdriven lead guitar on the melody, in E major at 124 BPM.
- New instruments: 808, flute, rhythm guitar, lead guitar, toms. MIDI maps toms to GM 47.
- Existing links are unchanged: the golden note-level test passes against 0.1.0.

## 0.2.0 — 2026-09-22

- **Jazz** style: walking upright bass (roots on the downbeat, chord tones between, a chromatic step into every next chord), swung ride with hi-hat on 2 and 4 and brush ghost notes, rootless 3-5-7-9 piano voicings in a Charleston comp, and a swung vibraphone melody over ii–V–I changes.
- **Orchestral** style: divided strings that swell in, a french-horn melody, pizzicato arpeggios, low strings, timpani tuned to the key with timpani rolls for builds, celesta bells, and a concert-hall reverb.
- New instruments: upright bass, ride cymbal, brush snare, vibraphone, jazz piano, string ensemble, pizzicato, french horn, timpani, concert bass drum, celesta. MIDI export adds a Timpani track and GM ride/brush/bass-drum notes.
- **Share links are now a promise.** Bare hashtags pick their style from the original five styles, frozen, so adding styles never changes a link someone already shared. Golden note-level hashes in the tests enforce it (audio samples can differ in the last bit across CPU architectures; the notes cannot).

## 0.1.0 — 2026-09-22

First release.

- **Melody Machine** (web): one button for a new melody, with dials for style, key, mode, tempo, bars, busy-ness, syncopation, shape, phrase form, register, chords and backing. Turning a dial keeps the seed, so you shape the same melody.
- **Composer** (web): snap Intro, Verse, Build, Chorus, Break, Outro and Ending blocks together like Lego. Each block has its own layers, drums, filter sweep, chords and melody dials. **Auto** builds a whole song, finishes a partial one, or re-rolls one block; locked blocks are never touched.
- **CLI**: `tom melody`, `tom song`, `tom jingle` (lands a final hit at an exact time, for video end cards), `tom render` (blueprints from the composer), `tom compose`, `tom styles`, `tom doctor`.
- Five styles: Synthwave, Bright Pop, Chiptune, Lo-fi, Marimba.
- Melody generator: motif + phrase form (AABA, ABAB, …) + contour, strong beats on chord tones, gap-filled leaps, no tritone leaps, tonic cadence.
- Export WAV and Standard MIDI (one track per layer, GM drums); ffmpeg adds m4a/mp3 and loudness normalization in the CLI.
- Deterministic: the same blueprint and seed give the same notes everywhere, and byte-identical audio on the same machine.
- Zero dependencies. The same engine runs in Node and in the browser (Web Worker).
