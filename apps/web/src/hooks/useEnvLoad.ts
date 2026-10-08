// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology } from '@orrery/core';
import { useEffect, useState } from 'react';
import {
  type Api,
  ApiError,
  type EnvironmentListing,
  isAbort,
  type PublicConfig,
} from '../lib/api.js';

export interface EnvData {
  config: PublicConfig;
  /** From /api/environments; falls back to the config's list when that call fails. */
  environments: readonly { id: string; name: string; tier: string }[];
  topology: Topology;
  snapshot: Snapshot;
  startAt: Date;
}

export type EnvLoad =
  { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; data: EnvData };

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError('Something went wrong while loading this environment.', 0, 'unknown');
}

async function listEnvironments(
  api: Api,
  config: PublicConfig,
  signal: AbortSignal,
): Promise<readonly EnvironmentListing[] | PublicConfig['environments']> {
  try {
    return await api.environments(signal);
  } catch (error) {
    if (isAbort(error)) throw error;
    return config.environments;
  }
}

/** Loads config, topology, the first snapshot, and the environment list for one environment. */
export function useEnvLoad(api: Api, envId: string, startAt: Date): EnvLoad {
  const [state, setState] = useState<EnvLoad>({ status: 'loading' });
  const startMs = startAt.getTime();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const start = new Date(startMs);
    setState({ status: 'loading' });
    Promise.all([
      api.config(signal),
      api.topology(envId, signal),
      api.snapshot(envId, start, signal),
    ])
      .then(async ([config, topology, snapshot]) => {
        const environments = await listEnvironments(api, config, signal);
        if (signal.aborted) return;
        setState({
          status: 'ready',
          data: { config, environments, topology, snapshot, startAt: start },
        });
      })
      .catch((error: unknown) => {
        if (!signal.aborted) setState({ status: 'error', error: toApiError(error) });
      });
    return () => {
      controller.abort();
    };
  }, [api, envId, startMs]);

  return state;
}
