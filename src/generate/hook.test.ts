import { describe, expect, it } from 'vitest';
import type { Key, Meter } from '../core/index.js';
import { PPQ, barTicks, makeRng, pc, toDiatonicDegree } from '../core/index.js';
import {
  HOOK_RHYTHMS, HOOK_SCHEMES, distinctPitches, generateHook, generateHookSet, renderHook, statement,
} from './hook.js';
import type { HookOptions, RestatementScheme } from './hook.js';

const KEY: Key = { tonic: pc(0), mode: 'minor' };
const METER: Meter = { num: 4, den: 4 };

const opts = (over: Partial<HookOptions> = {}): HookOptions => ({
  seed: 42, key: KEY, meter: METER, cellBars: 2, scheme: 'sequence-up', rhythm: 'gallop', ...over,
});

describe('hook cell', () => {
  it('is deterministic in its seed', () => {
    const a = generateHook(opts());
    const b = generateHook(opts());
    expect(a.cell.notes).toEqual(b.cell.notes);
    expect(generateHook(opts({ seed: 43 })).cell.notes).not.toEqual(a.cell.notes);
  });

  it('uses few enough pitches to be memorable, and enough to be a tune', () => {
    // The whole point: a hook you can hum. Widen the ceiling and it stops being a
    // hook; drop the floor and some seeds emit a single repeated note.
    for (const rhythm of HOOK_RHYTHMS) {
      for (const cellBars of [1, 2]) {
        for (let seed = 0; seed < 60; seed++) {
          const h = generateHook(opts({ seed, rhythm, cellBars }));
          const n = distinctPitches(h);
          expect(n, `${rhythm}/${cellBars}bar/seed${seed}`).toBeGreaterThanOrEqual(3);
          expect(n, `${rhythm}/${cellBars}bar/seed${seed}`).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it('spans exactly its cell length and never overruns the bar', () => {
    for (const cellBars of [1, 2]) {
      for (const rhythm of HOOK_RHYTHMS) {
        const h = generateHook(opts({ cellBars, rhythm }));
        expect(h.cell.length).toBe(cellBars * barTicks(METER));
        for (const n of h.cell.notes) {
          expect(n.start + n.duration).toBeLessThanOrEqual(h.cell.length);
        }
      }
    }
  });

  it('lands a note on the downbeat of every rhythm figure', () => {
    // Anchoring is what keeps the cell from drifting into an arpeggio exercise.
    for (const rhythm of HOOK_RHYTHMS) {
      const h = generateHook(opts({ rhythm }));
      expect(h.cell.notes[0]?.start).toBe(0);
    }
  });
});

describe('restatement', () => {
  it('immediate repeats the cell exactly', () => {
    const h = generateHook(opts({ scheme: 'immediate' }));
    const s = statement(h);
    const half = h.cell.length;
    const first = s.notes.filter((n) => n.start < half);
    const second = s.notes.filter((n) => n.start >= half);
    expect(second.length).toBe(first.length);
    second.forEach((n, i) => {
      expect(n.pitch).toBe(first[i]!.pitch);
      expect(n.start - half).toBe(first[i]!.start);
    });
  });

  it('sequence-up restates exactly one diatonic step higher', () => {
    const h = generateHook(opts({ scheme: 'sequence-up' }));
    const s = statement(h);
    const half = h.cell.length;
    const first = s.notes.filter((n) => n.start < half);
    const second = s.notes.filter((n) => n.start >= half);
    second.forEach((n, i) => {
      const before = toDiatonicDegree(first[i]!.pitch, KEY);
      const after = toDiatonicDegree(n.pitch, KEY);
      expect(after - before).toBe(1);
    });
  });

  it('sequence-down restates one step lower', () => {
    const h = generateHook(opts({ scheme: 'sequence-down' }));
    const s = statement(h);
    const half = h.cell.length;
    const first = s.notes.filter((n) => n.start < half);
    const second = s.notes.filter((n) => n.start >= half);
    second.forEach((n, i) => {
      expect(toDiatonicDegree(n.pitch, KEY) - toDiatonicDegree(first[i]!.pitch, KEY)).toBe(-1);
    });
  });

  it('answer keeps the rhythm but bends the tail downward', () => {
    const h = generateHook(opts({ scheme: 'answer' }));
    const s = statement(h);
    const half = h.cell.length;
    const first = s.notes.filter((n) => n.start < half);
    const second = s.notes.filter((n) => n.start >= half);
    expect(second.map((n) => n.start - half)).toEqual(first.map((n) => n.start));
    const lastBefore = toDiatonicDegree(first.at(-1)!.pitch, KEY);
    const lastAfter = toDiatonicDegree(second.at(-1)!.pitch, KEY);
    expect(lastAfter).toBeLessThan(lastBefore);
  });

  it('ostinato is one cell, cycling', () => {
    const h = generateHook(opts({ scheme: 'ostinato', cellBars: 1 }));
    expect(statement(h).length).toBe(h.cell.length);
  });
});

describe('renderHook', () => {
  it('fills exactly the requested number of bars for every scheme', () => {
    for (const scheme of HOOK_SCHEMES) {
      for (const bars of [4, 8, 16]) {
        const h = generateHook(opts({ scheme }));
        const m = renderHook(h, bars);
        expect(m.length).toBe(bars * barTicks(METER));
        for (const n of m.notes) expect(n.start + n.duration).toBeLessThanOrEqual(m.length);
      }
    }
  });

  it('actually recurs — the same material comes back later in the phrase', () => {
    const h = generateHook(opts({ scheme: 'immediate', cellBars: 2 }));
    const m = renderHook(h, 16);
    const atStart = m.notes.filter((n) => n.start < barTicks(METER)).map((n) => n.pitch);
    const oneStatementLater = m.notes
      .filter((n) => n.start >= h.cell.length * 2 && n.start < h.cell.length * 2 + barTicks(METER))
      .map((n) => n.pitch);
    expect(oneStatementLater).toEqual(atStart);
    expect(atStart.length).toBeGreaterThan(0);
  });

  it('handles a 1-bar cell asked for an odd bar count', () => {
    const h = generateHook(opts({ scheme: 'ostinato', cellBars: 1 }));
    const m = renderHook(h, 5);
    expect(m.length).toBe(5 * barTicks(METER));
  });

  it('produces sixteenth-grid onsets', () => {
    const m = renderHook(generateHook(opts({ rhythm: 'syncopated-16ths' })), 8);
    for (const n of m.notes) expect(n.start % (PPQ / 4)).toBe(0);
  });
});

describe('phrasing', () => {
  /** Longest stretch with no gap larger than a tick — what the breath limit measures. */
  function longestRun(m: { notes: readonly { start: number; duration: number }[] }): number {
    let longest = 0;
    let runStart: number | null = null;
    let prevEnd = 0;
    for (const n of m.notes) {
      if (runStart === null || n.start > prevEnd + 1) runStart = n.start;
      prevEnd = n.start + n.duration;
      longest = Math.max(longest, prevEnd - runStart);
    }
    return longest;
  }

  it('leaves air at the end of every phrase, for every rhythm', () => {
    // Four of the five figures fill every sixteenth, so without this a 16-bar render
    // is one unbroken 23-second line.
    for (const rhythm of HOOK_RHYTHMS) {
      for (const scheme of HOOK_SCHEMES) {
        const m = renderHook(generateHook(opts({ rhythm, scheme })), 16);
        const phraseTicks = 4 * barTicks(METER); // 2-bar cell, two statements
        expect(longestRun(m), `${rhythm}/${scheme}`).toBeLessThan(phraseTicks);
      }
    }
  });

  it('breathes at most once per phrase, not once per bar', () => {
    // A one-bar ostinato gasping every bar would not be a tune.
    const m = renderHook(generateHook(opts({ scheme: 'ostinato', cellBars: 1 })), 16);
    expect(longestRun(m)).toBeGreaterThanOrEqual(barTicks(METER));
  });

  it('keeps the opening gesture intact — the breath is taken at the end', () => {
    const h = generateHook(opts({ rhythm: 'driving-8ths', scheme: 'immediate' }));
    const bare = renderHook(h, 16, 0);
    const breathed = renderHook(h, 16);
    const firstBar = (m: typeof bare): unknown => m.notes.filter((n) => n.start < barTicks(METER)).map((n) => [n.start, n.pitch]);
    expect(firstBar(breathed)).toEqual(firstBar(bare));
    expect(breathed.notes.length).toBeLessThan(bare.notes.length);
  });

  it('still fills exactly the requested span', () => {
    for (const breath of [0, 1, 2, 4]) {
      expect(renderHook(generateHook(opts()), 16, breath).length).toBe(16 * barTicks(METER));
    }
  });

  it('never writes a note past the end', () => {
    const m = renderHook(generateHook(opts({ rhythm: 'march' })), 12);
    for (const n of m.notes) expect(n.start + n.duration).toBeLessThanOrEqual(m.length);
  });
});

describe('generateHookSet', () => {
  it('covers every rhythm and every scheme before repeating any', () => {
    // A six-card set showing four cards on the same rhythm wastes most of the choice.
    for (let seed = 0; seed < 25; seed++) {
      const set = generateHookSet(KEY, METER, makeRng(seed), 5);
      expect(set).toHaveLength(5);
      expect(new Set(set.map((h) => h.rhythm)).size).toBe(HOOK_RHYTHMS.length);
      expect(new Set<RestatementScheme>(set.map((h) => h.scheme)).size).toBe(HOOK_SCHEMES.length);
    }
  });

  it('at six cards, still shows five distinct rhythms', () => {
    for (let seed = 0; seed < 25; seed++) {
      const set = generateHookSet(KEY, METER, makeRng(seed), 6);
      expect(new Set(set.map((h) => h.rhythm)).size).toBe(5);
    }
  });

  it('is deterministic in the rng seed', () => {
    const a = generateHookSet(KEY, METER, makeRng(11), 4);
    const b = generateHookSet(KEY, METER, makeRng(11), 4);
    expect(a.map((h) => h.cell.notes)).toEqual(b.map((h) => h.cell.notes));
  });
});
