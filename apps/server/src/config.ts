// SPDX-License-Identifier: Apache-2.0
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, parseConfig, type OrreryConfig } from '@orrery/core';
import { applyTheme } from './theme.js';

/** Repository root, found relative to this file (`src/` and `dist/` sit at the same depth). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'config/examples/demo.yaml');
/** Where the packaged app ships the demo config, relative to the working directory. */
const PACKAGED_CONFIG_PATH = 'config/demo.yaml';

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The default demo config: the repository copy when running from source, else the packaged
 * copy under the working directory (the repository root does not exist inside the bundle).
 */
async function resolveDefaultConfig(): Promise<string> {
  if (await exists(DEFAULT_CONFIG_PATH)) return DEFAULT_CONFIG_PATH;
  const packaged = path.resolve(PACKAGED_CONFIG_PATH);
  if (await exists(packaged)) return packaged;
  throw new Error(
    `No default demo config found (looked for ${DEFAULT_CONFIG_PATH} and ${packaged}). ` +
      'Set ORRERY_CONFIG to a config file.',
  );
}

export interface LoadedConfig {
  config: OrreryConfig;
  source: string;
  /** True when `ORRERY_CONFIG` was unset and the demo config was used. */
  isDefault: boolean;
  /** The theme file merged over the config's visuals, when one applied. */
  themeSource?: string;
}

/**
 * Reads and validates the config named by `ORRERY_CONFIG` (relative paths resolve against the
 * working directory), then applies a fork theme override if one exists (`ORRERY_THEME` or
 * `config/private/theme.yaml`). Throws `ConfigError` or `Error`. */
export async function loadConfig(
  env: Record<string, string | undefined>,
  cwd: string = process.cwd(),
): Promise<LoadedConfig> {
  const configured = env.ORRERY_CONFIG?.trim();
  const isDefault = !configured;
  const source = configured ? path.resolve(configured) : await resolveDefaultConfig();
  let text: string;
  try {
    text = await readFile(source, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new Error(`Cannot read config file ${source} (${code}).`, { cause: error });
  }
  const result = parseConfig(text);
  if (!result.ok) throw new ConfigError(source, result.issues);
  const themed = await applyTheme(result.config, env, cwd);
  return {
    config: themed.config,
    source,
    isDefault,
    ...(themed.source ? { themeSource: themed.source } : {}),
  };
}

export interface ListenOptions {
  host: string;
  port: number;
}

const DEFAULT_HOST = '127.0.0.1';
const APP_HOST = '0.0.0.0';
const DEFAULT_PORT = 8787;
const MAX_PORT = 65535;

/**
 * Reads HOST and PORT, failing fast on a malformed port. Databricks Apps sets
 * `DATABRICKS_APP_PORT`: it is the port fallback and implies binding all interfaces.
 */
export function resolveListenOptions(env: Record<string, string | undefined>): ListenOptions {
  const appPort = env.DATABRICKS_APP_PORT?.trim();
  const host = env.HOST?.trim() || (appPort ? APP_HOST : DEFAULT_HOST);
  const rawPort = env.PORT?.trim() || appPort;
  if (!rawPort) return { host, port: DEFAULT_PORT };
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(`PORT must be an integer from 0 to ${MAX_PORT}, got "${rawPort}".`);
  }
  return { host, port };
}
