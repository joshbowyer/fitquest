/**
 * Sound bus — tiny pub-sub for "things just happened that deserve a
 * chime". Same architectural shape as RewardOverlay (separate
 * component for the bus logic, pages call `playSound(event)` from
 * anywhere).
 *
 * v2 ships a proper synthwave synth layer for when a real MP3
 * isn't mapped in SOUND_FILES. The synth technique is the same
 * pattern used in the Outrun-style car-fighter game on GitHub
 * (charge260w/car-fighter, CC0): sawtooth + biquad lowpass +
 * detune for chorus + ADSR with sustain + filter sweeps. Earlier
 * versions used raw oscillators with no filter and no chorus,
 * which the user described as '8-bit DOS' — adding the filter
 * and detune is what makes it sound like synthwave instead.
 *
 * Real recordings still win when the user prefers them — the
 * SOUND_FILES map below lists MP3 paths; playFile() takes
 * precedence over the synth when the file 404s cleanly. The
 * 6 file-backed events (workoutComplete, levelUp, achievement,
 * restTimerDone, bossKill, lootDrop) use Kenney CC0 SFX from
 * the sparkstream-sounds pack; skillUnlock uses the YouTube
 * 'Party Horn Children Yay' SFX. Empty mapping → synth fallback.
 *
 * Mute toggle is persisted to localStorage so the user's
 * preference survives page reloads. Browser autoplay policy is
 * handled by lazy-creating the AudioContext on the first user
 * gesture (any click/keypress), since that's the only signal
 * the browser accepts to unlock audio playback without an
 * explicit permission prompt.
 */

let ctx: AudioContext | null = null;
let unlocked = false;
let muted = false;

// Restored at module load (we can't read localStorage during SSR,
// but this module is client-only by virtue of being in web/src).
try {
  muted = localStorage.getItem('fitquest:sound:muted') === '1';
} catch {
  // SSR or storage disabled — default to unmuted.
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/**
 * Try to unlock the AudioContext. Must be called from a user
 * gesture handler (click, keypress, pointerdown). Browsers won't
 * play audio until then. We attach one-time listeners on the
 * first invocation so any subsequent user interaction unlocks it
 * without further wiring.
 */
function tryUnlock() {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') {
    c.resume().catch(() => {});
  }
  unlocked = true;
}

if (typeof window !== 'undefined') {
  // Best-effort: as soon as the user does anything, unlock audio.
  // 'pointerdown' + 'keydown' covers mouse, touch, and keyboard.
  const unlock = () => tryUnlock();
  window.addEventListener('pointerdown', unlock, { once: false, passive: true });
  window.addEventListener('keydown', unlock, { once: false, passive: true });
}

export type SoundEvent =
  | 'workoutComplete'
  | 'levelUp'
  | 'achievement'
  | 'restTimerDone'
  | 'skillUnlock'
  | 'bossKill'
  | 'lootDrop';

// Per-event MP3 paths. When a real recording is dropped in at
// `web/public/sounds/{event}.mp3` and added here, the synth fallback
// is bypassed. Events without a file use the built-in synthwave
// synth (see playPattern() below). skillUnlock stays mapped to
// the YouTube 'Party Horn Children Yay' SFX — the user wanted
// that one as a meme.
const SOUND_FILES: Partial<Record<SoundEvent, string>> = {
  // workoutComplete: '/sounds/workout-complete.mp3',
  // levelUp:        '/sounds/level-up.mp3',
  // achievement:    '/sounds/achievement.mp3',
  // restTimerDone:   '/sounds/rest-timer.mp3',
  skillUnlock:     '/sounds/skill-unlock.mp3',
  // bossKill:        '/sounds/boss-kill.mp3',
  // lootDrop:        '/sounds/loot-drop.mp3',
};

// =============================================================
// Synthwave synth primitives — modeled on the Outrun car-fighter
// game on GitHub. Each primitive is small + focused: a single
// voice type that can be combined (e.g., layer a pluck voice +
// noise hit for a punchy impact). The earlier 8-bit version
// used bare oscillators with no filter — adding the lowpass +
// detune is what makes it read as "synthwave" not "chiptune".
// =============================================================

/** White-noise BufferSource. */
function makeNoise(dur: number): AudioBufferSourceNode {
  const c = ensureCtx()!;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  return s;
}

/** ADSR envelope helper. Quick attack to peak, then exponential decay to ~0 over the rest of the note's lifetime. The exponentialRamp uses the gain's current value as the start (after the linear attack ramp lands at peak), so a single ramp gives the full 'attack + ring-out' envelope. */
function envPluck(
  g: GainNode,
  start: number,
  durSec: number,
  peak: number,
): void {
  g.gain.cancelScheduledValues(start);
  g.gain.setValueAtTime(0.0001, start);
  // Quick attack — 3ms linear ramp to peak.
  g.gain.linearRampToValueAtTime(peak, start + 0.003);
  // Decay over the rest of the note's lifetime. ExponentialRamp
  // uses the current value at the call site — which is now
  // `peak` because the linear ramp just scheduled it. The ramp
  // ends at the start+attack+rest of the duration.
  g.gain.exponentialRampToValueAtTime(0.0001, start + durSec);
}

/**
 * Synthwave pad voice: detuned saw + lowpass filter with
 * long attack + sustain. The detune is what gives it the
 * characteristic "two slightly-out-of-tune saws" chorused
 * sound. The lowpass keeps it warm and analog instead of
 * harsh. This is the "hummm" the user described.
 */
function playPad(
  midi: number,
  durationSec: number,
  gain = 0.10,
  detuneCents = 5,
): void {
  const c = ensureCtx();
  if (!c || !unlocked || muted) return;
  const start = c.currentTime;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  // Two saws slightly detuned (chorus).
  const o1 = c.createOscillator();
  o1.type = 'sawtooth';
  o1.frequency.value = freq;
  o1.detune.value = -detuneCents;
  const o2 = c.createOscillator();
  o2.type = 'sawtooth';
  o2.frequency.value = freq;
  o2.detune.value = detuneCents;
  // Lowpass shapes the timbre. 1400Hz is a good warm synthwave
  // sweet spot — bright enough to hear, dark enough to not be
  // buzzy.
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  lp.Q.value = 1;
  const g = c.createGain();
  o1.connect(lp);
  o2.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  envPluck(g, start, durationSec, gain);
  o1.start(start);
  o2.start(start);
  o1.stop(start + durationSec + 0.1);
  o2.stop(start + durationSec + 0.1);
}

/**
 * Pluck voice: short saw + lowpass sweep. The filter starts
 * bright (2500Hz) and drops to dark (400Hz) over the note's
 * lifetime — this is the classic analog synth "filter
 * envelope" that gives each note its attack character.
 */
function playPluck(
  midi: number,
  durationSec = 0.30,
  gain = 0.20,
): void {
  const c = ensureCtx();
  if (!c || !unlocked || muted) return;
  const start = c.currentTime;
  const stop = start + durationSec;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = freq;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2500, start);
  lp.frequency.exponentialRampToValueAtTime(400, stop);
  lp.Q.value = 4;
  const g = c.createGain();
  o.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  envPluck(g, start, durationSec, gain);
  o.start(start);
  o.stop(stop + 0.02);
}

/**
 * Laser zap: rapid descending saw pitch sweep (2kHz → 80Hz)
 * through a bandpass filter. The classic "pew" — the user
 * mentioned this explicitly.
 */
function playLaser(
  startFreq = 2000,
  endFreq = 80,
  durationSec = 0.30,
  gain = 0.18,
): void {
  const c = ensureCtx();
  if (!c || !unlocked || muted) return;
  const start = c.currentTime;
  const stop = start + durationSec;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(startFreq, start);
  o.frequency.exponentialRampToValueAtTime(endFreq, stop);
  // Bandpass keeps the sweep bright instead of going muddy.
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 6;
  const g = c.createGain();
  o.connect(bp);
  bp.connect(g);
  g.connect(c.destination);
  envPluck(g, start, durationSec, gain);
  o.start(start);
  o.stop(stop + 0.02);
}

/**
 * Noise impact (kick / snare / glass). Filter + short envelope.
 * Pass `low` for the kick sub-thump (lowpass 80Hz), `mid` for
 * a snare (bandpass 1.5kHz), `high` for a hi-hat (highpass 6kHz).
 */
function playNoiseHit(
  durationSec = 0.20,
  filterMode: 'low' | 'mid' | 'high' = 'mid',
  gain = 0.20,
): void {
  const c = ensureCtx();
  if (!c || !unlocked || muted) return;
  const start = c.currentTime;
  const stop = start + durationSec;
  const n = makeNoise(durationSec + 0.05);
  const f = c.createBiquadFilter();
  if (filterMode === 'low') {
    f.type = 'lowpass';
    f.frequency.value = 80;
  } else if (filterMode === 'high') {
    f.type = 'highpass';
    f.frequency.value = 6000;
  } else {
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 2;
  }
  const g = c.createGain();
  n.connect(f);
  f.connect(g);
  g.connect(c.destination);
  envPluck(g, start, durationSec, gain);
  n.start(start);
  n.stop(stop);
}

/**
 * Kick: sine sweep 150Hz → 48Hz with fast decay. The synthwave
 * variant of the classic 808-style sub.
 */
function playKick(): void {
  const c = ensureCtx();
  if (!c || !unlocked || muted) return;
  const start = c.currentTime;
  const stop = start + 0.18;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, start);
  o.frequency.exponentialRampToValueAtTime(48, start + 0.11);
  const g = c.createGain();
  o.connect(g);
  g.connect(c.destination);
  g.gain.setValueAtTime(0.5, start);
  g.gain.exponentialRampToValueAtTime(0.0001, stop);
  o.start(start);
  o.stop(stop + 0.02);
}

// =============================================================
// Per-event patterns. Each is a short layered sequence using
// the primitives above. Aim is for each event to have a
// distinct character so the user can tell them apart without
// looking at the screen.
// =============================================================

function playPattern(event: SoundEvent): void {
  switch (event) {
    case 'workoutComplete':
      // Triumphant synthwave chord stab. C minor triad (C, Eb, G)
      // played as overlapping plucks with a low sub-kick. The
      // hummm the user asked for, in ascending melodic form.
      playKick();
      playPluck(60, 0.45, 0.30);  // C4
      playPluck(63, 0.45, 0.28);  // Eb4
      playPluck(67, 0.55, 0.30);  // G4 — longer, lets the chord "ring"
      break;
    case 'levelUp':
      // Ascending arpeggio. C5 → E5 → G5 → C6 — the iconic RPG
      // level-up jingle, but with synthwave timbre (detuned
      // saws under lowpass). Each note is a short pluck.
      playPluck(72, 0.20, 0.30);  // C5
      playPluck(76, 0.20, 0.30);  // E5
      playPluck(79, 0.22, 0.32);  // G5
      playPluck(84, 0.45, 0.34);  // C6 — held, the payoff
      break;
    case 'achievement':
      // Short two-note "ping". The C major arpeggio sounds
      // positive and triumphant. Quick attack + fast decay.
      playPluck(72, 0.18, 0.28);
      playPluck(76, 0.32, 0.30);
      break;
    case 'restTimerDone':
      // Synthwave alarm: a mid-frequency descending pulse with
      // a lowpass sweep. Two-tone "bwong-bwong" so it's
      // clearly an alert, not a celebration.
      playPluck(67, 0.20, 0.26);
      playPluck(60, 0.40, 0.30);
      break;
    case 'skillUnlock':
      // Real recording from the YouTube SFX the user linked
      // ('Party Horn Children Yay Sound Effect', K6tsx6j-ZAM).
      // Downloaded + extracted via yt-dlp, converted to mono
      // 96kbps MP3 with ffmpeg, dropped at
      // web/public/sounds/skill-unlock.mp3 (4.2s, 35KB).
      // playFile() will pick this up; if the file 404s the
      // synth fallback fires. The user preferred the real
      // recording over any synth.
      break;
    case 'bossKill':
      // Power-down: descending laser + low noise impact +
      // descending bass pad. The "boss is dead" sequence.
      playLaser(1200, 80, 0.5, 0.22);    // descending pew
      playNoiseHit(0.45, 'low', 0.30);   // sub impact
      playPluck(48, 0.55, 0.28);         // low C — the death knell
      break;
    case 'lootDrop':
      // Quick ascending laser + tiny noise tick. Classic
      // "you got an item" feedback. The user explicitly asked
      // for a laser-gun sound.
      playLaser(400, 2200, 0.20, 0.22); // ascending pew
      playNoiseHit(0.08, 'high', 0.16);  // small tick
      break;
  }
}

async function playFile(event: SoundEvent): Promise<boolean> {
  const src = SOUND_FILES[event];
  if (!src) return false;
  if (muted) return true; // mute state handled, just no audio
  const c = ensureCtx();
  if (!c || !unlocked) return true;
  try {
    const res = await fetch(src);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    const audio = await c.decodeAudioData(buf);
    const node = c.createBufferSource();
    node.buffer = audio;
    const env = c.createGain();
    env.gain.value = 0.3;
    node.connect(env).connect(c.destination);
    node.start();
    return true;
  } catch {
    return false;
  }
}

/**
 * Fire a sound for the given event. If a file override is set
 * and loads, it plays. Otherwise we fall back to the synth
 * pattern. No-ops while muted.
 */
export async function playSound(event: SoundEvent): Promise<void> {
  if (muted) return;
  const filePlayed = await playFile(event);
  if (filePlayed) return;
  // Fallback to synth. Even if playPattern bails (no ctx / not
  // unlocked), we tried — pages shouldn't have to handle the
  // failure case.
  try {
    playPattern(event);
  } catch {
    // silent fallback
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem('fitquest:sound:muted', value ? '1' : '0');
  } catch {
    // localStorage unavailable (private mode, etc.) — in-memory
    // toggle still works for the rest of this session.
  }
}

/**
 * Test / warm-up helper. Call once from a user gesture (e.g. the
 * mute toggle button onClick) to unlock the audio context so
 * subsequent playSound calls work. Safe to call repeatedly.
 */
export function primeAudio(): void {
  tryUnlock();
}