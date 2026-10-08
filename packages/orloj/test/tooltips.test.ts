// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { drawFace } from '../src/draw/index.js';
import { geometryFor } from '../src/geometry.js';
import { createFaceModel, faceHits, maxPipelinesAcross } from '../src/model/index.js';
import { settledSmooth } from '../src/smooth.js';
import { ORLOJ_STRINGS, type OrlojFace, type OrlojPart } from '../src/index.js';
import { createFakeContext } from './fake-canvas.js';
import { loadFaces, timeAt, visuals } from './fixture.js';

const ACTION = 'Click the face to open the system view.';
const geo = geometryFor(visuals);
const ISO = '2026-10-07T10:45:00Z';
let faces: OrlojFace[];

beforeAll(async () => {
  faces = await loadFaces();
});

function modelOf(face: OrlojFace) {
  return createFaceModel(face, timeAt(ISO), visuals, maxPipelinesAcross(faces));
}

function partOf(key: string): OrlojPart | 'plaque' | null {
  const prefix = key.split(':')[0] ?? key;
  const map: Record<string, OrlojPart | 'plaque'> = {
    'sun-hand': 'sun-hand',
    arc: 'arcs',
    spoke: 'spokes',
    moon: 'moon',
    'star-hand': 'star-hand',
    noon: 'noon-suns',
    procession: 'procession',
    spend: 'spend',
    freshness: 'freshness',
    incidents: 'incidents',
    consumers: 'consumers',
    calendar: 'calendar',
    rooster: 'rooster',
    plaque: 'plaque',
  };
  return map[prefix] ?? null;
}

describe('tooltips', () => {
  it('gives every part definition + current value + action', () => {
    const seen = new Set<string>();
    for (const face of faces) {
      for (const hit of faceHits(modelOf(face), geo, new Map())) {
        const part = partOf(hit.part);
        if (!part) continue;
        seen.add(part);
        const definition =
          part === 'plaque'
            ? ORLOJ_STRINGS.hit.plaqueDefinition
            : ORLOJ_STRINGS.parts[part].definition;
        expect(hit.text, hit.part).toContain(definition);
        expect(hit.text, hit.part).toContain(' Now: ');
        expect(hit.text.endsWith(ACTION), hit.part).toBe(true);
        expect(hit.text, hit.part).not.toMatch(/\.\./);
        expect(hit.text, hit.part).not.toMatch(/\{\w+\}/);
      }
    }
    for (const part of [
      'sun-hand',
      'arcs',
      'spokes',
      'moon',
      'star-hand',
      'noon-suns',
      'procession',
      'spend',
      'freshness',
      'incidents',
      'consumers',
      'calendar',
      'rooster',
      'plaque',
    ]) {
      expect(seen.has(part), part).toBe(true);
    }
  });

  it('puts the live value in the tooltip', () => {
    const prod = faces[2] as OrlojFace;
    const texts = new Map(faceHits(modelOf(prod), geo, new Map()).map((h) => [h.part, h.text]));
    expect(texts.get('sun-hand')).toContain('Now: 10:45 UTC.');
    expect(texts.get('spend')).toMatch(/Now: \d+ compute units per hour/);
    expect(texts.get('plaque')).toContain('Now: tier prod.');
  });

  it('says the reason instead of a value when the source is unavailable', () => {
    const prod = faces[2] as OrlojFace;
    if (!prod.snapshot) throw new Error('no snapshot');
    const reasons = {
      schedule: 'No schedule data from this adapter.',
      calendar: 'No release calendar from this adapter.',
      spend: 'No spend data from this adapter.',
      backlog: 'No backlog from this adapter.',
      consumers: 'No consumers from this adapter.',
    };
    const face: OrlojFace = {
      ...prod,
      snapshot: { ...prod.snapshot, schedule: [], unavailable: reasons },
    };
    const hits = new Map(faceHits(modelOf(face), geo, new Map()).map((h) => [h.part, h.text]));
    const expected: Record<string, [OrlojPart, string]> = {
      spend: ['spend', reasons.spend],
      moon: ['moon', reasons.backlog],
      consumers: ['consumers', reasons.consumers],
      calendar: ['calendar', reasons.calendar],
    };
    for (const [key, [part, reason]] of Object.entries(expected)) {
      const text = hits.get(key) ?? '';
      expect(text, key).toContain(ORLOJ_STRINGS.parts[part].definition);
      expect(text, key).toContain(reason);
      expect(text, key).not.toContain('Now:');
      expect(text.endsWith(ACTION), key).toBe(true);
    }
    expect([...hits.keys()].some((k) => k.startsWith('calendar-day:'))).toBe(false);
    expect(hits.get('procession')).toContain(reasons.schedule);
    expect(hits.get('freshness')).toContain('Now:');
  });

  it('uses the default reason when the adapter names a part without one', () => {
    const prod = faces[2] as OrlojFace;
    if (!prod.snapshot) throw new Error('no snapshot');
    const face = { ...prod, snapshot: { ...prod.snapshot, unavailable: { spend: '' } } };
    const spend = faceHits(modelOf(face), geo, new Map()).find((h) => h.part === 'spend');
    expect(spend?.text).toContain(ORLOJ_STRINGS.unavailable.spend);
  });

  it('applies string overrides', () => {
    const prod = faces[2] as OrlojFace;
    const strings = {
      ...ORLOJ_STRINGS,
      tooltipWithValue: '{definition} | {value}',
    };
    const moon = faceHits(modelOf(prod), geo, new Map(), undefined, strings).find(
      (h) => h.part === 'moon',
    );
    expect(moon?.text.startsWith(ORLOJ_STRINGS.parts.moon.definition)).toBe(true);
    expect(moon?.text).toMatch(/ \| \d+% of the bronze yard in use$/);
  });
});

describe('permanent labels', () => {
  function drawn(face: OrlojFace, showLabels?: boolean): string[] {
    const { ctx, calls } = createFakeContext();
    const model = modelOf(face);
    drawFace(ctx, model, {
      visuals,
      geo,
      deco: 0,
      smooth: settledSmooth(model),
      ...(showLabels === undefined ? {} : { showLabels }),
    });
    return calls;
  }
  const hasText = (calls: readonly string[], value: string): boolean =>
    calls.some((c) => c.startsWith(`fillText(${value},`));

  it('draws UTC now, fresher, and next on a data face', () => {
    const calls = drawn(faces[2] as OrlojFace);
    for (const label of ['UTC now', 'fresher', 'next'])
      expect(hasText(calls, label), label).toBe(true);
  });

  it('draws nothing when labels are turned off', () => {
    const calls = drawn(faces[2] as OrlojFace, false);
    for (const label of ['UTC now', 'fresher', 'next'])
      expect(hasText(calls, label), label).toBe(false);
  });

  it('does not draw on error faces', () => {
    const calls = drawn({ ...(faces[2] as OrlojFace), error: 'boom' });
    for (const label of ['UTC now', 'fresher', 'next'])
      expect(hasText(calls, label), label).toBe(false);
  });

  it('omits "next" when nothing is scheduled', () => {
    const prod = faces[2] as OrlojFace;
    if (!prod.snapshot) throw new Error('no snapshot');
    const calls = drawn({ ...prod, snapshot: { ...prod.snapshot, schedule: [] } });
    expect(hasText(calls, 'next')).toBe(false);
    expect(hasText(calls, 'UTC now')).toBe(true);
  });
});
