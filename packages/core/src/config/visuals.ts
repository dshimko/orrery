// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { HexColor, Id, strictObject } from './strict.js';

const num = (value: number) => z.number().default(value);
const pos = (value: number) => z.number().positive().default(value);
const color = (value: string) => HexColor.default(value);

const World = strictObject({
  hubRadius: pos(5),
  productRingRadius: pos(7.4),
  productRingTiltDeg: num(18),
  stationOrbit: pos(11),
  beltRadius: pos(128),
  beltSpread: pos(12),
  cometEllipse: z.tuple([z.number().positive(), z.number().positive()]).default([150, 92]),
});

/** radius = clamp(base + scale × log10(age in minutes), min, max) */
const FreshnessOrbit = strictObject({
  base: num(24),
  scale: num(22),
  min: pos(24),
  max: pos(104),
});

/** size = base + scale × sqrt(metric ÷ largest metric across spokes) */
const PlanetSize = strictObject({ base: pos(1.8), scale: pos(3.4) });

/** speed = 2π ÷ (periodHours × (radius ÷ referenceRadius)^1.5) radians per simulated hour */
const OrbitSpeed = strictObject({ periodHours: pos(26), referenceRadius: pos(30) });

const Colors = strictObject({
  tiers: z.record(Id, HexColor).default({ dev: '#3FC1CF', stg: '#FFB020', prod: '#6EA8FF' }),
  bronze: color('#C0804A'),
  silver: color('#D5DEEA'),
  gold: color('#F3D36B'),
  streaming: color('#37D6E8'),
  ml: color('#E070FF'),
  build: color('#9B8CFF'),
  sharing: color('#3FC1CF'),
  federated: color('#B9F3FF'),
  incident: color('#FF4D4F'),
  warning: color('#FFB020'),
  info: color('#6EA8FF'),
});

/** Reference spoke palette: the first color is for the ingest spoke, the rest cycle over the domain spokes. */
export const DEFAULT_PALETTE: readonly string[] = [
  '#9FC4FF',
  '#5FA8D3',
  '#7BC8A4',
  '#B79CED',
  '#F28FAD',
  '#E9966B',
  '#A3B1C6',
];

const Lighting = strictObject({
  ambientColor: color('#8EA2C6'),
  ambientIntensity: z.number().min(0).default(0.42),
  sunPosition: z.tuple([z.number(), z.number(), z.number()]).default([-460, 90, -320]),
  starCount: z.number().int().min(0).default(2200),
});

const Camera = strictObject({
  fovDeg: pos(38),
  tweenRate: pos(4.5),
  inertiaDecay: pos(2.8),
});

const Time = strictObject({
  secondsPerSimDay: pos(120),
  speeds: z.array(z.number().positive()).min(1).default([1, 2, 4]),
});

const Stability = strictObject({
  approachRate: z.number().min(1.2).max(4).default(2),
  hysteresis: z.number().min(0).max(0.2).default(0.03),
  meanAgeCadenceMinutes: pos(30),
  domHz: z.number().positive().max(4).default(4),
});

const Orloj = strictObject({
  faceSize: z.tuple([z.number().positive(), z.number().positive()]).default([440, 820]),
  breakpoints: strictObject({ three: pos(1150), two: pos(720) }).prefault({}),
  maxScale: pos(1.25),
  dial: strictObject({
    center: z.tuple([z.number(), z.number()]).default([220, 345]),
    radius: pos(140),
    rimWidth: pos(9),
    hourRingWidth: pos(22),
  }).prefault({}),
  spokeDistance: strictObject({ base: num(18), span: num(62), orbitRange: pos(80) }).prefault({}),
  spokeSize: strictObject({ base: pos(4.5), scale: pos(5) }).prefault({}),
  zodiacTurnsPerDay: pos(0.25),
  procession: strictObject({
    minutes: pos(30),
    minFigures: z.number().int().min(0).default(3),
    maxFigures: z.number().int().positive().default(12),
  }).prefault({}),
  calendar: strictObject({
    center: z.tuple([z.number(), z.number()]).default([220, 650]),
    radius: pos(100),
  }).prefault({}),
});

const VehicleKind = z.enum([
  'laser-pulse',
  'cargo-pod',
  'shuttle',
  'gantry-crate',
  'aurora-orb',
  'gold-pulse',
  'drone',
]);

const Workload = strictObject({
  id: Id,
  name: z.string().min(1),
  vehicle: VehicleKind,
  color: HexColor,
  /** Name of an adapter query (never free-form SQL) that feeds this workload. */
  source: z.string().min(1).optional(),
});

export const DEFAULT_WORKLOADS: readonly z.input<typeof Workload>[] = [
  { id: 'streaming', name: 'Streaming', vehicle: 'laser-pulse', color: '#37D6E8' },
  { id: 'batch', name: 'Batch loads', vehicle: 'cargo-pod', color: '#C0804A' },
  { id: 'transfer', name: 'Transfer and copy', vehicle: 'shuttle', color: '#D5DEEA' },
  { id: 'transform', name: 'Transform and quality', vehicle: 'gantry-crate', color: '#F3D36B' },
  { id: 'ml', name: 'ML training and scoring', vehicle: 'aurora-orb', color: '#E070FF' },
  { id: 'serving', name: 'Serving and BI', vehicle: 'gold-pulse', color: '#F3D36B' },
  { id: 'build', name: 'Build and deploy', vehicle: 'drone', color: '#9B8CFF' },
];

export const Visuals = strictObject({
  sizeBy: z.enum(['pipelines', 'products', 'complexity', 'volume']).default('pipelines'),
  workloads: z
    .union([z.literal('default'), z.array(Workload).min(1)])
    .default('default')
    .transform((value) => (value === 'default' ? DEFAULT_WORKLOADS.map((w) => ({ ...w })) : value)),
  theme: z.enum(['dark', 'light']).default('dark'),
  world: World.prefault({}),
  freshnessOrbit: FreshnessOrbit.prefault({}),
  planetSize: PlanetSize.prefault({}),
  orbitSpeed: OrbitSpeed.prefault({}),
  colors: Colors.prefault({}),
  palette: z
    .array(HexColor)
    .min(1)
    .default([...DEFAULT_PALETTE]),
  spokeColors: z.record(Id, HexColor).default({}),
  lighting: Lighting.prefault({}),
  camera: Camera.prefault({}),
  time: Time.prefault({}),
  stability: Stability.prefault({}),
  orloj: Orloj.prefault({}),
});

export type Visuals = z.infer<typeof Visuals>;
export type Workload = z.infer<typeof Workload>;
