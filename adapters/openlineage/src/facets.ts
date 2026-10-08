// SPDX-License-Identifier: Apache-2.0
// Defensive readers for the OpenLineage facets this adapter uses beyond identity and tags:
// run `errorMessage` and `nominalTime`, and output `outputStatistics`. Anything of an unexpected
// shape, or out of bounds, is ignored rather than failing the event.

/** Longest error message kept for alert text, in characters. */
export const MAX_ERROR_MESSAGE_CHARS = 300;
/** Strings longer than this are not even scanned (a stack trace pasted into the message). */
const MAX_RAW_MESSAGE_CHARS = 20_000;
const MAX_TIMESTAMP_CHARS = 64;
/** Statistics above this are treated as bogus (1 EB, 1e18 rows). */
const MAX_STATISTIC = 1e18;
const ELLIPSIS = '…';

export interface OutputStatistics {
  rowCount?: number;
  sizeBytes?: number;
}

export interface RunFacetValues {
  errorMessage?: string;
  nominalStartMs?: number;
}

type Facets = Readonly<Record<string, unknown>>;

const asRecord = (value: unknown): Facets | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Facets)
    : undefined;

const isControl = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

/** Plain text: control characters become spaces, whitespace collapses, length is bounded. */
export function plainText(raw: string, maxChars: number): string | undefined {
  if (raw.length > MAX_RAW_MESSAGE_CHARS) return undefined;
  const cleaned = [...raw]
    .map((char) => (isControl(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return undefined;
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 1).trimEnd()}${ELLIPSIS}`;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_STATISTIC
    ? value
    : undefined;
}

/** `errorMessage.message` and `nominalTime.nominalStartTime` from a run's facets. */
export function runFacetsOf(facets: unknown): RunFacetValues {
  const record = asRecord(facets);
  const result: RunFacetValues = {};
  const message = asRecord(record?.['errorMessage'])?.['message'];
  const text =
    typeof message === 'string' ? plainText(message, MAX_ERROR_MESSAGE_CHARS) : undefined;
  if (text !== undefined) result.errorMessage = text;
  const nominal = asRecord(record?.['nominalTime'])?.['nominalStartTime'];
  if (typeof nominal === 'string' && nominal.length <= MAX_TIMESTAMP_CHARS) {
    const ms = Date.parse(nominal);
    if (!Number.isNaN(ms)) result.nominalStartMs = ms;
  }
  return result;
}

/** `outputStatistics.rowCount` and `.size` (bytes) from a dataset's output facets. */
export function outputStatisticsOf(outputFacets: unknown): OutputStatistics | undefined {
  const stats = asRecord(asRecord(outputFacets)?.['outputStatistics']);
  if (!stats) return undefined;
  const rowCount = nonNegative(stats['rowCount']);
  const sizeBytes = nonNegative(stats['size']);
  if (rowCount === undefined && sizeBytes === undefined) return undefined;
  return {
    ...(rowCount !== undefined ? { rowCount } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
  };
}
