// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { geometryFor } from '../src/geometry.js';
import { orlojLayout } from '../src/layout.js';
import {
  MARKER_RADIUS,
  annotationAnchors,
  createFaceModel,
  firstLoadedIndex,
  labelSide,
  maxPipelinesAcross,
} from '../src/model/index.js';
import { ORLOJ_PARTS, legendEntries, type OrlojFace } from '../src/index.js';
import { loadFaces, timeAt, visuals } from './fixture.js';

const geo = geometryFor(visuals);
let faces: OrlojFace[];

beforeAll(async () => {
  faces = await loadFaces();
});

const modelOf = (face: OrlojFace) =>
  createFaceModel(face, timeAt('2026-10-07T10:45:00Z'), visuals, maxPipelinesAcross(faces));

describe('annotationAnchors', () => {
  it('places a numbered anchor for every part, inside the face, in legend order', () => {
    const anchors = annotationAnchors(
      modelOf(faces[2] as OrlojFace),
      geo,
      legendEntries(faces),
      'right',
    );
    expect(anchors.map((a) => a.part)).toEqual([...ORLOJ_PARTS]);
    expect(anchors.map((a) => a.number)).toEqual(ORLOJ_PARTS.map((_, i) => i + 1));
    for (const a of anchors) {
      for (const p of [a.marker, a.target]) {
        expect(p.x - MARKER_RADIUS, a.part).toBeGreaterThanOrEqual(0);
        expect(p.x + MARKER_RADIUS, a.part).toBeLessThanOrEqual(geo.faceW);
        expect(p.y - MARKER_RADIUS, a.part).toBeGreaterThanOrEqual(0);
        expect(p.y + MARKER_RADIUS, a.part).toBeLessThanOrEqual(geo.faceH);
      }
    }
  });

  it('keeps markers from overlapping each other', () => {
    const anchors = annotationAnchors(
      modelOf(faces[2] as OrlojFace),
      geo,
      legendEntries(faces),
      'none',
    );
    for (const [i, a] of anchors.entries()) {
      for (const b of anchors.slice(i + 1)) {
        const d = Math.hypot(a.marker.x - b.marker.x, a.marker.y - b.marker.y);
        expect(d, `${a.part} vs ${b.part}`).toBeGreaterThanOrEqual(MARKER_RADIUS * 1.6);
      }
    }
  });

  it('spreads labels down the neighbor area, ordered by marker height, right of the face', () => {
    const anchors = annotationAnchors(
      modelOf(faces[0] as OrlojFace),
      geo,
      legendEntries(faces),
      'right',
    );
    const byLabel = [...anchors].sort((a, b) => (a.label?.y ?? 0) - (b.label?.y ?? 0));
    const markerYs = byLabel.map((a) => a.marker.y);
    expect(markerYs).toEqual([...markerYs].sort((a, b) => a - b));
    for (const a of anchors) {
      expect(a.label?.x).toBeGreaterThan(geo.faceW);
      expect(a.label?.align).toBe('left');
    }
    const left = annotationAnchors(
      modelOf(faces[0] as OrlojFace),
      geo,
      legendEntries(faces),
      'left',
    );
    expect(left.every((a) => (a.label?.x ?? 1) < 0 && a.label?.align === 'right')).toBe(true);
  });

  it('gives markers only (no labels) when there is no neighbor', () => {
    const anchors = annotationAnchors(
      modelOf(faces[0] as OrlojFace),
      geo,
      legendEntries(faces),
      'none',
    );
    expect(anchors.length).toBe(ORLOJ_PARTS.length);
    expect(anchors.every((a) => a.label === null)).toBe(true);
  });

  it('skips parts with an unavailable reason and keeps legend numbers', () => {
    const lacking = faces.map((f) =>
      f.snapshot ? { ...f, snapshot: { ...f.snapshot, unavailable: { spend: 'none' } } } : f,
    );
    const anchors = annotationAnchors(
      modelOf(lacking[2] as OrlojFace),
      geo,
      legendEntries(lacking),
      'right',
    );
    expect(anchors.some((a) => a.part === 'spend')).toBe(false);
    expect(anchors.length).toBe(ORLOJ_PARTS.length - 1);
    expect(anchors.find((a) => a.part === 'freshness')?.number).toBe(
      ORLOJ_PARTS.indexOf('freshness') + 1,
    );
  });

  it('skips parts the face has no data for', () => {
    const prod = faces[2] as OrlojFace;
    if (!prod.snapshot) throw new Error('no snapshot');
    const bare = { ...prod, snapshot: { ...prod.snapshot, schedule: [] } };
    const parts = annotationAnchors(modelOf(bare), geo, legendEntries([bare]), 'none').map(
      (a) => a.part,
    );
    expect(parts).not.toContain('arcs');
    expect(parts).not.toContain('star-hand');
    expect(parts).toContain('sun-hand');
  });

  it('returns nothing for an error face', () => {
    const error = modelOf({ ...(faces[0] as OrlojFace), error: 'boom' });
    expect(annotationAnchors(error, geo, legendEntries(faces), 'right')).toEqual([]);
  });
});

describe('labelSide and firstLoadedIndex', () => {
  it('chooses the right neighbor, then the left, and none at one column', () => {
    const wide = orlojLayout(1200, 3, visuals);
    expect(labelSide(wide, 0, 3)).toBe('right');
    expect(labelSide(wide, 1, 3)).toBe('right');
    expect(labelSide(wide, 2, 3)).toBe('left');
    expect(labelSide(orlojLayout(600, 3, visuals), 0, 3)).toBe('none');
    expect(labelSide(orlojLayout(1200, 1, visuals), 0, 1)).toBe('none');
  });

  it('finds the first face that is not an error face', () => {
    const error = modelOf({ ...(faces[0] as OrlojFace), error: 'boom' });
    expect(firstLoadedIndex([error, modelOf(faces[1] as OrlojFace)])).toBe(1);
    expect(firstLoadedIndex([error])).toBe(-1);
  });
});
