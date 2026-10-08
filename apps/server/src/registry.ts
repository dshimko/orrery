// SPDX-License-Identifier: Apache-2.0
import { MockAdapter } from '@orrery/adapter-mock';
import {
  adapterList,
  type AdapterContext,
  type AdapterFactory,
  type AdapterHealth,
  type Clock,
  type Logger,
  type OrreryAdapter,
  type OrreryConfig,
  type ResolvedEnvironment,
} from '@orrery/core';
import { errorMessage } from './logger.js';

export const ADAPTER_INIT_TIMEOUT_MS = 10_000;

const NOT_YET_AVAILABLE = new Set(['databricks', 'openlineage']);

/** One configured environment: a live adapter, or the reason there is none. */
export interface EnvRuntime {
  env: ResolvedEnvironment;
  adapter?: OrreryAdapter;
  /** Client-safe reason the environment has no adapter. */
  unavailableMessage?: string;
}

export interface RegistryDeps {
  clock: Clock;
  logger: Logger;
  env: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
  initTimeoutMs?: number;
}

function unavailable(env: ResolvedEnvironment, message: string): EnvRuntime {
  return { env, unavailableMessage: message };
}

function isAdapter(value: unknown): value is OrreryAdapter {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ['init', 'topology', 'snapshot', 'events', 'health', 'dispose'].every(
    (method) => typeof candidate[method] === 'function',
  );
}

async function loadForkAdapter(packageName: string): Promise<OrreryAdapter> {
  const module = (await import(packageName)) as { default?: unknown };
  if (typeof module.default !== 'function') {
    throw new Error(`Package "${packageName}" has no default export that is an AdapterFactory.`);
  }
  const adapter = (module.default as AdapterFactory)();
  if (!isAdapter(adapter)) {
    throw new Error(`Package "${packageName}" did not return an OrreryAdapter.`);
  }
  return adapter;
}

async function createAdapter(
  name: string,
  config: OrreryConfig,
): Promise<OrreryAdapter | { message: string }> {
  if (name === 'mock') return new MockAdapter();
  if (NOT_YET_AVAILABLE.has(name)) return { message: `The ${name} adapter is not available yet.` };
  const registered = config.adapters?.[name];
  if (!registered) return { message: `The adapter "${name}" is not registered.` };
  return loadForkAdapter(registered.package);
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms.`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Loads and initializes one adapter. Init gets its own signal, aborted on timeout or shutdown. */
async function bootAdapter(
  env: ResolvedEnvironment,
  name: string,
  config: OrreryConfig,
  deps: RegistryDeps,
  signal: AbortSignal,
  onCreated: (adapter: OrreryAdapter) => void,
): Promise<EnvRuntime> {
  let adapter: OrreryAdapter | { message: string };
  try {
    adapter = await createAdapter(name, config);
  } catch (error) {
    deps.logger.error('adapter load failed', {
      envId: env.id,
      adapter: name,
      error: errorMessage(error),
    });
    return unavailable(env, `The ${name} adapter could not be loaded.`);
  }
  if (!isAdapter(adapter)) return unavailable(env, adapter.message);
  onCreated(adapter);
  const context: AdapterContext = { clock: deps.clock, logger: deps.logger, env: deps.env, signal };
  await adapter.init(env, context);
  return { env, adapter };
}

export const DISPOSE_TIMEOUT_MS = 2000;

/**
 * Starts one environment. Loading, the factory, and init all run under one deadline; on
 * timeout or failure the adapter's signal aborts and it is disposed (also bounded), so one
 * environment can never block the others or the server.
 */
async function startEnvironment(
  env: ResolvedEnvironment,
  config: OrreryConfig,
  deps: RegistryDeps,
): Promise<EnvRuntime> {
  const names = adapterList(env);
  if (names.length > 1) return unavailable(env, 'Adapter composition is not supported yet.');
  const name = names[0] ?? '';
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, deps.signal]);
  let created: OrreryAdapter | undefined;
  try {
    return await withTimeout(
      bootAdapter(env, name, config, deps, signal, (adapter) => {
        created = adapter;
      }),
      deps.initTimeoutMs ?? ADAPTER_INIT_TIMEOUT_MS,
    );
  } catch (error) {
    controller.abort();
    deps.logger.error('adapter init failed', {
      envId: env.id,
      adapter: name,
      error: errorMessage(error),
    });
    if (created) await withTimeout(created.dispose(), DISPOSE_TIMEOUT_MS).catch(() => undefined);
    return unavailable(env, `The ${name} adapter failed to start.`);
  }
}

/** Environments in promotion order, then the rest in config order. */
export function orderEnvironments(config: OrreryConfig): ResolvedEnvironment[] {
  const order = config.promotion?.order ?? [];
  const byId = new Map(config.environments.map((env) => [env.id, env]));
  const promoted = order.flatMap((id) => byId.get(id) ?? []);
  const promotedIds = new Set(promoted.map((env) => env.id));
  return [...promoted, ...config.environments.filter((env) => !promotedIds.has(env.id))];
}

/** Starts one adapter per environment in parallel. Never rejects: failures become runtimes. */
export async function startEnvironments(
  config: OrreryConfig,
  deps: RegistryDeps,
): Promise<EnvRuntime[]> {
  return Promise.all(orderEnvironments(config).map((env) => startEnvironment(env, config, deps)));
}

const HEALTH_CACHE_MS = 5000;
const healthCache = new WeakMap<EnvRuntime, { atMs: number; value: Promise<AdapterHealth> }>();

/**
 * Health for the home page card, cached for a few seconds per environment with one shared
 * in-flight call, so polling clients cannot drive unbounded adapter work.
 */
export function cachedHealthOf(
  runtime: EnvRuntime,
  clock: Clock,
  logger: Logger,
  nowMs: () => number = () => performance.now(),
): Promise<AdapterHealth> {
  const hit = healthCache.get(runtime);
  if (hit && nowMs() - hit.atMs < HEALTH_CACHE_MS) return hit.value;
  const value = healthOf(runtime, clock, logger);
  healthCache.set(runtime, { atMs: nowMs(), value });
  return value;
}

/** Health for the home page card; adapter failures are reported, not thrown. */
export async function healthOf(
  runtime: EnvRuntime,
  clock: Clock,
  logger: Logger,
): Promise<AdapterHealth> {
  const checkedAt = clock.now().toISOString();
  if (!runtime.adapter) {
    return { status: 'error', message: runtime.unavailableMessage ?? 'Unavailable.', checkedAt };
  }
  try {
    return await withTimeout(runtime.adapter.health(), ADAPTER_INIT_TIMEOUT_MS);
  } catch (error) {
    logger.error('adapter health failed', { envId: runtime.env.id, error: errorMessage(error) });
    return { status: 'error', message: 'The health check failed.', checkedAt };
  }
}
