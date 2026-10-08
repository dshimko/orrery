// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { ErrorState } from '../components/ErrorState.js';
import { Link } from '../components/Link.js';
import { type Api, ApiError, type EnvironmentListing, isAbort } from '../lib/api.js';
import { envPath } from '../lib/router.js';

export interface HomePageProps {
  api: Api;
}

/** Placeholder home: a plain list of environments. The Orloj clock view replaces it later. */
export function HomePage({ api }: HomePageProps) {
  const [environments, setEnvironments] = useState<EnvironmentListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .environments(controller.signal)
      .then(setEnvironments)
      .catch((cause: unknown) => {
        if (isAbort(cause)) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load environments.');
      });
    return () => {
      controller.abort();
    };
  }, [api]);

  if (error) return <ErrorState title="Environments unavailable" message={error} />;
  return (
    <main className="message-page">
      <h1>Orrery</h1>
      <p className="lbl">Lakehouse activity, one solar system per environment.</p>
      {environments === null ? (
        <p>Loading environments...</p>
      ) : (
        <ul className="env-list" data-testid="env-list">
          {environments.map((env) => (
            <li key={env.id}>
              <Link to={envPath(env.id)} className="btn">
                {env.name}
              </Link>
              <span className="lbl"> {env.tier}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
