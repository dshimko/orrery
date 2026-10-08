// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawFace } from '../src/draw/index.js';
import {
  NICHE_HALF_HEIGHT,
  bellSwing,
  captionLayout,
  coinCount,
  freshShare,
  pupilRadius,
  showsRays,
  wrapCaption,
} from '../src/draw/figures.js';
import {
  BELL_SWING_AMPLITUDE,
  PUPIL_MAX_RADIUS,
  PUPIL_MIN_RADIUS,
  iconNicheBounds,
  type IconKind,
} from '../src/draw/icons.js';
import { geometryFor } from '../src/geometry.js';
import { createFaceModel, maxPipelinesAcross } from '../src/model/index.js';
import { settledSmooth } from '../src/smooth.js';
import { ORLOJ_STRINGS, type OrlojFace } from '../src/index.js';
import { createFakeContext } from './fake-canvas.js';
import { loadFaces, timeAt, visuals } from './fixture.js';

const NICHE_HALF_WIDTH = 27;
const MARGIN = 2;
const KINDS: IconKind[] = ['spend', 'freshness', 'incidents', 'consumers'];
const FIGURE_LABELS: Record<IconKind, string> = {
  spend: ORLOJ_STRINGS.canvas.figureSpend,
  freshness: ORLOJ_STRINGS.canvas.figureFreshness,
  incidents: ORLOJ_STRINGS.canvas.figureIncidents,
  consumers: ORLOJ_STRINGS.canvas.figureConsumers,
};

describe('icon extents', () => {
  for (const kind of KINDS) {
    it(`keeps the ${kind} icon inside its niche and above the caption value`, () => {
      const b = iconNicheBounds(kind);
      expect(b.minX).toBeGreaterThanOrEqual(-NICHE_HALF_WIDTH + MARGIN);
      expect(b.maxX).toBeLessThanOrEqual(NICHE_HALF_WIDTH - MARGIN);
      expect(b.minY).toBeGreaterThanOrEqual(-NICHE_HALF_HEIGHT + MARGIN);
      const lines = wrapCaption(FIGURE_LABELS[kind]).length;
      expect(b.maxY).toBeLessThan(captionLayout(lines).valueTop);
    });
  }
});

describe('encodings', () => {
  it('draws 1 to 4 coins by spend level', () => {
    expect([0, 0.25, 0.26, 0.5, 0.51, 0.75, 0.76, 1].map(coinCount)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it('fills the top sand by the share of spokes within target', () => {
    expect(freshShare(0, 8)).toBe(1);
    expect(freshShare(2, 8)).toBe(0.75);
    expect(freshShare(8, 8)).toBe(0);
    expect(freshShare(0, 0)).toBe(1);
  });

  it('sizes the pupil from 2.5 at no activity to 7 at full', () => {
    expect(pupilRadius(0)).toBe(PUPIL_MIN_RADIUS);
    expect(pupilRadius(0)).toBe(2.5);
    expect(pupilRadius(1)).toBe(PUPIL_MAX_RADIUS);
    expect(pupilRadius(1)).toBe(7);
    expect(pupilRadius(5)).toBe(7);
  });

  it('shows rays only above 45% activity', () => {
    expect(showsRays(0.45)).toBe(false);
    expect(showsRays(0.46)).toBe(true);
    expect(showsRays(0)).toBe(false);
  });

  it('swings the bell only while the bell is ringing', () => {
    expect(bellSwing(0, 0.17)).toBe(0);
    expect(Math.abs(bellSwing(1, 0.17))).toBeGreaterThan(0);
    for (let t = 0; t < 10; t += 0.13) {
      expect(Math.abs(bellSwing(1, t))).toBeLessThanOrEqual(BELL_SWING_AMPLITUDE);
    }
  });
});

describe('drawn icons', () => {
  let faces: OrlojFace[];
  beforeAll(async () => {
    faces = await loadFaces();
  });
  afterEach(() => vi.unstubAllGlobals());

  function figureCalls(
    change: (m: ReturnType<typeof createFaceModel>) => ReturnType<typeof createFaceModel>,
    deco = 0.17,
  ): string[] {
    const { ctx, calls } = createFakeContext();
    const base = createFaceModel(
      faces[2] as OrlojFace,
      timeAt('2026-10-07T10:45:00Z'),
      visuals,
      maxPipelinesAcross(faces),
    );
    const model = change(base);
    drawFace(ctx, model, {
      visuals,
      geo: geometryFor(visuals),
      deco,
      smooth: settledSmooth(model),
    });
    return calls;
  }

  const count = (calls: string[], call: string): number => calls.filter((c) => c === call).length;

  const withFigures =
    (patch: Partial<ReturnType<typeof createFaceModel>['figures']>) =>
    (m: ReturnType<typeof createFaceModel>) => ({ ...m, figures: { ...m.figures, ...patch } });

  it('colors the hourglass amber when spokes are late and gold otherwise', () => {
    const late = figureCalls(withFigures({ spokesPastTarget: 2, spokeCount: 8 }));
    const none = figureCalls(withFigures({ spokesPastTarget: 0, spokeCount: 8 }));
    const amber = `set strokeStyle=${visuals.colors.warning}`;
    expect(count(late, amber)).toBeGreaterThan(count(none, amber));
  });

  it('colors the bell red for incidents, amber for warnings only', () => {
    const incident = figureCalls(
      withFigures({
        openIncidents: 1,
        incidentLevel: 'incident',
        incidentColor: visuals.colors.incident,
      }),
    );
    const warning = figureCalls(
      withFigures({
        openIncidents: 1,
        incidentLevel: 'warning',
        incidentColor: visuals.colors.warning,
      }),
    );
    const red = `set strokeStyle=${visuals.colors.incident}`;
    expect(count(incident, red)).toBeGreaterThan(count(warning, red));
  });

  it('rings only when incidents are open, and rotates by zero otherwise', () => {
    const quiet = figureCalls(withFigures({ openIncidents: 0, incidentLevel: 'none' }));
    const ringing = figureCalls(
      withFigures({
        openIncidents: 2,
        incidentLevel: 'incident',
        incidentColor: visuals.colors.incident,
      }),
    );
    expect(quiet).toContain('rotate(0)');
    expect(ringing.some((c) => c.startsWith('rotate(') && c !== 'rotate(0)')).toBe(true);
  });

  it('draws icon paths with Path2D when the environment has it', () => {
    class FakePath2D {
      constructor(readonly d: string) {}
    }
    vi.stubGlobal('Path2D', FakePath2D);
    const withPaths = figureCalls(withFigures({}));
    expect(withPaths.filter((c) => c === 'stroke(obj)').length).toBeGreaterThan(8);
    vi.unstubAllGlobals();
    const without = figureCalls(withFigures({}));
    expect(without.filter((c) => c === 'stroke(obj)')).toHaveLength(0);
  });
});
