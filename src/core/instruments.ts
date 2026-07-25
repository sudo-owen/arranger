import type { Midi } from './brand.js';
import { PPQ, midi } from './brand.js';
import type { Instrument, VoiceClass } from './types.js';

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
  /** Max sustainable articulations/second (single-tongue for brass). */
  notesPerSec: number;
  /** Max unbroken phrase seconds before a breath is required (wind/brass). */
  maxPhraseSec: number;
  /**
   * A SECTION rather than one player. Sections stagger their breathing between desks,
   * so a unison line can run indefinitely — the phrase limit simply does not apply.
   * Articulation still does: every player has their own tongue.
   *
   * This used to be true of brass by accident. `BRASS_SECTION` was a plain `Instrument`
   * with no entry in the spec table, so the lookup returned null and every breath check
   * silently passed. Same outcome, no stated reason, and nothing stopping the next
   * section-shaped voice from being held to a soloist's lungs.
   */
  section: boolean;
}

const spec = (
  name: string, low: number, high: number, notesPerSec: number, maxPhraseSec: number,
): InstrumentSpec => ({ name, low: midi(low), high: midi(high), class: 'acoustic', notesPerSec, maxPhraseSec, section: false });

const chip = (name: string, low: number, high: number): InstrumentSpec =>
  ({ name, low: midi(low), high: midi(high), class: 'chip', notesPerSec: Infinity, maxPhraseSec: Infinity, section: false });

/** A desk of players in unison: breathing is staggered, tonguing is not. */
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

/** Chip stand-in for the brass section — same span, no lungs. */
export const PULSE_BRASS = chip('pulse brass', 40, 82);

/**
 * A generic lead voice for the melody — generous range, so we never reject the user's
 * own tune. Chip-class: this is the voice that has to play fast at battle tempo, and
 * holding it to a wind player's tongue would reject exactly the lines we want.
 */
export const LEAD: Instrument = { name: 'lead', low: midi(48), high: midi(96), class: 'chip' };
/** Brass as a SECTION (trumpet down through trombone) — block voicings span wider than any one horn. */
export const BRASS_SECTION = sectionOf('brass', 40, 82, 9);
/** Winds in unison (flutes over oboes/clarinets) — spans wider than any one player. */
export const WIND_SECTION = sectionOf('winds', 55, 93, 12);

export const WINDS: readonly InstrumentSpec[] = [FLUTE, OBOE, CLARINET, BASSOON];
export const BRASS: readonly InstrumentSpec[] = [TRUMPET, HORN, TROMBONE, TUBA];
export const CHIP: readonly InstrumentSpec[] = [PULSE_LEAD, PULSE_2, PULSE_BRASS, TRI_BASS];
export const SECTIONS: readonly InstrumentSpec[] = [BRASS_SECTION, WIND_SECTION];
export const ALL_SPECS: readonly InstrumentSpec[] = [...WINDS, ...BRASS, ...CHIP, ...SECTIONS];

export const isChip = (inst: Instrument): boolean => inst.class === 'chip';

/**
 * The shortest note this voice should be asked to articulate, in ticks.
 *
 * Deliberately derived from the voice CLASS and not from tempo. Tempo never enters
 * generation (§8.5) — it constrains the writing through the instruments, and the
 * critic checks the result against the actual BPM afterwards. So this is the coarse,
 * always-true rule: a wind section can tongue sixteenths, nobody should be writing
 * them thirty-seconds, and a pulse channel does not care either way.
 */
export function minArticulation(inst: Instrument): number {
  return inst.class === 'chip' ? PPQ / 8 : PPQ / 4;
}

/** The spec for an instrument, if it has one. Plain `Instrument`s (LEAD) return null. */
export function specFor(inst: Instrument): InstrumentSpec | null {
  for (const s of ALL_SPECS) if (s.name === inst.name) return s;
  return null;
}

export const VOICE_CLASSES: readonly VoiceClass[] = ['chip', 'acoustic'];

// ─── palettes ────────────────────────────────────────────────────────────────

/**
 * Which voices are chip and which are acoustic — the actual "GBA meets orchestra"
 * dial, expressed as five points on it.
 *
 * The BASS is always triangle: a line playing on every beat for a whole track is
 * beyond any set of lungs, and the critic rejects it correctly.
 *
 * The lead used to be forced to chip for the same reason, and no longer is. Three
 * changes made a wind lead playable: hooks now breathe at the end of every phrase,
 * sections stagger their breathing, and ornamentation will not subdivide below what
 * the voice can tongue. `winds-lead` is the result — the hook itself carried by the
 * wind section over a chip rhythm section.
 */
export type Palette = 'full-chip' | 'chip-brass' | 'chip-winds' | 'chip-orchestral' | 'winds-lead';

export interface PaletteSpec {
  label: string;
  blurb: string;
  melody: Instrument;
  bass: Instrument;
  winds: Instrument;
  brass: Instrument;
}

export const PALETTES: Readonly<Record<Palette, PaletteSpec>> = {
  'full-chip': {
    label: 'Full chip', blurb: 'every voice a pulse channel',
    melody: PULSE_LEAD, bass: TRI_BASS, winds: PULSE_2, brass: PULSE_BRASS,
  },
  'chip-brass': {
    label: 'Chip + brass', blurb: 'square lead over a real brass section',
    melody: PULSE_LEAD, bass: TRI_BASS, winds: PULSE_2, brass: BRASS_SECTION,
  },
  'chip-winds': {
    label: 'Chip + winds', blurb: 'square lead, oboe counter-line',
    melody: PULSE_LEAD, bass: TRI_BASS, winds: WIND_SECTION, brass: PULSE_BRASS,
  },
  'chip-orchestral': {
    label: 'Chip + orchestra', blurb: 'chip rhythm section, acoustic winds and brass',
    melody: PULSE_LEAD, bass: TRI_BASS, winds: WIND_SECTION, brass: BRASS_SECTION,
  },
  'winds-lead': {
    label: 'Winds lead', blurb: 'the hook carried by winds, chip rhythm underneath',
    melody: WIND_SECTION, bass: TRI_BASS, winds: PULSE_2, brass: BRASS_SECTION,
  },
};

export const PALETTE_ORDER: readonly Palette[] =
  ['chip-orchestral', 'chip-brass', 'winds-lead', 'chip-winds', 'full-chip'];

/** Is `pitch` inside the instrument's practical range? */
export function inRange(pitch: Midi, inst: Instrument): boolean {
  return pitch >= inst.low && pitch <= inst.high;
}

/** Nearest octave transposition of `pitch` that lands inside the range (or clamped). */
export function fitToRange(pitch: Midi, inst: Instrument): Midi {
  let p: number = pitch;
  while (p < inst.low) p += 12;
  while (p > inst.high) p -= 12;
  if (p < inst.low) p = inst.low; // range narrower than an octave: clamp
  return midi(p);
}

