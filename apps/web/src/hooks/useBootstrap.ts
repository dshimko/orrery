// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import {
  type Api,
  ApiError,
  type EnvironmentSummary,
  isAbort,
  type PublicConfig,
} from '../lib/api.js';
import { healthError, orderEnvironments, promotionOrderOf } from '../lib/home.js';

export interface Bootstrap {
  config: PublicConfig;
  /** In promotion order. */
  environments: readonly EnvironmentSummary[];
  /** Health errors reported by `/api/environments`, by environment id. */
  healthErrors: Readonly<Record<string, string>>;
}

export type BootstrapState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: Bootstrap };

/** Loads the public config and the environment list (with health) that several pages need. */
export function useBootstrap(api: Api): BootstrapState {
  const [state, setState] = useState<BootstrapState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      const config = await api.config(signal);
      const healthErrors: Record<string, string> = {};
      let listed: readonly EnvironmentSummary[] = config.environments;
      try {
        const listing = await api.environments(signal);
        listed = listing.map(({ id, name, tier }) => ({ id, name, tier }));
        for (const item of listing) {
          const message = healthError(item.health);
          if (message !== null) healthErrors[item.id] = message;
        }
      } catch (error) {
        if (isAbort(error)) throw error;
        // The list is a convenience; the config already names every environment.
      }
      const environments = orderEnvironments(listed, promotionOrderOf(config.promotion));
      if (!signal.aborted)
        setState({ status: 'ready', data: { config, environments, healthErrors } });
    })().catch((error: unknown) => {
      if (signal.aborted || isAbort(error)) return;
      const message =
        error instanceof ApiError ? error.message : 'Could not load the environments.';
      setState({ status: 'error', message });
    });
    return () => {
      controller.abort();
    };
  }, [api]);

  return state;
}
