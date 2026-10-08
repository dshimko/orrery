// SPDX-License-Identifier: Apache-2.0
// Fails when any installed dependency is outside the license allowlist. Production dependencies
// get no exceptions; dev-only tooling may be listed in license-exceptions.json after review.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
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

/**
 * License of an installed package from its own package.json (`license`, legacy `{ type }`, or
 * a `licenses` array joined with OR).
 * @param {Record<string, unknown>} manifest
 */
export function licenseOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === 'string') return license;
  if (license && typeof license === 'object' && typeof license.type === 'string')
    return license.type;
  if (Array.isArray(licenses)) {
    const types = licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean);
    if (types.length > 0) return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
  }
  return 'UNKNOWN';
}

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

/** Every package installed under node_modules/.pnpm (what is actually on disk). */
export function installedPackages(root) {
  const store = join(root, 'node_modules', '.pnpm');
  const found = new Map();
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const modules = join(store, entry.name, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const top of readdirSync(modules)) {
      const dirs = top.startsWith('@')
        ? readdirSync(join(modules, top)).map((n) => join(modules, top, n))
        : [join(modules, top)];
      for (const dir of dirs) {
        if (lstatSync(dir).isSymbolicLink() || !existsSync(join(dir, 'package.json'))) continue;
        const manifest = readManifest(dir);
        found.set(dir, {
          name: manifest.name,
          versions: [manifest.version],
          license: licenseOf(manifest),
        });
      }
    }
  }
  return [...found.values()];
}

/**
 * Packages reachable from the workspace packages' runtime `dependencies`, following pnpm's
 * symlinked layout (a package's own dependencies are siblings in its .pnpm node_modules dir).
 */
export function productionPackages() {
  const projects = JSON.parse(
    execFileSync('pnpm', ['list', '-r', '--json', '--depth', '0'], { encoding: 'utf8' }),
  );
  const seen = new Map();
  const visit = (fromDir, deps) => {
    for (const name of Object.keys(deps ?? {})) {
      const link = join(fromDir, 'node_modules', name);
      if (!existsSync(link)) continue;
      const dir = realpathSync(link);
      if (seen.has(dir) || !dir.includes(`${sep}.pnpm${sep}`)) {
        // Workspace packages (not under .pnpm) are walked for their own dependencies.
        if (!seen.has(dir) && !dir.includes(`${sep}.pnpm${sep}`)) {
          seen.set(dir, null);
          visit(dir, readManifest(dir).dependencies);
        }
        continue;
      }
      const manifest = readManifest(dir);
      seen.set(dir, {
        name: manifest.name,
        versions: [manifest.version],
        license: licenseOf(manifest),
      });
      const siblings = dirname(name.startsWith('@') ? dirname(dir) : dir);
      visit(join(siblings, '..'), { ...manifest.dependencies, ...manifest.optionalDependencies });
    }
  };
  for (const project of projects) visit(project.path, readManifest(project.path).dependencies);
  return [...seen.values()].filter(Boolean);
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
  const root = process.cwd();
  const all = installedPackages(root);
  const violations = findViolations(all, productionPackages(), exceptions);
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
