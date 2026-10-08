// SPDX-License-Identifier: Apache-2.0
// Validates one or more orrery config files without starting the server:
//   pnpm validate-config config/private/orrery.config.yaml
// Exits 1 and prints every problem (with the path and a suggested fix) when a file is invalid.
// `${env:NAME}` references are checked for form only; their values are read at startup.
import { readFileSync } from 'node:fs';
import { parseConfig, formatIssues } from '../packages/core/dist/index.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: pnpm validate-config <orrery.config.yaml> [more.yaml ...]');
  process.exit(2);
}
let failed = false;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`${file}: cannot read (${error.code ?? 'error'})`);
    failed = true;
    continue;
  }
  const result = parseConfig(text);
  if (result.ok) {
    const envs = result.config.environments.map((e) => `${e.id} (${[e.adapter].flat().join('+')})`);
    console.log(`${file}: ok: ${envs.join(', ')}`);
  } else {
    console.error(formatIssues(file, result.issues));
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
