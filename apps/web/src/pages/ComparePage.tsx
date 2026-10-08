// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from 'react';
import { ComparePane } from '../components/ComparePane.js';
import { ErrorState } from '../components/ErrorState.js';
import { Link } from '../components/Link.js';
import { TimeControls } from '../components/TimeControls.js';
import { type Bootstrap, useBootstrap } from '../hooks/useBootstrap.js';
import { prefersReducedMotion, useSharedClock } from '../hooks/useSharedClock.js';
import { useSimClock } from '../hooks/useSimClock.js';
import type { Api } from '../lib/api.js';
import { clockLink, pageUrl } from '../lib/clock-url.js';
import {
  MAX_COMPARE_ENVS,
  MIN_COMPARE_ENVS,
  parseCompareEnvs,
  serializeCompareEnvs,
  withCompareSlot,
} from '../lib/compare.js';
import { parseDeepLink } from '../lib/params.js';
import { buildUrl, COMPARE_PATH, navigate, type Query } from '../lib/router.js';

export interface ComparePageProps {
  api: Api;
  query: Query;
}

/** Compare mode: two or three system views side by side on one shared clock (see lib/compare.ts). */
export function ComparePage({ api, query }: ComparePageProps) {
  const boot = useBootstrap(api);
  if (boot.status === 'error') {
    return <ErrorState title="Environments unavailable" message={boot.message} />;
  }
  if (boot.status === 'loading') {
    return (
      <main className="message-page" aria-busy="true">
        <p role="status">Loading environments...</p>
      </main>
    );
  }
  if (boot.data.environments.length < MIN_COMPARE_ENVS) {
    return (
      <ErrorState
        title="Nothing to compare"
        message="Compare mode needs at least two environments."
      />
    );
  }
  return <CompareReady api={api} data={boot.data} query={query} />;
}

function CompareReady({ api, data, query }: { api: Api; data: Bootstrap; query: Query }) {
  const { config, environments } = data;
  const { visuals } = config;
  const envIds = useMemo(() => environments.map((env) => env.id), [environments]);
  const ids = useMemo(() => parseCompareEnvs(query.envs, envIds), [query.envs, envIds]);
  const link = useMemo(() => parseDeepLink(query), []);
  const controller = useSharedClock(link, visuals.time);
  const { time, refresh } = useSimClock(controller);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [pinned, setPinned] = useState({ minuteOfDay: link.minuteOfDay, date: link.date });
  const [jumpEpoch, setJumpEpoch] = useState(0);

  const url = pageUrl(
    COMPARE_PATH,
    clockLink(time, pinned),
    { envs: serializeCompareEnvs(ids) },
    false,
  );
  useEffect(() => {
    if (url !== window.location.pathname + window.location.search) navigate(url, { replace: true });
  }, [url]);

  const onSlot = (slot: number, envId: string | null): void => {
    const next = withCompareSlot(ids, slot, envId);
    navigate(buildUrl(COMPARE_PATH, { ...query, envs: serializeCompareEnvs(next) }));
  };
  const nextFree = envIds.find((id) => !ids.includes(id));

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          {config.product.title}
        </Link>
        <h1 className="env-name">Compare environments</h1>
        <div className="topbar-spacer" />
        <Link to="/" className="btn sm">
          Home
        </Link>
      </header>
      <main className="compare" data-testid="compare">
        <section className="compare-pick" aria-label="Environments to compare">
          {ids.map((id, slot) => (
            <label className="field" key={slot}>
              <span className="lbl">Environment {slot + 1}</span>
              <select
                data-testid={`compare-select-${slot}`}
                value={id}
                onChange={(event) => {
                  onSlot(slot, event.target.value);
                }}
              >
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name} ({env.tier})
                  </option>
                ))}
              </select>
            </label>
          ))}
          {nextFree !== undefined && ids.length < MAX_COMPARE_ENVS && (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                onSlot(ids.length, nextFree);
              }}
            >
              Add a third environment
            </button>
          )}
          {ids.length > MIN_COMPARE_ENVS && (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                onSlot(ids.length - 1, null);
              }}
            >
              Remove the third environment
            </button>
          )}
        </section>
        <TimeControls
          time={time}
          speeds={visuals.time.speeds}
          onTogglePlay={() => {
            controller.setPaused(!controller.state().paused);
            refresh();
          }}
          onSpeed={(speed) => {
            controller.setSpeed(speed);
            refresh();
          }}
          onScrub={(minute) => {
            controller.seekMinute(minute);
            refresh();
            setPinned((current) => ({ ...current, minuteOfDay: minute }));
            setJumpEpoch((epoch) => epoch + 1);
          }}
        />
        <div className={`compare-grid cols-${ids.length}`}>
          {ids.map((id) => {
            const env = environments.find((item) => item.id === id);
            return env ? (
              <ComparePane
                key={id}
                api={api}
                env={env}
                visuals={visuals}
                controller={controller}
                reducedMotion={reducedMotion}
                jumpEpoch={jumpEpoch}
              />
            ) : null;
          })}
        </div>
      </main>
    </div>
  );
}
