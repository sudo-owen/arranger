import { describe, expect, it } from 'vitest';
import type { Genome, Key, Palette } from '../core/index.js';
import { PALETTES, PALETTE_ORDER, PPQ, makeRng, pc } from '../core/index.js';
import { violations } from '../critic/index.js';
import { contourSimilarity, CONTOUR_FLOOR } from '../theory/index.js';
import { arrange } from './arrange.js';
import { wholeForm } from './context.js';
import { generateHookSet, renderHook } from './hook.js';
import { defaultProgression, harmonyFromProgression, progressionsFor, spreadByBrightness } from './progressions.js';

const METER = { num: 4, den: 4 };
const KEY: Key = { tonic: pc(9), mode: 'minor' };
const BPM = 168;

function genome(palette: Palette, melodySeed: number, seed: number): Genome {
  const r = makeRng(seed);
  return {
    version: 1, palette,
    skeleton: { seed: r.int(1e9), temperature: 0.5, template: 'sentence', bars: 8 },
    melody: { seed: melodySeed, ornament: 0.3, radius: 1 },
    bass: { seed: r.int(1e9), walkiness: r.next(), register: r.int(3) - 1 },
    drums: { seed: r.int(1e9), fillDensity: 0.5, swing: 0 },
    winds: { seed: r.int(1e9), activity: 0.5, ornament: 0.2 },
    brass: { seed: r.int(1e9), voicing: 'drop2', density: 0.6 },
  };
}

const hooks = generateHookSet(KEY, METER, makeRng(3), 5);

describe('beds over a hook', () => {
  it('every palette passes the critic at battle tempo, for every hook rhythm', () => {
    // The palettes exist to be chosen between. One that can never be generated is not
    // a choice, so this is the check that keeps the set honest.
    for (const hook of hooks) {
      const source = renderHook(hook, 8);
      const harmony = harmonyFromProgression(defaultProgression('minor'), KEY, METER, 8);
      for (const palette of PALETTE_ORDER) {
        for (let seed = 0; seed < 4; seed++) {
          const arr = arrange({ harmony, form: wholeForm(harmony), meter: METER, source }, genome(palette, 11, seed));
          expect(violations(arr, source, BPM, METER), `${hook.rhythm}/${palette}/seed${seed}`).toEqual([]);
        }
      }
    }
  });

  it('preserves the hook: the written melody stays kin to the source', () => {
    // The regression that motivated the sixteenth grid — beat-snapping collapsed a
    // sixteenth-note hook onto four onsets a bar and blew straight through the floor.
    for (const hook of hooks) {
      const source = renderHook(hook, 8);
      const harmony = harmonyFromProgression(defaultProgression('minor'), KEY, METER, 8);
      const arr = arrange({ harmony, form: wholeForm(harmony), meter: METER, source }, genome('chip-orchestral', 11, 1));
      const melody = arr.tracks.find((t) => t.role === 'melody')!.motif;
      expect(contourSimilarity(melody, source), hook.rhythm).toBeGreaterThanOrEqual(CONTOUR_FLOOR);
      // ...and it keeps roughly the note count, rather than being quantised away.
      expect(melody.notes.length).toBeGreaterThan(source.notes.length * 0.6);
    }
  });

  it('holds one melodic skeleton across palettes, thinning only what a voice cannot play', () => {
    // The premise of the stage: six cards, one tune. The skeleton is shared; the only
    // permitted divergence is ornamental, and only where the voice cannot articulate
    // the figure — a wind section will not be handed thirty-seconds.
    const source = renderHook(hooks[0]!, 8);
    const progs = spreadByBrightness(progressionsFor('minor'), 3);
    const melodyFor = (palette: Palette) => {
      const harmony = harmonyFromProgression(progs[0]!, KEY, METER, 8);
      const arr = arrange({ harmony, form: wholeForm(harmony), meter: METER, source }, genome(palette, 11, 1));
      return arr.tracks.find((t) => t.role === 'melody')!.motif;
    };

    // Same voice class ⇒ byte-identical.
    const chip = melodyFor('full-chip');
    expect(melodyFor('chip-orchestral').notes).toEqual(chip.notes);

    // An acoustic lead is the same line with the unplayable ornaments left out, so its
    // onsets are a strict subset — never a different tune.
    const winds = melodyFor('winds-lead');
    const chipOnsets = new Set(chip.notes.map((n) => n.start));
    for (const n of winds.notes) expect(chipOnsets.has(n.start)).toBe(true);
    expect(winds.notes.length).toBeLessThanOrEqual(chip.notes.length);
  });

  it('never asks an acoustic lead for a figure faster than a sixteenth', () => {
    for (const hook of hooks) {
      const source = renderHook(hook, 8);
      const harmony = harmonyFromProgression(defaultProgression('minor'), KEY, METER, 8);
      const arr = arrange({ harmony, form: wholeForm(harmony), meter: METER, source }, genome('winds-lead', 11, 4));
      const notes = arr.tracks.find((t) => t.role === 'melody')!.motif.notes;
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i]!.start - notes[i - 1]!.start, hook.rhythm).toBeGreaterThanOrEqual(PPQ / 4);
      }
    }
  });

  it('changes only the palette instruments when only the palette changes', () => {
    const source = renderHook(hooks[1]!, 8);
    const harmony = harmonyFromProgression(defaultProgression('minor'), KEY, METER, 8);
    const a = arrange({ harmony, form: wholeForm(harmony), meter: METER, source }, genome('full-chip', 11, 2));
    const b = arrange({ harmony, form: wholeForm(harmony), meter: METER, source }, genome('chip-orchestral', 11, 2));

    for (const role of ['melody', 'bass', 'drums'] as const) {
      const ta = a.tracks.find((t) => t.role === role)!;
      const tb = b.tracks.find((t) => t.role === role)!;
      expect(ta.motif.notes, role).toEqual(tb.motif.notes);
    }
    expect(a.tracks.find((t) => t.role === 'winds')!.instrument!.class).toBe('chip');
    expect(b.tracks.find((t) => t.role === 'winds')!.instrument!.class).toBe('acoustic');
  });

  it('writes every voice inside its palette instrument’s range', () => {
    for (const palette of PALETTE_ORDER) {
      const source = renderHook(hooks[2]!, 8);
      const harmony = harmonyFromProgression(defaultProgression('minor'), KEY, METER, 8);
      const arr = arrange({ harmony, form: wholeForm(harmony), meter: METER, source }, genome(palette, 11, 3));
      for (const track of arr.tracks) {
        const inst = track.instrument;
        if (!inst) continue;
        for (const n of track.motif.notes) {
          expect(n.pitch, `${palette}/${track.role}`).toBeGreaterThanOrEqual(inst.low);
          expect(n.pitch, `${palette}/${track.role}`).toBeLessThanOrEqual(inst.high);
        }
      }
    }
  });

  it('always writes the bass on triangle, and the lead on chip unless a section carries it', () => {
    // Bass stays forced — a line on every beat for a whole track is beyond any lungs.
    // The lead is no longer forced: phrasing, sections and the ornament clamp between
    // them make a wind lead playable at battle tempo.
    for (const palette of PALETTE_ORDER) expect(PALETTES[palette].bass.name).toBe('tri bass');
    expect(PALETTES['winds-lead'].melody.name).toBe('winds');
    expect(PALETTES['winds-lead'].melody.class).toBe('acoustic');
    for (const p of PALETTE_ORDER.filter((x) => x !== 'winds-lead')) {
      expect(PALETTES[p].melody.class, p).toBe('chip');
    }
  });
});
