import type { Arrangement, Genome, Key, Meter, Motif } from '../core/index.js';
import { NEUTRAL_MOOD, PALETTES, ROLE_ORDER } from '../core/index.js';
import { arrange } from './arrange.js';
import type { GenContext } from './context.js';
import { wholeForm } from './context.js';
import type { Hook } from './hook.js';
import { renderHook } from './hook.js';
import type { Form, Mood } from '../core/index.js';
import { FORM_SHAPES, planForm } from './form.js';
import type { Progression } from './progressions.js';
import { deform, progressionForMood } from './mood.js';
import { harmonyFromProgression, progressionById } from './progressions.js';
import type { VariationPlan } from './variation.js';
import { variationForMood, varySource } from './variation.js';

/**
 * Everything needed to reconstruct a track, at any mood, from a few hundred bytes.
 *
 * This is what ships to the game instead of a bank of pre-baked stems: the hook, one
 * genome, and the tempo. Because `arrange()` is pure and the engine is DOM-free, the
 * runtime can call `renderSong` at whatever mood the fight is currently at and get the
 * same notes this app auditioned.
 */
export interface SongSpec {
  version: 1;
  bpm: number;
  meter: Meter;
  key: Key;
  bars: number;
  hook: Hook;
  genome: Genome;
  progressionId: string;
  /**
   * Which section plan to rebuild. Without it the game renders the right NUMBER of bars
   * with no arc — a long loop rather than the track that was auditioned.
   */
  formTemplate?: string;
  /**
   * How the hook differs on each return. Absent means every recurrence is identical —
   * playable, but the version a long fight wears through fastest.
   */
  variation?: VariationPlan;
}

/**
 * The mood pipeline, in one place. The app auditions through this and the game renders
 * through it; if they were two copies, the audition would eventually stop predicting
 * what ships, which is the whole premise of shipping a spec rather than audio.
 */
export function arrangeAtMood(
  source: Motif, key: Key, meter: Meter, bars: number, genome: Genome,
  current: Progression | null, mood: Mood, form?: Form, variation?: VariationPlan,
): { arr: Arrangement; genome: Genome; progression: Progression } {
  const progression = progressionForMood(key.mode, mood, current);
  const harmony = harmonyFromProgression(progression, key, meter, bars);
  const deformed = deform(genome, mood);
  const plan = form ?? wholeForm(harmony);
  // The authored plan, bent by how the fight is going. Both halves of the adaptive model
  // now reach the material: `deform` moves the densities, this moves the tune itself.
  const varied = varySource(source, plan, variationForMood(variation ?? {}, plan, mood), harmony, meter, genome);
  const ctx: GenContext = { harmony, form: plan, meter, source: varied, mood };
  return { arr: arrange(ctx, deformed), genome: deformed, progression };
}

/**
 * Everything wrong with a spec, according to THIS engine. Both repos ask this same
 * question, so drift is a list of sentences rather than a silent flat loop or a throw
 * mid-fight. The render at the end catches structural drift this has not learned to name.
 */
export function specProblems(spec: SongSpec): string[] {
  const out: string[] = [];
  const has = (v: unknown): boolean => v !== undefined && v !== null;

  if (spec.version !== 1) out.push(`unknown spec version ${String(spec.version)} — this engine reads version 1`);
  if (!(spec.bpm > 0)) out.push('bpm must be positive');
  if (!has(spec.meter) || !(spec.meter.num > 0) || !(spec.meter.den > 0)) out.push('meter is missing or malformed');
  if (!has(spec.key) || !has(spec.key.tonic) || !has(spec.key.mode)) out.push('key is missing or malformed');
  if (!(spec.bars > 0)) out.push('bars must be positive');
  if (!has(spec.hook) || !has(spec.hook.cell)) out.push('hook is missing');

  // Named field by field: a genome written before a role existed throws inside arrange().
  const genome: Partial<Genome> | undefined = spec.genome;
  if (!has(genome)) out.push('genome is missing');
  else {
    for (const role of ROLE_ORDER) {
      if (!has(genome[role])) out.push(`genome.${role} is missing — the spec predates that voice`);
    }
    if (genome.palette === undefined || !has(PALETTES[genome.palette])) {
      out.push(`unknown palette "${String(genome.palette)}"`);
    }
  }

  if (!progressionById(spec.progressionId)) out.push(`unknown progression "${String(spec.progressionId)}"`);
  if (spec.formTemplate !== undefined && !FORM_SHAPES.some((s) => s.template === spec.formTemplate)) {
    out.push(`unknown form template "${spec.formTemplate}" — the arc will be dropped`);
  }

  if (out.length) return out;

  try {
    const arr = renderSong(spec, NEUTRAL_MOOD);
    if (!arr.tracks.some((t) => t.motif.notes.length)) out.push('renders no notes at all');
  } catch (err) {
    out.push(`fails to render: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

export function formOf(spec: SongSpec, meter: Meter): Form | undefined {
  const shape = FORM_SHAPES.find((s) => s.template === spec.formTemplate);
  return shape ? planForm(shape, spec.bars, meter) : undefined;
}

export function renderSong(spec: SongSpec, mood: Mood): Arrangement {
  const source = renderHook(spec.hook, spec.bars);
  const current = progressionById(spec.progressionId);
  const form = formOf(spec, spec.meter);
  return arrangeAtMood(source, spec.key, spec.meter, spec.bars, spec.genome, current, mood, form, spec.variation).arr;
}

/**
 * Whether a spec can actually reproduce `source`. `renderSong` derives its source from
 * the hook, so material that has been extended or promoted past the hook cannot be
 * expressed — exporting it anyway would ship a track that plays a different tune in
 * the game than the one that was auditioned here.
 */
export function specCovers(spec: SongSpec, source: Motif): boolean {
  const rebuilt = renderHook(spec.hook, spec.bars);
  return rebuilt.length === source.length
    && rebuilt.notes.length === source.notes.length
    && rebuilt.notes.every((n, i) => n.start === source.notes[i]?.start && n.pitch === source.notes[i]?.pitch);
}
