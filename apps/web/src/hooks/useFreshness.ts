// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { createFreshnessTracker, type FreshnessTracker } from '../lib/freshness.js';

/** One freshness tracker per page; data hooks report poll outcomes into it. */
export function useFreshness(): FreshnessTracker {
  return useState(createFreshnessTracker)[0];
}
