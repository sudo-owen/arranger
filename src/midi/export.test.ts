import { describe, expect, it } from 'vitest';
import { TIMBRES } from '../core/index.js';
import { arrange } from '../generate/index.js';
import { fixtureContext, fixtureGenome } from '../generate/fixtures.js';
import { toSMF } from './export.js';

const G = fixtureContext();
const bytes = toSMF(arrange(G, fixtureGenome()), 168, G.meter);

/**
 * Find the track named `name`, then read the event that follows its name meta event.
 * Export writes the name first, so a program change lands immediately after it.
 */
function programAfterTrackName(data: Uint8Array, name: string): number | null {
  for (let i = 0; i + 3 + name.length < data.length; i++) {
    if (data[i] !== 0xff || data[i + 1] !== 0x03 || data[i + 2] !== name.length) continue;
    let matched = true;
    for (let k = 0; k < name.length; k++) {
      if (data[i + 3 + k] !== name.charCodeAt(k)) { matched = false; break; }
    }
    if (!matched) continue;
    const p = i + 3 + name.length;
    // [delta, status, data] — a program change is 0xC0 | channel
    if (data[p] === 0x00 && (data[p + 1]! & 0xf0) === 0xc0) return data[p + 2]!;
    return null;
  }
  return null;
}

describe('MIDI export — the wire format munch reads', () => {
  it('is a well-formed SMF header', () => {
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
  });

  it('stamps each pitched track with its timbre’s GM program', () => {
    // This is the cross-repo contract: munch recovers the timbre from these numbers.
    // A chip lead exported as a flute would render as a flute in the game.
    expect(programAfterTrackName(bytes, 'melody')).toBe(TIMBRES['pulse-lead'].gmProgram);
    expect(programAfterTrackName(bytes, 'bass')).toBe(TIMBRES['tri-bass'].gmProgram);
    expect(programAfterTrackName(bytes, 'winds')).toBe(TIMBRES.winds.gmProgram);
    expect(programAfterTrackName(bytes, 'brass')).toBe(TIMBRES.brass.gmProgram);
  });

  it('writes no program change for percussion', () => {
    expect(programAfterTrackName(bytes, 'drums')).toBeNull();
  });

  it('keeps every program inside the 7-bit MIDI range', () => {
    for (const timbre of Object.values(TIMBRES)) {
      expect(timbre.gmProgram).toBeGreaterThanOrEqual(0);
      expect(timbre.gmProgram).toBeLessThanOrEqual(127);
    }
  });

  it('assigns each timbre a distinct program, so the lookup is unambiguous', () => {
    const programs = Object.values(TIMBRES).map((t) => t.gmProgram);
    expect(new Set(programs).size).toBe(programs.length);
  });
});
