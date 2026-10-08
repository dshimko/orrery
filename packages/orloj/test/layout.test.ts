// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { faceAt, faceOrigin, orlojLayout } from '../src/layout.js';
import { visuals } from './fixture.js';

const FACE_W = 440;
const FACE_H = 820;

describe('orlojLayout', () => {
  it.each([
    [1150, 3],
    [1149, 2],
    [720, 2],
    [719, 1],
    [400, 1],
  ])('uses the right column count at %i px', (width, columns) => {
    expect(orlojLayout(width, 6, visuals).columns).toBe(columns);
  });

  it('never uses more columns than faces', () => {
    expect(orlojLayout(1600, 2, visuals).columns).toBe(2);
    expect(orlojLayout(1600, 1, visuals).columns).toBe(1);
  });

  it('caps scale at maxScale and fits narrow widths', () => {
    expect(orlojLayout(3000, 3, visuals).scale).toBe(1.25);
    expect(orlojLayout(1150, 3, visuals).scale).toBeCloseTo(1150 / (3 * FACE_W), 10);
    expect(orlojLayout(360, 3, visuals).scale).toBeCloseTo(360 / FACE_W, 10);
  });

  it('computes height as rows times face height times scale', () => {
    const layout = orlojLayout(1149, 3, visuals);
    expect(layout.columns).toBe(2);
    expect(layout.height).toBeCloseTo(2 * FACE_H * layout.scale, 8);
  });

  it('handles an empty face list', () => {
    expect(orlojLayout(1000, 0, visuals)).toMatchObject({ columns: 1, height: 0 });
  });

  it('places faces on a centered grid and finds the face under a point', () => {
    const layout = orlojLayout(3000, 3, visuals);
    const gridWidth = 3 * FACE_W * layout.scale;
    const first = faceOrigin(layout, 0, visuals);
    expect(first.x).toBeCloseTo((3000 - gridWidth) / 2, 8);
    const second = faceOrigin(layout, 1, visuals);
    expect(second.x - first.x).toBeCloseTo(FACE_W * layout.scale, 8);
    expect(faceAt(layout, 3, second.x + 5, 5, visuals)).toBe(1);
    expect(faceAt(layout, 3, 1, 5, visuals)).toBe(-1);
  });
});
