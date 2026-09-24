<p align="center">
  <a href="https://tom.wemiller.com"><img src="web/gecko.svg" width="120" alt="Tom the gecko"></a>
</p>

<h1 align="center">Tom</h1>

<p align="center">
  <strong>A music machine. Dial in a melody in seconds, snap a whole song together like Lego, or tune in to endless radio.</strong><br>
  Seeded, parameterized, royalty-free. In your browser (even offline) or on the command line.
</p>

<p align="center">
  <a href="https://tom.wemiller.com"><strong>Open Tom</strong></a> &bull;
  <a href="#the-web-app">Web app</a> &bull;
  <a href="#radio">Radio</a> &bull;
  <a href="#the-cli">CLI</a> &bull;
  <a href="#share-links-a-hashtag-is-a-song">Share links</a> &bull;
  <a href="#how-it-works">How it works</a>
</p>

---

Tom is named after the **tokay gecko**, one of the few lizards that sings (it's named after its own call: *"to-KAY!"*). Tom writes music on demand: a hook for a video, a loop for a game, a jingle that lands exactly on your end card, or a full three-minute song. Everything is generated from a **seed**, so the same seed and settings always produce the same music: the same notes, rhythm and sounds, on every computer. And because Tom writes it all, what you make is yours to use: no samples, no licenses, no Content ID claims.

## The web app

**[tom.wemiller.com](https://tom.wemiller.com)** runs entirely in your browser. Nothing is uploaded, and after your first visit it works **offline**: on iPhone or iPad, tap Share → **Add to Home Screen** and Tom opens like an app, with or without a connection.

### Melody Machine

Press **🎲 New melody** and you get one. Then dial it in:

| Dial | What it does |
|---|---|
| **Style** | Synthwave, Bright Pop, Chiptune, Lo-fi, Marimba, Jazz, Orchestral, Hip-Hop, Rock, Reggae, EDM, Country, Funk |
| **Key · Mode · Tempo** | Any key; major, minor, dorian, mixolydian, pentatonic |
| **Bars** | 4, 8 or 16 |
| **Busy-ness** | Sparse and singable ↔ quick and chatty |
| **Swing & syncopation** | On the beat ↔ pushing against it |
| **Shape** | Arch, rise, fall, wave or flat: the overall contour of the line |
| **Phrase form** | AABA, ABAB, AAAB, ABAC, ABCD: which bars repeat the hook |
| **Register** | Low, mid or high |
| **Chords · Backing · Drums** | Progression presets, chords and bass on/off, drum density |

Turning a dial **keeps the seed**, so you're shaping *this* melody rather than getting a new one. The piano roll shows every note, and **Add to composer →** drops it into a song.

### Composer

Songs are built from **blocks**, like Lego bricks: **Intro, Verse, Build, Chorus, Break, Outro** and an **Ending** hit. Click or drag bricks onto the timeline and reorder them. Select a brick to shape it: length, chords, layers (chords, arp, bass, melody, counter-melody, bells, octave doubling, riser, crash), drum level, filter sweep, and the same melody dials.

**✨ Auto** does the heavy lifting whenever you want:

- **Build a whole song:** a full (~3 min), short (~1 min) or loop arrangement, with choruses that share one hook.
- **Finish my song:** keeps what you've made and adds the rest of the arrangement, ending with a proper outro and final hit.
- **Surprise me:** re-rolls just the selected block.
- **Re-roll everything unlocked:** 🔒 **Lock** any block you love, and Auto will never touch it.

**Export** gives you WAV audio, a **MIDI** file (one track per layer, General MIDI drums) for Logic, GarageBand or Ableton, or the song as JSON. Your work autosaves in the browser.

### Radio

Pick a station, one per style plus **Mix**, which rotates through every style, and Tom writes an endless run of brand-new songs in it: a fresh tag, key and tempo for each, mostly full-length, and each with its own song form, section lengths and textures. Tom stays two songs ahead of the one playing, so the gaps between songs are just the ring-out of each ending.

- **It keeps playing in the background.** Radio plays through a media element rather than Web Audio, so on iPhone it carries on with the screen locked, with Safari in the background, and with the ringer switch on silent. The lock screen and Control Center show the song and station, with play, pause, next and scrubbing. If a song isn't written yet when the last one ends, Radio holds the line with silence (iOS stops a page that goes quiet) and starts the song as soon as it's ready.
- **Every song is a real song.** **Open in the composer** takes the one you're hearing into the composer to keep editing, and **Copy link** gives its `#song:` link, the same song for anyone.
- `tom.wemiller.com/#radio:jazz` opens the Jazz station.

## Share links: a hashtag is a song

The seed lives in the URL, so **the link is the song**:

```
tom.wemiller.com/#sunset-drive                        a melody; the tag alone picks style, key, tempo and shape
tom.wemiller.com/#sunset-drive&style=chip&busy=0.8    the same tag with a couple of dials turned
tom.wemiller.com/#first-dance&style=jazz&key=Bb&bpm=132   any tag, in any style
tom.wemiller.com/#song:road-trip&length=short         a whole auto-built song from a tag
tom.wemiller.com/#song:road-trip&gen=2                the same tag through the newer, more varied arranger
tom.wemiller.com/#song=eyJ2ZXJzaW9uIjox…               an edited song, carried in full
```

Type any word after the `#` and Tom plays that song, the same one for everyone, every time. The address bar updates as you work, so copying it always copies exactly what you hear. Links list only the dials that differ from the tag's own recipe, so they stay short. A link, once shared, keeps its song: bare tags choose among the original five styles forever, so adding styles never changes an existing link (the tests pin every note of a set of golden links). New styles are one `&style=` away. The die rolls memorable tags like `#mellow-gecko-42`.

The CLI reads the same links and prints one for every render, so a song moves between the browser and the terminal without changing a note.

## The CLI

Zero dependencies; Node 18 or newer. [ffmpeg](https://ffmpeg.org) is optional and adds `.m4a`/`.mp3` output plus loudness normalization (−14 LUFS by default).

```sh
git clone https://github.com/blaineam/Tom.git && cd Tom
node tom.mjs help                 # or: ln -s "$PWD/bin/tom" /usr/local/bin/tom
```

```sh
tom melody --seed '#sunset-drive' --out hook.wav --midi       # the same melody as the link above
tom melody --style chip --density 0.8 --contour rise --form AAAB --bars 16
tom song --seed road-trip --length short --out road-trip.m4a --blueprint
tom jingle --style synthwave --length 9.1 --hit 6.75 --out bed.wav
tom render 'https://tom.wemiller.com/#sunset-drive&busy=0.8'  # any share link
tom render my-song.json                                       # a song saved from the composer
tom radio --station funk --count 5 --format m4a                # the next five songs of a radio station
tom compose                                                   # run the web app locally
tom styles | tom doctor
```

| Command | Makes |
|---|---|
| `tom melody` | A melody over a backing loop. Every Melody Machine dial is a flag: `--bars --density --syncopation --contour --form --octave --progression --no-chords --no-bass --drums`. |
| `tom song` | A whole auto-arranged song. `--length full\|short\|loop` |
| `tom jingle` | A short bed whose final hit lands **exactly** at `--hit` seconds and rings out to `--length`. Tempo is solved so the hit falls on a bar line, which makes it ideal for video end cards. |
| `tom render` | A composer song (`.json`), a share link, or a bare `#hashtag`. |
| `tom radio` | The next few songs of a station, one file each, into a folder. `--station <style\|mix> --count 3 --seed <s> --out <dir> --format wav\|m4a\|mp3`. The same `--seed` gives the same songs. |
| `tom compose` | Serves the web app at `http://127.0.0.1:5178`. |

Common flags: `--style`, `--seed` (any word or `#hashtag`), `--key` (e.g. `A`, `F#`, `Eb`), `--mode`, `--bpm`, `--out`, `--midi [file]`, `--blueprint [file]`, `--loudness <LUFS>`.

### With Monkr

[Monkr](https://github.com/blaineam/Monkr) animates device mockups into video. When `tom` is installed, `monkr animate --music <style>` scores the clip with a Tom jingle whose final hit lands where you ask.

## Styles

| Style | Sound |
|---|---|
| **Synthwave** | Saw arpeggios, gated reverb snare, a pad that pumps with the kick |
| **Bright Pop** | Plucked arps, claps, sidechained supersaw |
| **Chiptune** | Square-wave lead, triangle bass, noise drums |
| **Lo-fi** | Swung FM electric piano, soft drums, vinyl crackle |
| **Marimba** | Warm marimba melody, shaker, soft pad |
| **Jazz** | Walking upright bass that steps chromatically into each chord, swung ride and brushes, rootless piano comping, vibraphone melody over ii–V–I changes |
| **Orchestral** | Swelling divided strings, french-horn melody, pizzicato, low strings, timpani tuned to the key (and timpani rolls into each chorus), concert-hall reverb |
| **Hip-Hop** | Boom-bap drums with swung hats and ghost notes, snare layered with a clap, an 808 that slides into pitch and lands with every kick, dusty electric-piano chords, a breathy flute hook |
| **Rock** | Distorted power chords (palm-muted chugs in verses, open ringing chords in choruses), driving picked bass, a roomy kit with a tom fill every fourth bar, an overdriven lead guitar on the melody |
| **Reggae** | One-drop drums (nothing on the one; kick and rimshot together on three), guitar skank on 2 and 4, organ bubble on the off-beats, a deep dub bass that leaves space, a melodica lead through dub echo |
| **EDM** | Four-on-the-floor kick, claps and off-beat open hats, hard-pumping sidechained supersaw chords, an off-beat house bassline, 16th-note saw-pluck arps, a supersaw lead, and builds that roll and rise into the drop |
| **Country** | Boom-chick: bass alternating root and fifth on 1 and 3 (walking up into each chord change) with an acoustic strum on 2 and 4, a brushed two-step, banjo forward rolls, a pedal-steel melody that swells and slides into its notes, and a fiddle |
| **Funk** | A syncopated 16th-note groove with snare ghost notes and an open hat on the "and" of 4, slap bass that pops the octave and leans on the flat seven, chicken-scratch guitar on 9th chords, keys in the verses, horn-section stabs in the choruses, and a brass lead |

## How it works

- **Blueprints.** A song is a JSON list of blocks. Each block says *which* layers play and how its melody is shaped; each style says *how* those layers sound. The web app, the CLI and share links all produce the same blueprint for the same input.
- **Melodies with memory.** A motif (a bar of rhythm plus a melodic shape) is invented for each letter of the phrase form, then replayed. That repetition is what makes a tune hummable instead of a random walk. The contour steers the line, strong beats land on chord tones, every leap is answered by a step back, there are no tritone leaps, and the phrase resolves to the tonic.
- **Synthesis from scratch.** Band-limited oscillators, Karplus–Strong plucks, FM electric piano and bells, biquad filters, a Freeverb reverb, echo, kick-driven sidechain and a soft-clipping master bus, all in plain JavaScript on `Float32Array`s. The same code runs in Node and in a Web Worker in the browser.
- **Deterministic.** Every random choice comes from a seeded generator, and each layer draws from its own forked stream, so changing one part never reshuffles another. The notes are identical everywhere. On one machine the audio is byte-identical too; across different CPUs, `sin`/`exp` can round differently in the last bit, far below anything audible.

```
lib/
  rng.mjs         seeded randomness (mulberry32, forkable streams)
  dsp.mjs         oscillators, envelopes, filters, reverb, mix bus
  instruments.mjs drums, plucks, pads, leads, bass
  theory.mjs      scales, chords, progressions, the melody generator
  styles.mjs      the sound palettes (synthwave, pop, chip, lofi, marimba, jazz, orchestral, hiphop, rock, reggae, edm, country, funk)
  blueprint.mjs   blocks, Auto song / finish / surprise, jingles, melodies
  arrange.mjs     blueprint → audio + note events
  share.mjs       hashtag seeds and share links
  radio.mjs       stations: track n of a station, as a song with its own link
  wav.mjs midi.mjs  file writers
web/              the web app (no build step); sw.js caches it for offline use
tom.mjs           the CLI
```

Run the tests with `npm test`.

## License

[MIT](LICENSE) © 2026 Blaine Miller. Music you make with Tom is yours.
