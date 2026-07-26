import type { Tick } from './brand.js';
import type { Palette } from './instruments.js';
import type { Mood } from './mood.js';

// ─── Form (spec §5.5) ────────────────────────────────────────────────────────

export type FormTemplate = 'sentence' | 'arc' | 'surge' | 'relentless';
export type SectionLabel = 'intro' | 'A' | "A'" | 'B' | 'A"' | 'tag';

export interface Section {
  label: SectionLabel;
  start: Tick;
  length: Tick;
  /**
   * Where this section sits in the mood square. It replaced a bare `density: number`,
   * which was urgency under another name and read by nothing — one axis where the rest
   * of the system already had two, and no way to say "quieter but brighter".
   */
  mood: Mood;
}

export interface Form {
  sections: readonly Section[];
  template: FormTemplate;
  /**
   * Where the track returns to. 0 means the whole thing loops; anything else is a head
   * that plays once — an intro the player hears at the start of a fight and not every
   * sixty seconds after. Everything that joins the end back to the beginning reads this
   * rather than assuming tick 0.
   */
  loopStart: Tick;
}

// ─── Genome: the ~40-byte struct the whole arrangement is a function of (§5.6) ──

export type BrassVoicing = 'close' | 'drop2' | 'drop3' | 'stabs';
export const VOICING_ORDER: readonly BrassVoicing[] = ['close', 'drop2', 'drop3', 'stabs'];

/**
 * What the low counter-voice does with its octave. Three ways to add weight that do not
 * compete with the bass line for the same job:
 *
 * - `pedal` — one sustained tone per chord, on the fifth. Horns holding under the tune.
 * - `drive` — an upbeat push against the backbeat. Motion where the bass rests.
 * - `octaves` — the chord root doubled an octave above the bass, on the kick beats. The
 *   plain thickener: no new rhythm, just more bottom.
 */
export type TenorMotion = 'pedal' | 'drive' | 'octaves';
export const TENOR_MOTION_ORDER: readonly TenorMotion[] = ['pedal', 'drive', 'octaves'];

export interface Genome {
  version: 1;
  palette: Palette;
  melody: { seed: number; ornament: number };
  bass: { seed: number; walkiness: number; register: number };
  tenor: { seed: number; motion: TenorMotion; presence: number };
  drums: { seed: number; fillDensity: number; swing: number };
  winds: { seed: number; activity: number };
  brass: { seed: number; voicing: BrassVoicing; density: number };
}
