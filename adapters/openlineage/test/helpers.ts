// SPDX-License-Identifier: Apache-2.0
import { parseConfigOrThrow, type ResolvedEnvironment } from '@orrery/core';
import { FixedClock, silentLogger } from '@orrery/testkit';
import type { AdapterContext } from '@orrery/core';
import type { DatasetRef, RunEvent, RunEventType } from '../src/types.js';

export const REPO_ROOT = new URL('../../..', import.meta.url).pathname;
export const T0 = Date.parse('2026-03-02T10:00:00.000Z');
export const MIN = 60_000;

const BASE_TOPOLOGY = `
hub: { id: core, name: Core }
spokes:
  - id: raw
    name: Raw
    role: ingest
    match: { catalog: lake, schema: 'raw.*' }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
  - id: mart
    name: Mart
    role: domain
    match: { catalog: lake, schema: 'mart.*' }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
sourceGroups:
  - id: ext
    name: External
    utcOffset: 0
    match: { catalog: ext }
  - id: loaders
    name: Loaders
    utcOffset: 0
    match: { schema: 'load_*' }
useCases:
  - id: board
    name: Board
    match: { schema: 'report_*' }
`;

const indent = (text: string, spaces: number): string =>
  text
    .trim()
    .split('\n')
    .map((line) => ' '.repeat(spaces) + line)
    .join('\n');

/** An environment `t` using the openlineage adapter, with a topology and options as YAML. */
export function makeEnv(
  options: string,
  topology: string = BASE_TOPOLOGY,
  envId = 't',
): ResolvedEnvironment {
  const yaml = `version: 1
topologies:
  main:
${indent(topology, 4)}
environments:
  - id: ${envId}
    name: Test
    tier: dev
    topology: main
    adapter: openlineage
    options:
${indent(options, 6)}
`;
  const config = parseConfigOrThrow(yaml, 'test.yaml');
  const env = config.environments[0];
  if (!env) throw new Error('no environment');
  return env;
}

export const FILE_OPTIONS = `source: { kind: file, path: x.json }
replay: false`;

export function context(
  at: Date | string | number,
  env: Record<string, string> = {},
): AdapterContext {
  return {
    clock: new FixedClock(typeof at === 'number' ? new Date(at) : at),
    logger: silentLogger,
    env,
  };
}

export const dataset = (
  name: string,
  namespace = 'lake',
  tags: Record<string, string> = {},
): DatasetRef => ({
  namespace,
  name,
  tags,
});

export interface EventSpec {
  type: RunEventType;
  atMin: number;
  run: string;
  job: string;
  inputs?: DatasetRef[];
  outputs?: DatasetRef[];
  jobTags?: Record<string, string>;
  streaming?: boolean;
  namespace?: string;
}

export function ev(spec: EventSpec): RunEvent {
  return {
    eventType: spec.type,
    timeMs: T0 + spec.atMin * MIN,
    runId: spec.run,
    job: {
      namespace: spec.namespace ?? 'jobs',
      name: spec.job,
      tags: spec.jobTags ?? {},
      streaming: spec.streaming ?? false,
    },
    inputs: spec.inputs ?? [],
    outputs: spec.outputs ?? [],
  };
}

/** The wire form of an event, as a file or Marquez would carry it. */
export function wire(event: RunEvent): Record<string, unknown> {
  const facets = (job: RunEvent['job']): Record<string, unknown> => ({
    ...(Object.keys(job.tags).length > 0
      ? { tags: { tags: Object.entries(job.tags).map(([key, value]) => ({ key, value })) } }
      : {}),
  });
  return {
    eventType: event.eventType,
    eventTime: new Date(event.timeMs).toISOString(),
    run: { runId: event.runId },
    job: { namespace: event.job.namespace, name: event.job.name, facets: facets(event.job) },
    inputs: event.inputs.map(({ namespace, name }) => ({ namespace, name })),
    outputs: event.outputs.map(({ namespace, name }) => ({ namespace, name })),
  };
}
