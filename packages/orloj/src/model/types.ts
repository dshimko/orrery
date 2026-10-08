// SPDX-License-Identifier: Apache-2.0
// The pure face model: everything the drawing code needs, computed from data, time, and visuals.
import type { Severity } from '@orrery/core';

/** A tooltip region in face units (0..faceW, 0..faceH). */
export interface FaceHit {
  part: string;
  title: string;
  text: string;
  x: number;
  y: number;
  r: number;
}

export interface ArcModel {
  id: string;
  title: string;
  text: string;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  severity: Severity;
  color: string;
  /** True while the simulated time is inside the window. */
  isActive: boolean;
  startLabel: string;
  endLabel: string;
}

export interface TickModel {
  id: string;
  title: string;
  text: string;
  angle: number;
}

export type NoonKind = 'source' | 'office' | 'studio';

export interface NoonSunModel {
  key: string;
  code: string;
  name: string;
  kind: NoonKind;
  color: string;
  angle: number;
  text: string;
}

export interface SpokeModel {
  id: string;
  name: string;
  code: string;
  /** Ray angle: zodiac rotation plus the spoke's slot. */
  angle: number;
  /** Target distance from the hub; the view approaches it exponentially (stability rule 2). */
  distance: number;
  size: number;
  color: string;
  ageMinutes: number;
  targetMinutes: number;
  pastTarget: boolean;
  isIngest: boolean;
  isSecondaryMetastore: boolean;
  pipelines: number;
  products: number;
}

export interface MoonModel {
  /** Share of the ingest yard in use, 0 to 1. */
  phase: number;
  angle: number;
}

export interface StarModel {
  angle: number;
  title: string;
  /** Minute of the UTC day at which the next window starts. */
  minute: number;
  label: string;
}

export interface ProcessionFigure {
  workload: string;
  color: string;
}

export interface ProcessionModel {
  figures: ProcessionFigure[];
  /** 0 to 1 across the marching window; null when the hour's procession is not marching. */
  progress: number | null;
  hasRelease: boolean;
  text: string;
}

export type IncidentLevel = 'none' | 'warning' | 'incident';

export interface FiguresModel {
  spend: number;
  /** Purse fullness target, 0.25 to 1. */
  purseTarget: number;
  spokesPastTarget: number;
  spokeCount: number;
  openIncidents: number;
  incidentLevel: IncidentLevel;
  incidentColor: string;
  incidentTitles: string[];
  consumerActivity: number;
}

export interface RoosterModel {
  isCrowing: boolean;
}

export interface CalendarDayModel {
  day: number;
  releases: number;
  promotion: boolean;
  monthEndClose: boolean;
  isPast: boolean;
  isToday: boolean;
  startAngle: number;
  endAngle: number;
  midAngle: number;
}

export interface CalendarModel {
  days: CalendarDayModel[];
  today: number;
  totalReleases: number;
  totalPromotions: number;
  nextText: string;
}

export interface FaceModel {
  envId: string;
  name: string;
  tier: string;
  tierColor: string;
  /** Set when the face has no data: the face draws as an error face with this message. */
  errorMessage: string | null;
  minuteOfDay: number;
  hubName: string;
  /** Data products in the hub, shown on the hub disc. */
  products: number;
  /** Sun hand angle. */
  sunAngle: number;
  arcs: ArcModel[];
  ticks: TickModel[];
  noonSuns: NoonSunModel[];
  spokes: SpokeModel[];
  moon: MoonModel;
  star: StarModel | null;
  figures: FiguresModel;
  procession: ProcessionModel;
  rooster: RoosterModel;
  calendar: CalendarModel | null;
}
