// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { findHit, MIN_HIT_RADIUS_PX, toPixelHits } from '../src/hit-test.js';
import { describeFaces } from '../src/aria.js';
import { nextLate, settledSmooth, stepSmooth } from '../src/smooth.js';
import { createFaceModel } from '../src/model/index.js';
import type { OrlojFace } from '../src/index.js';
import { loadFace, timeAt, visuals } from './fixture.js';

describe('nextLate (3% hysteresis)', () => {
  it('does not flip near the threshold', () => {
    expect(nextLate(false, true, 101, 100, 0.03)).toBe(false);
    expect(nextLate(false, true, 104, 100, 0.03)).toBe(true);
    expect(nextLate(true, false, 99, 100, 0.03)).toBe(true);
    expect(nextLate(true, false, 96, 100, 0.03)).toBe(false);
    expect(nextLate(true, true, 50, 100, 0.03)).toBe(true);
  });
});

describe('stepSmooth', () => {
  async function setup(): Promise<{
    face: OrlojFace;
    modelAt: (f: OrlojFace) => ReturnType<typeof createFaceModel>;
  }> {
    const face = await loadFace('prod');
    return {
      face,
      modelAt: (f) => createFaceModel(f, timeAt('2026-10-07T10:45:00Z'), visuals, 150),
    };
  }

  it('stays put when already at the targets', async () => {
    const { face, modelAt } = await setup();
    const m = modelAt(face);
    const s0 = settledSmooth(m);
    expect(stepSmooth(s0, m, 0.016, visuals)).toEqual(s0);
  });

  it('approaches new targets exponentially without overshoot or jumps', async () => {
    const { face, modelAt } = await setup();
    const start = settledSmooth(modelAt(face));
    const moved = {
      ...face,
      snapshot: {
        ...(face.snapshot as NonNullable<OrlojFace['snapshot']>),
        backlog: 1,
        spendPerHour: 5000,
      },
    };
    const m = modelAt(moved);
    const one = stepSmooth(start, m, 0.1, visuals);
    const rate = visuals.stability.approachRate;
    const expected = start.moon + (1 - start.moon) * (1 - Math.exp(-rate * 0.1));
    expect(one.moon).toBeCloseTo(expected, 10);
    expect(one.moon).toBeLessThan(1);
    expect(one.purse).toBeGreaterThan(start.purse);
    let s = one;
    for (let i = 0; i < 300; i += 1) s = stepSmooth(s, m, 0.05, visuals);
    expect(s.moon).toBeCloseTo(1, 4);
    expect(s.purse).toBeCloseTo(1, 4);
  });
});

describe('hit testing and aria', () => {
  it('uses at least the minimum radius and prefers the nearest center', () => {
    const px = toPixelHits(
      'prod',
      [
        { part: 'a', title: 't', text: 'x', x: 10, y: 10, r: 2 },
        { part: 'b', title: 't', text: 'x', x: 14, y: 10, r: 2 },
      ],
      100,
      50,
      0.5,
    );
    expect(px[0]).toMatchObject({ envId: 'prod', x: 105, y: 55, r: MIN_HIT_RADIUS_PX });
    expect(findHit(px, 106, 55)?.part).toBe('b');
    expect(findHit(px, 104, 55)?.part).toBe('a');
    expect(findHit(px, 500, 500)).toBeNull();
  });

  it('summarizes every face by name, incidents, and spokes past target', async () => {
    const face = await loadFace('prod');
    const m = createFaceModel(face, timeAt('2026-10-07T10:45:00Z'), visuals, 150);
    const err = createFaceModel(
      { ...face, error: 'x' },
      timeAt('2026-10-07T10:45:00Z'),
      visuals,
      150,
    );
    const label = describeFaces([m, err]);
    expect(label).toContain('PROD: 1 open incident, 0 spokes past target');
    expect(label).toContain('PROD: no data');
    expect(describeFaces([])).toContain('No environments');
  });
});
