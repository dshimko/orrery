// SPDX-License-Identifier: Apache-2.0
import type { ChangeEvent, ReactNode } from 'react';
import { envPath, navigate } from '../lib/router.js';
import { Brand } from './Brand.js';
import { Link } from './Link.js';
import { TierBadge } from './TierBadge.js';

export interface HeaderEnv {
  id: string;
  name: string;
  tier: string;
}

export interface HeaderProps {
  productName: string;
  logoUrl: string | null;
  env: HeaderEnv;
  environments: readonly HeaderEnv[];
  tierColor: string;
  /** Extra controls placed before the Home link, e.g. the wall display toggle. */
  actions?: ReactNode;
}

/** Product title, environment name and tier badge, environment switcher, and Home link. */
export function Header({
  productName,
  logoUrl,
  env,
  environments,
  tierColor,
  actions,
}: HeaderProps) {
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    if (event.target.value === env.id) return;
    navigate(envPath(event.target.value));
  };
  return (
    <header className="topbar" style={{ borderTopColor: tierColor }}>
      <Brand productName={productName} logoUrl={logoUrl} />
      <h1 className="env-name">{env.name}</h1>
      <TierBadge tier={env.tier} color={tierColor} />
      <div className="topbar-spacer" />
      <label className="field">
        <span className="lbl">Environment</span>
        <select data-testid="env-switcher" value={env.id} onChange={onChange}>
          {environments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.tier})
            </option>
          ))}
        </select>
      </label>
      {actions}
      <Link to="/" className="btn sm">
        Home
      </Link>
    </header>
  );
}
