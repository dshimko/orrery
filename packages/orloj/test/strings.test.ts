// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ORLOJ_PARTS,
  ORLOJ_STRINGS,
  fill,
  legendEntries,
  resolveStrings,
  type OrlojFace,
} from '../src/index.js';
import { drawFace } from '../src/draw/index.js';
import { geometryFor } from '../src/geometry.js';
import { describeFaces } from '../src/aria.js';
import { createFaceModel, maxPipelinesAcross } from '../src/model/index.js';
import { settledSmooth } from '../src/smooth.js';
import { createFakeContext } from './fake-canvas.js';
import { loadFaces, timeAt, visuals } from './fixture.js';

let faces: OrlojFace[];
beforeAll(async () => {
  faces = await loadFaces();
});

function without(face: OrlojFace, unavailable: Record<string, string>): OrlojFace {
  if (!face.snapshot) throw new Error('fixture face has no snapshot');
  return { ...face, snapshot: { ...face.snapshot, unavailable } };
}

function leafStrings(value: unknown, path = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [[path, value]];
  return Object.entries(value).flatMap(([k, v]) =>
    leafStrings(v, path === '' ? k : `${path}.${k}`),
  );
}

describe('ORLOJ_STRINGS', () => {
  it('gives every part a name, a short gloss, and a definition', () => {
    expect(ORLOJ_PARTS.length).toBe(14);
    for (const part of ORLOJ_PARTS) {
      const s = ORLOJ_STRINGS.parts[part];
      expect(s.name.trim(), part).not.toBe('');
      expect(s.short.trim(), part).not.toBe('');
      expect(s.definition.trim(), part).not.toBe('');
      expect(s.short.length, part).toBeLessThanOrEqual(52);
    }
  });

  it('has no empty or non-string values anywhere', () => {
    for (const [path, value] of leafStrings(ORLOJ_STRINGS)) {
      expect(typeof value, path).toBe('string');
      expect((value as string).trim(), path).not.toBe('');
    }
  });

  it('carries the permanent labels and the tooltip templates', () => {
    expect(ORLOJ_STRINGS.labelSunNow).toBe('UTC now');
    expect(ORLOJ_STRINGS.labelFresher).toBe('fresher');
    expect(ORLOJ_STRINGS.labelNext).toBe('next');
    expect(ORLOJ_STRINGS.tooltipWithValue).toBe(
      '{definition} Now: {value}. Click the face to open the system view.',
    );
  });
});

describe('fill', () => {
  it('replaces every placeholder, numbers included', () => {
    expect(fill('{a} of {b}, {a} again', { a: 3, b: 'x' })).toBe('3 of x, 3 again');
  });

  it('leaves a placeholder with no value visible', () => {
    expect(fill('hello {missing}', {})).toBe('hello {missing}');
  });
});

describe('resolveStrings', () => {
  it('returns the defaults without overrides', () => {
    expect(resolveStrings()).toBe(ORLOJ_STRINGS);
  });

  it('merges overrides over the defaults one nested key at a time', () => {
    const merged = resolveStrings({
      labelNext: 'dalsi',
      parts: { moon: { name: 'Mesic' } },
      unavailable: { spend: 'Zadna data.' },
      hit: { spendTitle: 'Naklady' },
    });
    expect(merged.labelNext).toBe('dalsi');
    expect(merged.labelSunNow).toBe(ORLOJ_STRINGS.labelSunNow);
    expect(merged.parts.moon.name).toBe('Mesic');
    expect(merged.parts.moon.definition).toBe(ORLOJ_STRINGS.parts.moon.definition);
    expect(merged.parts['sun-hand']).toEqual(ORLOJ_STRINGS.parts['sun-hand']);
    expect(merged.unavailable.spend).toBe('Zadna data.');
    expect(merged.unavailable.schedule).toBe(ORLOJ_STRINGS.unavailable.schedule);
    expect(merged.hit.spendTitle).toBe('Naklady');
    expect(ORLOJ_STRINGS.labelNext).toBe('next');
  });

  it('ignores undefined override values', () => {
    expect(resolveStrings({ labelNext: undefined } as never).labelNext).toBe('next');
  });
});

describe('legendEntries', () => {
  it('numbers one entry per part from 1, in teaching order', () => {
    const entries = legendEntries(faces);
    expect(entries.map((e) => e.part)).toEqual([...ORLOJ_PARTS]);
    expect(entries.map((e) => e.number)).toEqual(ORLOJ_PARTS.map((_, i) => i + 1));
    for (const e of entries) {
      expect(e.name).toBe(ORLOJ_STRINGS.parts[e.part].name);
      expect(e.definition).toBe(ORLOJ_STRINGS.parts[e.part].definition);
      expect(e.unavailableReason, e.part).toBeUndefined();
    }
  });

  it('uses overridden strings', () => {
    expect(legendEntries(faces, { parts: { rooster: { name: 'Kohout' } } }).at(-1)?.name).toBe(
      'Kohout',
    );
  });

  it('sets the adapter reason on parts whose source every loaded face lacks', () => {
    const reason = 'No schedule data from this adapter.';
    const all = faces.map((f) => without(f, { schedule: reason }));
    const byPart = new Map(legendEntries(all).map((e) => [e.part, e]));
    expect(byPart.get('arcs')?.unavailableReason).toBe(reason);
    expect(byPart.get('star-hand')?.unavailableReason).toBe(reason);
    expect(byPart.get('spokes')?.unavailableReason).toBeUndefined();
    expect(byPart.get('calendar')?.unavailableReason).toBeUndefined();
  });

  it('keeps a part available when any loaded face has its data', () => {
    const mixed = [without(faces[0] as OrlojFace, { schedule: 'none' }), ...faces.slice(1)];
    const arcs = legendEntries(mixed).find((e) => e.part === 'arcs');
    expect(arcs?.unavailableReason).toBeUndefined();
  });

  it('maps every source to its parts and falls back to the default reason', () => {
    const all = faces.map((f) =>
      without(f, { calendar: 'c', spend: 's', backlog: 'b', consumers: ' ' }),
    );
    const byPart = new Map(legendEntries(all).map((e) => [e.part, e.unavailableReason]));
    expect(byPart.get('calendar')).toBe('c');
    expect(byPart.get('spend')).toBe('s');
    expect(byPart.get('moon')).toBe('b');
    expect(byPart.get('consumers')).toBe(ORLOJ_STRINGS.unavailable.consumers);
  });

  it('ignores error faces and faces without a snapshot when judging availability', () => {
    const lacking = without(faces[0] as OrlojFace, { schedule: 'none' });
    const noisy = [
      lacking,
      { ...(faces[1] as OrlojFace), error: 'boom' },
      { ...(faces[2] as OrlojFace), snapshot: null },
    ];
    expect(legendEntries(noisy).find((e) => e.part === 'arcs')?.unavailableReason).toBe('none');
  });

  it('reports no reasons when no face is loaded', () => {
    const none = legendEntries([{ ...(faces[0] as OrlojFace), error: 'boom' }]);
    expect(none.every((e) => e.unavailableReason === undefined)).toBe(true);
    expect(legendEntries([]).length).toBe(14);
  });
});

describe('overrides reach model, aria, and canvas text', () => {
  const strings = resolveStrings({
    model: {
      noData: 'Zadna data.',
      nothingScheduled: 'Nic',
      utc: 'UTCX',
      severityIncident: 'Zavada',
    },
    aria: { prefix: 'Hodiny.', noEnvironments: 'Zadna prostredi.' },
    canvas: { calendarTitle: 'Kalendar', figureSpend: 'naklady' },
  });
  const at = timeAt('2026-10-07T10:45:00Z');

  it('uses overridden model text for error faces, schedule text, and the star label', () => {
    const face = faces[2] as OrlojFace;
    const empty = createFaceModel({ ...face, snapshot: null }, at, visuals, 1, strings);
    expect(empty.errorMessage).toBe('Zadna data.');
    const model = createFaceModel(face, at, visuals, maxPipelinesAcross(faces), strings);
    expect(model.star?.label).toContain('UTCX');
    expect(model.ticks.every((t) => t.text.includes('UTCX'))).toBe(true);
    expect(model.noonSuns.every((n) => n.text.includes('UTCX'))).toBe(true);
    expect(model.calendar?.nextText).toContain('UTCX');
  });

  it('uses overridden aria text', () => {
    expect(describeFaces([], strings)).toBe('Hodiny. Zadna prostredi.');
    const model = createFaceModel(faces[0] as OrlojFace, at, visuals, 1, strings);
    expect(describeFaces([model], strings)).toContain('Hodiny.');
  });

  it('uses overridden canvas text when drawing', () => {
    const { ctx, calls } = createFakeContext();
    const model = createFaceModel(faces[2] as OrlojFace, at, visuals, 1, strings);
    drawFace(ctx, model, {
      visuals,
      geo: geometryFor(visuals),
      deco: 0,
      smooth: settledSmooth(model),
      strings,
    });
    expect(calls.some((c) => c.startsWith('fillText(Kalendar,'))).toBe(true);
    expect(calls.some((c) => c.startsWith('fillText(naklady,'))).toBe(true);
    expect(calls.some((c) => c.startsWith('fillText(Release calendar,'))).toBe(false);
  });
});
