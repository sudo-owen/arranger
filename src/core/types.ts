import type { Midi, PC, Tick } from './brand.js';

// ─── Rhythm / pitch content ──────────────────────────────────────────────────

export interface Note {
  start: Tick;
  duration: Tick;
  pitch: Midi;
  velocity: number; // 0–127
  tie?: boolean;
}

export interface Motif {
  /**
   * Sorted by `start`, ascending. This invariant is load-bearing: every operator
   * must preserve it (dev check: assertMotif). Constructing via motif() guarantees it.
   */
  notes: readonly Note[];
  length: Tick;
}

// ─── Harmony ─────────────────────────────────────────────────────────────────

export type Mode = 'major' | 'minor';

export interface Key {
  tonic: PC;
  mode: Mode;
}

export type Quality =
  | 'maj' | 'min' | 'dim' | 'aug'
  | 'dom7' | 'maj7' | 'min7' | 'min7b5' | 'dim7'
  | 'sus4' | 'sus2';

export interface Chord {
  root: PC;
  quality: Quality;
  bass?: PC; // inversion, if not root
}

export interface ChordEvent {
  start: Tick;
  duration: Tick;
  chord: Chord;
}

export interface Harmony {
  key: Key;
  /**
   * Contiguous and gap-free: covers [0, length) with no holes. Downstream
   * generators assume "there is always a chord at time t" (spec §5.4).
   */
  events: readonly ChordEvent[];
  length: Tick;
}

// ─── Meter / instruments / roles ─────────────────────────────────────────────

export interface Meter {
  num: number;
  den: number; // e.g. { num: 4, den: 4 }
}

export type Role = 'melody' | 'bass' | 'drums' | 'winds' | 'brass';
export const ROLE_ORDER: readonly Role[] = ['melody', 'bass', 'drums', 'winds', 'brass'];

/**
 * What kind of thing is making the sound. This is a CONSTRAINT class, not a timbre:
 * an acoustic player has a tongue and a pair of lungs, so the critic holds it to an
 * articulation ceiling and a breath limit (§7.5). A pulse channel has neither, so a
 * 16th-note lead at 180 BPM is a legitimate thing to write rather than a rejectable
 * fantasy. Getting this wrong in either direction is audible: chip voices held to
 * brass limits can't play battle music, acoustic voices freed from them stop
 * sounding like anyone is playing them.
 */
export type VoiceClass = 'chip' | 'acoustic';

export interface Instrument {
  name: string;
  low: Midi;
  high: Midi;
  class: VoiceClass;
}

// ─── Arrangement output ──────────────────────────────────────────────────────

export interface Track {
  role: Role;
  instrument?: Instrument; // omitted for drums (percussion map, not a pitched range)
  motif: Motif;
}

export interface Arrangement {
  source: Motif;
  harmony: Harmony;
  tracks: readonly Track[];
  length: Tick;
}
