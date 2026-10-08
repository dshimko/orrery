// SPDX-License-Identifier: Apache-2.0
import type { AdapterContext, OrreryAdapter, ResolvedEnvironment } from '@orrery/core';

/** Everything the contract suite needs to exercise one adapter. `setup` must not call `init`. */
export interface ContractSubject {
  adapter: OrreryAdapter;
  env: ResolvedEnvironment;
  ctx: AdapterContext;
  at: Date;
}

export interface ContractOptions {
  /** Same inputs give identical output. Default true. */
  deterministic?: boolean;
  /** Length of the event window checked, in minutes. Default 60. */
  eventWindowMinutes?: number;
}
