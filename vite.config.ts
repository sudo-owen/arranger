import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

// The source uses TypeScript's Bundler-style `.js` import specifiers that point at
// `.ts` files. Rewrite those to the real `.ts` on resolve so Vite/esbuild find them.
function jsToTs() {
  return {
    name: 'js-to-ts',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (importer && source.endsWith('.js') && (source.startsWith('./') || source.startsWith('../'))) {
        const candidate = resolve(dirname(importer), `${source.slice(0, -3)}.ts`);
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [jsToTs()],
  build: { outDir: 'dist', target: 'es2022', sourcemap: true },
});
