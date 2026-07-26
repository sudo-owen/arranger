import { describe, expect, it } from 'vitest';
import { arrange } from './arrange.js';
import { fixtureContext, fixtureGenome } from '../testing/index.js';

const G = fixtureContext();

describe('arrange() — the §8.3 DAG', () => {
  it('is fully deterministic (golden: same genome ⇒ identical notes)', () => {
    const a = arrange(G, fixtureGenome());
    const b = arrange(G, fixtureGenome());
    expect(a).toEqual(b); // any stray Math.random() breaks this loudly (§11)
  });

  it('produces the five roles, drums without a pitched instrument', () => {
    const { tracks } = arrange(G, fixtureGenome());
    expect(tracks.map((t) => t.role)).toEqual(['melody', 'bass', 'drums', 'winds', 'brass']);
    const drums = tracks.find((t) => t.role === 'drums');
    expect(drums?.instrument).toBeUndefined();
    for (const t of tracks) {
      if (t.role !== 'drums') expect(t.instrument).toBeDefined();
    }
  });

  it('rerolling one role leaves the others byte-identical (§8.2/§8.4)', () => {
    const base = fixtureGenome();
    const rerolled = { ...base, bass: { ...base.bass, seed: base.bass.seed + 1 } };
    const a = arrange(G, base);
    const b = arrange(G, rerolled);

    const track = (arr: typeof a, role: string) => arr.tracks.find((t) => t.role === role)?.motif;
    for (const role of ['melody', 'drums', 'winds', 'brass']) {
      expect(track(b, role)).toEqual(track(a, role)); // untouched roles unchanged
    }
    expect(track(b, 'bass')).not.toEqual(track(a, 'bass')); // the rerolled one moved
  });

  it('every generated note is well-formed (invariants, §11)', () => {
    const { tracks } = arrange(G, fixtureGenome());
    for (const t of tracks) {
      for (let i = 0; i < t.motif.notes.length; i++) {
        const n = t.motif.notes[i]!;
        expect(n.duration).toBeGreaterThan(0);      // no zero-duration notes
        expect(n.pitch).toBeGreaterThanOrEqual(0);
        expect(n.pitch).toBeLessThanOrEqual(127);
        if (i > 0) expect(n.start).toBeGreaterThanOrEqual(t.motif.notes[i - 1]!.start); // sorted
      }
    }
  });
});
