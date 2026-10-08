// SPDX-License-Identifier: Apache-2.0
// Fails when any installed dependency is outside the license allowlist. Production dependencies
// get no exceptions; dev-only tooling may be listed in license-exceptions.json after review.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALLOWED = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD'];
/** Web fonts may also be OFL-1.1, and only font packages may use it. */
const FONT_PACKAGE = /^@fontsource\//;

/**
 * Evaluates a simple SPDX expression: `OR` needs one allowed side, `AND` needs both.
 * @param {string} expression
 * @param {string} name
 */
export function isAllowed(expression, name) {
  const allowed = FONT_PACKAGE.test(name) ? [...ALLOWED, 'OFL-1.1'] : ALLOWED;
  const clean = expression.replace(/[()]/g, '').trim();
  return clean
    .split(/\s+OR\s+/)
    .some((alternative) =>
      alternative.split(/\s+AND\s+/).every((id) => allowed.includes(id.trim())),
    );
}

/** @param {boolean} prodOnly */
function licenseInventory(prodOnly) {
  const args = ['licenses', 'list', '--json', ...(prodOnly ? ['--prod'] : [])];
  const byLicense = JSON.parse(execFileSync('pnpm', args, { encoding: 'utf8' }) || '{}');
  return Object.entries(byLicense).flatMap(([license, packages]) =>
    packages.map((pkg) => ({ name: pkg.name, versions: pkg.versions, license })),
  );
}

/**
 * @param {{ name: string, license: string }[]} all
 * @param {{ name: string, license: string }[]} prod
 * @param {{ package: string, license: string }[]} exceptions
 */
export function findViolations(all, prod, exceptions) {
  const prodNames = new Set(prod.map((pkg) => pkg.name));
  const excepted = (pkg) =>
    exceptions.some((e) => e.package === pkg.name && e.license === pkg.license);
  return all
    .filter((pkg) => !isAllowed(pkg.license, pkg.name))
    .filter((pkg) => prodNames.has(pkg.name) || !excepted(pkg))
    .map((pkg) => ({ ...pkg, inProduction: prodNames.has(pkg.name) }));
}

function main() {
  const { exceptions } = JSON.parse(readFileSync('license-exceptions.json', 'utf8'));
  const all = licenseInventory(false);
  const violations = findViolations(all, licenseInventory(true), exceptions);
  if (violations.length > 0) {
    console.error('Dependencies outside the license allowlist:');
    for (const v of violations) {
      const where = v.inProduction ? 'production' : 'dev';
      console.error(`  ${v.name}@${v.versions.join(',')}: ${v.license} (${where})`);
    }
    process.exit(1);
  }
  console.log(
    `Licenses: ok (${all.length} packages, ${exceptions.length} reviewed dev exception(s))`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
