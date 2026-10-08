// SPDX-License-Identifier: Apache-2.0
// Fails when a source file lacks `SPDX-License-Identifier: Apache-2.0` near its top.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { repoFiles } from './repo-files.mjs';

const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs|css|html|sql|sh|ya?ml)$/;
const EXEMPT = [/^reference\//, /^pnpm-lock\.yaml$/, /(^|\/)dist\//];
const HEADER = 'SPDX-License-Identifier: Apache-2.0';
const HEADER_WINDOW_LINES = 5;

/** @param {string} path */
export function needsHeader(path) {
  const isSource = SOURCE_EXT.test(path) || path.startsWith('.githooks/');
  return isSource && !EXEMPT.some((re) => re.test(path));
}

/** @param {string} text */
export function hasHeader(text) {
  return text.split('\n', HEADER_WINDOW_LINES).some((line) => line.includes(HEADER));
}

function main() {
  const missing = repoFiles()
    .filter(needsHeader)
    .filter((path) => existsSync(path) && !hasHeader(readFileSync(path, 'utf8')));
  if (missing.length > 0) {
    console.error(`Missing "${HEADER}" header in ${missing.length} file(s):`);
    for (const path of missing) console.error(`  ${path}`);
    process.exit(1);
  }
  console.log('SPDX headers: ok');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
