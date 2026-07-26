import type { Midi } from './brand.js';
import { PPQ, midi } from './brand.js';
import type { Instrument } from './types.js';

/**
 * GM orchestral ranges and articulation ceilings (spec §8.5). Tempo never enters
 * generation; it constrains the writing through these instruments (§8.5, §7.5). The
 * `notesPerSec` ceiling is what makes a 16th-note trumpet line at 170 BPM a
 * rejectable fantasy rather than a rendered squeal.
 *
 * Chip voices carry the same shape with `Infinity` limits: a pulse channel has no
 * tongue and no lungs, so only its range constrains it. Keeping them in the same
 * table (rather than as a separate concept) means the critic's per-instrument lookup
 * stays uniform and there is exactly one place to add a voice.
 */
export interface InstrumentSpec extends Instrument {
  notesPerSec: number;
  maxPhraseSec: number;
  /**
   * A SECTION rather than one player. Sections stagger their breathing between desks,
   * so a unison line can run indefinitely — the phrase limit simply does not apply.
   * Articulation still does: every player has their own tongue.
   *
   * Stated here rather than left to a missing spec-table entry, so that exempting a
   * voice from the breath check is a claim about the voice and not an absence.
   */
  section: boolean;
}

const spec = (
  name: string, low: number, high: number, notesPerSec: number, maxPhraseSec: number,
): InstrumentSpec => ({ name, low: midi(low), high: midi(high), class: 'acoustic', notesPerSec, maxPhraseSec, section: false });

const chip = (name: string, low: number, high: number): InstrumentSpec =>
  ({ name, low: midi(low), high: midi(high), class: 'chip', notesPerSec: Infinity, maxPhraseSec: Infinity, section: false });

const sectionOf = (name: string, low: number, high: number, notesPerSec: number): InstrumentSpec =>
  ({ name, low: midi(low), high: midi(high), class: 'acoustic', notesPerSec, maxPhraseSec: Infinity, section: true });

// MIDI numbers: C4 = 60.
export const FLUTE     = spec('flute',      60, 96, 14, 8);   // C4–C7
export const OBOE      = spec('oboe',       58, 89, 12, 6);   // Bb3–F6
export const CLARINET  = spec('clarinet',   50, 91, 14, 8);   // D3–G6 (written)
export const BASSOON   = spec('bassoon',    34, 72, 10, 6);   // Bb1–C5
export const TRUMPET   = spec('trumpet',    52, 82, 11, 5);   // E3–Bb5, ~8–12/s
export const HORN      = spec('horn',       41, 72,  9, 5);   // F2–C5
export const TROMBONE  = spec('trombone',   40, 70,  8, 5);   // E2–Bb4
export const TUBA      = spec('tuba',       26, 65,  6, 4);   // D1–F4

// Chip voices — the GBA/NES half of the hybrid. Ranges are practical rather than
// physical: a square wave below ~C2 is mud and above ~C7 is a whistle.
export const PULSE_LEAD = chip('pulse lead', 55, 96); // G3–C7
export const PULSE_2    = chip('pulse 2',    48, 91); // C3–G6, counter-line
export const TRI_BASS   = chip('tri bass',   28, 60); // E1–C4

export const PULSE_BRASS = chip('pulse brass', 40, 82);
/**
 * The chip counterpart to `HORN_SECTION`, given the same window on purpose: with the
 * ranges matched, `fitToRange` folds identically, so swapping the tenor between a chip
 * and an acoustic palette changes the timbre and not one note.
 */
export const PULSE_TENOR = chip('pulse tenor', 41, 72);

/**
 * A generic lead voice for the melody — generous range, so we never reject the user's
 * own tune. Chip-class: this is the voice that has to play fast at battle tempo, and
 * holding it to a wind player's tongue would reject exactly the lines we want.
 */
export const LEAD: Instrument = { name: 'lead', low: midi(48), high: midi(96), class: 'chip' };
export const BRASS_SECTION = sectionOf('brass', 40, 82, 9);
/**
 * Winds in unison (flutes over clarinets) — spans wider than any one player, and
 * articulates like the instruments actually in that range rather than like the slowest
 * of them. At 14/s it can still play a sixteenth at the top of the tempo band.
 */
export const WIND_SECTION = sectionOf('winds', 55, 93, 14);

/**
 * The low sections — trombones with tuba, and bassoons with bass clarinet.
 *
 * These are what let the bass slot hold anything but a triangle. A bass line plays a
 * note per beat for the whole track, which is past any soloist's breath: only a voice
 * with no lungs or a section that staggers its breathing can carry it. Nothing else
 * about the check is relaxed — articulation still binds, and at a quarter-note per beat
 * the line asks for 3.1 notes/sec at the top of the tempo band against a ceiling of 7.
 *
 * `LOW_BRASS` floors at E1 rather than the tuba's D1 to match `TRI_BASS`'s window, so a
 * palette swap on the bass slot is a change of timbre and not of notes.
 */
export const LOW_BRASS = sectionOf('low brass', 28, 70, 7);   // E1–Bb4, trombone+tuba
export const LOW_WINDS = sectionOf('low winds', 34, 72, 10);  // Bb1–C5, bassoon+bass clarinet
/**
 * Horns in unison, the tenor pad. A single horn is a soloist (`HORN`, 5s of breath) and
 * cannot hold a pedal under a 90-second track; a section can, which is what the role is.
 */
export const HORN_SECTION = sectionOf('horns', 41, 72, 9);    // F2–C5

export const WINDS: readonly InstrumentSpec[] = [FLUTE, OBOE, CLARINET, BASSOON];
export const BRASS: readonly InstrumentSpec[] = [TRUMPET, HORN, TROMBONE, TUBA];
export const CHIP: readonly InstrumentSpec[] = [PULSE_LEAD, PULSE_2, PULSE_BRASS, PULSE_TENOR, TRI_BASS];
export const SECTIONS: readonly InstrumentSpec[] =
  [BRASS_SECTION, WIND_SECTION, LOW_BRASS, LOW_WINDS, HORN_SECTION];
export const ALL_SPECS: readonly InstrumentSpec[] = [...WINDS, ...BRASS, ...CHIP, ...SECTIONS];

export function specFor(inst: Instrument): InstrumentSpec | null {
  for (const s of ALL_SPECS) if (s.name === inst.name) return s;
  return null;
}

/**
 * The fastest tempo generation is written to survive. Generation stays a pure function
 * of the genome — the project's BPM never reaches it (§8.5) — but the articulation
 * floor below has to assume *some* tempo, and an assumption with a name can be checked
 * and changed. It must stay at or above the fastest tempo the UI offers, or the top of
 * the band writes figures the voice cannot articulate.
 */
export const GENERATION_REF_BPM = 185;

/**
 * The shortest note this voice should be asked to articulate, in ticks — the
 * instrument's own ceiling, converted at the reference tempo.
 */
export function minArticulation(inst: Instrument): number {
  const s = specFor(inst);
  if (!s || !Number.isFinite(s.notesPerSec)) return PPQ / 8;
  return Math.ceil((PPQ * GENERATION_REF_BPM) / (60 * s.notesPerSec));
}

// ─── palettes ────────────────────────────────────────────────────────────────

/**
 * Which voices are chip and which are acoustic — the actual "GBA meets orchestra"
 * dial, expressed as seven points on it.
 *
 * Neither the lead nor the bass is restricted to chip. Three things make an acoustic
 * voice playable on a continuous line at battle tempo: hooks breathe at the end of every
 * phrase, sections stagger their breathing, and ornamentation will not subdivide below
 * what the voice can tongue. `winds-lead` carries the hook on the wind section over a
 * chip rhythm section; `deep-brass` and `low-winds` put a section on the bottom.
 */
export type Palette =
  | 'full-chip' | 'chip-brass' | 'chip-winds' | 'chip-orchestral' | 'winds-lead'
  | 'deep-brass' | 'low-winds';

export interface PaletteSpec {
  label: string;
  blurb: string;
  melody: Instrument;
  bass: Instrument;
  tenor: Instrument;
  winds: Instrument;
  brass: Instrument;
}

export const PALETTES: Readonly<Record<Palette, PaletteSpec>> = {
  'full-chip': {
    label: 'Full chip', blurb: 'every voice a pulse channel',
    melody: PULSE_LEAD, bass: TRI_BASS, tenor: PULSE_TENOR, winds: PULSE_2, brass: PULSE_BRASS,
  },
  'chip-brass': {
    label: 'Chip + brass', blurb: 'square lead over a real brass section',
    melody: PULSE_LEAD, bass: TRI_BASS, tenor: HORN_SECTION, winds: PULSE_2, brass: BRASS_SECTION,
  },
  'chip-winds': {
    label: 'Chip + winds', blurb: 'square lead, oboe counter-line',
    melody: PULSE_LEAD, bass: TRI_BASS, tenor: PULSE_TENOR, winds: WIND_SECTION, brass: PULSE_BRASS,
  },
  'chip-orchestral': {
    label: 'Chip + orchestra', blurb: 'chip rhythm section, acoustic winds and brass',
    melody: PULSE_LEAD, bass: TRI_BASS, tenor: HORN_SECTION, winds: WIND_SECTION, brass: BRASS_SECTION,
  },
  'winds-lead': {
    label: 'Winds lead', blurb: 'the hook carried by winds, chip rhythm underneath',
    melody: WIND_SECTION, bass: TRI_BASS, tenor: PULSE_TENOR, winds: PULSE_2, brass: BRASS_SECTION,
  },
  'deep-brass': {
    label: 'Deep brass', blurb: 'square lead over trombones, tuba and horns',
    melody: PULSE_LEAD, bass: LOW_BRASS, tenor: HORN_SECTION, winds: PULSE_2, brass: BRASS_SECTION,
  },
  'low-winds': {
    label: 'Low winds', blurb: 'bassoons on the bottom, horns in the middle',
    melody: PULSE_LEAD, bass: LOW_WINDS, tenor: HORN_SECTION, winds: WIND_SECTION, brass: PULSE_BRASS,
  },
};

/** Every entry is reachable: `generateBeds` walks this from a random offset each time. */
export const PALETTE_ORDER: readonly Palette[] =
  ['chip-orchestral', 'deep-brass', 'chip-brass', 'winds-lead', 'full-chip', 'low-winds', 'chip-winds'];

export function inRange(pitch: Midi, inst: Instrument): boolean {
  return pitch >= inst.low && pitch <= inst.high;
}

export function fitToRange(pitch: Midi, inst: Instrument): Midi {
  let p: number = pitch;
  while (p < inst.low) p += 12;
  while (p > inst.high) p -= 12;
  if (p < inst.low) p = inst.low; // range narrower than an octave: clamp
  return midi(p);
}

