// SPDX-License-Identifier: Apache-2.0
// Annotation mode, pure part: where each numbered marker, its target, and its definition label
// go on the annotated face. Coordinates are face units of that face; label x may fall outside
// it, in the neighboring (dimmed) face's area.
import {
  ARC_INSET,
  NUMERAL_INSET,
  SKY_INSET,
  STAR_HAND_INSET,
  SUN_INSET,
  hourAngle,
  type Geometry,
} from '../geometry.js';
import {
  CONSUMERS_POS,
  FRESHNESS_POS,
  INCIDENTS_POS,
  PROCESSION_HIT,
  ROOSTER_POS,
  SPEND_POS,
  type Point,
} from '../constants.js';
import type { LegendEntry, OrlojLayout, OrlojPart } from '../types.js';
import type { FaceModel } from './types.js';

/** Where definition labels go: the neighbor's area on the right or left, or nowhere. */
export type LabelSide = 'right' | 'left' | 'none';

export interface AnnotationAnchor {
  part: OrlojPart;
  /** The legend number, so the face and the legend agree. */
  number: number;
  /** Center of the numbered marker disc. */
  marker: Point;
  /** The spot on the part the marker points at. */
  target: Point;
  /** Left-middle (right side) or right-middle (left side) of the definition label; null at none. */
  label: (Point & { align: 'left' | 'right' }) | null;
}

export const MARKER_RADIUS = 7.5;
/** Markers for dial parts sit this far outside the rim's outer edge. */
const MARKER_RIM_GAP = 10;
/** Smallest angular spacing between dial markers, in radians (a marker's width at the rim). */
const MIN_MARKER_GAP = 0.11;
const FULL_TURN = Math.PI * 2;
const HOUR_RING_HOUR = 15;
const NOON_MARK_OFFSET = 6;
const NICHE_MARKER_LIFT = 42;
const NICHE_TARGET_LIFT = 16;
const ROOSTER_MARKER_DX = 26;
const CALENDAR_ANGLE = -Math.PI / 4;
const CALENDAR_MARKER_GAP = 8;
const CALENDAR_TARGET_INSET = 8;
const LABEL_GUTTER = 18;
const LABEL_TOP = 60;
const LABEL_BOTTOM = 790;
const MIN_COLUMNS_FOR_LABELS = 2;

function polar(g: Geometry, angle: number, radius: number): Point {
  return { x: g.cx + Math.cos(angle) * radius, y: g.cy + Math.sin(angle) * radius };
}

interface DialPart {
  part: OrlojPart;
  angle: number;
  targetRadius: number;
}

/** Dial parts present in the model, each with its angle and the radius of its target. */
function dialParts(model: FaceModel, g: Geometry): DialPart[] {
  const R = g.radius;
  const skyR = R - SKY_INSET;
  const parts: DialPart[] = [
    { part: 'sun-hand', angle: model.sunAngle, targetRadius: R - SUN_INSET },
    { part: 'hour-ring', angle: hourAngle(HOUR_RING_HOUR), targetRadius: R - NUMERAL_INSET },
    { part: 'moon', angle: model.moon.angle, targetRadius: skyR * 0.62 },
  ];
  const arc = model.arcs[0];
  if (arc) parts.push({ part: 'arcs', angle: arc.midAngle, targetRadius: R - ARC_INSET });
  const spoke = model.spokes[0];
  if (spoke) parts.push({ part: 'spokes', angle: spoke.angle, targetRadius: spoke.distance });
  if (model.star) {
    parts.push({ part: 'star-hand', angle: model.star.angle, targetRadius: R - STAR_HAND_INSET });
  }
  const noon = model.noonSuns[0];
  if (noon)
    parts.push({ part: 'noon-suns', angle: noon.angle, targetRadius: skyR + NOON_MARK_OFFSET });
  return parts;
}

const normalize = (angle: number): number => ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN;

/** Marker angles for the dial parts, spread so neighboring marker discs never overlap. */
function spreadAngles(parts: readonly DialPart[]): Map<OrlojPart, number> {
  const sorted = [...parts]
    .map((p) => ({ part: p.part, angle: normalize(p.angle) }))
    .sort((a, b) => a.angle - b.angle);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.angle - prev.angle < MIN_MARKER_GAP)
      cur.angle = prev.angle + MIN_MARKER_GAP;
  }
  return new Map(sorted.map((s) => [s.part, s.angle]));
}

interface Placement {
  part: OrlojPart;
  marker: Point;
  target: Point;
}

function dialPlacements(model: FaceModel, g: Geometry): Placement[] {
  const parts = dialParts(model, g);
  const angles = spreadAngles(parts);
  const markerRadius = g.radius + g.rimWidth + MARKER_RIM_GAP;
  return parts.map((p) => ({
    part: p.part,
    marker: polar(g, angles.get(p.part) ?? p.angle, markerRadius),
    target: polar(g, p.angle, p.targetRadius),
  }));
}

function nichePlacement(part: OrlojPart, pos: Point): Placement {
  return {
    part,
    marker: { x: pos.x, y: pos.y - NICHE_MARKER_LIFT },
    target: { x: pos.x, y: pos.y - NICHE_TARGET_LIFT },
  };
}

function facadePlacements(model: FaceModel, g: Geometry): Placement[] {
  const placements: Placement[] = [
    {
      part: 'procession',
      marker: PROCESSION_HIT,
      target: { x: PROCESSION_HIT.x, y: PROCESSION_HIT.y + 6 },
    },
    {
      part: 'rooster',
      marker: { x: ROOSTER_POS.x + ROOSTER_MARKER_DX, y: ROOSTER_POS.y + 4 },
      target: ROOSTER_POS,
    },
    nichePlacement('spend', SPEND_POS),
    nichePlacement('freshness', FRESHNESS_POS),
    nichePlacement('incidents', INCIDENTS_POS),
    nichePlacement('consumers', CONSUMERS_POS),
  ];
  if (model.calendar) {
    placements.push({
      part: 'calendar',
      marker: {
        x: g.calCx + Math.cos(CALENDAR_ANGLE) * (g.calRadius + CALENDAR_MARKER_GAP),
        y: g.calCy + Math.sin(CALENDAR_ANGLE) * (g.calRadius + CALENDAR_MARKER_GAP),
      },
      target: {
        x: g.calCx + Math.cos(CALENDAR_ANGLE) * (g.calRadius - CALENDAR_TARGET_INSET),
        y: g.calCy + Math.sin(CALENDAR_ANGLE) * (g.calRadius - CALENDAR_TARGET_INSET),
      },
    });
  }
  return placements;
}

/** Which neighbor's area holds the labels for face `index`: right if one exists, else left. */
export function labelSide(layout: OrlojLayout, index: number, faceCount: number): LabelSide {
  if (layout.columns < MIN_COLUMNS_FOR_LABELS) return 'none';
  const column = index % layout.columns;
  if (column + 1 < layout.columns && index + 1 < faceCount) return 'right';
  return column > 0 ? 'left' : 'none';
}

/**
 * Anchors for every legend entry that is available and present on this face, in legend order.
 * Labels are spread evenly down the neighbor's area, ordered by marker height so leader lines
 * cross as little as possible.
 */
export function annotationAnchors(
  model: FaceModel,
  g: Geometry,
  entries: readonly LegendEntry[],
  side: LabelSide,
): AnnotationAnchor[] {
  if (model.errorMessage !== null) return [];
  const placed = new Map(
    [...dialPlacements(model, g), ...facadePlacements(model, g)].map((p) => [p.part, p]),
  );
  const shown = entries.flatMap((entry) => {
    const placement = placed.get(entry.part);
    return entry.unavailableReason === undefined && placement ? [{ entry, placement }] : [];
  });
  const byHeight = [...shown].sort((a, b) => a.placement.marker.y - b.placement.marker.y);
  const step = byHeight.length > 1 ? (LABEL_BOTTOM - LABEL_TOP) / (byHeight.length - 1) : 0;
  const slotOf = new Map(byHeight.map((s, i) => [s.entry.part, LABEL_TOP + i * step]));
  return shown.map(({ entry, placement }) => ({
    part: entry.part,
    number: entry.number,
    marker: placement.marker,
    target: placement.target,
    label: labelAt(side, g, slotOf.get(entry.part) ?? LABEL_TOP),
  }));
}

function labelAt(side: LabelSide, g: Geometry, y: number): AnnotationAnchor['label'] {
  if (side === 'right') return { x: g.faceW + LABEL_GUTTER, y, align: 'left' };
  if (side === 'left') return { x: -LABEL_GUTTER, y, align: 'right' };
  return null;
}

/** Index of the first face that is not an error face, or -1. */
export function firstLoadedIndex(models: readonly FaceModel[]): number {
  return models.findIndex((m) => m.errorMessage === null);
}
