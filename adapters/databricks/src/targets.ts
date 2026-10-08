// SPDX-License-Identifier: Apache-2.0
import type { ResolvedEnvironment } from '@orrery/core';
import type { Target } from './contracts.js';
import { resolveRef, type EnvMap } from './env-refs.js';

const PRIMARY_METASTORE = 'primary';

/** Normalises a workspace host to `https://<host>`; throws a value-free message when invalid. */
export function normalizeHost(raw: string, label: string): string {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${label}: host is not a valid URL.`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label}: host must use https.`);
  if (url.username !== '' || url.password !== '') {
    throw new Error(`${label}: host must not contain credentials.`);
  }
  if (url.search !== '' || url.hash !== '' || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`${label}: host must not contain a path, query, or fragment.`);
  }
  if (url.hostname === '') throw new Error(`${label}: host is empty.`);
  return `https://${url.host}`;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

function buildTarget(
  environmentId: string,
  metastore: string,
  hostRef: string | undefined,
  hostFallback: string | undefined,
  warehouseRef: string | undefined,
  env: EnvMap,
  fieldPrefix: string,
): Target {
  const label = `Environment "${environmentId}"`;
  const host = resolveRef(hostRef, env) ?? hostFallback;
  if (host === undefined) {
    throw new Error(`${label}: missing ${fieldPrefix}host (set it or the variable it references).`);
  }
  const warehouseId = resolveRef(warehouseRef, env);
  if (warehouseId === undefined) {
    throw new Error(
      `${label}: missing ${fieldPrefix}warehouseId (set it or the variable it references).`,
    );
  }
  return { metastore, host: normalizeHost(host, `${label} ${fieldPrefix}host`), warehouseId };
}

/** One target per metastore in multi-metastore mode, otherwise a single `primary` target. */
export function resolveTargets(environment: ResolvedEnvironment, env: EnvMap): Target[] {
  const federation = environment.federation;
  if (federation?.mode === 'multi-metastore') {
    const metastores = federation.metastores ?? [];
    if (metastores.length === 0) {
      throw new Error(
        `Environment "${environment.id}": multi-metastore needs federation.metastores.`,
      );
    }
    return metastores.map((m) =>
      buildTarget(
        environment.id,
        m.id,
        m.host,
        undefined,
        m.warehouseId,
        env,
        `federation.metastores[${m.id}].`,
      ),
    );
  }
  const connection = environment.connection;
  return [
    buildTarget(
      environment.id,
      PRIMARY_METASTORE,
      connection?.host,
      nonEmpty(env['DATABRICKS_HOST']),
      connection?.warehouseId,
      env,
      'connection.',
    ),
  ];
}
