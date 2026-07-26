import { describe, expect, it } from 'vitest';
import { KEY, METER, MOOD_GRID, TEMPOS, fixtureGenome, problemsFor, testHooks, track } from '../testing/index.js';
import { NEUTRAL_MOOD, PALETTE_ORDER, ROLE_ORDER, clampMood, makeRng } from '../core/index.js';
import { violations } from '../critic/index.js';
import { contourSimilarity, CONTOUR_FLOOR } from '../theory/index.js';
import { generateHookSet, renderHook } from './hook.js';
import { MOOD_CORNERS, brightnessFor, deform, describeMood, layerGains, progressionForMood } from './mood.js';
import { neighbours, rerollRole } from './mutate.js';
import { renderSong } from './song.js';
import type { SongSpec } from './song.js';
import { progressionsFor } from './progressions.js';


describe('deform', () => {
  it('is the identity at neutral — the authored take passes through untouched', () => {
    // The property that keeps the Bed and Variations stages meaningful. Assigning from
    // mood instead of biasing collapsed six distinct beds onto one set of numbers.
    expect(deform(fixtureGenome(), NEUTRAL_MOOD)).toEqual(fixtureGenome());
  });

  it('keeps distinct takes distinct at every mood', () => {
    const r = makeRng(21);
    const takes = Array.from({ length: 6 }, () => ({
      ...fixtureGenome(),
      bass: { ...fixtureGenome().bass, walkiness: r.next() },
      drums: { ...fixtureGenome().drums, fillDensity: 0.3 + r.next() * 0.5 },
      winds: { ...fixtureGenome().winds, activity: 0.3 + r.next() * 0.5 },
    }));
    for (const mood of MOOD_GRID) {
      const shapes = new Set(takes.map((t) => {
        const d = deform(t, mood);
        return `${d.drums.fillDensity.toFixed(3)}/${d.bass.walkiness.toFixed(3)}/${d.winds.activity.toFixed(3)}`;
      }));
      expect(shapes.size, `${mood.urgency}/${mood.fortune}`).toBeGreaterThan(3);
    }
  });

  it('preserves the ordering of two takes it deforms', () => {
    const quiet = { ...fixtureGenome(), drums: { ...fixtureGenome().drums, fillDensity: 0.2 } };
    const busy = { ...fixtureGenome(), drums: { ...fixtureGenome().drums, fillDensity: 0.8 } };
    for (const mood of MOOD_GRID) {
      expect(deform(busy, mood).drums.fillDensity)
        .toBeGreaterThanOrEqual(deform(quiet, mood).drums.fillDensity);
    }
  });

  it('never touches the melody — the hook survives every mood', () => {
    const base = fixtureGenome();
    for (const mood of MOOD_GRID) expect(deform(base, mood).melody).toEqual(base.melody);
  });

  it('is total: every point in the square yields renderable, in-range parameters', () => {
    const base = fixtureGenome();
    for (const mood of MOOD_GRID) {
      const g = deform(base, mood);
      for (const v of [g.drums.fillDensity, g.drums.swing, g.bass.walkiness, g.winds.activity, g.brass.density]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps input rather than extrapolating past the corners', () => {
    const base = fixtureGenome();
    expect(deform(base, { urgency: 9, fortune: -9 })).toEqual(deform(base, { urgency: 1, fortune: 0 }));
    expect(clampMood({ urgency: -1, fortune: 2 })).toEqual({ urgency: 0, fortune: 1 });
  });

  it('moves urgency and fortune in the directions they claim', () => {
    const base = { ...fixtureGenome(), drums: { ...fixtureGenome().drums, fillDensity: 0.5, swing: 0.2 } };
    const calm = deform(base, { urgency: 0, fortune: 0.5 });
    const frantic = deform(base, { urgency: 1, fortune: 0.5 });
    expect(frantic.drums.fillDensity).toBeGreaterThan(calm.drums.fillDensity);
    expect(frantic.bass.walkiness).toBeGreaterThan(calm.bass.walkiness);
    expect(frantic.drums.swing).toBeLessThan(calm.drums.swing);

    const losing = deform(base, { urgency: 0.5, fortune: 0 });
    const winning = deform(base, { urgency: 0.5, fortune: 1 });
    expect(winning.brass.density).toBeGreaterThan(losing.brass.density);
  });

  it('is deterministic', () => {
    const base = fixtureGenome();
    expect(deform(base, { urgency: 0.31, fortune: 0.72 })).toEqual(deform(base, { urgency: 0.31, fortune: 0.72 }));
  });
});

describe('every mood point stays playable', () => {
  it('passes the critic across the whole square, at every tempo, for every hook', () => {
    for (const hook of testHooks(3, 4)) {
      for (const mood of MOOD_GRID) {
        const t = track({ hook, mood });
        for (const bpm of TEMPOS) {
          expect(problemsFor(t, bpm), `${hook.rhythm}@${mood.urgency}/${mood.fortune}@${bpm}`).toEqual([]);
        }
      }
    }
  });

  it('holds for every palette at the four corners', () => {
    const hook = testHooks(1, 9)[0]!;
    for (const palette of PALETTE_ORDER) {
      for (const { mood, label } of MOOD_CORNERS) {
        expect(problemsFor(track({ hook, palette, mood })), `${palette} @ ${label}`).toEqual([]);
      }
    }
  });
});

describe('progression selection', () => {
  it('maps fortune onto brightness', () => {
    expect(brightnessFor(0)).toBe('dark');
    expect(brightnessFor(0.5)).toBe('neutral');
    expect(brightnessFor(1)).toBe('bright');
  });

  it('keeps the current progression while its brightness still fits', () => {
    const bright = progressionsFor('minor').find((p) => p.brightness === 'bright')!;
    expect(progressionForMood('minor', { urgency: 0.5, fortune: 0.9 }, bright)).toBe(bright);
    expect(progressionForMood('minor', { urgency: 0.5, fortune: 0.1 }, bright)).not.toBe(bright);
  });

  it('always returns a progression in the requested mode', () => {
    for (const mode of ['minor', 'major'] as const) {
      for (const mood of MOOD_GRID) expect(progressionForMood(mode, mood, null).mode).toBe(mode);
    }
  });
});

describe('layerGains', () => {
  it('keeps the spine audible everywhere — losing the hook is not a mood', () => {
    for (const mood of MOOD_GRID) {
      const g = layerGains(mood);
      expect(g.melody).toBe(1);
      expect(g.bass).toBe(1);
      expect(g.drums).toBeGreaterThan(0.5);
    }
  });

  it('gives every role a gain in [0, 1]', () => {
    for (const mood of MOOD_GRID) {
      const g = layerGains(mood);
      for (const role of ROLE_ORDER) {
        expect(g[role]).toBeGreaterThanOrEqual(0);
        expect(g[role]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('brings brass in as fortune rises', () => {
    expect(layerGains({ urgency: 0.5, fortune: 1 }).brass)
      .toBeGreaterThan(layerGains({ urgency: 0.5, fortune: 0 }).brass);
  });
});

describe('neighbours', () => {
  it('changes exactly one field per variant', () => {
    const base = fixtureGenome();
    for (const n of neighbours(base, makeRng(5), 6)) {
      const differing = (['melody', 'bass', 'drums', 'winds', 'brass'] as const)
        .filter((k) => JSON.stringify(n.genome[k]) !== JSON.stringify(base[k])).length
        + (n.genome.palette === base.palette ? 0 : 1);
      expect(differing, n.changed).toBeLessThanOrEqual(1);
    }
  });

  it('never touches the melody seed', () => {
    const base = fixtureGenome();
    for (const n of neighbours(base, makeRng(6), 9)) expect(n.genome.melody.seed).toBe(base.melody.seed);
  });

  it('returns distinct tweaks, capped at the number available', () => {
    const labels = neighbours(fixtureGenome(), makeRng(7), 6).map((n) => n.changed);
    expect(new Set(labels).size).toBe(labels.length);
    expect(neighbours(fixtureGenome(), makeRng(8), 99).length).toBeLessThanOrEqual(9);
  });
});

describe('rerollRole', () => {
  it('changes that role and leaves the others byte-identical', () => {
    const base = fixtureGenome();
    for (const role of ROLE_ORDER) {
      const next = rerollRole(base, role, makeRng(role.length));
      expect(next[role].seed, role).not.toBe(base[role].seed);
      for (const other of ROLE_ORDER.filter((r) => r !== role)) {
        expect(next[other], `${role} disturbed ${other}`).toEqual(base[other]);
      }
    }
  });
});

describe('describeMood', () => {
  it('names every corner and the centre distinctly', () => {
    const names = [...MOOD_CORNERS.map((c) => c.mood), NEUTRAL_MOOD].map((m) => describeMood(m).name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('SongSpec', () => {
  it('survives a JSON round trip and rebuilds the same notes', () => {
    const hook = generateHookSet(KEY, METER, makeRng(12), 1)[0]!;
    const spec: SongSpec = {
      version: 1, bpm: 168, meter: METER, key: KEY, bars: 8,
      hook, genome: fixtureGenome(), progressionId: 'aeolian-vamp',
    };
    const revived = JSON.parse(JSON.stringify(spec)) as SongSpec;
    const mood = { urgency: 0.7, fortune: 0.3 };
    expect(renderSong(revived, mood).tracks.map((t) => t.motif.notes))
      .toEqual(renderSong(spec, mood).tracks.map((t) => t.motif.notes));
  });

  it('renders a playable arrangement at every corner from the spec alone', () => {
    const hook = generateHookSet(KEY, METER, makeRng(13), 1)[0]!;
    const spec: SongSpec = {
      version: 1, bpm: 168, meter: METER, key: KEY, bars: 8,
      hook, genome: fixtureGenome(), progressionId: 'aeolian-vamp',
    };
    const source = renderHook(spec.hook, spec.bars);
    for (const { mood, label } of MOOD_CORNERS) {
      expect(violations(renderSong(spec, mood), source, spec.bpm), label).toEqual([]);
    }
  });

  it('keeps the tune recognisable at every mood', () => {
    // Not note-identical: mood re-picks the progression, and a melody that fails the
    // contour floor once ornamented falls back to its bare skeleton, so the surface can
    // differ by an ornament. What must hold is that it is still the same tune.
    const hook = generateHookSet(KEY, METER, makeRng(14), 1)[0]!;
    const spec: SongSpec = {
      version: 1, bpm: 168, meter: METER, key: KEY, bars: 8,
      hook, genome: fixtureGenome(), progressionId: 'aeolian-vamp',
    };
    const source = renderHook(spec.hook, spec.bars);
    for (const mood of MOOD_GRID) {
      const melody = renderSong(spec, mood).tracks.find((t) => t.role === 'melody')!.motif;
      expect(contourSimilarity(melody, source), `${mood.urgency}/${mood.fortune}`).toBeGreaterThanOrEqual(CONTOUR_FLOOR);
      expect(renderSong(spec, mood).tracks.find((t) => t.role === 'melody')!.motif.notes[0]!.start).toBe(0);
    }
  });
});
