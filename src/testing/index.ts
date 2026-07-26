/**
 * Shared test scaffolding.
 *
 * Its own package, and deliberately absent from `scripts/vendor-engine.mjs` — these
 * fixtures used to live in `generate/`, which meant every one of them was copied into
 * the game bundle despite having no non-test caller.
 */
export * from './fixtures.js';
export * from './music.js';
