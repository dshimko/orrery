// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology, Visuals } from '@orrery/core';
import type { SystemView } from '@orrery/render';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useSystemData } from '../hooks/useSystemData.js';
import { type Api, ApiError, isAbort } from '../lib/api.js';
import { friendlyEnvError, FALLBACK_TIER_COLOR } from '../lib/home.js';
import { envPath } from '../lib/router.js';
import type { TimeController } from '../lib/time.js';
import { Link } from './Link.js';
import { SceneHost } from './SceneHost.js';
import { TierBadge } from './TierBadge.js';

export interface ComparePaneProps {
  api: Api;
  env: { id: string; name: string; tier: string };
  visuals: Visuals;
  controller: TimeController;
  reducedMotion: boolean;
  /** Increments when the shared clock was scrubbed; each pane refetches. */
  jumpEpoch: number;
  /** The shared clock follows the wall clock: events come from the live stream. */
  isLive: boolean;
}

type PaneLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; topology: Topology; snapshot: Snapshot };

/** One system view with its own data scheduler, on the page's shared time controller. */
export function ComparePane(props: ComparePaneProps) {
  const { api, env, controller } = props;
  const [load, setLoad] = useState<PaneLoad>({ status: 'loading' });

  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    setLoad({ status: 'loading' });
    Promise.all([api.topology(env.id, signal), api.snapshot(env.id, controller.state().at, signal)])
      .then(([topology, snapshot]) => {
        if (!signal.aborted) setLoad({ status: 'ready', topology, snapshot });
      })
      .catch((error: unknown) => {
        if (signal.aborted || isAbort(error)) return;
        setLoad({
          status: 'error',
          message: error instanceof ApiError ? friendlyEnvError(error) : 'Could not load.',
        });
      });
    return () => {
      abort.abort();
    };
  }, [api, env.id, controller]);

  const tierColor = props.visuals.colors.tiers[env.tier] ?? FALLBACK_TIER_COLOR;
  if (load.status === 'ready') {
    return (
      <PaneScene
        {...props}
        tierColor={tierColor}
        topology={load.topology}
        initial={load.snapshot}
      />
    );
  }
  return (
    <PaneFrame env={env} tierColor={tierColor}>
      <p
        className={load.status === 'error' ? 'banner' : 'lbl'}
        role={load.status === 'error' ? 'alert' : 'status'}
      >
        {load.status === 'error' ? `Unavailable: ${load.message}` : 'Loading...'}
      </p>
    </PaneFrame>
  );
}

interface PaneFrameProps {
  env: ComparePaneProps['env'];
  tierColor: string;
  /** Live open-incident count, when the pane has data. */
  incidents?: number;
  children: ReactNode;
}

/** The pane's tier band, name, tier badge, and open-incident count. */
function PaneFrame({ env, tierColor, incidents, children }: PaneFrameProps) {
  return (
    <section
      className="pane"
      aria-label={`${env.name} system view`}
      style={{ ['--tier' as string]: tierColor }}
      data-env={env.id}
    >
      <header className="pane-head" style={{ borderTopColor: tierColor }}>
        <h2>{env.name}</h2>
        <TierBadge tier={env.tier} color={tierColor} />
        {incidents !== undefined && (
          <span data-testid="pane-incidents">
            {incidents} open {incidents === 1 ? 'incident' : 'incidents'}
          </span>
        )}
        <div className="topbar-spacer" />
        <Link to={envPath(env.id)} className="btn sm">
          Open system view
        </Link>
      </header>
      {children}
    </section>
  );
}

interface PaneSceneProps extends ComparePaneProps {
  tierColor: string;
  topology: Topology;
  initial: Snapshot;
}

function PaneScene(props: PaneSceneProps) {
  const { api, env, visuals, controller, reducedMotion, jumpEpoch, tierColor, topology } = props;
  const viewRef = useRef<SystemView | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const system = useSystemData(api, env.id, controller, props.initial, viewRef, props.isLive);
  const { jump } = system;
  const { counts } = system.snapshot;
  const onView = useCallback((view: SystemView | null) => {
    viewRef.current = view;
  }, []);

  const lastEpoch = useRef(jumpEpoch);
  useEffect(() => {
    if (lastEpoch.current === jumpEpoch) return;
    lastEpoch.current = jumpEpoch;
    jump();
  }, [jumpEpoch, jump]);

  return (
    <PaneFrame env={env} tierColor={tierColor} incidents={counts.openIncidents}>
      <p className="lbl pane-counts">
        {counts.spokesPastTarget} of {system.snapshot.spokes.length} spokes past target,{' '}
        {counts.runningPipelines} pipelines running.
      </p>
      <div className="scene-wrap pane-scene">
        <div className="tier-edge" style={{ background: tierColor }} aria-hidden="true" />
        <SceneHost
          envId={env.id}
          topology={topology}
          visuals={visuals}
          tierColor={tierColor}
          initialSnapshot={props.initial}
          reducedMotion={reducedMotion}
          time={() => controller.state()}
          onView={onView}
          onFailure={setSceneError}
        />
        {sceneError && <p className="scene-error">{sceneError}</p>}
      </div>
      {system.refreshError && (
        <p className="banner" role="status">
          {system.refreshError}
        </p>
      )}
    </PaneFrame>
  );
}
