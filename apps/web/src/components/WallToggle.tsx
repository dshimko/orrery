// SPDX-License-Identifier: Apache-2.0
import { useRoute } from '../hooks/useRoute.js';
import { buildUrl, isWallQuery, navigate, withWall } from '../lib/router.js';

/** Turns wall display mode on or off by adding or removing `wall=1` in the current URL. */
export function WallToggle() {
  const { query } = useRoute();
  const isOn = isWallQuery(query);
  const onClick = (): void => {
    navigate(buildUrl(window.location.pathname, withWall(query, !isOn)), { replace: true });
  };
  return (
    <button
      type="button"
      className="btn sm"
      data-testid="wall-toggle"
      aria-pressed={isOn}
      title="Cycle the home page and each environment. Press Escape to exit."
      onClick={onClick}
    >
      Wall display
    </button>
  );
}
