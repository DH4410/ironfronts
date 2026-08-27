# Audio credits and licensing

Ironfronts uses music from the **0 A.D. soundtrack** by Wildfire Games and its music contributors.

## License

The official 0 A.D. music page states that the soundtrack is released under the
**Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)** license.

- Official soundtrack page: https://play0ad.com/media/music/
- License: https://creativecommons.org/licenses/by-sa/3.0/
- Official May 2015 MP3 archive:
  https://play0ad.com/wp-content/uploads/2015/06/0-AD-Music_updated_May2015.zip

The soundtrack assets remain under CC BY-SA 3.0. This notice does not relicense
Ironfronts source code.

When redistributing these tracks or adaptations of them, preserve attribution
and comply with the ShareAlike terms of CC BY-SA 3.0.

## Archive used for the Ironfronts soundtrack catalog

The supplied `0-AD-Music_updated_May2015.zip` contains:

- 31 MP3 tracks
- approximately 89.63 MiB total audio
- approximately 97.2 minutes total runtime
- archive SHA-256: `b04049a17fe33ff5ff87bf243dd81d4b2790e9d68e76f44cf459a1ce63407cea`
- 128 kbps MP3 for 30 tracks
- 160 kbps MP3 for `Cisalpine_Gaul.mp3`

The MP3 files only contain basic album/title ID3 metadata, so this document
preserves creator attribution separately.

## Primary music credits

The soundtrack is led by **Omri Lahav**. Known primary-artist exceptions and
collaborations in this 31-track set include:

- **Jeff Willet** — First Sighting; Elusive Predator
- **Mike Skalandunas** — Tavern in the Mist
- **Omri Lahav & Shlomi Nogay** — Valley of the Nile

0 A.D. release notes also credit Jeff Willet with percussion on Celtica and
The Hellespont, and credit additional performers on various recordings.

## Ironfronts music grouping

### Menu

- Calm Before the Storm
- Honor Bound

### Match opening

- First Sighting

### Relaxed / peace rotation

- Ammon-Ra
- An Old Warhorse Goes to Pasture
- Celtic Pride
- Celtica
- Cisalpine Gaul
- Dried Tears
- Eastern Dreams
- Elysian Fields
- Forging a City-State
- Harsh Lands, Rugged People
- Harvest Festival
- Highland Mist
- In the Shadow of Olympus
- Juno Protect You
- Land Between the Two Seas
- Mediterranean Waves
- Peaks of Atlas
- Sands of Time
- Tavern in the Mist
- The Hellespont
- The Road Ahead
- Valley of the Nile
- Water's Edge

> Ironfronts intentionally places **Dried Tears** in the relaxed rotation to
> follow the selected soundtrack design. In 0 A.D. it was historically used as
> a defeat cue.

### War / battle rotation

- Elusive Predator
- Helen Leaves Sparta
- Karmic Confluence
- Rise of Macedon

### Outcome

- You Are Victorious! — victory stinger

## Runtime source policy

During development, tracks that still exist in the archived public
`0ad/0ad` GitHub mirror are streamed from commit
`61a3b9507d974084e6badb88a0826bd89a6d5b8b` so playback is deterministic
and does not follow a moving branch.

The current archived mirror no longer contains **First Sighting** or
**Elusive Predator**. The music catalog therefore also supports same-origin
MP3 files under `public/audio/music/`. Once the May 2015 archive is vendored,
those two tracks (and optionally all tracks) should be served locally rather
than depending on an external mirror.

## Sound effects and ambience

### Kenney UI Audio — CC0 1.0

Ironfronts currently uses three UI samples from **Kenney's UI SFX Set**:

- `public/audio/sfx/ui-click.wav` — original `click1.wav`
- `public/audio/sfx/ui-hover.wav` — original `rollover2.wav`
- `public/audio/sfx/ui-switch.wav` — original `switch14.wav`

Original author: **Kenney Vleugels (Kenney.nl)**  
License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://kenney.nl/assets/ui-audio

The WAV copies were vendored from the CC0 mirror
`Calinou/kenney-ui-audio` at commit
`8c3d81b9159d058c444f89d12d518276b0b09345`. That mirror documents the
WAVs as lossless conversions of Kenney's original OGG files.

Attribution is not required by CC0, but is preserved here.

### Ylmir — Rain (loopable) — CC0 1.0

`public/audio/ambience/rain.ogg` is from **Rain (loopable)** by **Ylmir**,
published on OpenGameArt.org.

License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://opengameart.org/content/rain-loopable

The vendored file is the 45-second `3.ogg` variant from the original
`Rain OGG.zip` pack, re-encoded from 160 kbps to 96 kbps Vorbis with no
other modification. It was copied from
`halogenandtoast/ArkhamHorror` at commit
`7cca20a30a271a1386041a5381622ae46ab0f26d`, which preserves the original
source and CC0 license notice.

The rain loop is intentionally non-spatial for now: weather should surround
the listener rather than sound like a single point emitter. Localized effects
such as thunder, battles, cities and coastlines can use HRTF spatialization
later.

