import { describe, expect, it } from 'vitest';
import { PPQ, midi, motif, tick } from '../core/index.js';
import { MOOD_CORNERS, arrangeAtMood, renderSong } from '../generate/index.js';
import { violations } from '../critic/index.js';
import { STAGES, Store, chooseBeds, isFallbackSet, listening, reachable } from './state.js';
import type { Candidate, Stage } from './state.js';
import type { SongSpec } from '../generate/index.js';

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

    // ...and coming back restores it, arrangements included.
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
  it('offers only beds that survive all four mood corners, or flags that it could not', () => {
    const store = seeded(6);
    const source = store.get().source!;
    if (isFallbackSet(store.get().candidates)) {
      // Nothing passed, so the least-bad were shown rather than an empty stage. The set
      // is flagged and the status says why — that is the whole of the weaker contract.
      expect(store.get().status).toMatch(/None passed the critic/);
      expect(store.get().candidates.length).toBeGreaterThan(0);
      return;
    }
    for (const c of store.get().candidates) {
      for (const { mood, label } of MOOD_CORNERS) {
        const at = arrangeAtMood(source, store.get().key!, store.get().meter, 4, c.genome, c.progression, mood);
        // Against `at.arr.source`, not the raw hook: at a corner `variationForMood` varies
        // the source the melody is generated from, so measuring contour kinship against
        // the unvaried hook counts the deliberate variation as drift.
        expect(violations(at.arr, at.arr.source, store.get().bpm), label).toEqual([]);
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
      120, { num: 4, den: 4 }, 'test import',
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
    // `contextFor` must derive the varied source through the shared pipeline, on the
    // melody seed: a second derivation on any other seed rewrites the melody a reroll is
    // supposed to leave alone, and takes §8.2's promise down with it.
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

describe('a song.json round trip', () => {
  /** A store parked on a fully authored track: hook, bed, form and a variation. */
  function authored(): Store {
    const store = new Store();
    store.generateHookDrafts({ tonic: 9, mode: 'minor' }, 1);
    store.useSelectedHook();
    store.generateBeds(4);
    store.useForm(store.planForms(60)[0]!);
    store.useVariation({ intro: 'thinned', "A'": 'ornamented' }, 'Terraced');
    return store;
  }

  /** Through a file, not just through memory — object identity would hide a lost field. */
  const onDisk = (spec: SongSpec): SongSpec => JSON.parse(JSON.stringify(spec, null, 2)) as SongSpec;

  it('loads back the arrangement that was exported, note for note', () => {
    const store = authored();
    const spec = store.songSpec()!;
    const before = store.get().candidates[0]!.arr;

    const loaded = new Store();
    expect(loaded.loadSpec(onDisk(spec))).toBe(true);

    expect(loaded.get().candidates[0]!.arr.tracks.map((t) => t.motif.notes))
      .toEqual(before.tracks.map((t) => t.motif.notes));
  });

  it('restores every choice the flow made, not just the notes', () => {
    // A take you cannot keep editing is a dead end — the point of loading a theme back
    // is to change something about it.
    const store = authored();
    const spec = store.songSpec()!;
    const loaded = new Store();
    loaded.loadSpec(onDisk(spec));
    const s = loaded.get();

    expect(s.hook).toEqual(spec.hook);
    expect(s.key).toEqual(spec.key);
    expect(s.bpm).toBe(spec.bpm);
    expect(s.meter).toEqual(spec.meter);
    expect(s.variation).toEqual(spec.variation);
    expect(s.form?.template).toBe(spec.formTemplate);
    expect(s.candidates[0]!.genome).toEqual(spec.genome);
    expect(s.candidates[0]!.progression?.id).toBe(spec.progressionId);
    // The seed a reroll has to hold constant, or editing a loaded theme rewrites its tune.
    expect(s.melodySeed).toBe(spec.genome.melody.seed);
  });

  it('re-exports byte-identically, so a load/save cycle is not an edit', () => {
    const store = authored();
    const spec = onDisk(store.songSpec()!);
    const loaded = new Store();
    loaded.loadSpec(spec);
    expect(loaded.songSpec()).toEqual(spec);
  });

  it('survives the trip at every mood corner, the way the game will play it', () => {
    const store = authored();
    const loaded = new Store();
    loaded.loadSpec(onDisk(store.songSpec()!));
    const spec = loaded.songSpec()!;
    for (const { mood, label } of MOOD_CORNERS) {
      const arr = renderSong(spec, mood);
      expect(violations(arr, arr.source, spec.bpm), label).toEqual([]);
    }
  });

  it('refuses a spec this engine cannot render, rather than half-loading it', () => {
    const store = authored();
    const spec = onDisk(store.songSpec()!);
    const loaded = new Store();

    expect(loaded.loadSpec({ ...spec, progressionId: 'no-such-progression' })).toBe(false);
    expect(loaded.get().source).toBeNull();
    expect(loaded.get().status).toMatch(/unknown progression/);

    // ...and the store is still usable afterwards.
    expect(loaded.loadSpec(spec)).toBe(true);
    expect(loaded.get().source).not.toBeNull();
  });

  it('opens on the pad, which is the only thing left to do to a finished theme', () => {
    const loaded = new Store();
    loaded.loadSpec(onDisk(authored().songSpec()!));
    expect(loaded.get().stage).toBe('mood');
    expect(STAGES[STAGES.length - 1]).toBe('mood');
  });
});

describe('the rail only offers stages that have something to offer', () => {
  /** Exactly what each stage view refuses to draw without — the rail must agree. */
  const hasContent = (s: ReturnType<Store['get']>, stage: Stage): boolean => {
    const bed = s.candidates[s.selected] !== undefined;
    switch (stage) {
      case 'hook': return !listening(s);
      case 'bed': return !listening(s);
      case 'form': return bed && s.hook !== null;
      case 'vary': return bed && s.form !== null;
      case 'mood': return bed;
    }
  };

  it('never offers a stage whose only content is an instruction to go back', () => {
    // Walked one commitment at a time, checking the rail at every point along the way.
    const store = new Store();
    const check = (): void => {
      for (const stage of STAGES) {
        if (!reachable(store.get(), stage)) continue;
        expect(hasContent(store.get(), stage), `${stage} offered with nothing on it`).toBe(true);
      }
    };

    check();
    store.generateHookDrafts({ tonic: 9, mode: 'minor' }, 1);
    check();
    store.useSelectedHook();
    check();
    store.generateBeds(4);
    check();
    store.useForm(store.planForms(60)[0]!);
    check();
    store.useVariation({ intro: 'thinned' }, 'Terraced');
    check();
  });

  it('opens each stage exactly as its precondition is met, not before', () => {
    const store = new Store();
    const open = (): Stage[] => STAGES.filter((st) => reachable(store.get(), st));

    expect(open()).toEqual(['hook']);

    store.generateHookDrafts({ tonic: 9, mode: 'minor' }, 1);
    store.useSelectedHook();
    // A committed hook opens the Bed stage, and nothing past it — there is no bed yet.
    expect(open()).toEqual(['hook', 'bed']);

    store.generateBeds(4);
    // A bed makes Form and Mood live. Vary still needs a form to vary.
    expect(open()).toEqual(['hook', 'bed', 'form', 'mood']);

    store.useForm(store.planForms(60)[0]!);
    expect(open()).toEqual(['hook', 'bed', 'form', 'vary', 'mood']);
  });

  it('shuts the choosing stages for imported material, and leaves the pad open', () => {
    // Listen mode: a source with no hook behind it. Hook and Bed have nothing to ask,
    // and Form/Vary cannot rebuild a tune they never had.
    const store = new Store();
    const q = PPQ;
    const tune = motif(
      [57, 60, 62, 64].map((p, i) => ({ start: tick(i * q), duration: tick(q), pitch: midi(p), velocity: 96 })),
      tick(4 * q),
    );
    store.loadSource(tune, 120, { num: 4, den: 4 });
    store.generateBeds(2);
    expect(listening(store.get())).toBe(true);
    expect(STAGES.filter((st) => reachable(store.get(), st))).toEqual(['mood']);
  });

  it('opens the whole rail for a loaded song.json, which arrives fully authored', () => {
    const source = new Store();
    source.generateHookDrafts({ tonic: 9, mode: 'minor' }, 1);
    source.useSelectedHook();
    source.generateBeds(4);
    source.useForm(source.planForms(60)[0]!);

    const store = new Store();
    store.loadSpec(JSON.parse(JSON.stringify(source.songSpec()!)) as SongSpec);
    expect(STAGES.filter((st) => reachable(store.get(), st))).toEqual(['hook', 'bed', 'form', 'vary', 'mood']);
  });
});

describe('chooseBeds', () => {
  const cand = (n: number, problems?: string[]): Candidate =>
    ({ genome: null as never, arr: { length: n } as never, progression: null, ...(problems ? { problems } : {}) });

  it('prefers clean candidates, and a clean set is not a fallback', () => {
    const got = chooseBeds([cand(1), cand(2)], [cand(9, ['x'])], 6);
    expect(got).toHaveLength(2);
    expect(isFallbackSet(got)).toBe(false);
  });

  it('shows the least-bad rather than an empty grid when nothing passed', () => {
    // The failure this pins: `generateBeds` used to return early with candidates
    // untouched, so the Mood stage read "Pick a bed first" while the real reason —
    // for a real MIDI, "melody: contour similarity below 0.5" — sat in the footer.
    const got = chooseBeds([], [
      cand(3, ['a', 'b', 'c']),
      cand(1, ['a']),
      cand(2, ['a', 'b']),
    ], 2);
    expect(got.map((c) => c.arr.length)).toEqual([1, 2]); // fewest problems first
    expect(isFallbackSet(got)).toBe(true);
  });

  it('reports no fallback when there is nothing at all to salvage', () => {
    expect(chooseBeds([], [], 6)).toEqual([]);
    expect(isFallbackSet([])).toBe(false);
  });
});
