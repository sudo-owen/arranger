import { describe, expect, it } from 'vitest';
import type { Palette } from '../core/index.js';
import { PALETTES, PALETTE_ORDER, PPQ, specFor } from '../core/index.js';
import { contourSimilarity, CONTOUR_FLOOR } from '../theory/index.js';
import { TEMPOS, notesOf, problemsFor, testHooks, track, variedGenome } from '../testing/index.js';

const hooks = testHooks(5);

describe('beds over a hook', () => {
  it('every palette passes the critic at every offered tempo, for every hook rhythm', () => {
    // The palettes exist to be chosen between. One that cannot be generated is not a
    // choice — and "cannot" has to mean at every tempo the UI offers, not just one.
    for (const hook of hooks) {
      for (const palette of PALETTE_ORDER) {
        for (let seed = 0; seed < 4; seed++) {
          const t = track({ hook, palette, genome: variedGenome(seed) });
          for (const bpm of TEMPOS) {
            expect(problemsFor(t, bpm), `${hook.rhythm}/${palette}/seed${seed}@${bpm}`).toEqual([]);
          }
        }
      }
    }
  });

  it('preserves the hook: the written melody stays kin to the source', () => {
    // What the sixteenth grid is for: beat-snapping collapses a sixteenth-note hook
    // onto four onsets a bar and takes it straight through the contour floor.
    for (const hook of hooks) {
      const t = track({ hook, genome: variedGenome(1) });
      const melody = t.arr.tracks.find((x) => x.role === 'melody')!.motif;
      expect(contourSimilarity(melody, t.source), hook.rhythm).toBeGreaterThanOrEqual(CONTOUR_FLOOR);
      // ...and it keeps roughly the note count, rather than being quantised away.
      expect(melody.notes.length).toBeGreaterThan(t.source.notes.length * 0.6);
    }
  });

  it('holds one melodic skeleton across palettes, thinning only what a voice cannot play', () => {
    // The premise of the stage: six cards, one tune. The only permitted divergence is
    // ornamental, and only where the voice cannot articulate the figure.
    const hook = hooks[0]!;
    const melodyFor = (palette: Palette) =>
      notesOf(track({ hook, palette, genome: variedGenome(1) }), 'melody');

    expect(melodyFor('chip-orchestral')).toEqual(melodyFor('full-chip'));

    // An acoustic lead is the same line with the unplayable ornaments left out, so its
    // onsets are a strict subset — never a different tune.
    const chip = melodyFor('full-chip');
    const winds = melodyFor('winds-lead');
    const chipOnsets = new Set(chip.map((n) => n.start));
    for (const n of winds) expect(chipOnsets.has(n.start)).toBe(true);
    expect(winds.length).toBeLessThanOrEqual(chip.length);
  });

  it('never asks an acoustic lead for a figure faster than a sixteenth', () => {
    for (const hook of hooks) {
      const notes = notesOf(track({ hook, palette: 'winds-lead', genome: variedGenome(4) }), 'melody');
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i]!.start - notes[i - 1]!.start, hook.rhythm).toBeGreaterThanOrEqual(PPQ / 4);
      }
    }
  });

  it('changes only the palette instruments when only the palette changes', () => {
    const hook = hooks[1]!;
    const a = track({ hook, palette: 'full-chip', genome: variedGenome(2) });
    const b = track({ hook, palette: 'chip-orchestral', genome: variedGenome(2) });
    // Tenor is in this list because `PULSE_TENOR` and `HORN_SECTION` are given the same
    // window: matched ranges mean `fitToRange` folds identically, so the chip and the
    // acoustic tenor differ in timbre and in nothing else.
    for (const role of ['melody', 'bass', 'tenor', 'drums'] as const) {
      expect(notesOf(a, role), role).toEqual(notesOf(b, role));
    }
    expect(a.arr.tracks.find((x) => x.role === 'winds')!.instrument!.class).toBe('chip');
    expect(b.arr.tracks.find((x) => x.role === 'winds')!.instrument!.class).toBe('acoustic');
  });

  it('never puts a soloist on a continuous line — bass, tenor and lead are chip or a section', () => {
    // The bass plays a note per beat for the whole track and the tenor holds under it,
    // so neither can be one player with one pair of lungs. Chip voices have neither;
    // sections stagger their breathing. Anything else is a card that cannot generate.
    for (const palette of PALETTE_ORDER) {
      for (const role of ['bass', 'tenor', 'melody'] as const) {
        const inst = PALETTES[palette][role];
        expect(inst.class === 'chip' || specFor(inst)?.section === true, `${palette}/${role}: ${inst.name}`)
          .toBe(true);
      }
    }
    expect(PALETTES['deep-brass'].bass.name).toBe('low brass');
    expect(PALETTES['winds-lead'].melody.name).toBe('winds');
  });
});
