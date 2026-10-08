// SPDX-License-Identifier: Apache-2.0
// Validation of the environment's free-form `options` block (decision 13).
import { z } from 'zod';

const MS_PER_MINUTE = 60_000;
const MAX_NAMESPACE_LENGTH = 256;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ENV_REF = /^\$\{env:[A-Z_][A-Z0-9_]*\}$/;

const FileSource = z.strictObject({
  kind: z.literal('file'),
  /** Relative to the working directory, or absolute. */
  path: z.string().min(1).max(4096),
});

/** An https URL, or http only for a loopback host. No credentials, query, or fragment. */
export const MarquezUrl = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Use an absolute URL such as https://marquez.example.org.',
      });
      return;
    }
    const isLocal = LOCAL_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use https. Plain http is accepted only for localhost, 127.0.0.1, or [::1].',
      });
    }
    if (url.username !== '' || url.password !== '') {
      ctx.addIssue({ code: 'custom', message: 'Do not put credentials in the URL; use apiKey.' });
    }
    if (url.search !== '' || url.hash !== '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Remove the query string or fragment from the URL.',
      });
    }
  });

const MarquezSource = z.strictObject({
  kind: z.literal('marquez'),
  url: MarquezUrl,
  /** Only events whose job namespace equals this are used. */
  namespace: z.string().min(1).max(MAX_NAMESPACE_LENGTH).optional(),
  /** A bearer token for a gateway in front of Marquez, as `${env:NAME}`. Never a literal. */
  apiKey: z
    .string()
    .regex(
      ENV_REF,
      'The apiKey accepts only an environment reference such as ${env:MARQUEZ_API_KEY}.',
    )
    .optional(),
});

const ReplayFields = z.strictObject({
  /** The instant the sample's earliest event is mapped to. Default: its own time (no shift). */
  anchor: z.iso.datetime({ offset: true }).optional(),
  /** How often the sample repeats: every day (default) or every hour. */
  period: z.enum(['day', 'hour']).default('day'),
});

export const OpenLineageOptions = z.strictObject({
  source: z.discriminatedUnion('kind', [FileSource, MarquezSource]),
  /** File sources only. `false` serves the events at their recorded times. */
  replay: z.union([z.literal(false), ReplayFields]).optional(),
});

export type OpenLineageOptions = z.infer<typeof OpenLineageOptions>;
export type FileSourceOptions = z.infer<typeof FileSource>;
export type MarquezSourceOptions = z.infer<typeof MarquezSource>;

export interface ReplaySettings {
  /** Epoch ms the earliest event maps to, or undefined for "its own time". */
  anchorMs: number | undefined;
  periodMs: number;
}

export const REPLAY_PERIOD_MS: Readonly<Record<'day' | 'hour', number>> = {
  day: 24 * 60 * MS_PER_MINUTE,
  hour: 60 * MS_PER_MINUTE,
};

/** The replay settings for a file source: on by default, off with `replay: false`. */
export function replaySettings(options: OpenLineageOptions): ReplaySettings | undefined {
  if (options.source.kind !== 'file' || options.replay === false) return undefined;
  const replay = options.replay ?? { period: 'day' as const };
  return {
    anchorMs: replay.anchor === undefined ? undefined : Date.parse(replay.anchor),
    periodMs: REPLAY_PERIOD_MS[replay.period],
  };
}

/** Validates `env.options`. Throws one readable message listing every problem. */
export function parseOptions(raw: unknown): OpenLineageOptions {
  const parsed = OpenLineageOptions.safeParse(raw);
  if (parsed.success) {
    if (parsed.data.source.kind !== 'file' && parsed.data.replay !== undefined) {
      throw new Error('Invalid openlineage options: replay applies to file sources only.');
    }
    return parsed.data;
  }
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'options';
    return `${path}: ${issue.message}`;
  });
  throw new Error(`Invalid openlineage options. ${issues.join(' ')}`);
}
