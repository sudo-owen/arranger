/**
 * Copy the DOM-free engine into munch.
 *
 * The engine is pure TypeScript with no runtime dependencies and no DOM (enforced by
 * tsconfig.json's `lib: ["ES2022"]`), so the game can import it directly and rebuild a
 * track at any mood from a few hundred bytes of song.json — rather than shipping a bank
 * of pre-baked stems.
 *
 * A copy rather than a package because the two repos are separate trees. `engine.sha`
 * records what was copied; `npm run vendor:check` fails if the copy has drifted, so the
 * duplication cannot rot silently.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = resolve(root, '../snack/munch/src/app/music/engine');
// The DOM-free engine, plus the WebAudio renderer. `render` needs DOM lib for
// AudioContext but touches no document or window, so the engine's own boundary is
// unchanged — munch imports it from a separate entry point.
const PACKAGES = ['core', 'theory', 'generate', 'critic', 'render'];
const ENGINE_PACKAGES = ['core', 'theory', 'generate', 'critic'];

const BANNER = `// GENERATED — do not edit.
// Vendored from song-creatr/src by \`npm run vendor:engine\`. Edit it there.
`;

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...sources(full)); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.bench.ts')) continue;
    out.push(full);
  }
  return out;
}

const files = PACKAGES.flatMap((p) => sources(join(root, 'src', p))).sort();
const hash = createHash('sha256');
for (const f of files) hash.update(relative(root, f)).update(readFileSync(f));
const digest = hash.digest('hex');

if (process.argv.includes('--check')) {
  const recorded = (() => {
    try { return readFileSync(join(DEST, 'engine.sha'), 'utf8').trim(); } catch { return null; }
  })();
  if (recorded !== digest) {
    console.error(`munch's vendored engine is stale.\n  expected ${digest}\n  found    ${recorded ?? '(missing)'}\nRun: npm run vendor:engine`);
    process.exit(1);
  }
  console.log(`vendored engine up to date (${files.length} files, ${digest.slice(0, 12)})`);
  process.exit(0);
}

// One traversal: the copied set is provably the hashed set.
rmSync(DEST, { recursive: true, force: true });
for (const f of files) {
  const out = join(DEST, relative(join(root, 'src'), f));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, BANNER + readFileSync(f, 'utf8'));
}
writeFileSync(join(DEST, 'engine.sha'), `${digest}\n`);
writeFileSync(join(DEST, 'index.ts'), BANNER + ENGINE_PACKAGES.map((p) => `export * from './${p}/index.js';`).join('\n') + '\n');
writeFileSync(join(DEST, 'render.ts'), `${BANNER}export * from './render/index.js';\n`);
console.log(`vendored ${files.length} files -> ${relative(root, DEST)} (${digest.slice(0, 12)})`);
