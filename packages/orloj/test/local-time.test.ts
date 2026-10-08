// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { geometryFor } from '../src/geometry.js';
import { createFaceModel, faceHits, maxPipelinesAcross } from '../src/model/index.js';
import { localizeUtcText, utcWithLocal } from '../src/model/local-time.js';
import type { OrlojFace } from '../src/index.js';
import { loadFaces, timeAt, visuals } from './fixture.js';

const NEW_YORK = { at: new Date('2026-10-07T10:45:00Z'), timeZone: 'America/New_York' };
const UTC = { at: new Date('2026-10-07T10:45:00Z'), timeZone: 'UTC' };

describe('utcWithLocal', () => {
  it('appends the local range and zone for a window', () => {
    expect(utcWithLocal(630, 750, NEW_YORK)).toBe('10:30–12:30 UTC (06:30–08:30 EDT)');
  });

  it('appends the local time for a single instant', () => {
    expect(utcWithLocal(645, undefined, NEW_YORK)).toBe('10:45 UTC (06:45 EDT)');
  });

  it('does not duplicate when the zone is UTC', () => {
    expect(utcWithLocal(630, 750, UTC)).toBe('10:30–12:30 UTC');
    expect(utcWithLocal(645, undefined, UTC)).toBe('10:45 UTC');
  });

  it('is UTC only without a context or with an unknown zone', () => {
    expect(utcWithLocal(645, undefined, undefined)).toBe('10:45 UTC');
    expect(utcWithLocal(645, undefined, { ...UTC, timeZone: 'Not/AZone' })).toBe('10:45 UTC');
  });

  it('uses the offset in force on the anchor date (standard time in winter)', () => {
    const winter = { at: new Date('2026-12-07T10:45:00Z'), timeZone: 'America/New_York' };
    expect(utcWithLocal(645, undefined, winter)).toBe('10:45 UTC (05:45 EST)');
  });

  it('wraps local hours past midnight', () => {
    expect(utcWithLocal(30, undefined, NEW_YORK)).toBe('00:30 UTC (20:30 EDT)');
  });
});

describe('localizeUtcText', () => {
  it('rewrites only the matching UTC time token', () => {
    expect(localizeUtcText('Batch at 10:45 UTC', 645, NEW_YORK)).toBe(
      'Batch at 10:45 UTC (06:45 EDT)',
    );
    expect(localizeUtcText('Batch at 10:45 UTC', 645, undefined)).toBe('Batch at 10:45 UTC');
  });
});

describe('tooltip text with local time', () => {
  let faces: OrlojFace[];
  beforeAll(async () => {
    faces = await loadFaces();
  });

  function hitTexts(timeZone: string | null): Map<string, string> {
    const prod = faces[2] as OrlojFace;
    const model = createFaceModel(
      prod,
      timeAt('2026-10-07T10:45:00Z'),
      visuals,
      maxPipelinesAcross(faces),
    );
    const local =
      timeZone === null ? undefined : { at: new Date('2026-10-07T10:45:00Z'), timeZone };
    return new Map(
      faceHits(model, geometryFor(visuals), new Map(), local).map((h) => [h.part, h.text]),
    );
  }

  it('adds local time to the sun hand, arcs, ticks, and star hand', () => {
    const texts = hitTexts('America/New_York');
    expect(texts.get('sun-hand')).toContain('10:45 UTC (06:45 EDT)');
    const arc = [...texts].find(([part]) => part.startsWith('arc:'));
    expect(arc?.[1]).toMatch(/\d\d:\d\d–\d\d:\d\d UTC \(\d\d:\d\d–\d\d:\d\d E[SD]T\)\.$/);
    expect(texts.get('star-hand') ?? '').toMatch(/UTC \(\d\d:\d\d E[SD]T\)/);
    const tick = [...texts].find(([part]) => part.startsWith('tick:'));
    expect(tick?.[1]).toMatch(/UTC \(\d\d:\d\d E[SD]T\): /);
  });

  it('leaves UTC times alone when the zone is UTC', () => {
    const texts = hitTexts('UTC');
    for (const [part, text] of texts) expect(text, part).not.toMatch(/UTC \(/);
    expect(texts.get('sun-hand')).toContain('10:45 UTC.');
  });
});
