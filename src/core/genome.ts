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
}

// ─── Genome: the ~40-byte struct the whole arrangement is a function of (§5.6) ──

export type BrassVoicing = 'close' | 'drop2' | 'drop3' | 'stabs';
export const VOICING_ORDER: readonly BrassVoicing[] = ['close', 'drop2', 'drop3', 'stabs'];

export interface Genome {
  version: 1;
  palette: Palette;
  melody: { seed: number; ornament: number };
  bass: { seed: number; walkiness: number; register: number };
  drums: { seed: number; fillDensity: number; swing: number };
  winds: { seed: number; activity: number };
  brass: { seed: number; voicing: BrassVoicing; density: number };
}
