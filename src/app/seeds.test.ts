import { describe, expect, it } from 'vitest';
import { PPQ, isDiatonic } from '../core/index.js';
import { generateSeedTune, refineSeedTune } from './seeds.js';
import type { SeedBuilderOptions, SeedRefinement } from './seeds.js';

describe('generateSeedTune', () => {
  it('honours the requested length and key', () => {
    const result = generateSeedTune({ tonic: 2, mode: 'minor', bars: 4, contour: 'arch', activity: 'medium', seed: 42 });
    expect(result.motif.length).toBe(4 * 4 * PPQ);
    expect(result.motif.notes.length).toBeGreaterThan(0);
    expect(result.motif.notes.every((note) => isDiatonic(note.pitch, result.key))).toBe(true);
  });

  it('is reproducible for the same settings and seed', () => {
    const options: SeedBuilderOptions = { tonic: 0, mode: 'major', bars: 2, contour: 'rising', activity: 'busy', seed: 99 };
    expect(generateSeedTune(options)).toEqual(generateSeedTune(options));
  });

  it('keeps refinements diatonic and preserves phrase length', () => {
    const generated = generateSeedTune({ tonic: 9, mode: 'minor', bars: 2, contour: 'balanced', activity: 'sparse', seed: 7 });
    const actions: readonly Exclude<SeedRefinement, 'vary'>[] = ['higher', 'lower', 'simplify', 'densify', 'smooth'];
    for (const action of actions) {
      const refined = refineSeedTune(generated.motif, generated.key, action);
      expect(refined.length).toBe(generated.motif.length);
      expect(refined.notes.every((note) => isDiatonic(note.pitch, generated.key))).toBe(true);
    }
  });
});
