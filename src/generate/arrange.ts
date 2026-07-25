import type { Arrangement, Genome, Track } from '../core/index.js';
import { PALETTES, makeRng } from '../core/index.js';
import type { GenContext } from './context.js';
import { generateBass } from './roles/bass.js';
import { generateMelody } from './roles/melody.js';
import { generateDrums } from './roles/drums.js';
import { generateWinds } from './roles/winds.js';
import { generateBrass } from './roles/brass.js';

/**
 * Evaluate a genome into an arrangement (spec §8.3, §9.3). Each role draws from its
 * OWN seed — so rerolling one track (a new seed for that field) leaves the others
 * byte-identical. The dependency order is honoured: melody is written first, then
 * winds and brass answer the melody that was actually written.
 *
 * This is a pure function of (owned harmony + form, genome). Same inputs ⇒ same
 * notes, which is what the golden tests in §11 lock down.
 */
export function arrange(g: GenContext, genome: Genome): Arrangement {
  const melody = generateMelody(g, genome.melody, makeRng(genome.melody.seed), PALETTES[genome.palette].melody);
  const bass = generateBass(g, genome.bass, makeRng(genome.bass.seed), PALETTES[genome.palette].bass);
  const drums = generateDrums(g, genome.drums, makeRng(genome.drums.seed));
  const winds = generateWinds(g, melody, genome.winds, makeRng(genome.winds.seed), PALETTES[genome.palette].winds);
  const brass = generateBrass(g, melody, genome.brass, makeRng(genome.brass.seed), PALETTES[genome.palette].brass);

  // The palette decides which voices are chip and which are acoustic. It changes the
  // rendered timbre, the exported GM program, and which critic rules apply — but not a
  // single note, so two palettes over one genome are the same music differently voiced.
  const p = PALETTES[genome.palette];
  const tracks: Track[] = [
    { role: 'melody', instrument: p.melody, motif: melody },
    { role: 'bass', instrument: p.bass, motif: bass },
    { role: 'drums', motif: drums }, // percussion — no pitched range
    { role: 'winds', instrument: p.winds, motif: winds },
    { role: 'brass', instrument: p.brass, motif: brass },
  ];

  return { source: g.source, harmony: g.harmony, tracks, length: g.harmony.length };
}
