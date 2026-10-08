// SPDX-License-Identifier: Apache-2.0
import type { CameraViewKey, Filters, PickTarget, SystemView, TierFilter } from '@orrery/render';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ControlsPanel } from '../components/ControlsPanel.js';
import { DataTable } from '../components/DataTable.js';
import { Header } from '../components/Header.js';
import { SceneHost } from '../components/SceneHost.js';
import { StatusPanel } from '../components/StatusPanel.js';
import { TimeControls } from '../components/TimeControls.js';
import { WallToggle } from '../components/WallToggle.js';
import type { EnvData } from '../hooks/useEnvLoad.js';
import { useIncidentAnnouncer } from '../hooks/useIncidentAnnouncer.js';
import { useSharedClock, prefersReducedMotion } from '../hooks/useSharedClock.js';
import { useSimClock } from '../hooks/useSimClock.js';
import { useSystemData } from '../hooks/useSystemData.js';
import { logoUrlOf, type Api } from '../lib/api.js';
import { clockLink, pageUrl } from '../lib/clock-url.js';
import type { DeepLink } from '../lib/params.js';
import { envPath, navigate } from '../lib/router.js';

export interface SystemReadyProps {
  api: Api;
  envId: string;
  data: EnvData;
  link: DeepLink;
  /** Wall display mode is on (`wall=1`); keep it in the URL. */
  isWall: boolean;
}

const FALLBACK_TIER_COLOR = '#6EA8FF';

/** The interactive system view for one loaded environment. */
export function SystemReady({ api, envId, data, link, isWall }: SystemReadyProps) {
  const { visuals } = data.config;
  const env = data.environments.find((item) => item.id === envId) ?? {
    id: envId,
    name: envId,
    tier: 'unknown',
  };
  const tierColor = visuals.colors.tiers[env.tier] ?? FALLBACK_TIER_COLOR;
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  const controller = useSharedClock(link, visuals.time);
  const { time, refresh } = useSimClock(controller);

  const viewRef = useRef<SystemView | null>(null);
  const [viewVersion, setViewVersion] = useState(0);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const system = useSystemData(api, envId, controller, data.snapshot, viewRef);
  const { snapshot } = system;
  const announcement = useIncidentAnnouncer(snapshot.alerts);

  const [tier, setTier] = useState<TierFilter>(link.tier);
  const [workload, setWorkload] = useState(link.workload);
  const [focusAlerts, setFocusAlerts] = useState(false);
  const [focus, setFocus] = useState<PickTarget | null>(link.focus);
  const [viewKey, setViewKey] = useState<CameraViewKey | null>(link.view);
  const [selected, setSelected] = useState<PickTarget | null>(link.focus);
  const [pinned, setPinned] = useState({ minuteOfDay: link.minuteOfDay, date: link.date });
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;

  const onView = useCallback((view: SystemView | null) => {
    viewRef.current = view;
    if (view) setViewVersion((version) => version + 1);
  }, []);

  // Apply filters, restore focus, and subscribe to picks whenever a view is (re)created.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const filters: Partial<Filters> = { tier, workload, focusAlerts };
    view.setFilters(filters);
  }, [viewVersion, tier, workload, focusAlerts]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // A deep link restores a camera preset first; a focus target wins over it.
    if (viewKeyRef.current) view.goView(viewKeyRef.current);
    if (focusRef.current) view.focus(focusRef.current);
    return view.onPick((target) => {
      setSelected(target);
      if (target) {
        setFocus(target);
        setViewKey(null);
      }
    });
  }, [viewVersion]);

  const url = pageUrl(envPath(envId), clockLink(time, pinned), {}, isWall, {
    tier,
    workload,
    focus,
    view: viewKey,
  });
  useEffect(() => {
    if (url !== window.location.pathname + window.location.search) navigate(url, { replace: true });
  }, [url]);

  const onScrub = (minute: number): void => {
    controller.seekMinute(minute);
    refresh();
    setPinned((current) => ({ ...current, minuteOfDay: minute }));
    system.jump();
  };
  const onTogglePlay = (): void => {
    controller.setPaused(!controller.state().paused);
    refresh();
  };
  const onSpeed = (speed: number): void => {
    controller.setSpeed(speed);
    refresh();
  };
  const onFocus = (target: PickTarget): void => {
    viewRef.current?.focus(target);
    setFocus(target);
    setViewKey(null);
  };
  const onViewKey = (key: CameraViewKey): void => {
    viewRef.current?.goView(key);
    setViewKey(key);
    setFocus(null);
  };

  return (
    <div className="app" style={{ ['--tier' as string]: tierColor }}>
      <Header
        productName={data.config.product.title}
        logoUrl={logoUrlOf(data.config)}
        env={env}
        environments={data.environments}
        tierColor={tierColor}
        actions={<WallToggle />}
      />
      <div className="layout">
        <main className="stage-col">
          <section className="scene-wrap" aria-label="System view">
            <div className="tier-edge" style={{ background: tierColor }} aria-hidden="true" />
            <SceneHost
              envId={envId}
              topology={data.topology}
              visuals={visuals}
              tierColor={tierColor}
              initialSnapshot={snapshot}
              reducedMotion={reducedMotion}
              time={() => controller.state()}
              onView={onView}
              onFailure={setSceneError}
            />
            {sceneError && <p className="scene-error">{sceneError}</p>}
          </section>
          {system.refreshError && (
            <p className="banner" role="status">
              {system.refreshError}
            </p>
          )}
          <TimeControls
            time={time}
            speeds={visuals.time.speeds}
            onTogglePlay={onTogglePlay}
            onSpeed={onSpeed}
            onScrub={onScrub}
          />
          <DataTable topology={data.topology} snapshot={snapshot} />
        </main>
        <div className="side">
          <ControlsPanel
            tier={tier}
            workload={workload}
            focusAlerts={focusAlerts}
            reducedMotion={reducedMotion}
            workloads={visuals.workloads}
            hasFederation={data.topology.foreignCatalogs.length > 0}
            onTier={setTier}
            onWorkload={setWorkload}
            onFocusAlerts={setFocusAlerts}
            onReducedMotion={setReducedMotion}
            onView={onViewKey}
            onResetCamera={() => viewRef.current?.resetCamera()}
            onLevelHorizon={() => viewRef.current?.levelHorizon()}
          />
          <StatusPanel
            topology={data.topology}
            snapshot={snapshot}
            workloads={visuals.workloads}
            workload={workload}
            selected={selected}
            onWorkload={setWorkload}
            onFocus={onFocus}
            onCloseSelection={() => {
              setSelected(null);
            }}
          />
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
