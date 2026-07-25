import { describe, expect, it } from 'vitest';
import { PPQ, midi, motif, octave, tick } from '../core/index.js';
import type { Note } from '../core/index.js';
import { contourSimilarity, passesContourFloor } from './contour.js';

const Q = PPQ;
const line = (pitches: readonly number[]): Note[] =>
  pitches.map((p, i) => ({ start: tick(i * Q), duration: tick(Q), pitch: midi(p), velocity: 90 }));

const asc = motif(line([60, 62, 64, 65, 67]));
const desc = motif(line([67, 65, 64, 62, 60]));

describe('contour similarity (Müllensiefen)', () => {
  it('is 1 for a motif against itself', () => {
    expect(contourSimilarity(asc, asc)).toBeCloseTo(1, 5);
  });

  it('is invariant to octave transposition (z-normalised)', () => {
    expect(contourSimilarity(asc, octave(asc, 1))).toBeCloseTo(1, 5);
  });

  it('is strongly negative for a reversed contour', () => {
    expect(contourSimilarity(asc, desc)).toBeLessThan(-0.9);
  });

  it('floor passes kin, rejects a different shape', () => {
    expect(passesContourFloor(asc, asc)).toBe(true);
    expect(passesContourFloor(desc, asc)).toBe(false);
  });
});
