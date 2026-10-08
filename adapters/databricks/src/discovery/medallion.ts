// SPDX-License-Identifier: Apache-2.0
// Medallion tier of a schema according to the configured strategy.
import { matchGlob, type TopologyConfig } from '@orrery/core';
import type { Tags } from '../rows.js';
import type { Tier } from './types.js';

export type MedallionConfig = NonNullable<TopologyConfig['medallion']>;

/** Tag keys read by the `tag` strategy, in order. */
const TIER_TAG_KEYS: readonly string[] = ['medallion', 'tier'];
const TIERS: readonly Tier[] = ['bronze', 'silver', 'gold'];

export interface TierSubject {
  catalog: string;
  base: string;
  schema: string;
  tags: Tags;
}

function candidates(strategy: MedallionConfig['strategy'], subject: TierSubject): string[] {
  switch (strategy) {
    case 'schema-suffix':
      return [subject.schema];
    case 'catalog-prefix':
      return [subject.base, subject.catalog];
    case 'tag': {
      const lowered = new Map(Object.entries(subject.tags).map(([k, v]) => [k.toLowerCase(), v]));
      return TIER_TAG_KEYS.flatMap((key) => {
        const value = lowered.get(key);
        return value === undefined ? [] : [value];
      });
    }
  }
}

/** The tier a schema belongs to, or undefined when no pattern matches. */
export function tierOf(
  medallion: MedallionConfig | undefined,
  subject: TierSubject,
): Tier | undefined {
  if (!medallion) return undefined;
  const values = candidates(medallion.strategy, subject);
  return TIERS.find((tier) =>
    medallion[tier].some((glob) => values.some((value) => matchGlob(glob, value))),
  );
}

const RANK: Readonly<Record<Tier, number>> = { bronze: 0, silver: 1, gold: 2 };

/** The highest tier in the list; undefined when empty. */
export function highestTier(tiers: readonly (Tier | undefined)[]): Tier | undefined {
  let best: Tier | undefined;
  for (const tier of tiers) {
    if (tier !== undefined && (best === undefined || RANK[tier] > RANK[best])) best = tier;
  }
  return best;
}
