import { describe, expect, it } from 'vitest';
import type { Key } from '../core/index.js';
import { barTicks, pc } from '../core/index.js';
import {
  PROGRESSIONS, chordOf, defaultProgression, harmonyFromProgression, progressionById,
  progressionsFor, spreadByBrightness,
} from './progressions.js';

const METER = { num: 4, den: 4 };
const A_MINOR: Key = { tonic: pc(9), mode: 'minor' };

describe('the progression library', () => {
  it('has unique ids', () => {
    const ids = PROGRESSIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers both modes, and every brightness within each', () => {
    for (const mode of ['minor', 'major'] as const) {
      const list = progressionsFor(mode);
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(new Set(list.map((p) => p.brightness))).toEqual(new Set(['dark', 'neutral', 'bright']));
    }
  });

  it('anchors every progression on the tonic — the theme keeps its centre', () => {
    // The fortune axis slides between these; if they disagreed on the tonic, moving
    // along it would change the piece rather than its colour. Containing the tonic is
    // the real requirement, not opening on it — `vi–IV–I–V` starts on vi by design.
    for (const p of PROGRESSIONS) {
      expect(p.steps.some((s) => s.semitones === 0), p.id).toBe(true);
    }
  });

  it('resolves a step to a concrete chord in a key', () => {
    const aeolian = progressionById('aeolian-vamp')!;
    // i–♭VI–♭VII–i in A minor = Am – F – G – Am
    expect(chordOf(aeolian.steps[0]!, A_MINOR)).toEqual({ root: 9, quality: 'min' });
    expect(chordOf(aeolian.steps[1]!, A_MINOR)).toEqual({ root: 5, quality: 'maj' });
    expect(chordOf(aeolian.steps[2]!, A_MINOR)).toEqual({ root: 7, quality: 'maj' });
  });

  it('has a default per mode', () => {
    expect(defaultProgression('minor').mode).toBe('minor');
    expect(defaultProgression('major').mode).toBe('major');
  });
});

describe('harmonyFromProgression', () => {
  it('covers the span with no gaps and no overlaps (§5.4)', () => {
    const h = harmonyFromProgression(defaultProgression('minor'), A_MINOR, METER, 16);
    expect(h.length).toBe(16 * barTicks(METER));
    expect(h.events).toHaveLength(16);
    let cursor = 0;
    for (const e of h.events) {
      expect(e.start).toBe(cursor);
      cursor += e.duration;
    }
    expect(cursor).toBe(h.length);
  });

  it('tiles the loop, so bar 5 repeats bar 1', () => {
    const h = harmonyFromProgression(defaultProgression('minor'), A_MINOR, METER, 8);
    expect(h.events[4]?.chord).toEqual(h.events[0]?.chord);
    expect(h.events[5]?.chord).toEqual(h.events[1]?.chord);
  });

  it('handles a bar count that is not a multiple of the loop', () => {
    const h = harmonyFromProgression(defaultProgression('minor'), A_MINOR, METER, 6);
    expect(h.events).toHaveLength(6);
    expect(h.length).toBe(6 * barTicks(METER));
  });

  it('keeps the key it was given', () => {
    expect(harmonyFromProgression(defaultProgression('minor'), A_MINOR, METER, 4).key).toEqual(A_MINOR);
  });
});

describe('spreadByBrightness', () => {
  it('covers all three brightnesses before repeating any', () => {
    const picked = spreadByBrightness(progressionsFor('minor'), 3);
    expect(new Set(picked.map((p) => p.brightness)).size).toBe(3);
  });

  it('never returns duplicates', () => {
    const list = progressionsFor('minor');
    const picked = spreadByBrightness(list, 6);
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
  });

  it('stops at the library size rather than looping forever', () => {
    const list = progressionsFor('major');
    const picked = spreadByBrightness(list, 99);
    expect(picked).toHaveLength(list.length);
  });
});
