// Public surface of the `core` package. Depends on nothing outside itself
// (no DOM, no Tone, no React, no Node) — this draws the FFI boundary for free
// and keeps the interesting 80% testable in milliseconds (spec §4).

export * from './brand.js';
export * from './rng.js';
export * from './types.js';
export * from './genome.js';
export * from './pitch.js';
export * from './math.js';
export * from './mood.js';
export * from './meter.js';
export * from './motif.js';
export * from './operators.js';
export * from './instruments.js';
export * from './timbre.js';
