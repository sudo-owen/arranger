import { describe, expect, it } from 'vitest';
import { chordPCs, midi, pc } from '../core/index.js';
import type { Chord } from '../core/index.js';
import { closeVoicing, drop2, voice } from './voicing.js';

const C: Chord = { root: pc(0), quality: 'maj' }; // C E G
const pcsOf = (xs: readonly number[]) => xs.map((x) => ((x % 12) + 12) % 12);
const chordPcSet = new Set<number>(chordPCs(C).map((x) => x));

describe('block voicing (spec §7.4)', () => {
  it('four-way close: melody on top, chord tones stacked below, descending', () => {
    const v = closeVoicing(midi(67), C, 4); // G on top
    expect(v.length).toBe(4);
    expect(v[0]).toBe(67);
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThan(v[i - 1]!);
    for (const p of pcsOf(v)) expect(chordPcSet.has(p)).toBe(true);
  });

  it('non-chord-tone melody snaps its top to a chord tone', () => {
    const v = closeVoicing(midi(66), C, 4); // F# → nearest chord tone G
    expect(chordPcSet.has(((v[0]! % 12) + 12) % 12)).toBe(true);
  });

  it('drop-2 lowers the second voice an octave and stays sorted', () => {
    const close = closeVoicing(midi(67), C, 4); // [67,64,60,55]
    const d = drop2(close);                     // 64 → 52
    expect(d).toContain(52);
    expect(d).not.toContain(64);
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeLessThan(d[i - 1]!);
  });

  it('voice(close) equals closeVoicing', () => {
    expect(voice(midi(67), C, 'close', 4)).toEqual(closeVoicing(midi(67), C, 4));
  });
});
