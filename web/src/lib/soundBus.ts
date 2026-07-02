/**
 * Sound bus — tiny pub-sub for "things just happened that deserve a
 * chime". Same architectural shape as RewardOverlay (separate
 * component for the bus logic, pages call `playSound(event)` from
 * anywhere).
 *
 * v1 ships with Web Audio API synth tones (oscillator + envelope)
 * so we have working audio out of the box without bundling MP3s.
 * Every event has its own short tone pattern (level-up arpeggio,
 * workout-complete bell, rest-timer square-wave beep, etc.). The
 * `playFile()` helper is reserved for swapping in real MP3s later
 * without touching call sites — just drop the file in /public/sounds/
 * and add the mapping to SOUND_FILES below.
 *
 * Mute toggle is persisted to localStorage so the user's preference
 * survives page reloads. Browser autoplay policy is handled by
 * lazy-creating the AudioContext on the first user gesture (any
 * click/keypress), since that's the only signal the browser accepts
 * to unlock audio playback without an explicit permission prompt.
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
// is bypassed. Most entries are left commented — drop the file
// in and uncomment to upgrade. Events without a file use the
// built-in synth tone (see playPattern() below).
const SOUND_FILES: Partial<Record<SoundEvent, string>> = {
  // workoutComplete: '/sounds/workout-complete.mp3',
  // levelUp:        '/sounds/level-up.mp3',
  // achievement:    '/sounds/achievement.mp3',
  // restTimerDone:   '/sounds/rest-timer.mp3',
  skillUnlock:     '/sounds/skill-unlock.mp3',   // the meme — party horn + kids yay
  // bossKill:        '/sounds/boss-kill.mp3',
  // lootDrop:        '/sounds/loot-drop.mp3',
};

/**
 * File-path overrides. Drop MP3s in web/public/sounds/ and add
 * the filename here to use them instead of the synth tones.
 * If the file 404s we fall back to the synth. Empty = use synth.
 */
const SOUND_FILES: Partial<Record<SoundEvent, string>> = {
  // workoutComplete: '/sounds/workout-complete.mp3',
  // levelUp: '/sounds/level-up.mp3',
  // ...
};

function playTone(
  freq: number,
  durationSec: number,
  opts: { type?: OscillatorType; gain?: number; attack?: number; delayMs?: number } = {},
): void {
  if (muted) return;
  const c = ensureCtx();
  if (!c || !unlocked) return;
  const { type = 'sine', gain = 0.18, attack = 0.005, delayMs = 0 } = opts;
  const start = c.currentTime + delayMs / 1000;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // ADSR-ish envelope: quick attack, exponential decay. Keeps clicks
  // out and gives a percussive "pluck" character.
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
  osc.connect(env).connect(c.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.02);
}

/**
 * Party-horn approximation. Brassier than the kazoo: a square
 * wave mixed with a sawtooth (gives the "buzzy" brassy
 * character) plus a quick downward pitch slide at the start
 * (the "blat" attack real party horns make when you blow into
 * them). Two slightly-detuned oscillators for the body, with
 * a fast exponential pitch ramp from ~110% → 100% over the
 * first 30ms.
 *
 * NOTE: Currently unused — the user preferred real recordings
 * over synth approximations. Kept here in case someone wants
 * the synth fallback later.
 */
function playPartyHorn(
  baseFreq = 220,
  durationSec = 0.32,
  pitchStartCents = 18,
): void {
  const c = ensureCtx();
  if (!c || !unlocked || muted) return;
  const start = c.currentTime;
  const stop = start + durationSec;
  const osc1 = c.createOscillator();
  osc1.type = 'square';
  const osc2 = c.createOscillator();
  osc2.type = 'sawtooth';
  const startFreq = baseFreq * Math.pow(2, pitchStartCents / 1200);
  osc1.frequency.setValueAtTime(startFreq, start);
  osc1.frequency.exponentialRampToValueAtTime(baseFreq, start + 0.03);
  osc2.frequency.setValueAtTime(startFreq * 1.005, start);
  osc2.frequency.exponentialRampToValueAtTime(baseFreq * 1.005, start + 0.03);
  const g1 = c.createGain();
  g1.gain.value = 0.06;
  const g2 = c.createGain();
  g2.gain.value = 0.10;
  osc1.connect(g1);
  osc2.connect(g2);
  const env = c.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(1, start + 0.005);
  env.gain.setValueAtTime(1, start + 0.05);
  env.gain.exponentialRampToValueAtTime(0.001, stop);
  g1.connect(env);
  g2.connect(env);
  env.connect(c.destination);
  osc1.start(start);
  osc2.start(start);
  osc1.stop(stop + 0.02);
  osc2.stop(stop + 0.02);
}

/**
 * "Yay!" — a small group of kids cheering. Multiple short sine
 * tones at slightly different pitches and timings, like a few
 * kids shouting at the same time. The pitches aren't a clean
 * arpeggio — they cluster around the major triad (C, E, G)
 * but with a few "off" notes that give it the slightly chaotic
 * "kids yelling" feel.
 *
 * NOTE: This is currently unused — the user preferred real
 * recordings over synth approximations. Kept here in case
 * someone wants the synth fallback later. Set SOUND_FILES[event]
 * to undefined to fall back to this.
 */
function playKidsYay(delayMs = 0): void {
  const voices: Array<[number, number, number]> = [
    [523.25,   0,  0.20], // C5 — the "yay!" root
    [659.25,  20,  0.18], // E5 — the "yay!" fifth
    [783.99,  40,  0.20], // G5 — the "yay!" octave
    [698.46,  60,  0.16], // F5 — a little off, sounds kid-like
    [659.25,  85,  0.14], // E5 again, slightly behind
    [523.25, 110,  0.16], // C5 trailing
    [783.99, 130,  0.18], // G5 high
    [659.25, 170,  0.14], // E5 final
  ];
  for (const [freq, off, gain] of voices) {
    playTone(freq, 0.10, { type: 'sine', gain, delayMs: delayMs + off });
  }
}

/**
 * Per-event tone patterns. Each is 1-3 notes max — quick enough to
 * not overlap with the next event but distinct enough to be
 * recognizable.
 */
function playPattern(event: SoundEvent): void {
  switch (event) {
    case 'workoutComplete':
      // Two-note ascending bell (C5 → E5) — "done!"
      playTone(523.25, 0.18, { type: 'sine', gain: 0.2 });
      playTone(659.25, 0.22, { type: 'sine', gain: 0.2, delayMs: 110 });
      break;
    case 'levelUp':
      // Three-note arpeggio (A4 → C#5 → E5) — ascending fanfare.
      playTone(440, 0.12, { type: 'triangle', gain: 0.22 });
      playTone(554.37, 0.12, { type: 'triangle', gain: 0.22, delayMs: 90 });
      playTone(659.25, 0.28, { type: 'triangle', gain: 0.22, delayMs: 180 });
      break;
    case 'achievement':
      // Twinkle (G5 → C6) — higher-pitched than level-up so the
      // two are easy to tell apart.
      playTone(783.99, 0.1, { type: 'sine', gain: 0.18 });
      playTone(1046.5, 0.2, { type: 'sine', gain: 0.2, delayMs: 90 });
      break;
    case 'restTimerDone':
      // Single square-wave beep — distinct from the synth bell so
      // it's clearly an alert rather than a celebration.
      playTone(880, 0.12, { type: 'square', gain: 0.12 });
      break;
    case 'skillUnlock':
      // Real recording from the YouTube SFX the user linked
      // ('Party Horn Children Yay Sound Effect', K6tsx6j-ZAM).
      // Downloaded + extracted via yt-dlp, converted to mono
      // 96kbps MP3 with ffmpeg, dropped at
      // web/public/sounds/skill-unlock.mp3 (4.2s, 35KB).
      // playFile() will pick this up; if the file 404s the
      // synth fallback in playPattern() fires (kept as a
      // last-resort silent no-op for now — better than a sad
      // 8-bit version).
      break;
    case 'bossKill':
      // Descending three-note stab (E4 → C4 → A3) — heavy, final.
      playTone(329.63, 0.15, { type: 'sawtooth', gain: 0.15 });
      playTone(261.63, 0.15, { type: 'sawtooth', gain: 0.15, delayMs: 130 });
      playTone(220, 0.35, { type: 'sawtooth', gain: 0.18, delayMs: 260 });
      break;
    case 'lootDrop':
      // Sparkle — high pitch quick succession
      playTone(1568, 0.08, { type: 'sine', gain: 0.15 });
      playTone(1975.5, 0.08, { type: 'sine', gain: 0.15, delayMs: 60 });
      playTone(2349.3, 0.18, { type: 'sine', gain: 0.18, delayMs: 120 });
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