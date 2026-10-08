// SPDX-License-Identifier: Apache-2.0
// The slice of an OpenLineage RunEvent this adapter reads, normalized.

export type Tags = Readonly<Record<string, string>>;

/** OpenLineage run states; anything else (or a missing type) is `OTHER`. */
export type RunEventType = 'START' | 'RUNNING' | 'COMPLETE' | 'ABORT' | 'FAIL' | 'OTHER';

export interface DatasetRef {
  namespace: string;
  name: string;
  /** From the dataset `tags` facet, when present. */
  tags: Tags;
}

export interface JobRef {
  namespace: string;
  name: string;
  /** From the job `tags` facet and the `jobType` facet (`processingType`, `integration`, `jobType`). */
  tags: Tags;
  /** `jobType.processingType` is `STREAMING`. */
  streaming: boolean;
}

export interface RunEvent {
  eventType: RunEventType;
  /** `eventTime` in epoch milliseconds. */
  timeMs: number;
  runId: string;
  job: JobRef;
  inputs: DatasetRef[];
  outputs: DatasetRef[];
}

export const datasetKey = (ref: Pick<DatasetRef, 'namespace' | 'name'>): string =>
  `${ref.namespace}\u0000${ref.name}`;

export const jobKey = (ref: Pick<JobRef, 'namespace' | 'name'>): string =>
  `${ref.namespace}\u0000${ref.name}`;

/** Identity of one event, for de-duplication across polls: (runId, eventType, eventTime). */
export const eventIdentity = (event: RunEvent): string =>
  `${event.runId}|${event.eventType}|${event.timeMs}`;
