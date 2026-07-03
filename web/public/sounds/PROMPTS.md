# ElevenLabs Sound Effect Prompts

Stuck in your terminal? Cat this file. Each prompt is designed
to be pasted into ElevenLabs Sound Effects (or any equivalent
SFX generator) and downloaded. Aim for ~1-2 second sounds; the
timing should match what the synth currently does:

  workoutComplete  ~1.2s
  levelUp         ~1.5s
  achievement    ~0.7s
  restTimerDone   ~1.0s
  bossKill        ~1.5s
  lootDrop        ~0.5s
  skillUnlock     YouTube MP3 (no prompt needed)

All prompts are CC0 — no attribution required, no copyright
strings to scrub. Drop the downloaded MP3 into
`web/public/sounds/{event}.mp3` and uncomment the line in
`SOUND_FILES` in `web/src/lib/soundBus.ts:87` for that event.
The synth stays as a clean fallback if the file 404s.

---

## workoutComplete — the triumph hummm

Triumphant analog synth chord stab, Outrun 1986 aesthetic. A C
minor triad (C, E♭, G) on a lush detuned saw pad with a soft
lowpass filter and 1 second of slow exponential release, layered
over a subtle TR-808 style sub-kick. Warm, triumphant,
celebratory but not over the top. No vocals, no drums other than
the kick.

## levelUp — Commodore 64 SID chip achievement

Retro 8-bit computer achievement sound, 1982 Commodore 64 SID
chip aesthetic. Square wave arpeggio ascending from C5 to C6
over half a second with rapid arpeggio notes, then a triumphant
held triad chord. Slight 1-bit square wave crunch. Think
Ultima or Bard's Tale level-up jingle. Dry, no reverb, no chorus.

## achievement — synthwave trophy ping

Bright synthwave achievement chime, DX7 FM bell aesthetic. A
quick two-note ascending C5 to E5 major-third ping with a long
shimmering analog-style release tail, like a digital synth bell.
FM synthesis, no analog filter, clean and bright. Short 0.5 to
1 second.

## restTimerDone — synthwave alarm two-tone

Synthwave alarm, retro-futurist 1980s. Two-tone descending
pulse, "bwong-bwong", like a vintage computer error alert but
with a fat analog synthesizer sound. Lowpass-filtered saw wave
with a quick filter sweep. Not annoying, more like a "wake up,
this is important" cue. Slight detune for analog character. 1
second total.

## bossKill — synthwave power-down

Retro video game boss death sound, synthwave 1980s aesthetic.
Descending power-down sweep: starts at a high square-wave pitch
and rapidly descends over half a second, with a lowpass filter
closing as the pitch drops, ending in a low sustained hum.
Like a synth being turned off, or a Metroid boss explosion, or
a Castlevania death. Add a brief low-frequency boom at the very
end. 1.5 seconds.

## lootDrop — synthwave item pickup (the laser gun)

Synthwave item pickup chime, Outrun 1986. Quick ascending
laser-style frequency sweep (a "pew" or "zap") that goes from
low to high over 0.3 seconds, ending in a bright bell-like FM
synth "bling" note. Like a retro video game coin pickup or a
Sonic the Hedgehog item sound, but with a fat analog synth sweep
instead of chiptune. Quick and satisfying.

---

## File mapping reminder

After downloading each MP3, the path is fixed:

  web/public/sounds/workout-complete.mp3
  web/public/sounds/level-up.mp3
  web/public/sounds/achievement.mp3
  web/public/sounds/rest-timer.mp3
  web/public/sounds/boss-kill.mp3
  web/public/sounds/loot-drop.mp3
  web/public/sounds/skill-unlock.mp3   (already in place — YouTube MP3)

Filename is irrelevant to the app — the SOUND_FILES map in
`web/src/lib/soundBus.ts` hardcodes each path. If you want to
use a different name, edit the map.
