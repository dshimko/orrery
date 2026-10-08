// SPDX-License-Identifier: Apache-2.0

export interface TierBadgeProps {
  tier: string;
  color: string;
}

/** Tier name in text beside a colored dot, so color is never the only signal. */
export function TierBadge({ tier, color }: TierBadgeProps) {
  return (
    <span className="tier-badge" style={{ borderColor: color, color }}>
      <i style={{ background: color }} aria-hidden="true" />
      Tier: {tier.toUpperCase()}
    </span>
  );
}
