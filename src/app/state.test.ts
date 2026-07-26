import { describe, expect, it } from 'vitest';
import { PPQ, midi, motif, tick } from '../core/index.js';
import { MOOD_CORNERS, arrangeAtMood, renderSong } from '../generate/index.js';
import { violations } from '../critic/index.js';
import { Store } from './state.js';

/** A store parked on a generated set of arrangements. */
function seeded(count = 4): Store {
  const store = new Store();
  store.generateHookDrafts({ tonic: 0, mode: 'minor' }, 1);
  store.useSelectedHook(4);
  store.generateBeds(count);
  return store;
}

describe('history is fully restorable', () => {
  it('stepping back to a generate node brings its arrangements with it', () => {
    const store = seeded();
    const generateNode = store.get().evolution.at(-1)!;
    const before = store.get().candidates;
    expect(before.length).toBeGreaterThan(0);

    // Move away: promoting clears the candidate set.
    store.promoteCurrentMelody();
    expect(store.get().candidates).toHaveLength(0);

    // ...and coming back restores it. This is what used to be silently destroyed.
    store.selectEvolution(generateNode.id);
    expect(store.get().candidates).toHaveLength(before.length);
    expect(store.get().candidates[0]?.genome).toBe(before[0]?.genome);
    expect(store.get().selected).toBe(0);
  });

  it('restores the melody and harmony a node was taken at', () => {
    const store = seeded(2);
    const seedNode = store.get().evolution[0]!;
    const seedSource = store.get().source;

    store.extendSource();
    expect(store.get().source).not.toBe(seedSource);

    store.selectEvolution(seedNode.id);
    expect(store.get().source).toBe(seedNode.snapshot.source);
    expect(store.get().harmony).toBe(seedNode.snapshot.harmony);
    expect(store.get().source).toBe(seedSource);
  });

  it('branches from the restored node rather than the latest one', () => {
    const store = seeded(2);
    const seedNode = store.get().evolution[0]!;
    store.selectEvolution(seedNode.id);
    store.extendSource();
    expect(store.get().evolution.at(-1)?.parentId).toBe(seedNode.id);
  });
});

describe('pinned takes', () => {
  it('survive branching away and can be auditioned back', () => {
    const store = seeded();
    const kept = store.get().candidates[0]!;
    store.pin(0);
    expect(store.get().pinned).toHaveLength(1);

    store.promoteCurrentMelody();
    store.extendSource();
    expect(store.get().pinned).toHaveLength(1); // pins are not part of any snapshot

    store.auditionPin(store.get().pinned[0]!.id);
    expect(store.current()).toBe(kept.arr);
  });

  it('unpins by id', () => {
    const store = seeded();
    store.pin(0);
    store.pin(1);
    const [first] = store.get().pinned;
    store.unpin(first!.id);
    expect(store.get().pinned.map((p) => p.id)).not.toContain(first!.id);
    expect(store.get().pinned).toHaveLength(1);
  });
});

describe('debt: harmony ownership, history roots, corner-safe beds', () => {
  it('offers only beds that survive all four mood corners', () => {
    const store = seeded(6);
    const source = store.get().source!;
    for (const c of store.get().candidates) {
      for (const { mood, label } of MOOD_CORNERS) {
        const at = arrangeAtMood(source, store.get().key!, store.get().meter, 4, c.genome, c.progression, mood);
        expect(violations(at.arr, source, store.get().bpm), label).toEqual([]);
      }
    }
  });

  it('keeps a hook as its own history root instead of wiping the tree', () => {
    const store = new Store();
    store.generateHookDrafts({ tonic: 0, mode: 'minor' }, 2);
    store.useSelectedHook(4);
    store.generateBeds(2);
    const firstRun = store.get().evolution.length;
    const firstHookNode = store.get().evolution[0]!;

    store.generateHookDrafts({ tonic: 5, mode: 'minor' }, 2);
    store.selectHookDraft(1);
    store.useSelectedHook(4);

    // The second hook is a second root; the first hook's subtree is still reachable.
    expect(store.get().evolution.length).toBe(firstRun + 1);
    expect(store.get().evolution.filter((n) => n.parentId === null)).toHaveLength(2);
    store.selectEvolution(firstHookNode.id);
    expect(store.get().hook).toBe(firstHookNode.snapshot.hook);
  });

  it('arranges imported material over its own inferred harmony, not a library progression', () => {
    const store = new Store();
    const q = PPQ;
    const pitches = [60, 62, 64, 65, 67, 65, 64, 62];
    store.loadSource(
      motif(pitches.map((p, i) => ({ start: tick(i * q), duration: tick(q), pitch: midi(p), velocity: 96 })), tick(8 * q)),
      120, { num: 4, den: 4 }, 'test import', 'import',
    );
    const inferred = store.get().harmony!.events.map((e) => e.chord.root);
    store.generateBeds(2);
    expect(store.get().candidates.length).toBeGreaterThan(0);
    for (const c of store.get().candidates) {
      expect(c.progression).toBeNull();
      expect(c.arr.harmony.events.map((e) => e.chord.root)).toEqual(inferred);
    }
  });
});

describe('a committed variation reaches every path that builds an arrangement', () => {
  /** A store parked on a form with a variation committed. */
  function varied(): Store {
    const store = new Store();
    store.generateHookDrafts({ tonic: 9, mode: 'minor' }, 1);
    store.useSelectedHook();
    store.generateBeds(4);
    store.useForm(store.planForms(60)[0]!);
    store.useVariation({ intro: 'thinned', "A'": 'ornamented', 'A"': 'octave-up' }, 'Terraced');
    return store;
  }

  it('rerolling one voice still leaves the others byte-identical', () => {
    // `contextFor` used to re-derive the varied source with a hardcoded seed while the
    // shared pipeline used the melody seed, so every reroll silently rewrote the melody
    // it was supposed to leave alone — §8.2's whole promise, lost under a variation.
    const store = varied();
    const before = store.get().candidates[0]!.arr;
    store.rerollVoice('drums');
    const after = store.get().candidates[0]!.arr;
    const notesOf = (a: typeof before, role: 'melody' | 'bass' | 'drums') =>
      a.tracks.find((t) => t.role === role)!.motif.notes;
    expect(notesOf(after, 'melody')).toEqual(notesOf(before, 'melody'));
    expect(notesOf(after, 'bass')).toEqual(notesOf(before, 'bass'));
    expect(notesOf(after, 'drums')).not.toEqual(notesOf(before, 'drums'));
  });

  it('auditioning a treatment does not deform the genome it was authored at', () => {
    const store = varied();
    const genome = store.get().candidates[0]!.genome;
    store.setTreatment('B', 'answered');
    expect(store.get().candidates[0]!.genome).toEqual(genome);
  });

  it('exports the plan, and the spec rebuilds the arrangement that was auditioned', () => {
    const store = varied();
    const spec = store.songSpec()!;
    expect(spec.variation).toEqual({ intro: 'thinned', "A'": 'ornamented', 'A"': 'octave-up' });
    const rebuilt = renderSong(JSON.parse(JSON.stringify(spec)) as typeof spec, store.get().mood);
    expect(rebuilt.tracks.map((t) => t.motif.notes))
      .toEqual(store.get().candidates[0]!.arr.tracks.map((t) => t.motif.notes));
  });
});
