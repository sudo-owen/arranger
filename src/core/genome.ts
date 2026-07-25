import type { Tick } from './brand.js';
import type { Palette } from './instruments.js';
import type { Harmony, Meter, Motif, Role } from './types.js';

// ─── Form (spec §5.5) ────────────────────────────────────────────────────────

export type FormTemplate = 'period' | 'sentence' | 'AABA' | 'ABAC' | 'verse-chorus';
export type SectionLabel = 'A' | "A'" | 'B' | 'A"' | 'C';

export interface Section {
  label: SectionLabel;
  start: Tick;
  length: Tick;
  density: number; // 0–1 target activity for role generators
  roles: Role[];
}

export interface Form {
  sections: readonly Section[];
  template: FormTemplate;
}

// ─── Genome: the ~40-byte struct the whole arrangement is a function of (§5.6) ──

export type BrassVoicing = 'close' | 'drop2' | 'drop3' | 'stabs';

export interface Genome {
  version: 1;
  /** Which voices render as chip and which as acoustic (§8.5). */
  palette: Palette;
  skeleton: { seed: number; temperature: number; template: FormTemplate; bars: number };
  melody: { seed: number; ornament: number; radius: number };
  bass: { seed: number; walkiness: number; register: number };
  drums: { seed: number; fillDensity: number; swing: number };
  winds: { seed: number; activity: number; ornament: number };
  brass: { seed: number; voicing: BrassVoicing; density: number };
}

// ─── Project (spec §5.7) ─────────────────────────────────────────────────────

export interface ProjectMeta {
  bpm: number;
  meter: Meter;
  ppq: number;
  title: string;
}

export interface Project {
  meta: ProjectMeta;
  /** What the user gave us. Never mutated. */
  source: Motif;
  /** OWNED after first inference — the spine. Melody is generated against this. */
  harmony: Harmony;
  form: Form;
  genome: Genome;
  locks: Partial<Record<Role | 'skeleton', boolean>>;
  /** The keep pile. */
  starred: Genome[];
}
