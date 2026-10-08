// SPDX-License-Identifier: Apache-2.0
import { Link } from './Link.js';

export interface BrandProps {
  productName: string;
  /** A fork's logo; decorative, since the product title stays as text. */
  logoUrl: string | null;
}

/** The product title, preceded by the fork's logo when one is configured. */
export function Brand({ productName, logoUrl }: BrandProps) {
  return (
    <Link to="/" className="brand">
      {logoUrl !== null && <img className="brand-logo" src={logoUrl} alt="" />}
      {productName}
    </Link>
  );
}
