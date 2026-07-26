import { describe, expect, it } from 'vitest';
import { nextBoundary, spliceAtBoundary } from './scheduler.js';
import type { FlatEvent } from '../render/index.js';

const LOOKAHEAD = 0.1;
const BAR_168 = (60 / 168) * 4; // ~1.4286s — one 4/4 bar at 168 BPM

const ev = (time: number, pitch: number): FlatEvent =>
  ({ time, durSec: 0.2, pitch, velocity: 100, role: 'melody', timbre: 'pulse-lead' });

/** An eighth-note stream across two bars, standing in for a flattened arrangement. */
const stream = (pitch: number): FlatEvent[] =>
  Array.from({ length: 16 }, (_, i) => ev(i * (BAR_168 / 8), pitch));

describe('boundary-aligned swap (§9.3)', () => {
  it('always lands on a bar line', () => {
    for (const rel of [0, 0.01, 0.4, 1.2, 1.4285, 3.7, 9.9]) {
      const b = nextBoundary(rel, LOOKAHEAD, BAR_168);
      expect(b / BAR_168).toBeCloseTo(Math.round(b / BAR_168), 9);
    }
  });

  it('never lands inside the lookahead window — the invariant that makes it seamless', () => {
    // Anything within `lookahead` of now has already been handed to the audio clock.
    // A boundary at or before that point would need voices cancelled, which is the
    // exact thing this swap exists to avoid.
    for (let rel = 0; rel < 6; rel += 0.017) {
      expect(nextBoundary(rel, LOOKAHEAD, BAR_168)).toBeGreaterThan(rel + LOOKAHEAD);
    }
  });

  it('picks the very next bar when there is room, not the one after', () => {
    // Just past bar 2 (2.857s) with a full bar of headroom: expect bar 3.
    const rel = 2 * BAR_168 + 0.05;
    expect(nextBoundary(rel, LOOKAHEAD, BAR_168)).toBeCloseTo(3 * BAR_168, 6);
  });

  it('skips a bar line that is too close to schedule against', () => {
    // 30ms before bar 3 — inside the 100ms lookahead, so bar 3 is unusable.
    const rel = 3 * BAR_168 - 0.03;
    expect(nextBoundary(rel, LOOKAHEAD, BAR_168)).toBeCloseTo(4 * BAR_168, 6);
  });

  it('handles a pass origin sitting ahead of the clock', () => {
    // Right after a loop wrap the scheduler has already queued past the next origin,
    // so `rel` goes negative. Barely negative still means tick 0 is spoken for...
    expect(nextBoundary(-0.05, LOOKAHEAD, BAR_168)).toBeCloseTo(BAR_168, 6);
    // ...but with real headroom, tick 0 itself is the right place to change.
    expect(nextBoundary(-1, LOOKAHEAD, BAR_168)).toBe(0);
  });

  it('degrades safely on a nonsense bar length', () => {
    expect(nextBoundary(1, LOOKAHEAD, 0)).toBe(0);
    expect(nextBoundary(1, LOOKAHEAD, -1)).toBe(0);
  });
});

describe('splicing a swap into the current pass', () => {
  const oldArr = stream(60);
  const newArr = stream(72);
  const at = BAR_168; // swap on the second bar line

  it('never leaves a silent stretch — the bug the mute came from', () => {
    // Replacing the array and seeking to the boundary drops everything between the
    // lookahead edge and the boundary from BOTH timelines: the old events are gone and
    // the new ones are skipped. At 168 BPM that is up to 1.3s of silence per swap.
    const spliced = spliceAtBoundary(oldArr, newArr, at);
    expect(spliced).toHaveLength(oldArr.length);
    for (let i = 0; i < spliced.length; i++) {
      expect(spliced[i]!.time, `event ${i}`).toBeCloseTo(oldArr[i]!.time, 9);
    }
  });

  it('plays the old material up to the boundary and the new material after it', () => {
    const spliced = spliceAtBoundary(oldArr, newArr, at);
    for (const e of spliced) expect(e.pitch, `t=${e.time}`).toBe(e.time < at ? 60 : 72);
  });

  it('leaves the scheduler cursor valid — the prefix is untouched', () => {
    // Everything already handed to the audio clock sits below the boundary, so an index
    // counting consumed events still points at the same event after the splice.
    const spliced = spliceAtBoundary(oldArr, newArr, at);
    const before = oldArr.filter((e) => e.time < at).length;
    expect(spliced.slice(0, before)).toEqual(oldArr.slice(0, before));
  });

  it('stays sorted by time, which the scheduler walks in order', () => {
    for (const boundary of [0, BAR_168 / 2, BAR_168, 2 * BAR_168, 99]) {
      const spliced = spliceAtBoundary(oldArr, newArr, boundary);
      for (let i = 1; i < spliced.length; i++) {
        expect(spliced[i]!.time, `at ${boundary}`).toBeGreaterThanOrEqual(spliced[i - 1]!.time);
      }
    }
  });

  it('degenerates correctly at either end', () => {
    expect(spliceAtBoundary(oldArr, newArr, 0)).toEqual(newArr);          // everything new
    expect(spliceAtBoundary(oldArr, newArr, 99)).toEqual(oldArr);         // nothing yet
  });
});
