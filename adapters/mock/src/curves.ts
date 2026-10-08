// SPDX-License-Identifier: Apache-2.0
// Time-of-day activity curves, ported from the reference prototypes. Each maps a local hour
// (0 to 24) to an activity level between 0 and 1 by linear interpolation between points.

export type Curve = (hour: number) => number;
type Point = readonly [hour: number, level: number];

export function curve(points: readonly Point[]): Curve {
  return (hour) => {
    const h = ((hour % 24) + 24) % 24;
    for (let i = 0; i < points.length - 1; i += 1) {
      const [h0, v0] = points[i] as Point;
      const [h1, v1] = points[i + 1] as Point;
      if (h >= h0 && h <= h1) return h1 === h0 ? v0 : v0 + (v1 - v0) * ((h - h0) / (h1 - h0));
    }
    return (points[points.length - 1] as Point)[1];
  };
}

/** Local hour at a UTC offset for a minute of the UTC day. */
export function localHour(utcOffset: number, minuteOfDay: number): number {
  return (((minuteOfDay / 60 + utcOffset) % 24) + 24) % 24;
}

export const SHIFTS = {
  two: curve([
    [0, 0.3],
    [5, 0.3],
    [6, 0.95],
    [14, 0.95],
    [22, 0.9],
    [22.5, 0.3],
    [24, 0.3],
  ]),
  three: curve([
    [0, 0.7],
    [6, 0.9],
    [22, 0.9],
    [24, 0.7],
  ]),
} as const;

export const OFFICE = curve([
  [0, 0.1],
  [7, 0.15],
  [8, 0.7],
  [12, 0.9],
  [17, 0.7],
  [19, 0.25],
  [24, 0.1],
]);
export const STUDIO = curve([
  [0, 0.1],
  [8, 0.15],
  [9, 0.7],
  [19, 0.7],
  [21, 0.2],
  [24, 0.1],
]);
export const BATCH = curve([
  [0, 0.7],
  [1, 1],
  [3, 0.8],
  [4, 0.2],
  [8, 0.2],
  [17, 0.3],
  [21, 0.6],
  [22, 1],
  [24, 0.7],
]);
export const ML = curve([
  [0, 0.9],
  [5, 0.9],
  [8, 0.4],
  [18, 0.4],
  [20, 0.8],
  [24, 0.9],
]);

/** Domain activity profiles, keyed by name. Spokes pick one through the world fixture. */
export const DOMAIN_CURVES: Readonly<Record<string, Curve>> = {
  ingest: curve([
    [0, 0.5],
    [6, 0.9],
    [22, 0.9],
    [24, 0.5],
  ]),
  supply: curve([
    [0, 0.2],
    [2, 0.5],
    [3, 0.9],
    [5, 0.9],
    [6, 0.5],
    [13, 0.5],
    [14, 0.8],
    [16, 0.5],
    [24, 0.2],
  ]),
  operations: curve([
    [0, 0.2],
    [5, 0.2],
    [6, 0.9],
    [22, 0.9],
    [22.5, 0.25],
    [24, 0.2],
  ]),
  quality: curve([
    [0, 0.1],
    [6, 0.1],
    [7, 0.8],
    [22, 0.8],
    [22.5, 0.1],
    [24, 0.1],
  ]),
  customer: curve([
    [0, 0.3],
    [7, 0.6],
    [8.5, 0.8],
    [11, 0.4],
    [17, 0.5],
    [18, 0.9],
    [20, 0.6],
    [24, 0.3],
  ]),
  sales: curve([
    [0, 0.05],
    [8, 0.1],
    [9, 0.7],
    [18, 0.6],
    [20, 0.1],
    [24, 0.05],
  ]),
  finance: curve([
    [0, 0.8],
    [1, 0.9],
    [3, 0.7],
    [4, 0.1],
    [16, 0.1],
    [17.5, 0.8],
    [19, 0.6],
    [20, 0.1],
    [24, 0.8],
  ]),
};
