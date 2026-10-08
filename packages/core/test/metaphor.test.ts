// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { Visuals } from '../src/config/visuals.js';
import {
  METAPHOR,
  SEVERITY_COLOR_KEY,
  orbitRadius,
  orbitSpeed,
  orlojSpokeDistance,
  orlojSpokeSize,
  planetSize,
  simMinutesPerSecond,
  spokeColor,
  spokeColorMap,
  usesMeanAge,
  type MetaphorKey,
} from '../src/metaphor.js';

const v = Visuals.parse({});

describe('METAPHOR', () => {
  it('covers every metaphor key exactly once', () => {
    const keys: MetaphorKey[] = [
      'hub',
      'spoke',
      'ingest',
      'freshness',
      'sources',
      'medallion',
      'stations',
      'shipyard',
      'sharing',
      'federation',
      'alerts',
    ];
    expect(METAPHOR.map((e) => e.key).sort()).toEqual([...keys].sort());
  });

  it('has non-empty concept, element and encoding for each entry', () => {
    for (const e of METAPHOR) {
      expect(e.concept.length).toBeGreaterThan(0);
      expect(e.element.length).toBeGreaterThan(0);
      expect(e.encoding.length).toBeGreaterThan(0);
    }
  });

  it('maps severities to existing color keys', () => {
    for (const key of Object.values(SEVERITY_COLOR_KEY)) {
      expect(v.colors[key]).toMatch(/^#/);
    }
    expect(SEVERITY_COLOR_KEY.incident).toBe('incident');
  });
});

describe('orbitRadius', () => {
  it('matches spec values', () => {
    expect(orbitRadius(1, v.freshnessOrbit)).toBe(24);
    expect(orbitRadius(10, v.freshnessOrbit)).toBe(46);
    expect(orbitRadius(1e9, v.freshnessOrbit)).toBe(104);
  });

  it('treats sub-minute, negative and non-finite ages as 1 minute', () => {
    expect(orbitRadius(0.1, v.freshnessOrbit)).toBe(24);
    expect(orbitRadius(-5, v.freshnessOrbit)).toBe(24);
    expect(orbitRadius(Number.NaN, v.freshnessOrbit)).toBe(24);
    expect(orbitRadius(Number.POSITIVE_INFINITY, v.freshnessOrbit)).toBe(24);
  });

  it('is monotonic in age', () => {
    expect(orbitRadius(100, v.freshnessOrbit)).toBeGreaterThan(orbitRadius(50, v.freshnessOrbit));
  });
});

describe('planetSize', () => {
  it('returns base at zero and base+scale at max', () => {
    expect(planetSize(0, 10, v.planetSize)).toBe(1.8);
    expect(planetSize(10, 10, v.planetSize)).toBeCloseTo(5.2, 12);
  });

  it('uses the square root of the ratio', () => {
    expect(planetSize(2.5, 10, v.planetSize)).toBeCloseTo(1.8 + 3.4 * 0.5, 12);
  });

  it('returns base for non-positive max and clamps ratio above 1', () => {
    expect(planetSize(5, 0, v.planetSize)).toBe(1.8);
    expect(planetSize(-1, 10, v.planetSize)).toBe(1.8);
    expect(planetSize(50, 10, v.planetSize)).toBeCloseTo(5.2, 12);
  });
});

describe('orbitSpeed', () => {
  it('equals 2pi over the period at the reference radius', () => {
    expect(orbitSpeed(30, v.orbitSpeed)).toBeCloseTo((2 * Math.PI) / 26, 12);
  });

  it('is slower at larger radii following the 1.5 power law', () => {
    const ratio = orbitSpeed(30, v.orbitSpeed) / orbitSpeed(120, v.orbitSpeed);
    expect(ratio).toBeCloseTo(8, 10);
  });
});

describe('orloj formulas', () => {
  it('maps orbit range onto the spoke distance span', () => {
    expect(orlojSpokeDistance(24, v.orloj.spokeDistance, 24)).toBe(18);
    expect(orlojSpokeDistance(104, v.orloj.spokeDistance, 24)).toBe(80);
  });

  it('sizes spokes by pipelines', () => {
    expect(orlojSpokeSize(8, 8, v.orloj.spokeSize)).toBeCloseTo(9.5, 12);
    expect(orlojSpokeSize(0, 8, v.orloj.spokeSize)).toBe(4.5);
    expect(orlojSpokeSize(3, 0, v.orloj.spokeSize)).toBe(4.5);
  });
});

describe('simMinutesPerSecond', () => {
  it('is 12 at default 1x (24 sim hours in 120 s)', () => {
    expect(simMinutesPerSecond(v.time)).toBe(12);
  });

  it('scales with speed', () => {
    expect(simMinutesPerSecond(v.time, 4)).toBe(48);
  });
});

describe('usesMeanAge', () => {
  it('is true only below the cadence threshold', () => {
    expect(usesMeanAge(5, v.stability)).toBe(true);
    expect(usesMeanAge(30, v.stability)).toBe(false);
    expect(usesMeanAge(60, v.stability)).toBe(false);
  });
});

describe('spokeColor', () => {
  it('defaults to the reference palette: ingest first, then domains in order', () => {
    const spokes = [
      { id: 'ingest', role: 'ingest' },
      { id: 'a', role: 'domain' },
      { id: 'b', role: 'domain' },
    ];
    expect([...spokeColorMap(spokes, v).values()]).toEqual(['#9FC4FF', '#5FA8D3', '#7BC8A4']);
  });

  it('cycles the domain colors and never gives a domain the ingest color', () => {
    expect(spokeColor('x', 6, 'domain', v)).toBe('#5FA8D3');
    expect(spokeColor('x', 0, 'ingest', v)).toBe('#9FC4FF');
  });

  it('lets an explicit spokeColors entry win without shifting the others', () => {
    const custom = Visuals.parse({ spokeColors: { a: '#112233' } });
    const spokes = [
      { id: 'a', role: 'domain' },
      { id: 'b', role: 'domain' },
    ];
    expect([...spokeColorMap(spokes, custom).values()]).toEqual(['#112233', '#7BC8A4']);
  });

  it('uses the single palette color for every spoke when the palette has one entry', () => {
    const one = Visuals.parse({ palette: ['#010203'] });
    expect(spokeColor('a', 3, 'domain', one)).toBe('#010203');
  });

  it('rejects malformed colors', () => {
    expect(() => Visuals.parse({ palette: ['red'] })).toThrow();
    expect(() => Visuals.parse({ spokeColors: { a: 'blue' } })).toThrow();
  });
});
