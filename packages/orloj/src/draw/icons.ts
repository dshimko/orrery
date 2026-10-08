// SPDX-License-Identifier: Apache-2.0
// Niche icons from reference/orloj-icons.svg, re-centered on (0, 0) of the 64-unit grid. The
// shapes that depend on data (coin count, sand level, pupil, bell swing) are drawn by code.

/** Icon grid units to face units. */
export const ICON_SCALE = 0.66;
/** Icons are centered this far above their niche's center (face units). */
export const ICON_CENTER_DY = -16;

export const ICON_PATHS = {
  coinSide: 'M-14 0v5c0 3 6 5 14 5s14-2 14-5v-5',
  coinGlyph: 'M14 0v12M10.5 3.5h5a2.5 2.5 0 0 1 0 5h-5',
  hourglassBars: 'M-16-26h32M-16 26h32',
  hourglassGlass: 'M-11-26c0 15 22 17 22 26s-22 11-22 26M11-26c0 15-22 17-22 26s22 11 22 26',
  bell: 'M0-25c-2 0-3.5 1.5-3.5 3.5v1.8C-11.5-17.8-16-11-16-3v10l-5 7h42l-5-7V-3c0-8-4.5-14.8-12.5-16.7v-1.8C3.5-23.5 2-25 0-25z',
  bellClapper: 'M-6 18a6 6 0 0 0 12 0',
  bellWaves: 'M-25-12c-3 5-3 12 0 17M25-12c3 5 3 12 0 17',
  eye: 'M-27 0c6-11 15.5-17 27-17s21 6 27 17c-6 11-15.5 17-27 17S-21 11-27 0z',
  eyeRays: 'M0-23v-5M-14-20l-3-4M14-20l3-4',
} as const;

export type IconPathName = keyof typeof ICON_PATHS;

export const ICON_STROKE = 3;
export const ICON_THIN_STROKE = 2;
export const ICON_WAVE_STROKE = 2.4;
export const ICON_RAY_STROKE = 2.2;

/** Coin stack geometry: coin k sits at `COIN_X`, `COIN_BOTTOM_Y - k * COIN_STEP`. */
export const COIN_X = -12;
export const COIN_BOTTOM_Y = 16;
export const COIN_STEP = 8;
export const COIN_RX = 14;
export const COIN_RY = 5;
export const MAX_COINS = 4;
export const BIG_COIN = { x: 14, y: 6, r: 13, innerR: 8.5 } as const;

export const BELL_PIVOT_Y = -25;
/** Largest swing of the bell, in radians. */
export const BELL_SWING_AMPLITUDE = 0.35;

export const PUPIL_MIN_RADIUS = 2.5;
export const PUPIL_MAX_RADIUS = 7;
export const EYE_IRIS_RADIUS = 10;

export type IconKind = 'spend' | 'freshness' | 'incidents' | 'consumers';

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const HALF_STROKE = ICON_STROKE / 2;

function union(boxes: readonly Bounds[]): Bounds {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

/** Bounds of a box rotated about (0, pivotY): the box of its four rotated corners. */
function rotatedAbout(box: Bounds, pivotY: number, angle: number): Bounds {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [box.minX, box.minY],
    [box.minX, box.maxY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
  ].map(([cx = 0, cy = 0]) => {
    const dy = cy - pivotY;
    return { x: cx * cos - dy * sin, y: pivotY + cx * sin + dy * cos };
  });
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    maxX: Math.max(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

/**
 * The largest area each icon can cover, in icon units around its center, stroke included: four
 * coins, full sand, pupil at its widest, rays on, and the bell at maximum swing with its ring
 * waves. Control points are not tighter than the curves, so each box is a safe upper bound.
 */
export function iconExtents(kind: IconKind): Bounds {
  switch (kind) {
    case 'spend': {
      const topCoinY = COIN_BOTTOM_Y - (MAX_COINS - 1) * COIN_STEP;
      return {
        minX: COIN_X - COIN_RX - HALF_STROKE,
        maxX: BIG_COIN.x + BIG_COIN.r + HALF_STROKE,
        minY: topCoinY - COIN_RY - HALF_STROKE,
        // The lowest coin's side curve ends 10 units under its center.
        maxY: COIN_BOTTOM_Y + 10 + HALF_STROKE,
      };
    }
    case 'freshness':
      return {
        minX: -16 - HALF_STROKE,
        maxX: 16 + HALF_STROKE,
        minY: -26 - HALF_STROKE,
        maxY: 26 + HALF_STROKE,
      };
    case 'incidents': {
      const body: Bounds = {
        minX: -21 - HALF_STROKE,
        maxX: 21 + HALF_STROKE,
        minY: -25 - HALF_STROKE,
        maxY: 14 + HALF_STROKE,
      };
      const clapper: Bounds = {
        minX: -6 - HALF_STROKE,
        maxX: 6 + HALF_STROKE,
        minY: 18 - HALF_STROKE,
        maxY: 24 + HALF_STROKE,
      };
      // Bezier x of the wave bulges 2.25 units past its end points (-25 -> -27.25).
      const waveHalfStroke = ICON_WAVE_STROKE / 2;
      const waves: Bounds = {
        minX: -27.25 - waveHalfStroke,
        maxX: 27.25 + waveHalfStroke,
        minY: -12 - waveHalfStroke,
        maxY: 5 + waveHalfStroke,
      };
      return union([
        waves,
        ...[-1, 1].flatMap((sign) =>
          [body, clapper].map((b) => rotatedAbout(b, BELL_PIVOT_Y, sign * BELL_SWING_AMPLITUDE)),
        ),
      ]);
    }
    case 'consumers': {
      const eye: Bounds = {
        minX: -27 - HALF_STROKE,
        maxX: 27 + HALF_STROKE,
        minY: -17 - HALF_STROKE,
        maxY: 17 + HALF_STROKE,
      };
      const rays: Bounds = {
        minX: -17 - ICON_RAY_STROKE / 2,
        maxX: 17 + ICON_RAY_STROKE / 2,
        minY: -28 - ICON_RAY_STROKE / 2,
        maxY: -20 + ICON_RAY_STROKE / 2,
      };
      return union([eye, rays]);
    }
  }
}

/** An icon's extents in face units relative to its niche's center (scaled and shifted up). */
export function iconNicheBounds(kind: IconKind): Bounds {
  const b = iconExtents(kind);
  return {
    minX: b.minX * ICON_SCALE,
    maxX: b.maxX * ICON_SCALE,
    minY: b.minY * ICON_SCALE + ICON_CENTER_DY,
    maxY: b.maxY * ICON_SCALE + ICON_CENTER_DY,
  };
}

const pathCache = new Map<IconPathName, Path2D>();

/** The icon path as a `Path2D`, or null where the environment has none (Node without a canvas). */
export function iconPath(name: IconPathName): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  const cached = pathCache.get(name);
  if (cached) return cached;
  const path = new Path2D(ICON_PATHS[name]);
  pathCache.set(name, path);
  return path;
}

/** Strokes a named icon path; a no-op where `Path2D` is unavailable. */
export function strokeIconPath(ctx: CanvasRenderingContext2D, name: IconPathName): void {
  const path = iconPath(name);
  if (path) ctx.stroke(path);
}

/** Fills a named icon path; a no-op where `Path2D` is unavailable. */
export function fillIconPath(ctx: CanvasRenderingContext2D, name: IconPathName): void {
  const path = iconPath(name);
  if (path) ctx.fill(path);
}
