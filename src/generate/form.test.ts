import { describe, expect, it } from 'vitest';
import { NEUTRAL_MOOD, barTicks, makeRng, pc } from '../core/index.js';
import { loopSeamProblems } from '../critic/index.js';
import { arrange } from './arrange.js';
import { generateHookSet, renderHook } from './hook.js';
import {
  FORM_SHAPES, barsForSeconds, formBars, intensityAt, minBars, moodAt, planForm, secondsForBars,
  sectionAt, shapesFor,
} from './form.js';
import { defaultProgression, harmonyFromProgression } from './progressions.js';
import { formOf, renderSong } from './song.js';
import type { SongSpec } from './song.js';
import { BPM, KEY, LENGTHS, METER, TEMPOS, fixtureGenome, notesOf, problemsFor, testHooks, track } from '../testing/index.js';


describe('length targets', () => {
  it('lands within a phrase of the requested duration', () => {
    for (const bpm of TEMPOS) {
      for (const seconds of LENGTHS) {
        const bars = barsForSeconds(seconds, bpm, METER);
        const actual = secondsForBars(bars, bpm, METER);
        const phrase = secondsForBars(4, bpm, METER);
        expect(Math.abs(actual - seconds), `${seconds}s @ ${bpm}`).toBeLessThanOrEqual(phrase / 2 + 1e-6);
      }
    }
  });

  it('always returns whole phrases', () => {
    for (const bpm of TEMPOS) {
      for (const seconds of [10, 30, 45, 60, 90, 120]) {
        expect(barsForSeconds(seconds, bpm, METER) % 4).toBe(0);
      }
    }
  });
});

describe('planForm', () => {
  it('hits the requested bar count exactly for every shape that fits', () => {
    for (const bpm of TEMPOS) {
      for (const seconds of LENGTHS) {
        const bars = barsForSeconds(seconds, bpm, METER);
        for (const shape of shapesFor(bars)) {
          expect(formBars(planForm(shape, bars, METER), METER), `${shape.template} ${seconds}s @ ${bpm}`).toBe(bars);
        }
      }
    }
  });

  it('never inverts the weight order, at any length a tempo can produce', () => {
    // Rounding each weight independently used to push all the drift onto the first
    // part, so at 28 bars the arc's intro came out longest and its climax shortest.
    for (const shape of FORM_SHAPES) {
      for (let bars = minBars(shape); bars <= 400; bars += 4) {
        const sections = planForm(shape, bars, METER).sections;
        expect(sections.reduce((n, s) => n + s.length, 0) / barTicks(METER)).toBe(bars);
        for (const s of sections) expect(s.length / barTicks(METER)).toBeGreaterThanOrEqual(4);
        shape.parts.forEach(([, w], i) => {
          shape.parts.forEach(([, w2], j) => {
            if (w > w2) expect(sections[i]!.length, `${shape.template}@${bars}`).toBeGreaterThanOrEqual(sections[j]!.length);
          });
        });
      }
    }
  });

  it('excludes shapes that cannot fit — a six-section arc needs six phrases', () => {
    // 30s at 140 BPM is 16 bars; the arc needs 24. Offering it would silently overrun
    // the requested length.
    const short = barsForSeconds(30, 140, METER);
    expect(short).toBe(16);
    expect(shapesFor(short).map((s) => s.template)).not.toContain('arc');
    expect(shapesFor(barsForSeconds(60, 168, METER)).length).toBe(FORM_SHAPES.length);
    for (const shape of FORM_SHAPES) expect(minBars(shape)).toBe(shape.parts.length * 4);
  });

  it('gives every section a whole number of phrases and no gaps', () => {
    for (const shape of FORM_SHAPES) {
      const form = planForm(shape, barsForSeconds(60, 168, METER), METER);
      let cursor = 0;
      for (const s of form.sections) {
        expect(s.start).toBe(cursor);
        expect((s.length / barTicks(METER)) % 4).toBe(0);
        expect(s.length).toBeGreaterThan(0);
        cursor += s.length;
      }
    }
  });

  it('shapes an arc — the climax is the most urgent section', () => {
    const form = planForm(FORM_SHAPES[0]!, barsForSeconds(60, 168, METER), METER);
    const byLabel = new Map(form.sections.map((s) => [s.label, s.mood.urgency]));
    expect(byLabel.get('A"')).toBeGreaterThan(byLabel.get('A')!);
    expect(byLabel.get('intro')).toBeLessThan(byLabel.get('A')!);
    expect(byLabel.get('B')).toBeLessThan(byLabel.get("A'")!);
  });
});

describe('sectionAt / moodAt', () => {
  const form = planForm(FORM_SHAPES[0]!, 40, METER);

  it('covers every tick in the span', () => {
    for (let t = 0; t < 40 * barTicks(METER); t += barTicks(METER)) {
      expect(sectionAt(form, t as never)).toBeDefined();
    }
  });

  it('composes the section mood with the track mood rather than overriding it', () => {
    const climax = form.sections.find((s) => s.label === 'A"')!;
    const calm = moodAt(form, climax.start, { urgency: 0, fortune: 0.5 });
    const frantic = moodAt(form, climax.start, { urgency: 1, fortune: 0.5 });
    expect(frantic.urgency).toBeGreaterThan(calm.urgency);
    // The arc itself: the climax outranks the intro, which is what the generators read.
    expect(intensityAt(form, climax.start))
      .toBeGreaterThan(intensityAt(form, form.sections[0]!.start));
  });
});

describe('a planned track', () => {
  const hooks = testHooks(3, 31);

  it('passes the critic and the loop seam at every length and shape', () => {
    for (const hook of hooks) {
      for (const shape of FORM_SHAPES) {
        for (const seconds of LENGTHS) {
          const bars = barsForSeconds(seconds, BPM, METER);
          if (minBars(shape) > bars) continue;
          const t = track({ hook, shape, seconds });
          expect(problemsFor(t), `${hook.rhythm}/${shape.template}/${seconds}s`).toEqual([]);
        }
      }
    }
  });

  it('actually varies intensity across the track rather than flattening it', () => {
    const t = track({ hook: hooks[0]!, shape: FORM_SHAPES[0]!, seconds: 60 });
    const drums = notesOf(t, 'drums');
    const perBar = (s: { start: number; length: number }): number =>
      drums.filter((n) => n.start >= s.start && n.start < s.start + s.length).length / (s.length / barTicks(METER));
    const intro = t.form.sections.find((s) => s.label === 'intro')!;
    const climax = t.form.sections.find((s) => s.label === 'A"')!;
    expect(perBar(climax)).toBeGreaterThan(perBar(intro) * 1.15);
  });

  it('crashes on section boundaries, which is what marks the form', () => {
    const t = track({ hook: hooks[1]!, shape: FORM_SHAPES[0]!, seconds: 60 });
    const crashes = new Set(notesOf(t, 'drums').filter((n) => n.pitch === 49).map((n) => n.start));
    for (const s of t.form.sections) expect(crashes.has(s.start), s.label).toBe(true);
  });
});

describe('loopSeamProblems', () => {
  const bars = 16;
  const form = planForm(FORM_SHAPES[2]!, bars, METER);
  const source = renderHook(generateHookSet(KEY, METER, makeRng(2), 1)[0]!, bars);
  const harmony = harmonyFromProgression(defaultProgression('minor'), KEY, METER, bars);
  const arr = arrange({ harmony, form, meter: METER, source }, fixtureGenome({ palette: 'chip-orchestral' }));

  it('accepts a track whose last chord leads back to its first', () => {
    expect(loopSeamProblems(arr, METER)).toEqual([]);
  });

  it('catches a crash in the final bar', () => {
    const drums = arr.tracks.find((t) => t.role === 'drums')!;
    const clash = {
      ...arr,
      tracks: arr.tracks.map((t) => (t.role === 'drums'
        ? { ...t, motif: { ...t.motif, notes: [...t.motif.notes, { ...drums.motif.notes[0]!, start: (arr.length - 100) as never, pitch: 49 as never }] } }
        : t)),
    };
    expect(loopSeamProblems(clash, METER).some((p) => p.includes('crash'))).toBe(true);
  });

  it('catches material sustaining past the loop point', () => {
    const over = {
      ...arr,
      tracks: arr.tracks.map((t) => (t.role === 'bass'
        ? { ...t, motif: { ...t.motif, notes: t.motif.notes.map((n, i) => (i === t.motif.notes.length - 1 ? { ...n, duration: (n.duration + 5000) as never } : n)) } }
        : t)),
    };
    expect(over.tracks.find((t) => t.role === 'bass')!.motif.notes.length).toBeGreaterThan(0);
    expect(loopSeamProblems(over, METER).some((p) => p.includes('sustains past'))).toBe(true);
  });

  it('catches a progression that does not return', () => {
    const stranded = {
      ...arr,
      harmony: { ...arr.harmony, events: arr.harmony.events.map((e, i) => (i === arr.harmony.events.length - 1 ? { ...e, chord: { root: pc(KEY.tonic + 6), quality: 'dim' as const } } : e)) },
    };
    expect(loopSeamProblems(stranded, METER).some((p) => p.includes('lead back'))).toBe(true);
  });
});

describe('a form survives the round trip to song.json', () => {
  it('rebuilds the same section arc from the spec alone', () => {
    const bars = barsForSeconds(60, 168, METER);
    const hook = generateHookSet(KEY, METER, makeRng(44), 1)[0]!;
    const spec: SongSpec = {
      version: 1, bpm: 168, meter: METER, key: KEY, bars, hook,
      genome: fixtureGenome({ palette: 'chip-orchestral' }),
      progressionId: 'aeolian-vamp', formTemplate: 'arc',
    };
    const revived = JSON.parse(JSON.stringify(spec)) as SongSpec;
    const form = formOf(revived, METER)!;
    expect(form.sections.map((s) => s.label)).toEqual(['intro', 'A', "A'", 'B', 'A"', 'tag']);
    expect(formBars(form, METER)).toBe(bars);

    const a = renderSong(spec, NEUTRAL_MOOD);
    const b = renderSong(revived, NEUTRAL_MOOD);
    expect(b.tracks.map((t) => t.motif.notes)).toEqual(a.tracks.map((t) => t.motif.notes));
    expect(loopSeamProblems(b, METER)).toEqual([]);
  });

  it('renders a flat loop when no form is named, and an arc when one is', () => {
    const bars = barsForSeconds(60, 168, METER);
    const hook = generateHookSet(KEY, METER, makeRng(45), 1)[0]!;
    const base: SongSpec = {
      version: 1, bpm: 168, meter: METER, key: KEY, bars, hook,
      genome: fixtureGenome({ palette: 'chip-orchestral' }), progressionId: 'aeolian-vamp',
    };
    const flat = renderSong(base, NEUTRAL_MOOD);
    const arced = renderSong({ ...base, formTemplate: 'arc' }, NEUTRAL_MOOD);
    const crashes = (a: typeof flat): number =>
      a.tracks.find((t) => t.role === 'drums')!.motif.notes.filter((n) => n.pitch === 49).length;
    expect(crashes(flat)).toBe(1);
    expect(crashes(arced)).toBe(6);
  });

  it('keeps the hook identical whether or not a form is applied', () => {
    const bars = barsForSeconds(60, 168, METER);
    const hook = generateHookSet(KEY, METER, makeRng(46), 1)[0]!;
    const base: SongSpec = {
      version: 1, bpm: 168, meter: METER, key: KEY, bars, hook,
      genome: fixtureGenome({ palette: 'chip-orchestral' }), progressionId: 'aeolian-vamp',
    };
    const mel = (spec: SongSpec) => renderSong(spec, NEUTRAL_MOOD).tracks.find((t) => t.role === 'melody')!.motif.notes;
    expect(mel({ ...base, formTemplate: 'arc' })).toEqual(mel(base));
  });
});
