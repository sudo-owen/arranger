import type { Instrument } from './types.js';

/**
 * THE SOURCE OF TRUTH FOR HOW EVERY VOICE SOUNDS.
 *
 * Pure data — no WebAudio, no DOM — so it lives in the engine and both renderers read
 * the same numbers. song-creatr's `audio/synth.ts` interprets it, and munch's
 * `BattleMusicService` interprets it identically. That matters more than it sounds:
 * previously song-creatr auditioned a sine lead over sawtooth winds while the game
 * played the same MIDI as square waves, so every taste decision made while authoring
 * was made against a sound that never shipped.
 *
 * The `gmProgram` on each timbre is the wire format. Export stamps it into the MIDI
 * file, munch reads it back and looks the timbre up here — so adding a voice is one
 * edit in one table, not three edits in two repos.
 */

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

export type FilterSpec =
  /** Unfiltered — the raw oscillator. What makes chip voices read as chip. */
  | { kind: 'none' }
  /** Fixed cutoff in Hz. */
  | { kind: 'lowpass'; hz: number }
  /** Cutoff tracks the note: `mult` × fundamental. Keeps timbre even across the range. */
  | { kind: 'bandpass-rel'; mult: number; q: number }
  /**
   * The brass gesture: cutoff snaps open on the attack, then settles. This is what
   * reads as "blown" rather than "played" — a fixed filter sounds like an organ.
   */
  | { kind: 'lowpass-sweep'; openMult: number; peakMult: number; settleMult: number; openSec: number };

export interface VoiceTimbre {
  wave: Waveform;
  filter: FilterSpec;
  attackSec: number;
  releaseSec: number;
  /** Gain at nominal velocity (100), before master. */
  peak: number;
  /** Sustain level as a fraction of peak. 1 = flat, which is the chip behaviour. */
  sustain: number;
  /** Vibrato, if any: rate in Hz and depth as a frequency deviation in Hz. */
  vibratoHz?: number;
  vibratoDepthHz?: number;
  /** General MIDI program written on export and used to recover this timbre on import. */
  gmProgram: number;
}

export type TimbreName = 'pulse-lead' | 'pulse-2' | 'tri-bass' | 'winds' | 'brass';

/**
 * Chip envelopes are near-instant and flat-sustained (attack 4ms, release 30ms) —
 * that snap is the sound. Acoustic envelopes breathe: slower attack, a little decay
 * into sustain, longer release.
 */
export const TIMBRES: Readonly<Record<TimbreName, VoiceTimbre>> = {
  'pulse-lead': {
    wave: 'square', filter: { kind: 'none' },
    attackSec: 0.004, releaseSec: 0.03, peak: 0.13, sustain: 1, gmProgram: 80,
  },
  'pulse-2': {
    wave: 'sawtooth', filter: { kind: 'none' },
    attackSec: 0.004, releaseSec: 0.03, peak: 0.10, sustain: 1, gmProgram: 81,
  },
  'tri-bass': {
    wave: 'triangle', filter: { kind: 'lowpass', hz: 900 },
    attackSec: 0.004, releaseSec: 0.04, peak: 0.17, sustain: 1, gmProgram: 38,
  },
  winds: {
    wave: 'sawtooth', filter: { kind: 'bandpass-rel', mult: 2, q: 6 },
    attackSec: 0.05, releaseSec: 0.17, peak: 0.17, sustain: 0.8,
    vibratoHz: 5, vibratoDepthHz: 3, gmProgram: 68,
  },
  brass: {
    wave: 'sawtooth',
    filter: { kind: 'lowpass-sweep', openMult: 2, peakMult: 5, settleMult: 2.5, openSec: 0.04 },
    attackSec: 0.008, releaseSec: 0.1, peak: 0.2, sustain: 0.8, gmProgram: 61,
  },
};

/** Which timbre an instrument renders through. Falls back by voice class. */
export function timbreNameFor(inst: Instrument): TimbreName {
  switch (inst.name) {
    case 'lead': case 'pulse lead': return 'pulse-lead';
    case 'pulse 2': case 'pulse brass': return 'pulse-2';
    case 'tri bass': return 'tri-bass';
    case 'flute': case 'oboe': case 'clarinet': case 'bassoon': case 'winds': return 'winds';
    case 'trumpet': case 'horn': case 'trombone': case 'tuba': case 'brass': return 'brass';
    default: return inst.class === 'chip' ? 'pulse-lead' : 'winds';
  }
}

/** Recover a timbre from a General MIDI program number (the import direction). */
export function timbreForProgram(program: number): TimbreName | null {
  for (const name of Object.keys(TIMBRES) as TimbreName[]) {
    if (TIMBRES[name].gmProgram === program) return name;
  }
  // Unknown program: fall back by GM family so third-party MIDI still sounds sane.
  if (program >= 56 && program <= 63) return 'brass';
  if (program >= 64 && program <= 79) return 'winds';
  if (program >= 32 && program <= 39) return 'tri-bass';
  if (program >= 80 && program <= 87) return 'pulse-lead';
  return null;
}

// ─── Drums ───────────────────────────────────────────────────────────────────

/**
 * Percussion is synthesised per-piece rather than filtered noise across the board —
 * a swept sine kick has punch that band-passed noise at 160 Hz simply does not, and
 * battle music lives or dies on the kick.
 */
export type DrumVoice =
  | { kind: 'kick'; fromHz: number; toHz: number; sweepSec: number; peak: number; decaySec: number }
  | { kind: 'snare'; highpassHz: number; toneHz: number; peak: number; decaySec: number }
  | { kind: 'noise'; highpassHz: number; peak: number; decaySec: number };

export const KICK = 36;
export const SNARE = 38;
export const HAT = 42;
export const CRASH = 49;

export function drumVoice(pitch: number): DrumVoice {
  if (pitch === KICK) return { kind: 'kick', fromHz: 140, toHz: 45, sweepSec: 0.12, peak: 0.9, decaySec: 0.16 };
  if (pitch === SNARE) return { kind: 'snare', highpassHz: 1500, toneHz: 180, peak: 0.55, decaySec: 0.12 };
  if (pitch === CRASH) return { kind: 'noise', highpassHz: 4000, peak: 0.4, decaySec: 0.5 };
  return { kind: 'noise', highpassHz: 7000, peak: 0.3, decaySec: 0.05 };
}

// ─── Gain staging ────────────────────────────────────────────────────────────

/**
 * Master ceiling. Both renderers must agree or "the same" mix sits at a different
 * level in each, and level differences read as tone differences when a compressor is
 * in the chain.
 */
export const MASTER_CEILING = 0.32;

/**
 * Velocity → gain multiplier. The generators write meaningful velocities (winds 74,
 * brass 88, melody 92, drum fills 78–102); a renderer that ignores them flattens the
 * arrangement's internal balance. 100 is nominal.
 */
export function velocityGain(velocity: number): number {
  return Math.max(0.25, Math.min(1.3, velocity / 100));
}
