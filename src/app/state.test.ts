import { describe, expect, it } from 'vitest';
import { PPQ } from '../core/index.js';
import { Store } from './state.js';

describe('arrangement extension', () => {
  it('extends a selected arrangement to explicit total bar counts', () => {
    const store = new Store();
    store.generateHookDrafts({ tonic: 0, mode: 'minor' }, 1);
    store.useSelectedHook(4);
    store.generateBeds(1);

    store.extendSelectedArrangement(8);
    expect(store.current()?.length).toBe(8 * 4 * PPQ);
    expect(store.get().source?.length).toBe(8 * 4 * PPQ);

    store.extendSelectedArrangement(16);
    expect(store.current()?.length).toBe(16 * 4 * PPQ);
    expect(store.get().evolution.at(-1)?.kind).toBe('arrangement-extend');
  });
});

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
