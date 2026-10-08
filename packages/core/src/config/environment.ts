// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { Id, SecretRef, ValueOrEnvRef, strictObject } from './strict.js';
import { TopologyOverrides } from './topology.js';

export const BUILTIN_ADAPTERS = ['mock', 'databricks', 'openlineage'] as const;

const ObjectRefString = z
  .string()
  .regex(
    /^(hub|spoke|sourceGroup|site|useCase|foreign|metastore|shipyard)(:[a-z0-9][a-z0-9_-]*)?$/,
    'Use kind:id, for example spoke:sales or useCase:exec (or a bare kind such as shipyard).',
  );

const ScriptedIncident = strictObject({
  id: Id,
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour UTC time such as 02:30.'),
  durationMinutes: z.number().positive().max(1440),
  severity: z.enum(['incident', 'warning', 'info']),
  /** Behavior the mock simulates, such as transfer-hold or schema-drift; any string is allowed. */
  kind: z.string().min(1),
  title: z.string().min(1),
  text: z.string().default(''),
  targets: z.array(ObjectRefString).min(1),
});

const MockProfile = strictObject({
  seed: z.number().int().optional(),
  scale: z.number().positive().max(10).default(1),
  failureRate: z.number().min(0).max(1).default(0.05),
  deploysPerHour: z.number().min(0).default(1),
  agingFactor: z.number().positive().default(1),
  /** Environment that releases from this one promote to (default by tier: dev to stg to prod). */
  promotesTo: Id.optional(),
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
  name: z.string().min(1).optional(),
  host: ValueOrEnvRef.optional(),
  warehouseId: ValueOrEnvRef.optional(),
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
  adapter: z.union([Id, z.array(Id).min(1)], {
    error: 'Set adapter to mock, databricks, openlineage, or a name registered under "adapters".',
  }),
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
export type MockProfile = z.infer<typeof MockProfile>;
export type ScriptedIncident = z.infer<typeof ScriptedIncident>;

export function adapterList(env: Pick<Environment, 'adapter'>): readonly string[] {
  return typeof env.adapter === 'string' ? [env.adapter] : env.adapter;
}
