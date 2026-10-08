// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from 'react';
import { ErrorState } from '../components/ErrorState.js';
import { GlanceTable } from '../components/GlanceTable.js';
import { HomeAlerts } from '../components/HomeAlerts.js';
import { HomeAnnouncer } from '../components/HomeAnnouncer.js';
import { Link } from '../components/Link.js';
import { OrlojStage } from '../components/OrlojStage.js';
import { SummaryDialog } from '../components/SummaryDialog.js';
import { TimeControls } from '../components/TimeControls.js';
import { WallToggle } from '../components/WallToggle.js';
import { type Bootstrap, useBootstrap } from '../hooks/useBootstrap.js';
import { useHomeFeeds } from '../hooks/useHomeFeeds.js';
import { useSimClock } from '../hooks/useSimClock.js';
import { prefersReducedMotion, useSharedClock } from '../hooks/useSharedClock.js';
import type { Api } from '../lib/api.js';
import { clockLink, pageUrl } from '../lib/clock-url.js';
import { compareUrl, defaultComparePair, MIN_COMPARE_ENVS } from '../lib/compare.js';
import {
  aggregateAlerts,
  alertsFor,
  buildFace,
  buildGlanceRow,
  FALLBACK_TIER_COLOR,
  isFirstLoadDone,
  withHealth,
} from '../lib/home.js';
import { parseDeepLink } from '../lib/params.js';
import { isWallQuery, navigate, type Query } from '../lib/router.js';

export interface HomePageProps {
  api: Api;
  query: Query;
}

/** The Orloj clock view: one face per environment on one shared clock, with a text equivalent. */
export function HomePage({ api, query }: HomePageProps) {
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
  return <HomeReady api={api} data={boot.data} query={query} />;
}

interface HomeReadyProps {
  api: Api;
  data: Bootstrap;
  query: Query;
}

function HomeReady({ api, data, query }: HomeReadyProps) {
  const { config, environments, healthErrors } = data;
  const { visuals } = config;
  const tierColors = visuals.colors.tiers;
  // The deep link is read once; later URL updates must not restart the clock.
  const link = useMemo(() => parseDeepLink(query), []);
  const controller = useSharedClock(link, visuals.time);
  const { time, refresh } = useSimClock(controller);
  const { feeds, jump } = useHomeFeeds(api, environments, controller);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [pinned, setPinned] = useState({ minuteOfDay: link.minuteOfDay, date: link.date });
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const isWall = isWallQuery(query);

  const url = pageUrl('/', clockLink(time, pinned), {}, isWall);
  useEffect(() => {
    if (url !== window.location.pathname + window.location.search) navigate(url, { replace: true });
  }, [url]);

  const rows = useMemo(
    () =>
      environments.map((env) =>
        buildGlanceRow(env, withHealth(feeds[env.id], healthErrors[env.id]), time.at),
      ),
    [environments, feeds, healthErrors, time.at],
  );
  const faces = useMemo(
    () =>
      environments.map((env) =>
        buildFace(env, withHealth(feeds[env.id], healthErrors[env.id]), tierColors),
      ),
    [environments, feeds, healthErrors, tierColors],
  );
  const alerts = useMemo(() => aggregateAlerts(environments, feeds), [environments, feeds]);
  const isLoaded = isFirstLoadDone(
    environments,
    Object.fromEntries(
      environments.map((env) => [env.id, withHealth(feeds[env.id], healthErrors[env.id])]),
    ),
  );
  const summaryRow = rows.find((row) => row.env.id === summaryId) ?? null;

  const onScrub = (minute: number): void => {
    controller.seekMinute(minute);
    refresh();
    setPinned((current) => ({ ...current, minuteOfDay: minute }));
    jump();
  };
  const onTogglePlay = (): void => {
    controller.setPaused(!controller.state().paused);
    refresh();
  };
  const onSpeed = (speed: number): void => {
    controller.setSpeed(speed);
    refresh();
  };

  const envIds = environments.map((env) => env.id);
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          {config.product.title}
        </Link>
        <h1 className="env-name">Orloj</h1>
        <p className="lbl topbar-note">One clock face per environment, in promotion order.</p>
        <div className="topbar-spacer" />
        {environments.length >= MIN_COMPARE_ENVS && (
          <Link to={compareUrl(defaultComparePair(envIds))} className="btn sm">
            Compare environments
          </Link>
        )}
        <WallToggle />
      </header>
      <main className="home">
        <TimeControls
          time={time}
          speeds={visuals.time.speeds}
          onTogglePlay={onTogglePlay}
          onSpeed={onSpeed}
          onScrub={onScrub}
        />
        <OrlojStage
          faces={faces}
          visuals={visuals}
          time={() => controller.state()}
          reducedMotion={reducedMotion}
          onSelect={setSummaryId}
        />
        <div className="home-grid">
          <section className="panel" aria-labelledby="glance-h">
            <h2 id="glance-h">Environments at a glance</h2>
            <GlanceTable
              rows={rows}
              tierColors={tierColors}
              fallbackColor={FALLBACK_TIER_COLOR}
              onSummary={setSummaryId}
            />
          </section>
          <section className="panel" aria-labelledby="home-alerts-h">
            <h2 id="home-alerts-h">Open alerts ({alerts.length})</h2>
            <HomeAlerts
              alerts={alerts}
              tierColors={tierColors}
              fallbackColor={FALLBACK_TIER_COLOR}
            />
          </section>
        </div>
      </main>
      {summaryRow && (
        <SummaryDialog
          row={summaryRow}
          alerts={alertsFor(alerts, summaryRow.env.id)}
          tierColor={tierColors[summaryRow.env.tier] ?? FALLBACK_TIER_COLOR}
          onClose={() => {
            setSummaryId(null);
          }}
        />
      )}
      {isLoaded && <HomeAnnouncer alerts={alerts} />}
    </div>
  );
}
