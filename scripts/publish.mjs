/**
 * Publish the engine and the themes into munch, which authors no music of its own.
 *
 * Both go under ONE hash. They drift in opposite directions and each break is silent: a
 * spec written before a role existed throws inside `arrange()`, an engine vendored before
 * a field was renamed ignores it and plays a flat loop. `--check` cannot pass while
 * either half is stale.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUNCH = resolve(root, '../snack/munch');
const ENGINE_DEST = join(MUNCH, 'src/app/music/engine');
const THEME_DEST = join(MUNCH, 'src/assets/music/themes');
const THEME_SRC = join(root, 'themes');

// `render` needs DOM lib for AudioContext but touches no document or window, so munch
// imports it from a separate entry point and the engine's boundary is unchanged.
const PACKAGES = ['core', 'theory', 'generate', 'critic', 'render'];
const ENGINE_PACKAGES = ['core', 'theory', 'generate', 'critic'];

const BANNER = `// GENERATED — do not edit.
// Vendored from song-creatr/src by \`npm run ship\`. Edit it there.
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

const engineFiles = PACKAGES.flatMap((p) => sources(join(root, 'src', p))).sort();
const themeFiles = readdirSync(THEME_SRC).filter((f) => f.endsWith('.json')).sort();

if (themeFiles.length === 0) {
  console.error(`No themes in ${relative(root, THEME_SRC)} — the game would have nothing to play.`);
  process.exit(1);
}

// One digest over both sets, so neither half can be stale on its own.
const hash = createHash('sha256');
for (const f of engineFiles) hash.update(relative(root, f)).update(readFileSync(f));
for (const f of themeFiles) hash.update(f).update(readFileSync(join(THEME_SRC, f)));
const digest = hash.digest('hex');

const ids = themeFiles.map((f) => f.replace(/\.json$/, ''));
const index = { version: 1, default: ids[0], themes: ids };

if (process.argv.includes('--check')) {
  const recorded = (() => {
    try { return readFileSync(join(ENGINE_DEST, 'engine.sha'), 'utf8').trim(); } catch { return null; }
  })();
  if (recorded !== digest) {
    console.error(
      `munch is out of date.\n  expected ${digest}\n  found    ${recorded ?? '(missing)'}\nRun: npm run ship`,
    );
    process.exit(1);
  }
  console.log(`munch up to date (${engineFiles.length} engine files, ${themeFiles.length} themes, ${digest.slice(0, 12)})`);
  process.exit(0);
}

rmSync(ENGINE_DEST, { recursive: true, force: true });
for (const f of engineFiles) {
  const out = join(ENGINE_DEST, relative(join(root, 'src'), f));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, BANNER + readFileSync(f, 'utf8'));
}
writeFileSync(join(ENGINE_DEST, 'engine.sha'), `${digest}\n`);
writeFileSync(
  join(ENGINE_DEST, 'index.ts'),
  BANNER + ENGINE_PACKAGES.map((p) => `export * from './${p}/index.js';`).join('\n') + '\n',
);
writeFileSync(join(ENGINE_DEST, 'render.ts'), `${BANNER}export * from './render/index.js';\n`);

rmSync(THEME_DEST, { recursive: true, force: true });
mkdirSync(THEME_DEST, { recursive: true });
for (const f of themeFiles) writeFileSync(join(THEME_DEST, f), readFileSync(join(THEME_SRC, f)));
writeFileSync(join(THEME_DEST, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

console.log(
  `published ${engineFiles.length} engine files and ${themeFiles.length} theme(s) -> ${relative(root, MUNCH)}`
  + ` (${digest.slice(0, 12)})\n  themes: ${ids.join(', ')}  default: ${index.default}`,
);
