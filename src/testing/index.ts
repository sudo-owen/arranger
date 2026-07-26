/**
 * Shared test scaffolding.
 *
 * Its own package, and deliberately absent from `scripts/publish.mjs`. Fixtures
 * living inside `generate/` would be copied into the game bundle despite having no
 * non-test caller.
 */
export * from './fixtures.js';
export * from './music.js';
