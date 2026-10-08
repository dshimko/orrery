// SPDX-License-Identifier: Apache-2.0
// Parses OpenLineage RunEvents from a JSON array or newline-delimited JSON. Problems name a line
// or item number and a reason, never the content (it may be customer data).
import { z } from 'zod';
import { outputStatisticsOf, runFacetsOf } from './facets.js';
import type { DatasetRef, JobRef, RunEvent, RunEventType, Tags } from './types.js';

const MAX_NAME_LENGTH = 512;
const MAX_REPORTED_PROBLEMS = 20;
const EVENT_TYPES: ReadonlySet<string> = new Set(['START', 'RUNNING', 'COMPLETE', 'ABORT', 'FAIL']);

// Marquez serves absent lists and facet maps as JSON null, so every optional field is nullish.
const Facets = z.record(z.string(), z.unknown()).nullish();
const Name = z.string().min(1).max(MAX_NAME_LENGTH);
const Dataset = z.looseObject({
  namespace: Name,
  name: Name,
  facets: Facets,
  // Read defensively by outputStatisticsOf, so an odd shape never rejects the event.
  outputFacets: z.unknown().optional(),
});
const WireEvent = z.looseObject({
  eventType: z.string().max(32).optional(),
  eventTime: z.string().min(1).max(64),
  run: z.looseObject({ runId: Name, facets: z.unknown().optional() }),
  job: z.looseObject({ namespace: Name, name: Name, facets: Facets }),
  inputs: z.array(Dataset).nullish(),
  outputs: z.array(Dataset).nullish(),
});

export interface ParseResult {
  events: RunEvent[];
  /** Entries that were skipped, as `line 3: reason` or `item 4: reason` (first 20). */
  problems: string[];
  /** Total entries skipped, including those beyond the reported problems. */
  skipped: number;
}

/** `tags` facet entries (`[{ key, value }]`) as a map. Tolerates a missing or odd shape. */
function tagsOf(facets: Record<string, unknown> | null | undefined): Record<string, string> {
  const facet = facets?.['tags'];
  const list =
    typeof facet === 'object' && facet !== null ? (facet as { tags?: unknown }).tags : undefined;
  const tags: Record<string, string> = {};
  if (!Array.isArray(list)) return tags;
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, value } = entry as { key?: unknown; value?: unknown };
    if (typeof key === 'string' && key !== '') tags[key] = typeof value === 'string' ? value : '';
  }
  return tags;
}

function jobTypeOf(facets: Record<string, unknown> | null | undefined): {
  tags: Record<string, string>;
  streaming: boolean;
} {
  const facet = facets?.['jobType'];
  const tags: Record<string, string> = {};
  if (typeof facet !== 'object' || facet === null) return { tags, streaming: false };
  const record = facet as Record<string, unknown>;
  for (const key of ['processingType', 'integration', 'jobType']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') tags[key] = value;
  }
  return { tags, streaming: tags['processingType']?.toUpperCase() === 'STREAMING' };
}

function datasetOf(raw: z.infer<typeof Dataset>): DatasetRef {
  const stats = outputStatisticsOf(raw.outputFacets);
  return {
    namespace: raw.namespace,
    name: raw.name,
    tags: tagsOf(raw.facets),
    ...(stats ? { stats } : {}),
  };
}

function jobOf(raw: z.infer<typeof WireEvent>['job']): JobRef {
  const type = jobTypeOf(raw.facets);
  return {
    namespace: raw.namespace,
    name: raw.name,
    tags: { ...tagsOf(raw.facets), ...type.tags } as Tags,
    streaming: type.streaming,
  };
}

function typeOf(raw: string | undefined): RunEventType {
  const upper = raw?.toUpperCase() ?? '';
  return EVENT_TYPES.has(upper) ? (upper as RunEventType) : 'OTHER';
}

/** Validates one decoded value. Returns the event or a reason it was skipped. */
export function normalizeEvent(value: unknown): RunEvent | string {
  if (typeof value === 'object' && value !== null && !('run' in value)) {
    return 'not a RunEvent (no run)';
  }
  const parsed = WireEvent.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return `invalid RunEvent at ${issue?.path.join('.') || 'event'}`;
  }
  const timeMs = Date.parse(parsed.data.eventTime);
  if (Number.isNaN(timeMs)) return 'invalid eventTime';
  return {
    eventType: typeOf(parsed.data.eventType),
    timeMs,
    runId: parsed.data.run.runId,
    job: jobOf(parsed.data.job),
    inputs: (parsed.data.inputs ?? []).map(datasetOf),
    outputs: (parsed.data.outputs ?? []).map(datasetOf),
    ...runFacetsOf(parsed.data.run.facets),
  };
}

class Collector {
  readonly events: RunEvent[] = [];
  readonly problems: string[] = [];
  skipped = 0;

  accept(label: string, value: unknown): void {
    const result = normalizeEvent(value);
    if (typeof result === 'string') this.reject(label, result);
    else this.events.push(result);
  }

  reject(label: string, reason: string): void {
    this.skipped += 1;
    if (this.problems.length < MAX_REPORTED_PROBLEMS) this.problems.push(`${label}: ${reason}`);
  }

  result(): ParseResult {
    return { events: this.events, problems: this.problems, skipped: this.skipped };
  }
}

function parseArray(text: string, out: Collector): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error('The content is not valid JSON.');
  }
  if (!Array.isArray(decoded)) throw new Error('The content is not a JSON array.');
  decoded.forEach((item, index) => out.accept(`item ${index + 1}`, item));
}

function parseLines(text: string, out: Collector): void {
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      out.reject(`line ${index + 1}`, 'not valid JSON');
      return;
    }
    out.accept(`line ${index + 1}`, decoded);
  });
}

/**
 * Parses a JSON array of RunEvents, or one JSON event per line. Bad entries are skipped and
 * reported; a document that is not JSON at all throws.
 */
export function parseRunEvents(text: string): ParseResult {
  const out = new Collector();
  if (text.trimStart().startsWith('[')) parseArray(text, out);
  else parseLines(text, out);
  return out.result();
}

/** A short health note for skipped entries, or undefined when there were none. */
export function describeProblems(
  result: Pick<ParseResult, 'problems' | 'skipped'>,
): string | undefined {
  if (result.skipped === 0) return undefined;
  const first = result.problems[0];
  return `Skipped ${result.skipped} entries that are not valid RunEvents${first ? ` (first: ${first})` : ''}.`;
}
