// SPDX-License-Identifier: Apache-2.0
// Writes schema/orrery.config.schema.json from the built zod types. Run after `tsc`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configJsonSchema } from '../dist/index.js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../schema/orrery.config.schema.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(configJsonSchema(), null, 2)}\n`);
process.stdout.write(`wrote ${out}\n`);
