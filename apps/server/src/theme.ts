// SPDX-License-Identifier: Apache-2.0
// Fork theme overrides: a YAML file with one top-level `visuals:` key holding a partial visuals
// object, merged over the main config's visuals and validated again with the core schema.
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigError, Visuals, type ConfigIssue, type OrreryConfig } from '@orrery/core';
import { parseDocument } from 'yaml';

/** Where a fork keeps its theme, relative to the working directory. */
export const DEFAULT_THEME_PATH = 'config/private/theme.yaml';
const THEME_KEY = 'visuals';

export interface ThemeResult {
  config: OrreryConfig;
  /** The theme file that was applied; undefined when there is none. */
  source?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Objects merge key by key; arrays and scalars in `override` replace the base value. */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const entries = new Map<string, unknown>(Object.entries(base));
  for (const [key, value] of Object.entries(override)) {
    entries.set(key, entries.has(key) ? deepMerge(entries.get(key), value) : value);
  }
  return Object.fromEntries(entries);
}

function formatPath(segments: readonly PropertyKey[]): string {
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc ? `${acc}.${String(segment)}` : String(segment);
  }, '');
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveThemeFile(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): Promise<string | undefined> {
  const configured = env.ORRERY_THEME?.trim();
  if (configured) return path.resolve(cwd, configured);
  const fallback = path.resolve(cwd, DEFAULT_THEME_PATH);
  return (await exists(fallback)) ? fallback : undefined;
}

function parseThemeVisuals(text: string): { visuals: Record<string, unknown> } | ConfigIssue[] {
  const doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    return doc.errors.map((error) => ({ path: '(yaml)', message: error.message }));
  }
  const root: unknown = doc.toJS();
  if (!isPlainObject(root)) {
    return [{ path: '(root)', message: `Expected an object with a "${THEME_KEY}" key.` }];
  }
  const unknownKeys = Object.keys(root).filter((key) => key !== THEME_KEY);
  if (unknownKeys.length > 0) {
    return unknownKeys.map((key) => ({
      path: key,
      message: `Unrecognized key; a theme file has only "${THEME_KEY}".`,
    }));
  }
  const visuals = root[THEME_KEY];
  if (!isPlainObject(visuals)) {
    return [{ path: THEME_KEY, message: 'Expected an object of visuals overrides.' }];
  }
  return { visuals };
}

/**
 * Applies the theme named by `ORRERY_THEME`, else `config/private/theme.yaml` when it exists.
 * Throws `ConfigError` for an invalid theme and `Error` for an unreadable `ORRERY_THEME` file.
 */
export async function applyTheme(
  config: OrreryConfig,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): Promise<ThemeResult> {
  const source = await resolveThemeFile(env, cwd);
  if (!source) return { config };
  let text: string;
  try {
    text = await readFile(source, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new Error(`Cannot read theme file ${source} (${code}).`, { cause: error });
  }
  const parsed = parseThemeVisuals(text);
  if (Array.isArray(parsed)) throw new ConfigError(source, parsed);
  const merged = Visuals.safeParse(deepMerge(config.visuals, parsed.visuals));
  if (!merged.success) {
    throw new ConfigError(
      source,
      merged.error.issues.map((issue) => ({
        path: formatPath([THEME_KEY, ...issue.path]),
        message: issue.message,
      })),
    );
  }
  return { config: { ...config, visuals: merged.data }, source };
}
