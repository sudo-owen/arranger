import { describe, expect, it } from 'vitest';
import type { Motif } from '../core/index.js';
import { NEUTRAL_MOOD, PPQ, barTicks, sliceAt } from '../core/index.js';
import { BPM, KEY, LENGTHS, METER, TEMPOS, fixtureGenome, problemsFor, testHooks, track } from '../testing/index.js';
import { CONTOUR_FLOOR, contourSimilarity } from '../theory/index.js';
import { FORM_SHAPES, barsForSeconds, planForm } from './form.js';
import { renderHook } from './hook.js';
import { defaultProgression, harmonyFromProgression } from './progressions.js';
import { formOf, renderSong } from './song.js';
import type { SongSpec } from './song.js';
import type { TreatmentId, VariationPlan } from './variation.js';
import {
  FORTUNE_LADDER, TREATMENTS, VARIATION_SCHEMES, driftAt, isStraight, varySource,
  variationForMood, variationProblems,
} from './variation.js';

const HOOK = testHooks(1, 77)[0]!;
const BARS = barsForSeconds(60, BPM, METER);
const FORM = planForm(FORM_SHAPES[0]!, BARS, METER);
const SOURCE = renderHook(HOOK, BARS);
const HARMONY = harmonyFromProgression(defaultProgression('minor'), KEY, METER, BARS);

const GENOME = fixtureGenome({ palette: 'chip-orchestral' });
const vary = (plan: VariationPlan, form = FORM): Motif => varySource(SOURCE, form, plan, HARMONY, METER, GENOME);
const everySection = (id: TreatmentId, form = FORM): VariationPlan =>
  Object.fromEntries(form.sections.map((s) => [s.label, id]));

describe('treatments', () => {
  it('every one keeps the section recognisable as the hook', () => {
    // The line between a variation and a second tune. Contour similarity is
    // z-normalised, so an octave lift — which moves every note — still scores 1.
    for (const t of TREATMENTS) {
      for (const hook of testHooks(4, 12)) {
        const src = renderHook(hook, 16);
        const harmony = harmonyFromProgression(defaultProgression('minor'), KEY, METER, 16);
        const form = planForm(FORM_SHAPES[2]!, 16, METER);
        const plan = everySection(t.id, form);
        const varied = varySource(src, form, plan, harmony, METER, GENOME);
        expect(variationProblems(src, varied, form), `${t.id}/${hook.rhythm}`).toEqual([]);
      }
    }
  });

  it('every one but as-written actually changes something', () => {
    const whole = { sections: FORM.sections.slice(0, 1), template: FORM.template };
    for (const t of TREATMENTS) {
      const varied = vary({ [whole.sections[0]!.label]: t.id }, whole);
      const drift = driftAt(SOURCE, varied, whole.sections[0]!);
      if (t.id === 'as-written') expect(drift).toBe(0);
      else expect(drift, t.id).toBeGreaterThan(0.1);
    }
  });

  it('fills its section exactly, whatever the treatment does to the length', () => {
    // `double-time` halves the material and `thinned` removes notes; neither may leave
    // a hole in the track or spill into the section after it.
    for (const t of TREATMENTS) {
      const varied = vary(everySection(t.id));
      expect(varied.length, t.id).toBe(SOURCE.length);
      for (const n of varied.notes) expect(n.start + n.duration, t.id).toBeLessThanOrEqual(varied.length);
    }
  });

  it('never asks a lead for a figure faster than a sixteenth', () => {
    for (const t of TREATMENTS) {
      const varied = vary(everySection(t.id));
      for (let i = 1; i < varied.notes.length; i++) {
        const gap = varied.notes[i]!.start - varied.notes[i - 1]!.start;
        expect(gap === 0 || gap >= PPQ / 4, `${t.id} @ ${varied.notes[i]!.start}`).toBe(true);
      }
    }
  });

  it('is deterministic — the same plan and seed rebuild the same notes', () => {
    for (const scheme of VARIATION_SCHEMES) expect(vary(scheme.plan)).toEqual(vary(scheme.plan));
  });

  it('leaves untreated sections byte-identical to the hook', () => {
    const varied = vary({ 'A"': 'octave-up' });
    for (const s of FORM.sections) {
      if (s.label !== 'A"') expect(driftAt(SOURCE, varied, s), s.label).toBe(0);
    }
  });

  it('treats each section independently — changing one moves only that one', () => {
    const a = vary({ B: 'thinned' });
    const b = vary({ B: 'thinned', tag: 'octave-down' });
    for (const s of FORM.sections) {
      if (s.label !== 'tag') expect(driftAt(a, b, s), s.label).toBe(0);
    }
  });

  it('falls back rather than emptying a section it cannot treat', () => {
    // `thinned` on already-sparse material would leave silence where the tune should be.
    const sparse = renderHook(testHooks(5, 4)[4]!, BARS);
    for (const t of TREATMENTS) {
      const varied = varySource(sparse, FORM, everySection(t.id), HARMONY, METER, GENOME);
      expect(varied.notes.length, t.id).toBeGreaterThan(0);
    }
  });

});

describe('variation schemes', () => {
  it('every scheme passes the critic at every length and tempo', () => {
    for (const seconds of LENGTHS) {
      const bars = barsForSeconds(seconds, BPM, METER);
      for (const shape of FORM_SHAPES) {
        if (bars < shape.parts.length * 4) continue;
        for (const scheme of VARIATION_SCHEMES) {
          const t = track({ hook: HOOK, shape, seconds, variation: scheme.plan });
          for (const bpm of TEMPOS) {
            expect(problemsFor(t, bpm), `${scheme.id}/${shape.template}/${seconds}s@${bpm}`).toEqual([]);
          }
        }
      }
    }
  });

  it('every scheme keeps every section kin to the hook', () => {
    for (const scheme of VARIATION_SCHEMES) {
      expect(variationProblems(SOURCE, vary(scheme.plan), FORM), scheme.id).toEqual([]);
    }
  });

  it('only `straight` leaves the track untouched', () => {
    for (const scheme of VARIATION_SCHEMES) {
      const moved = FORM.sections.filter((s) => driftAt(SOURCE, vary(scheme.plan), s) > 0).length;
      if (scheme.id === 'straight') expect(moved).toBe(0);
      else expect(moved, scheme.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('names a plan that does nothing, however it is spelled', () => {
    expect(isStraight(undefined)).toBe(true);
    expect(isStraight({})).toBe(true);
    expect(isStraight({ A: 'as-written' })).toBe(true);
    expect(isStraight({ A: 'thinned' })).toBe(false);
  });
});

describe('a variation survives the round trip to song.json', () => {
  const spec: SongSpec = {
    version: 1, bpm: BPM, meter: METER, key: KEY, bars: BARS, hook: HOOK,
    genome: fixtureGenome({ palette: 'chip-orchestral' }),
    progressionId: 'aeolian-vamp', formTemplate: 'arc',
    variation: { intro: 'thinned', "A'": 'ornamented', 'A"': 'octave-up' },
  };

  it('rebuilds the same notes from the spec alone', () => {
    const revived = JSON.parse(JSON.stringify(spec)) as SongSpec;
    expect(renderSong(revived, NEUTRAL_MOOD).tracks.map((t) => t.motif.notes))
      .toEqual(renderSong(spec, NEUTRAL_MOOD).tracks.map((t) => t.motif.notes));
  });

  it('is audibly a different track from the same spec without one', () => {
    const { variation: _omit, ...plain } = spec;
    const straight = renderSong(plain, NEUTRAL_MOOD);
    const varied = renderSong(spec, NEUTRAL_MOOD);
    const mel = (a: typeof varied) => a.tracks.find((t) => t.role === 'melody')!.motif;
    expect(mel(varied).notes).not.toEqual(mel(straight).notes);
    // Kinship is a per-section property, checked against the hook. Across the whole
    // track it is not: three sections moving is exactly what was asked for.
    expect(variationProblems(straight.source, varied.source, formOf(spec, METER)!)).toEqual([]);
    expect(driftAt(straight.source, varied.source, FORM.sections[1]!)).toBe(0);
  });

  it('carries the plan through every mood, without the mood disturbing it', () => {
    // Mood deforms the genome; it must not reach the variation, or dragging the pad
    // would quietly rewrite which treatment each section got.
    const at = (urgency: number) => renderSong(spec, { urgency, fortune: 0.5 }).source;
    expect(driftAt(at(0), at(1), FORM.sections[4]!)).toBe(0);
  });
});

describe('varySource on a formless track', () => {
  it('treats the whole span as one section', () => {
    const whole = { sections: [{ label: 'A' as const, start: FORM.sections[0]!.start, length: SOURCE.length, mood: NEUTRAL_MOOD }], template: 'sentence' as const };
    const varied = varySource(SOURCE, whole, { A: 'octave-up' }, HARMONY, METER, GENOME);
    expect(varied.notes.every((n, i) => n.pitch === SOURCE.notes[i]!.pitch + 12)).toBe(true);
  });

  it('returns the source untouched when there are no sections at all', () => {
    expect(varySource(SOURCE, { sections: [], template: 'sentence' }, { A: 'thinned' }, HARMONY, METER, GENOME)).toBe(SOURCE);
  });
});

describe('driftAt', () => {
  it('is 0 against itself and 1 when nothing survives', () => {
    const s = FORM.sections[1]!;
    expect(driftAt(SOURCE, SOURCE, s)).toBe(0);
    expect(driftAt(SOURCE, vary({ A: 'octave-up' }), s)).toBe(1);
  });

  it('grows with how much the treatment moved', () => {
    const s = FORM.sections[1]!;
    const barely = driftAt(SOURCE, vary({ A: 'thinned' }), s);
    expect(barely).toBeGreaterThan(0);
    expect(barely).toBeLessThan(driftAt(SOURCE, vary({ A: 'octave-up' }), s));
  });
});

describe('the seed', () => {
  const withSeed = (seed: number): Motif =>
    varySource(SOURCE, FORM, { A: 'ornamented' }, HARMONY, METER, { ...GENOME, melody: { ...GENOME.melody, seed } });

  it('is the melody seed, so rerolling the tune redraws its ornaments too', () => {
    expect(withSeed(1).notes).not.toEqual(withSeed(2).notes);
  });

  it('gives each section its own stream, so two ornamented sections differ', () => {
    const varied = vary({ A: 'ornamented', "A'": 'ornamented' });
    const onsets = (s: { start: number; length: number }): number[] =>
      sliceAt(varied, s.start, s.length).notes.map((n) => n.start);
    expect(onsets(FORM.sections[1]!)).not.toEqual(onsets(FORM.sections[2]!));
  });
});

describe('variationForMood — the adaptive half', () => {
  const plan: VariationPlan = { intro: 'thinned', A: 'as-written', "A'": 'ornamented', 'A"': 'octave-up' };
  const at = (fortune: number): VariationPlan => variationForMood(plan, FORM, { urgency: 0.5, fortune });

  it('is the identity anywhere the fight is still open', () => {
    // The same promise `deform` makes at neutral: what you author is what you audition.
    for (const fortune of [0.3, 0.4, 0.5, 0.6, 0.7]) expect(at(fortune)).toBe(plan);
  });

  it('strips the hook back as fortune falls, and strains it upward at the bottom', () => {
    const losing = at(0);
    expect(losing.A).toBe('answered');           // the statement deflates
    expect(losing["A'"]).toBe('as-written');     // decoration falls away
    expect(losing.intro).toBe('octave-up');      // already bare — it climbs instead
  });

  it('fills the hook out as fortune rises', () => {
    const winning = at(1);
    expect(winning.A).toBe('ornamented');
    expect(winning.intro).toBe('answered');
    expect(winning["A'"]).toBe('ornamented');    // already at the top
  });

  it('never walks a deliberate register or tempo statement off its own axis', () => {
    // The bug this pins: with the register moves on the ladder, the climax came back
    // THINNER at the triumphant corner.
    for (const fortune of [0, 1]) expect(at(fortune)['A"']).toBe('octave-up');
    expect(variationForMood({ B: 'double-time' }, FORM, { urgency: 1, fortune: 1 }).B).toBe('double-time');
  });

  it('moves every section by at most one rung', () => {
    for (const scheme of VARIATION_SCHEMES) {
      for (const fortune of [0, 1]) {
        const shifted = variationForMood(scheme.plan, FORM, { urgency: 0.5, fortune });
        for (const s of FORM.sections) {
          const before = FORTUNE_LADDER.indexOf(scheme.plan[s.label] ?? 'as-written');
          const after = FORTUNE_LADDER.indexOf(shifted[s.label] ?? 'as-written');
          if (before < 0 || after < 0) continue;
          expect(Math.abs(after - before), `${scheme.id}@${fortune} ${s.label}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('every scheme still passes the critic once the mood has bent it', () => {
    for (const scheme of VARIATION_SCHEMES) {
      for (const fortune of [0, 0.5, 1]) {
        for (const urgency of [0, 1]) {
          const mood = { urgency, fortune };
          const t = track({ hook: HOOK, shape: FORM_SHAPES[0]!, seconds: 60, mood, variation: variationForMood(scheme.plan, FORM, mood) });
          expect(problemsFor(t), `${scheme.id}@${urgency}/${fortune}`).toEqual([]);
        }
      }
    }
  });
});

describe('the sub-melody', () => {
  /** Wind notes per bar inside the sections carrying `id`. */
  function windDensity(id: TreatmentId): number {
    const plan: VariationPlan = { intro: id, B: id };
    const t = track({ hook: HOOK, shape: FORM_SHAPES[0]!, seconds: 60, variation: plan });
    const winds = t.arr.tracks.find((x) => x.role === 'winds')!.motif;
    let notes = 0;
    let bars = 0;
    for (const s of t.form.sections.filter((x) => plan[x.label])) {
      notes += winds.notes.filter((n) => n.start >= s.start && n.start < s.start + s.length).length;
      bars += s.length / barTicks(METER);
    }
    return notes / bars;
  }

  it('fills in where the lead steps back — a thinned section carries more wind, not less', () => {
    // The brief's "sub-melody in B". A thinned section leaves whole windows open, and
    // the winds take the hook's own material inverted rather than punctuating the gap.
    expect(windDensity('thinned')).toBeGreaterThan(windDensity('as-written') * 1.3);
  });

  it('is a second voice, not a doubling of the tune it is covering', () => {
    const t = track({ hook: HOOK, shape: FORM_SHAPES[0]!, seconds: 60, variation: { intro: 'thinned', B: 'thinned' } });
    const winds = t.arr.tracks.find((x) => x.role === 'winds')!.motif;
    const melody = t.arr.tracks.find((x) => x.role === 'melody')!.motif;
    for (const s of t.form.sections.filter((x) => x.label === 'B')) {
      const w = sliceAt(winds, s.start, s.length);
      const m = sliceAt(melody, s.start, s.length);
      if (w.notes.length < 3) continue;
      expect(contourSimilarity(w, m)).toBeLessThan(CONTOUR_FLOOR);
    }
  });
});
