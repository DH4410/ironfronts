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
