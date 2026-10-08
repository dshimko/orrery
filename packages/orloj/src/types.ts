// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, SnapshotPart, Topology, Visuals } from '@orrery/core';

/** One clock face: an environment, its data, or the reason it has none. */
export interface OrlojFace {
  env: { id: string; name: string; tier: string };
  /** Plaque and accent color, e.g. visuals.colors.tiers[env.tier]. */
  tierColor: string;
  /** Per-environment seed for the procession and calendar (stability rule 5). */
  seed: number;
  topology: Topology | null;
  snapshot: Snapshot | null;
  /** When set, the face renders as an error face showing this message; others still render. */
  error?: string;
}

export interface OrlojTime {
  /** Shared simulated time for every face. */
  at: Date;
  paused: boolean;
}

/** Every Orloj part a viewer can be taught about, in teaching order. */
export type OrlojPart =
  | 'sun-hand'
  | 'hour-ring'
  | 'arcs'
  | 'spokes'
  | 'moon'
  | 'star-hand'
  | 'noon-suns'
  | 'procession'
  | 'spend'
  | 'freshness'
  | 'incidents'
  | 'consumers'
  | 'calendar'
  | 'rooster';

/** A part's permanent text: its name, a one-line gloss for annotation, and its definition. */
export interface OrlojPartStrings {
  name: string;
  /** At most about 50 characters: the annotation label beside the numbered marker. */
  short: string;
  definition: string;
}

/** Titles and value templates for tooltips; `{placeholders}` are filled by `fill()`. */
export interface OrlojHitStrings {
  sunHandTitle: string;
  sunHandValue: string;
  moonTitle: string;
  moonValue: string;
  starHandTitle: string;
  starHandValue: string;
  spokeTitle: string;
  spokeIngestSuffix: string;
  spokeValue: string;
  spokePastTarget: string;
  spokeSecondary: string;
  noonTitle: string;
  noonValue: string;
  processionTitle: string;
  processionRelease: string;
  spendTitle: string;
  spendValue: string;
  freshnessTitle: string;
  freshnessValue: string;
  incidentsTitle: string;
  incidentsNone: string;
  incidentsCount: string;
  consumersTitle: string;
  consumersValue: string;
  calendarTitle: string;
  calendarValue: string;
  roosterTitle: string;
  roosterCrowing: string;
  roosterQuiet: string;
  plaqueDefinition: string;
  plaqueValue: string;
  hubTitle: string;
  hubText: string;
  dayTitle: string;
  dayToday: string;
  dayPast: string;
  dayPlanned: string;
  dayPromotion: string;
  dayMonthEnd: string;
  errorTitle: string;
}

/** Texts the face model builds into tooltips and captions; `{placeholders}` are filled. */
export interface OrlojModelStrings {
  /** The unit word after a UTC clock time, e.g. "10:45 UTC". */
  utc: string;
  ageMinutes: string;
  ageHours: string;
  ageDays: string;
  noData: string;
  defaultHubName: string;
  nothingScheduled: string;
  severityIncident: string;
  severityWarning: string;
  severityPlanned: string;
  kindTransfer: string;
  kindRelease: string;
  kindScripted: string;
  /** Placeholders: {severity} {kind}. */
  arcFallback: string;
  /** Placeholders: {title} {start} {end}. */
  arcTitle: string;
  /** Placeholders: {time} {utc}. */
  tickText: string;
  /** Placeholders: {title} {time} {utc}. */
  starLabel: string;
  /** Placeholders: {time} {utc} {local}. */
  noonText: string;
  /** Placeholder: {n}. */
  officeCode: string;
  studioCode: string;
  /** Placeholders: {count} {mix}. */
  processionText: string;
}

/** Texts drawn on the canvas. */
export interface OrlojCanvasStrings {
  calendarReleases: string;
  calendarMonth: string;
  calendarTitle: string;
  /** Placeholder: {text}. */
  calendarNext: string;
  roosterCrowing: string;
  errorTitle: string;
  figureSpend: string;
  figureFreshness: string;
  figureIncidents: string;
  figureConsumers: string;
}

/** The canvas's accessible description. */
export interface OrlojAriaStrings {
  prefix: string;
  noEnvironments: string;
  /** Placeholder: {name}. */
  faceNoData: string;
  /** Placeholders: {name} {incidents} {spokes}. */
  face: string;
  /** Placeholder: {n}. */
  incidentOne: string;
  incidentMany: string;
  spokeOne: string;
  spokeMany: string;
  /** Placeholders: {prefix} {faces}. */
  summary: string;
  faceSeparator: string;
}

/** Every user-facing Orloj string. Pass overrides in `OrlojOptions.strings`. */
export interface OrlojStrings {
  howToReadTitle: string;
  howToReadDismissHint: string;
  legendTitle: string;
  legendPurpose: string;
  legendHowToUse: string;
  /** The one-line key strip under the faces in wall mode. */
  wallKey: string;
  labelSunNow: string;
  labelFresher: string;
  labelNext: string;
  /** Placeholders: {definition} {value}. */
  tooltipWithValue: string;
  /** Placeholders: {definition} {reason}. */
  tooltipWithReason: string;
  parts: Record<OrlojPart, OrlojPartStrings>;
  /** Fallback reasons, used when an adapter names an unavailable part without a reason. */
  unavailable: Record<SnapshotPart, string>;
  hit: OrlojHitStrings;
  model: OrlojModelStrings;
  canvas: OrlojCanvasStrings;
  aria: OrlojAriaStrings;
}

/** Overrides for `OrlojStrings`: any string may be replaced, one nested key at a time. */
export interface OrlojStringOverrides extends Partial<
  Omit<OrlojStrings, 'parts' | 'unavailable' | 'hit' | 'model' | 'canvas' | 'aria'>
> {
  parts?: { [P in OrlojPart]?: Partial<OrlojPartStrings> };
  unavailable?: Partial<OrlojStrings['unavailable']>;
  hit?: Partial<OrlojHitStrings>;
  model?: Partial<OrlojModelStrings>;
  canvas?: Partial<OrlojCanvasStrings>;
  aria?: Partial<OrlojAriaStrings>;
}

/** One legend row per part, in teaching order, numbered from 1. */
export interface LegendEntry {
  part: OrlojPart;
  number: number;
  name: string;
  definition: string;
  /** Set when no loaded face has data for this part; the legend shows it instead of the definition. */
  unavailableReason?: string;
}

export interface OrlojOptions {
  visuals: Visuals;
  /** Faces in promotion order. */
  faces: readonly OrlojFace[];
  time: () => OrlojTime;
  reducedMotion?: boolean;
  /**
   * IANA zone for the local times appended to tooltips (the dial stays UTC). Defaults to the
   * browser's zone.
   */
  timeZone?: string;
  /** Overrides merged over `ORLOJ_STRINGS`. */
  strings?: OrlojStringOverrides;
}

/** A tooltip region, in CSS pixels relative to the canvas. */
export interface OrlojHit {
  envId: string;
  /** Stable part key, e.g. 'sun-hand', 'arc:qalert', 'spoke:sales', 'moon', 'miser', 'calendar'. */
  part: string;
  title: string;
  text: string;
  x: number;
  y: number;
  r: number;
}

export interface OrlojLayout {
  columns: number;
  /** Face scale (face units to CSS px), capped at visuals.orloj.maxScale. */
  scale: number;
  width: number;
  height: number;
}

export interface OrlojView {
  setFaces(faces: readonly OrlojFace[]): void;
  /** Fires on pointer move with the region under the pointer (null when none). */
  onHover(listener: (hit: OrlojHit | null) => void): () => void;
  /** Fires when a face is clicked. */
  onSelect(listener: (envId: string) => void): () => void;
  layout(): OrlojLayout;
  /** Annotation mode: numbered leader lines and definitions on the first face; others dim. */
  setAnnotation(on: boolean): void;
  dispose(): void;
}
