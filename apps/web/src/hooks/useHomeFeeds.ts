// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api, EnvironmentSummary } from '../lib/api.js';
import { createEnvFeed, type EnvFeed } from '../lib/feed.js';
import type { FreshnessTracker } from '../lib/freshness.js';
import { EMPTY_FEED, type EnvFeedState, friendlyEnvError, isNetworkFailure } from '../lib/home.js';
import { createThrottle } from '../lib/throttle.js';
import type { TimeController } from '../lib/time.js';
import { useOnVisible } from './useOnVisible.js';

/** DOM and face updates are batched to 4 Hz. */
const FEED_UPDATE_MS = 250;

export type FeedMap = Readonly<Record<string, EnvFeedState>>;

/**
 * One data feed per environment on the shared clock. Each feed fails alone: an environment that
 * cannot load gets an error message while the others keep updating.
 */
export function useHomeFeeds(
  api: Api,
  environments: readonly EnvironmentSummary[],
  controller: TimeController,
  freshness?: FreshnessTracker,
): { feeds: FeedMap; jump: () => void } {
  const [feeds, setFeeds] = useState<FeedMap>({});
  const handles = useRef<EnvFeed[]>([]);
  const key = environments.map((env) => env.id).join(',');

  useEffect(() => {
    let latest: FeedMap = {};
    const throttle = createThrottle<FeedMap>(setFeeds, FEED_UPDATE_MS);
    const update = (id: string, patch: Partial<EnvFeedState>): void => {
      latest = { ...latest, [id]: { ...(latest[id] ?? EMPTY_FEED), ...patch } };
      throttle.push(latest);
    };
    const started = environments.map((env) =>
      createEnvFeed({
        api,
        envId: env.id,
        now: () => controller.state().at,
        isLive: () => controller.state().live === true,
        sink: {
          onTopology: (topology) => {
            update(env.id, { topology });
          },
          onSnapshot: (snapshot) => {
            freshness?.ok(env.id, Date.now());
            update(env.id, { snapshot, error: null, isNetworkError: false });
          },
          onError: (error) => {
            freshness?.fail(env.id);
            update(env.id, {
              error: friendlyEnvError(error),
              isNetworkError: isNetworkFailure(error),
            });
          },
        },
      }),
    );
    handles.current = started;
    return () => {
      for (const feed of started) feed.stop();
      handles.current = [];
      throttle.cancel();
    };
    // `environments` is identified by `key`; the array identity changes with every render.
  }, [api, controller, freshness, key]);

  const jump = useCallback(() => {
    for (const feed of handles.current) feed.jump();
  }, []);

  useOnVisible(() => {
    for (const feed of handles.current) feed.refresh();
  });

  return { feeds, jump };
}
