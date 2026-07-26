import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOOD_CORNERS, renderSong, specProblems } from './generate/index.js';
import type { SongSpec } from './generate/index.js';
import { loopSeamProblems, violations } from './critic/index.js';
import { Store } from './app/state.js';

/**
 * Themes are data, so nothing else notices when the engine moves out from under them.
 * Every drift the two repos have suffered would have been a red test here.
 */
const THEME_DIR = new URL('../themes', import.meta.url).pathname;

const themes = readdirSync(THEME_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((file) => ({ file, spec: JSON.parse(readFileSync(join(THEME_DIR, file), 'utf8')) as SongSpec }));

describe('published themes', () => {
  it('there is at least one, or the game has nothing to play', () => {
    expect(themes.length).toBeGreaterThan(0);
  });

  for (const { file, spec } of themes) {
    describe(file, () => {
      it('is valid against this engine', () => {
        expect(specProblems(spec)).toEqual([]);
      });

      it('renders playable music at every corner of the mood square', () => {
        // A theme that only holds at neutral breaks the first time someone starts losing.
        for (const { mood, label } of MOOD_CORNERS) {
          const arr = renderSong(spec, mood);
          expect(violations(arr, arr.source, spec.bpm), `${file} @ ${label}`).toEqual([]);
          expect(loopSeamProblems(arr, spec.meter), `${file} @ ${label}`).toEqual([]);
        }
      });

      it('stays small enough to be worth shipping as a spec', () => {
        expect(JSON.stringify(spec).length).toBeLessThan(16_000);
      });
    });
  }
});

describe('specProblems', () => {
  const good = themes[0]!.spec;
  const broken = (patch: (s: SongSpec) => void): SongSpec => {
    const copy = JSON.parse(JSON.stringify(good)) as SongSpec;
    patch(copy);
    return copy;
  };

  it('accepts a published theme', () => {
    expect(specProblems(good)).toEqual([]);
  });

  // The two drifts that actually happened between the repos.
  it('catches a genome written before a role existed', () => {
    const s = broken((x) => { delete (x.genome as Partial<SongSpec['genome']>).tenor; });
    expect(specProblems(s).join(' ')).toMatch(/genome\.tenor/);
  });

  it('catches a renamed form field instead of silently dropping the arc', () => {
    const s = broken((x) => { x.formTemplate = 'formShapeId-era-value'; });
    expect(specProblems(s).join(' ')).toMatch(/unknown form template/);
  });

  it('catches an unknown progression, palette, and version', () => {
    expect(specProblems(broken((x) => { x.progressionId = 'nope'; })).join(' ')).toMatch(/unknown progression/);
    expect(specProblems(broken((x) => { x.genome.palette = 'nope' as never; })).join(' ')).toMatch(/unknown palette/);
    expect(specProblems(broken((x) => { (x as { version: number }).version = 2; })).join(' ')).toMatch(/version/);
  });

  it('reports a render failure rather than throwing', () => {
    const s = broken((x) => { x.hook.cell = { notes: [], length: 0 } as never; });
    expect(() => specProblems(s)).not.toThrow();
  });
});

describe('what the app exports is what the pipeline accepts', () => {
  // The missing link: `themes.test.ts` above validates files already in `themes/`, and
  // `specProblems` guards what munch loads, but nothing asserted that `songSpec()` —
  // the thing behind the Export button — produces a spec those two accept. Drift there
  // would only surface when someone dropped an export into `themes/` and ran `ship`.
  const exported = (): SongSpec => {
    const store = new Store();
    store.generateHookDrafts({ tonic: 9, mode: 'minor' }, 1);
    store.useSelectedHook(16);
    store.generateBeds(4);
    const plan = store.planForms(60).find((p) => !p.problems.length);
    if (plan) store.useForm(plan);
    const spec = store.songSpec();
    if (!spec) throw new Error('songSpec() returned null for a fully authored track');
    return spec;
  };

  it('survives the JSON round trip the download and the loader both do', () => {
    const spec = exported();
    const onDisk = JSON.parse(JSON.stringify(spec, null, 2)) as SongSpec;
    expect(specProblems(onDisk)).toEqual([]);
  });

  it('renders playable at every corner, the way a published theme must', () => {
    const onDisk = JSON.parse(JSON.stringify(exported())) as SongSpec;
    for (const { mood, label } of MOOD_CORNERS) {
      const arr = renderSong(onDisk, mood);
      expect(violations(arr, arr.source, onDisk.bpm), label).toEqual([]);
      expect(loopSeamProblems(arr, onDisk.meter), label).toEqual([]);
    }
  });

  it('carries every field the loader reads, and stays spec-sized', () => {
    const spec = exported();
    expect(Object.keys(spec).sort()).toEqual(
      expect.arrayContaining(['version', 'bpm', 'meter', 'key', 'bars', 'hook', 'genome', 'progressionId']),
    );
    expect(JSON.stringify(spec).length).toBeLessThan(16_000);
  });
});
