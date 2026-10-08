// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { Id, SecretRef, ValueOrEnvRef, strictObject } from './strict.js';
import { TopologyOverrides } from './topology.js';

export const BUILTIN_ADAPTERS = ['mock', 'databricks', 'openlineage'] as const;

const ScriptedIncident = strictObject({
  id: Id,
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour UTC time such as 02:30.'),
  durationMinutes: z.number().positive(),
  severity: z.enum(['incident', 'warning', 'info']),
  kind: z.string().min(1),
  target: z.string().min(1).optional(),
});

const MockProfile = strictObject({
  seed: z.number().int().optional(),
  scale: z.number().positive().max(10).default(1),
  failureRate: z.number().min(0).max(1).default(0.05),
  deploysPerHour: z.number().min(0).default(1),
  agingFactor: z.number().positive().default(1),
  incidents: z.array(ScriptedIncident).optional(),
});

const Auth = z.enum(['app-service-principal', 'on-behalf-of-user', 'oauth-m2m', 'pat']);

const Connection = strictObject({
  host: ValueOrEnvRef.optional(),
  warehouseId: ValueOrEnvRef.optional(),
  auth: Auth.default('app-service-principal'),
  clientId: SecretRef.optional(),
  clientSecret: SecretRef.optional(),
  token: SecretRef.optional(),
});

const Metastore = strictObject({
  id: Id,
  host: ValueOrEnvRef,
  warehouseId: ValueOrEnvRef,
});

const Federation = strictObject({
  mode: z.enum(['single-workspace', 'multi-workspace', 'multi-metastore']),
  metastores: z.array(Metastore).min(1).optional(),
  foreignCatalogs: strictObject({ show: z.boolean().default(true) }).optional(),
});

const Scope = strictObject({
  catalogs: z.array(z.string().min(1)).min(1).optional(),
  tag: z.record(z.string().min(1), z.string().min(1)).optional(),
});

export const Environment = strictObject({
  id: Id,
  name: z.string().min(1),
  tier: Id,
  topology: Id,
  overrides: TopologyOverrides.optional(),
  adapter: z.union([Id, z.array(Id).min(1)]),
  mock: MockProfile.optional(),
  connection: Connection.optional(),
  federation: Federation.optional(),
  scope: Scope.optional(),
  /** Free-form options for fork-registered adapters; each adapter validates its own block. */
  options: z.record(z.string(), z.unknown()).optional(),
});

/** Fork-registered adapters: config name to the package that implements `OrreryAdapter`. */
export const AdapterRegistry = z.record(Id, strictObject({ package: z.string().min(1) }));

export type Environment = z.infer<typeof Environment>;

export function adapterList(env: Pick<Environment, 'adapter'>): readonly string[] {
  return typeof env.adapter === 'string' ? [env.adapter] : env.adapter;
}
