// SPDX-License-Identifier: Apache-2.0
// Assembles the single deployable artifact in build/app: one bundled server file, the web build,
// the Databricks SQL files, the OpenLineage sample events, demo configs, and Databricks Apps /
// container metadata. Requires `pnpm build` first (the web app's dist). Fails when Databricks Apps
// file-size limits are exceeded.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build/app');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const PRIVATE_CONFIG_NAME = 'config/orrery.yaml';

/** Databricks Apps config; `configPath` is the ORRERY_CONFIG the app starts with. */
const appYaml = (configPath) => `# SPDX-License-Identifier: Apache-2.0
# Databricks Apps runtime config. The command is not run in a shell; env values are literal.
command: ['node', 'server/main.mjs']
env:
  - name: HOST
    value: '0.0.0.0'
  - name: ORRERY_WEB_DIR
    value: 'web'
  # Demo data from the mock adapter by default. To use your own config, run the package step with
  # ORRERY_PACKAGE_CONFIG=<path to your yaml>; it is copied to ${PRIVATE_CONFIG_NAME} and used here.
  - name: ORRERY_CONFIG
    value: '${configPath}'
  # SQL warehouse id from the "sql-warehouse" app resource declared in databricks.yml. Reference it
  # from the config as \${env:ORRERY_WAREHOUSE_ID} when using the Databricks adapter.
  - name: ORRERY_WAREHOUSE_ID
    valueFrom: sql-warehouse
`;

const APP_PACKAGE = {
  name: 'orrery-app',
  private: true,
  type: 'module',
  scripts: { start: 'node server/main.mjs' },
  engines: { node: '>=20.19.0' },
};

function copy(from, to) {
  cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });
}

async function bundleServer() {
  await build({
    entryPoints: [path.join(ROOT, 'apps/server/src/main.ts')],
    outfile: path.join(OUT, 'server/main.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    conditions: ['source'],
    banner: {
      js: "import { createRequire as __orreryCreateRequire } from 'node:module';\nconst require = __orreryCreateRequire(import.meta.url);",
    },
    legalComments: 'none',
    logLevel: 'warning',
  });
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function checkSizes() {
  const files = listFiles(OUT).map((file) => ({ file, bytes: statSync(file).size }));
  const total = files.reduce((sum, { bytes }) => sum + bytes, 0);
  const oversized = files.filter(({ bytes }) => bytes > MAX_FILE_BYTES);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes)[0];
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
  console.log(`build/app: ${files.length} files, ${mb(total)} MB total`);
  console.log(`largest: ${path.relative(OUT, largest.file)} (${mb(largest.bytes)} MB)`);
  const problems = oversized.map(
    ({ file, bytes }) => `${path.relative(OUT, file)} is ${mb(bytes)} MB (limit 10 MB per file)`,
  );
  if (total > MAX_TOTAL_BYTES) problems.push(`total ${mb(total)} MB exceeds 25 MB`);
  if (problems.length > 0) {
    console.error(`Package exceeds Databricks Apps limits:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
}

async function main() {
  try {
    statSync(path.join(ROOT, 'apps/web/dist/index.html'));
  } catch {
    console.error('apps/web/dist is missing. Run `pnpm build` first (or use `pnpm package`).');
    process.exit(1);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await bundleServer();
  copy('adapters/databricks/sql', 'sql');
  cpSync(path.join(ROOT, 'apps/web/dist'), path.join(OUT, 'web'), {
    recursive: true,
    filter: (source) => !source.endsWith('.map'),
  });
  copy('config/examples/demo.yaml', 'config/demo.yaml');
  copy('config/examples/three-env.yaml', 'config/three-env.yaml');
  // The OpenLineage demo reads its sample by a path relative to the working directory. It sits at
  // the same relative path in the package, so config/openlineage.yaml works from build/app too.
  copy('config/examples/openlineage.yaml', 'config/openlineage.yaml');
  copy('adapters/openlineage/samples', 'adapters/openlineage/samples');
  copy('LICENSE', 'LICENSE');
  copy('NOTICE', 'NOTICE');
  writeFileSync(path.join(OUT, 'package.json'), `${JSON.stringify(APP_PACKAGE, null, 2)}\n`);
  const extraConfig = process.env.ORRERY_PACKAGE_CONFIG;
  if (extraConfig) cpSync(path.resolve(extraConfig), path.join(OUT, PRIVATE_CONFIG_NAME));
  writeFileSync(
    path.join(OUT, 'app.yaml'),
    appYaml(extraConfig ? PRIVATE_CONFIG_NAME : 'config/demo.yaml'),
  );
  checkSizes();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
