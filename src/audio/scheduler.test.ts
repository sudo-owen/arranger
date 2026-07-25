import { describe, expect, it } from 'vitest';
import { nextBoundary } from './scheduler.js';

const LOOKAHEAD = 0.1;
const BAR_168 = (60 / 168) * 4; // ~1.4286s — one 4/4 bar at 168 BPM

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
