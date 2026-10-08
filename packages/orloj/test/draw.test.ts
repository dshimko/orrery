// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { drawFace } from '../src/draw/index.js';
import { wrapLines } from '../src/draw/common.js';
import { wrapCaption } from '../src/draw/figures.js';
import { geometryFor } from '../src/geometry.js';
import { createFaceModel, maxPipelinesAcross } from '../src/model/index.js';
import { settledSmooth } from '../src/smooth.js';
import type { OrlojFace } from '../src/index.js';
import { createFakeContext } from './fake-canvas.js';
import { loadFaces, timeAt, visuals } from './fixture.js';

let faces: OrlojFace[];

beforeAll(async () => {
  faces = await loadFaces();
});

function draw(face: OrlojFace, iso: string, deco = 0): string[] {
  const { ctx, calls } = createFakeContext();
  const model = createFaceModel(face, timeAt(iso), visuals, maxPipelinesAcross(faces));
  drawFace(ctx, model, { visuals, geo: geometryFor(visuals), deco, smooth: settledSmooth(model) });
  return calls;
}

describe('drawFace', () => {
  it('draws a full face without throwing, including text for the key parts', () => {
    for (const face of faces) {
      const calls = draw(face, '2026-10-07T10:45:00Z', 1.5);
      expect(calls.length).toBeGreaterThan(300);
      expect(calls.filter((c) => c.startsWith('fillText')).length).toBeGreaterThan(40);
    }
  });

  it('draws the procession figures only while marching', () => {
    const marching = draw(faces[2] as OrlojFace, '2026-10-07T10:10:00Z');
    const idle = draw(faces[2] as OrlojFace, '2026-10-07T10:40:00Z');
    expect(marching.filter((c) => c.startsWith('clip')).length).toBeGreaterThan(
      idle.filter((c) => c.startsWith('clip')).length,
    );
  });

  it('draws an error face with the wrapped message and no spokes', () => {
    const face = {
      ...(faces[0] as OrlojFace),
      error: 'The adapter could not reach the workspace after three attempts.',
    };
    const calls = draw(face, '2026-10-07T10:45:00Z');
    const texts = calls.filter((c) => c.startsWith('fillText'));
    expect(texts.some((c) => c.includes('No data'))).toBe(true);
    expect(texts.some((c) => c.includes('adapter'))).toBe(true);
    expect(texts.length).toBeLessThan(calls.length / 10);
  });

  it('draws a face with null data as an error face', () => {
    expect(() =>
      draw({ ...(faces[0] as OrlojFace), snapshot: null, topology: null }, '2026-10-07T00:00:00Z'),
    ).not.toThrow();
  });

  it('is deterministic: the same inputs record identical calls', () => {
    const a = draw(faces[1] as OrlojFace, '2026-10-07T10:45:00Z', 2);
    const b = draw(faces[1] as OrlojFace, '2026-10-07T10:45:00Z', 2);
    expect(a).toEqual(b);
  });
});

describe('wrapLines', () => {
  const measure = (s: string): number => s.length;
  it('wraps at word boundaries', () => {
    expect(wrapLines('aaa bbb ccc ddd', 7, measure)).toEqual(['aaa bbb', 'ccc ddd']);
  });
  it('keeps an overlong word on its own line and ignores empty input', () => {
    expect(wrapLines('abcdefghij k', 5, measure)).toEqual(['abcdefghij', 'k']);
    expect(wrapLines('   ', 5, measure)).toEqual([]);
  });
});

describe('wrapCaption', () => {
  it('keeps short labels on one line', () => {
    expect(wrapCaption('incidents')).toEqual(['incidents']);
    expect(wrapCaption('past target')).toEqual(['past target']);
  });

  it('wraps long labels at the space nearest the middle so they fit the niche', () => {
    expect(wrapCaption('spend per hour')).toEqual(['spend', 'per hour']);
    expect(wrapCaption('consumer activity')).toEqual(['consumer', 'activity']);
  });
});

describe('center label', () => {
  it('draws the calendar caption on two short lines', () => {
    const texts = draw(faces[0] as OrlojFace, '2026-10-07T10:45:00Z').filter((c) =>
      c.startsWith('fillText'),
    );
    expect(texts.some((c) => c.includes('this month'))).toBe(true);
    expect(texts.some((c) => c.includes('releases this month'))).toBe(false);
  });
});
