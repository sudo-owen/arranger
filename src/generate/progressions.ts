import type { Chord, ChordEvent, Harmony, Key, Meter, Mode, Quality } from '../core/index.js';
import { barTicks, pc, tick } from '../core/index.js';

/**
 * A library of battle progressions, chosen rather than inferred.
 *
 * The engine's HMM can read chords off a melody, and that is the right tool when
 * someone hands you a tune. It is the wrong tool here: a hook built from three
 * pitches of the tonic triad implies almost nothing, so inference returns the blandest
 * reading that fits and the user is left correcting it bar by bar. Picking from a set
 * of progressions that are already known to work under a driving minor hook is both
 * faster and better — the choice is "which harmonic colour", not "please fix this".
 *
 * Everything is expressed in SEMITONES ABOVE THE TONIC rather than scale degrees, so
 * borrowed chords (♭VI, ♭VII, ♭II) say what they mean without mode-dependent
 * arithmetic, and the tonic never moves. That last part matters for the adaptive work:
 * the fortune axis slides between dark and bright progressions, and it can only do
 * that without the track becoming a different piece if every option shares a tonic.
 */

/** Where a progression sits on the dark → bright axis the fortune mood axis drives. */
export type Brightness = 'dark' | 'neutral' | 'bright';

export interface ProgressionStep {
  /** Semitones above the tonic. */
  semitones: number;
  quality: Quality;
}

export interface Progression {
  id: string;
  /** Roman-numeral display, e.g. "i–♭VI–♭VII–i". */
  name: string;
  blurb: string;
  brightness: Brightness;
  /** The key mode this is written against. */
  mode: Mode;
  /** One chord per bar. */
  steps: readonly ProgressionStep[];
}

const s = (semitones: number, quality: Quality): ProgressionStep => ({ semitones, quality });

export const PROGRESSIONS: readonly Progression[] = [
  // ── minor: the battle-music home turf ───────────────────────────────────────
  {
    id: 'aeolian-vamp', name: 'i–♭VI–♭VII–i', blurb: 'the standard heroic minor loop',
    brightness: 'neutral', mode: 'minor',
    steps: [s(0, 'min'), s(8, 'maj'), s(10, 'maj'), s(0, 'min')],
  },
  {
    id: 'harmonic-cadence', name: 'i–iv–V–i', blurb: 'harmonic minor, hard cadence',
    brightness: 'dark', mode: 'minor',
    steps: [s(0, 'min'), s(5, 'min'), s(7, 'maj'), s(0, 'min')],
  },
  {
    id: 'andalusian', name: 'i–♭VII–♭VI–V', blurb: 'descending tetrachord, relentless',
    brightness: 'dark', mode: 'minor',
    steps: [s(0, 'min'), s(10, 'maj'), s(8, 'maj'), s(7, 'maj')],
  },
  {
    id: 'epic-third', name: 'i–♭III–♭VII–iv', blurb: 'wide and cinematic',
    brightness: 'neutral', mode: 'minor',
    steps: [s(0, 'min'), s(3, 'maj'), s(10, 'maj'), s(5, 'min')],
  },
  {
    id: 'neapolitan-push', name: 'i–♭II–V–i', blurb: 'Neapolitan lean, most unstable',
    brightness: 'dark', mode: 'minor',
    steps: [s(0, 'min'), s(1, 'maj'), s(7, 'dom7'), s(0, 'min')],
  },
  {
    id: 'minor-climb', name: 'i–v–♭VI–♭VII', blurb: 'rising, gathers momentum',
    brightness: 'neutral', mode: 'minor',
    steps: [s(0, 'min'), s(7, 'min'), s(8, 'maj'), s(10, 'maj')],
  },
  {
    id: 'picardy-turn', name: 'i–♭VII–♭VI–I', blurb: 'resolves major — a win in progress',
    brightness: 'bright', mode: 'minor',
    steps: [s(0, 'min'), s(10, 'maj'), s(8, 'maj'), s(0, 'maj')],
  },
  {
    id: 'relative-lift', name: 'i–♭III–♭VI–♭VII', blurb: 'leans on the relative major',
    brightness: 'bright', mode: 'minor',
    steps: [s(0, 'min'), s(3, 'maj'), s(8, 'maj'), s(10, 'maj')],
  },

  // ── major: brighter fights, victory themes ──────────────────────────────────
  {
    id: 'axis', name: 'vi–IV–I–V', blurb: 'the anthem loop',
    brightness: 'bright', mode: 'major',
    steps: [s(9, 'min'), s(5, 'maj'), s(0, 'maj'), s(7, 'maj')],
  },
  {
    id: 'heroic-major', name: 'I–V–vi–IV', blurb: 'open and confident',
    brightness: 'bright', mode: 'major',
    steps: [s(0, 'maj'), s(7, 'maj'), s(9, 'min'), s(5, 'maj')],
  },
  {
    id: 'mixolydian-drive', name: 'I–♭VII–IV–I', blurb: 'mixolydian, swaggering',
    brightness: 'neutral', mode: 'major',
    steps: [s(0, 'maj'), s(10, 'maj'), s(5, 'maj'), s(0, 'maj')],
  },
  {
    id: 'major-threat', name: 'I–♭VI–♭VII–I', blurb: 'major tonic, borrowed shadows',
    brightness: 'dark', mode: 'major',
    steps: [s(0, 'maj'), s(8, 'maj'), s(10, 'maj'), s(0, 'maj')],
  },
];

/** Progressions written for this mode. */
export function progressionsFor(mode: Mode): readonly Progression[] {
  return PROGRESSIONS.filter((p) => p.mode === mode);
}

export function progressionById(id: string): Progression | null {
  return PROGRESSIONS.find((p) => p.id === id) ?? null;
}

/** The safe opening choice — the loop that works under almost any driving hook. */
export function defaultProgression(mode: Mode): Progression {
  return progressionById(mode === 'minor' ? 'aeolian-vamp' : 'heroic-major')
    ?? PROGRESSIONS[0]!;
}

/**
 * `count` progressions spread across the brightness axis rather than taken in order,
 * so a set of candidate beds covers dark / neutral / bright instead of showing three
 * shades of the same mood.
 */
export function spreadByBrightness(list: readonly Progression[], count: number): Progression[] {
  const buckets: Record<Brightness, Progression[]> = { dark: [], neutral: [], bright: [] };
  for (const p of list) buckets[p.brightness].push(p);
  const order: Brightness[] = ['neutral', 'dark', 'bright'];
  const out: Progression[] = [];
  for (let round = 0; out.length < count; round++) {
    let addedThisRound = false;
    for (const b of order) {
      const pick = buckets[b][round];
      if (!pick) continue;
      out.push(pick);
      addedThisRound = true;
      if (out.length === count) break;
    }
    if (!addedThisRound) break; // every bucket exhausted
  }
  return out;
}

/** Chord for one step, in a concrete key. */
export function chordOf(step: ProgressionStep, key: Key): Chord {
  return { root: pc(key.tonic + step.semitones), quality: step.quality };
}

/**
 * Tile a progression across `bars`, one chord per bar. Contiguous and gap-free, which
 * every role generator relies on (§5.4).
 */
export function harmonyFromProgression(p: Progression, key: Key, meter: Meter, bars: number): Harmony {
  const bar = barTicks(meter);
  const events: ChordEvent[] = [];
  for (let b = 0; b < bars; b++) {
    const step = p.steps[b % p.steps.length]!;
    events.push({ start: tick(b * bar), duration: tick(bar), chord: chordOf(step, key) });
  }
  return { key, events, length: tick(bars * bar) };
}
