// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

const MAX_SUGGESTION_DISTANCE = 3;

/** Levenshtein edit distance, used to suggest the key a user probably meant. */
export function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(above + 1, (previous[j - 1] ?? 0) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

/** Returns the closest known key, or undefined when nothing is close enough to be a typo. */
export function suggestKey(unknown: string, known: readonly string[]): string | undefined {
  const lowered = unknown.toLowerCase();
  let best: { key: string; distance: number } | undefined;
  for (const key of known) {
    const distance = editDistance(lowered, key.toLowerCase());
    if (distance <= MAX_SUGGESTION_DISTANCE && (!best || distance < best.distance)) {
      best = { key, distance };
    }
  }
  return best?.key;
}

export function unknownKeyMessage(keys: readonly string[], known: readonly string[]): string {
  const parts = keys.map((key) => {
    const suggestion = suggestKey(key, known);
    return suggestion
      ? `Unknown key "${key}". Did you mean "${suggestion}"?`
      : `Unknown key "${key}".`;
  });
  return `${parts.join(' ')} Allowed keys: ${known.join(', ')}.`;
}

/**
 * A strict object whose unknown-key error names the closest valid key and lists the allowed ones.
 * Every object in the config schema is built with this, so typos never pass silently.
 */
export function strictObject<T extends z.ZodRawShape>(shape: T) {
  const known = Object.keys(shape);
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? unknownKeyMessage(issue.keys, known) : undefined,
  });
}

/** Lowercase slug used for every id in the config: environments, spokes, topologies, adapters. */
export const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, 'Use lowercase letters, digits, "-" or "_" (max 63 chars).');

export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color like #3FC1CF.');

const ENV_REF = /^\$\{env:([A-Z_][A-Z0-9_]*)\}$/;

/** A secret field. Only `${env:NAME}` references are accepted, never literal values. */
export const SecretRef = z
  .string()
  .regex(
    ENV_REF,
    'Secret fields accept only an environment reference such as ${env:ORRERY_TOKEN}; never put a literal secret in config.',
  );

/** Non-secret connection values may be literal or an `${env:NAME}` reference. */
export const ValueOrEnvRef = z.string().min(1);

export function envRefName(value: string): string | undefined {
  return ENV_REF.exec(value)?.[1];
}
