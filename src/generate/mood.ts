import type { Genome, Mode, Mood, Role } from '../core/index.js';
import { bias, clamp01, clampMood, lerp } from '../core/index.js';
import type { Brightness, Progression } from './progressions.js';
import { progressionsFor } from './progressions.js';

/**
 * How the two axes the game drives deform an arrangement. The `Mood` type itself lives
 * in core, because `Section` carries one.
 *
 * They are separate on purpose. A boss at full health should be intense without being
 * a losing position, and a slow grind you are winning is neither frantic nor
 * triumphant — one axis cannot say both.
 *
 * The load-bearing rule is what is NOT here: `melody.seed` is never touched. Deform
 * the accompaniment, the harmonic colour and the mix as far as you like; the moment
 * the tune itself changes with game state you have a playlist rather than a theme.
 */

/**
 * Mood BIASES the authored take rather than replacing it, so `deform(g, NEUTRAL_MOOD)`
 * is exactly `g` and a busier bed stays relatively busier at every mood.
 *
 * It has to bias rather than assign. Every choice the Bed and Variations stages offer is
 * a genome field mood touches, so `lerp(lo, hi, urgency)` would deform six beds chosen
 * for six different densities to the same three numbers and make those stages decorative.
 *
 * Total over the unit square: every point yields a renderable genome, so a runtime can
 * never land somewhere unplayable.
 */
export function deform(base: Genome, mood: Mood): Genome {
  const { urgency: u, fortune: f } = clampMood(mood);
  return {
    ...base,
    bass: { ...base.bass, walkiness: bias(base.bass.walkiness, u, 0.85) },
    // Weight rises as the fight gets heavier AND as it goes badly — the opposite corner
    // to brass, which comes in on fortune. A desperate scramble gets its low end from
    // the tenor; a triumphant charge gets it from the brass sitting on top of it.
    tenor: { ...base.tenor, presence: bias(base.tenor.presence, u * 0.5 + (1 - f) * 0.5, 0.8) },
    drums: {
      ...base.drums,
      fillDensity: bias(base.drums.fillDensity, u, 0.85),
      swing: bias(base.drums.swing, 1 - u, 0.3),
    },
    winds: { ...base.winds, activity: bias(base.winds.activity, u * 0.65 + f * 0.35, 0.8) },
    brass: { ...base.brass, density: bias(base.brass.density, f * 0.6 + u * 0.4, 0.85) },
  };
}

export function brightnessFor(fortune: number): Brightness {
  const f = clamp01(fortune);
  return f > 0.62 ? 'bright' : f < 0.38 ? 'dark' : 'neutral';
}

/**
 * The progression a mood asks for, preferring to stay where it is. Without the
 * stickiness a pad drag across a brightness border swaps harmony on every frame; with
 * it, the current choice survives as long as its brightness still matches.
 */
export function progressionForMood(mode: Mode, mood: Mood, current: Progression | null): Progression {
  const want = brightnessFor(mood.fortune);
  if (current && current.mode === mode && current.brightness === want) return current;
  const options = progressionsFor(mode).filter((p) => p.brightness === want);
  return options[0] ?? progressionsFor(mode)[0]!;
}

/**
 * Per-voice gain, for the vertical half of the adaptive mix. This is the fast path: a
 * gain change lands in a frame, where re-arranging has to wait for a bar line. Melody,
 * bass and drums are the spine and never duck out entirely — losing the hook is not a
 * mood, it is a bug.
 */
export function layerGains(mood: Mood): Record<Role, number> {
  const { urgency: u, fortune: f } = clampMood(mood);
  return {
    melody: 1,
    bass: 1,
    tenor: lerp(0.3, 1, u * 0.5 + (1 - f) * 0.5),
    drums: lerp(0.6, 1, u),
    winds: lerp(0.15, 1, u * 0.7 + (1 - f) * 0.3),
    brass: lerp(0.1, 1, f * 0.75 + u * 0.25),
  };
}

/**
 * The four extremes, which is what a mood has to be validated at — an arrangement that
 * behaves at neutral and falls apart at high urgency is a bug you want at authoring
 * time, not in a fight.
 */
export const MOOD_CORNERS: readonly { mood: Mood; label: string }[] = [
  { mood: { urgency: 0, fortune: 0 }, label: 'grinding attrition' },
  { mood: { urgency: 1, fortune: 0 }, label: 'desperate scramble' },
  { mood: { urgency: 0, fortune: 1 }, label: 'cruising' },
  { mood: { urgency: 1, fortune: 1 }, label: 'triumphant charge' },
];

/**
 * Ways a fight can go, as a path through the mood square.
 *
 * The four corners tell you the track survives its extremes; they cannot tell you
 * whether the journey between them sounds like anything. That is the thing the game
 * will actually play — the mood moves continuously as the fight swings — and until you
 * can hear one pass of it, "adaptive" is an assertion rather than a result.
 *
 * `t` runs 0→1 across one pass of the track.
 */
export interface MoodArc {
  id: string;
  label: string;
  blurb: string;
  at: (t: number) => Mood;
}

export const MOOD_ARCS: readonly MoodArc[] = [
  {
    id: 'comeback', label: 'Comeback', blurb: 'on the ropes, then turning it around',
    at: (t) => ({ urgency: 0.92 - t * 0.3, fortune: t }),
  },
  {
    id: 'collapse', label: 'Collapse', blurb: 'comfortably ahead, then losing the thread',
    at: (t) => ({ urgency: 0.3 + t * 0.65, fortune: 1 - t }),
  },
  {
    id: 'nail-biter', label: 'Nail-biter', blurb: 'trading blows — fortune swings twice',
    at: (t) => ({ urgency: 0.55 + Math.abs(Math.sin(t * Math.PI * 2)) * 0.35, fortune: 0.5 + Math.sin(t * Math.PI * 4) * 0.45 }),
  },
  {
    id: 'grind', label: 'Grind', blurb: 'even the whole way, pressure climbing',
    at: (t) => ({ urgency: 0.15 + t * 0.8, fortune: 0.5 }),
  },
];

const COLOUR: Readonly<Record<Brightness, string>> = {
  bright: 'major brightening, brass forward',
  neutral: 'natural minor',
  dark: 'darkest progressions, thin brass',
};

export function describeMood(mood: Mood): { name: string; detail: string } {
  const { urgency: u, fortune: f } = clampMood(mood);
  const band = (x: number): 0 | 1 | 2 => (x > 0.66 ? 2 : x > 0.33 ? 1 : 0);
  const pace = ['restrained', 'driving', 'frantic'][band(u)]!;
  const state = ['desperate', 'holding', 'triumphant'][band(f)]!;
  const kit = ['sparse kit', 'fills every four', 'fills every bar'][band(u)]!;
  return { name: `${pace} / ${state}`, detail: `${kit} · ${COLOUR[brightnessFor(f)]}` };
}
