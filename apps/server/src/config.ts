// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, parseConfig, type OrreryConfig } from '@orrery/core';

/** Repository root, found relative to this file (`src/` and `dist/` sit at the same depth). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'config/examples/demo.yaml');

export interface LoadedConfig {
  config: OrreryConfig;
  source: string;
  /** True when `ORRERY_CONFIG` was unset and the demo config was used. */
  isDefault: boolean;
}

/** Reads and validates the config named by `ORRERY_CONFIG`. Throws `ConfigError` or `Error`. */
export async function loadConfig(env: Record<string, string | undefined>): Promise<LoadedConfig> {
  const configured = env.ORRERY_CONFIG?.trim();
  const isDefault = !configured;
  const source = configured ? path.resolve(configured) : DEFAULT_CONFIG_PATH;
  let text: string;
  try {
    text = await readFile(source, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new Error(`Cannot read config file ${source} (${code}).`, { cause: error });
  }
  const result = parseConfig(text);
  if (!result.ok) throw new ConfigError(source, result.issues);
  return { config: result.config, source, isDefault };
}

export interface ListenOptions {
  host: string;
  port: number;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const MAX_PORT = 65535;

/** Reads HOST and PORT, failing fast on a malformed port. */
export function resolveListenOptions(env: Record<string, string | undefined>): ListenOptions {
  const host = env.HOST?.trim() || DEFAULT_HOST;
  const rawPort = env.PORT?.trim();
  if (!rawPort) return { host, port: DEFAULT_PORT };
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(`PORT must be an integer from 0 to ${MAX_PORT}, got "${rawPort}".`);
  }
  return { host, port };
}
