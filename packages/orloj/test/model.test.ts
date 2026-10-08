// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, beforeAll } from 'vitest';
import { orbitRadius, orlojSpokeDistance, orlojSpokeSize, type Snapshot } from '@orrery/core';
import { geometryFor, hourAngle } from '../src/geometry.js';
import {
  createFaceModel,
  faceHits,
  maxPipelinesAcross,
  type FaceModel,
} from '../src/model/index.js';
import { settledSmooth, spokeDistances } from '../src/smooth.js';
import type { OrlojFace } from '../src/index.js';
import { AT, loadFaces, timeAt, visuals } from './fixture.js';

let faces: OrlojFace[];
let prod: OrlojFace;
let maxP: number;

beforeAll(async () => {
  faces = await loadFaces();
  const found = faces.find((f) => f.env.id === 'prod');
  if (!found) throw new Error('prod face missing');
  prod = found;
  maxP = maxPipelinesAcross(faces);
});

const model = (face: OrlojFace, iso = AT.toISOString()): FaceModel =>
  createFaceModel(face, timeAt(iso), visuals, maxP);

function withSnapshot(face: OrlojFace, patch: Partial<Snapshot>): OrlojFace {
  if (!face.snapshot) throw new Error('no snapshot');
  return { ...face, snapshot: { ...face.snapshot, ...patch } };
}

describe('sun hand', () => {
  it('points down at midnight and up at noon', () => {
    const midnight = model(prod, '2026-10-07T00:00:00Z');
    const noon = model(prod, '2026-10-07T12:00:00Z');
    expect(Math.sin(midnight.sunAngle)).toBeCloseTo(1, 10);
    expect(Math.cos(midnight.sunAngle)).toBeCloseTo(0, 10);
    expect(Math.sin(noon.sunAngle)).toBeCloseTo(-1, 10);
  });

  it('points left at 18:00 (a quarter turn after noon)', () => {
    expect(Math.cos(model(prod, '2026-10-07T18:00:00Z').sunAngle)).toBeCloseTo(1, 10);
  });
});

describe('arcs, ticks, and star hand', () => {
  it('builds one arc per non-transfer window with severity colors', () => {
    const m = model(prod);
    const nonTransfer = prod.snapshot?.schedule.filter((w) => w.kind !== 'transfer') ?? [];
    expect(m.arcs.map((a) => a.id)).toEqual(nonTransfer.map((w) => w.id));
    const qalert = m.arcs.find((a) => a.id === 'qalert@2026-10-07');
    expect(qalert?.color).toBe(visuals.colors.incident);
    expect(qalert?.isActive).toBe(true);
    expect(qalert?.startAngle).toBeCloseTo(hourAngle(10.5), 10);
    expect(m.arcs.find((a) => a.id === 'hold@2026-10-07')?.color).toBe(visuals.colors.warning);
    expect(m.arcs.find((a) => a.id === 'batch@2026-10-08')?.color).toBe(visuals.colors.info);
    expect(m.arcs.find((a) => a.id === 'batch@2026-10-08')?.isActive).toBe(false);
  });

  it('draws transfers as silver ticks, not arcs', () => {
    const m = model(prod);
    const transfers = prod.snapshot?.schedule.filter((w) => w.kind === 'transfer') ?? [];
    expect(m.ticks.map((t) => t.id)).toEqual(transfers.map((w) => w.id));
    expect(m.arcs.some((a) => a.id.startsWith('transfer'))).toBe(false);
  });

  it('points the star hand at the next window start and wraps after the last', () => {
    const m = model(prod, '2026-10-07T10:45:00Z');
    expect(m.star?.minute).toBe(660);
    expect(m.star?.angle).toBeCloseTo(hourAngle(11), 10);
    const late = model(prod, '2026-10-07T23:50:00Z');
    expect(late.star?.minute).toBe(60);
    expect(late.star?.title).toBe('Overnight batch loads');
  });

  it('has no star hand when nothing is scheduled', () => {
    expect(model(withSnapshot(prod, { schedule: [] })).star).toBeNull();
  });
});

describe('spokes', () => {
  it('uses the spec formulas for distance and size', () => {
    const m = model(prod);
    const fo = visuals.freshnessOrbit;
    for (const s of m.spokes) {
      const state = prod.snapshot?.spokes.find((x) => x.id === s.id);
      const spec = prod.topology?.spokes.find((x) => x.id === s.id);
      if (!state || !spec) throw new Error('missing spoke');
      const orbit = orbitRadius(state.ageMinutes, fo);
      expect(s.distance).toBeCloseTo(
        orlojSpokeDistance(orbit, visuals.orloj.spokeDistance, fo.min),
        10,
      );
      expect(s.distance).toBeCloseTo(18 + ((orbit - 24) / 80) * 62, 10);
      expect(s.size).toBeCloseTo(
        orlojSpokeSize(spec.metrics.pipelines, maxP, visuals.orloj.spokeSize),
        10,
      );
      expect(s.size).toBeCloseTo(4.5 + 5 * Math.sqrt(spec.metrics.pipelines / maxP), 10);
    }
    expect(m.spokes.map((s) => s.code)).toContain('In');
  });

  it('spaces rays evenly and rotates a quarter turn per day', () => {
    const a = model(prod, '2026-10-07T00:00:00Z');
    const b = model(prod, '2026-10-08T00:00:00Z');
    const n = a.spokes.length;
    const gap = (a.spokes[1]?.angle ?? 0) - (a.spokes[0]?.angle ?? 0);
    expect(gap).toBeCloseTo((Math.PI * 2) / n, 10);
    const turn =
      ((b.spokes[0]?.angle ?? 0) - (a.spokes[0]?.angle ?? 0) + Math.PI * 4) % (Math.PI * 2);
    expect(turn).toBeCloseTo(Math.PI / 2, 6);
  });

  it('adds local-noon suns for source regions and distinct offices', () => {
    const m = model(prod);
    const sources = prod.topology?.sourceGroups.length ?? 0;
    const offices = new Set(prod.topology?.useCases.map((u) => u.site)).size;
    expect(m.noonSuns.length).toBe(sources + offices);
    const regionA = m.noonSuns.find((s) => s.name === 'Region A');
    expect(regionA?.angle).toBeCloseTo(hourAngle(18), 10);
  });
});

describe('procession', () => {
  it('marches only in the first 30 minutes of the hour', () => {
    expect(model(prod, '2026-10-07T10:00:00Z').procession.progress).toBe(0);
    expect(model(prod, '2026-10-07T10:15:00Z').procession.progress).toBeCloseTo(0.5, 10);
    expect(model(prod, '2026-10-07T10:29:59Z').procession.progress).not.toBeNull();
    expect(model(prod, '2026-10-07T10:30:00Z').procession.progress).toBeNull();
    expect(model(prod, '2026-10-07T10:59:00Z').procession.progress).toBeNull();
  });

  it('keeps the figure count inside the configured bounds', () => {
    const { minFigures, maxFigures } = visuals.orloj.procession;
    for (const running of [0, 40, 200, 287, 5000]) {
      const face = withSnapshot(prod, {
        schedule: [],
        counts: { ...(prod.snapshot as Snapshot).counts, runningPipelines: running },
      });
      const n = model(face).procession.figures.length;
      expect(n).toBeGreaterThanOrEqual(minFigures);
      expect(n).toBeLessThanOrEqual(maxFigures);
    }
  });

  it('adds one build figure when a release window is in the hour', () => {
    const release = {
      id: 'rel',
      title: 'Release',
      kind: 'release' as const,
      severity: 'info' as const,
      start: '2026-10-07T10:20:00.000Z',
      end: '2026-10-07T10:50:00.000Z',
    };
    const plain = model(withSnapshot(prod, { schedule: [] })).procession;
    const withRelease = model(withSnapshot(prod, { schedule: [release] })).procession;
    expect(withRelease.hasRelease).toBe(true);
    expect(withRelease.figures.length).toBe(plain.figures.length + 1);
    expect(withRelease.figures.at(-1)?.workload).toBe('build');
    expect(plain.hasRelease).toBe(false);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = model(prod).procession.figures;
    expect(model(prod).procession.figures).toEqual(a);
    const others = [1, 2, 3, 4, 5].map((seed) => model({ ...prod, seed }).procession.figures);
    expect(others.some((f) => JSON.stringify(f) !== JSON.stringify(a))).toBe(true);
  });
});

describe('rooster', () => {
  it('crows in the first 20 minutes only when the previous day was clean', () => {
    const clean = withSnapshot(prod, { previousDayClean: true });
    const dirty = withSnapshot(prod, { previousDayClean: false });
    expect(model(clean, '2026-10-07T00:10:00Z').rooster.isCrowing).toBe(true);
    expect(model(clean, '2026-10-07T00:19:59Z').rooster.isCrowing).toBe(true);
    expect(model(clean, '2026-10-07T00:20:00Z').rooster.isCrowing).toBe(false);
    expect(model(dirty, '2026-10-07T00:10:00Z').rooster.isCrowing).toBe(false);
  });
});

describe('figures and calendar', () => {
  it('reads the four niche figures from the snapshot', () => {
    const snap = prod.snapshot as Snapshot;
    const f = model(prod).figures;
    expect(f.spend).toBe(Math.round(snap.spendPerHour));
    expect(f.spokesPastTarget).toBe(snap.counts.spokesPastTarget);
    expect(f.spokeCount).toBe(prod.topology?.spokes.length);
    expect(f.openIncidents).toBe(snap.counts.openIncidents);
    expect(f.incidentLevel).toBe('incident');
    expect(f.incidentColor).toBe(visuals.colors.incident);
    expect(f.consumerActivity).toBeCloseTo(snap.consumerActivity, 10);
  });

  it('uses amber when open incidents are only warnings and none when clear', () => {
    const snap = prod.snapshot as Snapshot;
    const warn = model(
      withSnapshot(prod, {
        alerts: snap.alerts.map((a) => ({ ...a, severity: 'warning' as const })),
      }),
    ).figures;
    expect(warn.incidentLevel).toBe('warning');
    expect(warn.incidentColor).toBe(visuals.colors.warning);
    const clear = model(
      withSnapshot(prod, { alerts: [], counts: { ...snap.counts, openIncidents: 0 } }),
    ).figures;
    expect(clear.incidentLevel).toBe('none');
  });

  it('marks today and counts releases so far this month', () => {
    const cal = model(prod).calendar;
    const snapDays = prod.snapshot?.calendar.days ?? [];
    expect(cal?.days.length).toBe(snapDays.length);
    expect(cal?.today).toBe(7);
    expect(cal?.days.filter((d) => d.isToday).map((d) => d.day)).toEqual([7]);
    const past = snapDays.filter((d) => d.isPast);
    expect(cal?.totalReleases).toBe(past.reduce((sum, d) => sum + d.releases, 0));
    expect(cal?.totalPromotions).toBe(past.filter((d) => d.promotion).length);
  });
});

describe('error faces', () => {
  it('builds an error model when error is set, keeping the plaque data', () => {
    const m = model({ ...prod, error: 'Adapter unreachable' });
    expect(m.errorMessage).toBe('Adapter unreachable');
    expect(m.tierColor).toBe(prod.tierColor);
    expect(m.arcs).toEqual([]);
    expect(m.spokes).toEqual([]);
    expect(m.calendar).toBeNull();
    const parts = faceHits(m, geometryFor(visuals), new Map()).map((h) => h.part);
    expect(parts).toEqual(['plaque', 'error']);
  });

  it('falls back to a generic message when data is missing', () => {
    expect(model({ ...prod, snapshot: null }).errorMessage).not.toBeNull();
    expect(model({ ...prod, topology: null }).errorMessage).not.toBeNull();
  });
});

describe('hit regions', () => {
  it('gives every region a non-empty title and text, inside the face', () => {
    const geo = geometryFor(visuals);
    for (const face of [...faces, { ...prod, error: 'boom' }]) {
      const m = model(face);
      const hits = faceHits(m, geo, spokeDistances(settledSmooth(m)));
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.title.trim(), h.part).not.toBe('');
        expect(h.text.trim(), h.part).not.toBe('');
        expect(h.x - h.r, h.part).toBeGreaterThanOrEqual(0);
        expect(h.x + h.r, h.part).toBeLessThanOrEqual(geo.faceW);
        expect(h.y - h.r, h.part).toBeGreaterThanOrEqual(0);
        expect(h.y + h.r, h.part).toBeLessThanOrEqual(geo.faceH);
      }
    }
  });

  it('registers every named part with unique keys', () => {
    const geo = geometryFor(visuals);
    const m = model(prod);
    const parts = faceHits(m, geo, new Map()).map((h) => h.part);
    expect(new Set(parts).size).toBe(parts.length);
    for (const part of [
      'sun-hand',
      'arc:qalert@2026-10-07',
      'moon',
      'star-hand',
      'procession',
      'spend',
      'freshness',
      'incidents',
      'consumers',
      'calendar',
      'calendar-day:7',
      'rooster',
      'plaque',
    ]) {
      expect(parts, part).toContain(part);
    }
    expect(parts.some((p) => p.startsWith('spoke:'))).toBe(true);
  });
});

describe('determinism', () => {
  it('computes deeply equal models for the same paused time', () => {
    expect(model(prod)).toEqual(model(prod));
    expect(createFaceModel(prod, timeAt(AT.toISOString(), true), visuals, maxP)).toEqual(
      createFaceModel(prod, timeAt(AT.toISOString(), false), visuals, maxP),
    );
  });
});
