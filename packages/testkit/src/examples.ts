// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseConfig, type ResolvedEnvironment } from '@orrery/core';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** Loads one environment from `config/examples/<file>`, resolved and validated. */
export function loadExampleEnvironment(file: string, envId: string): ResolvedEnvironment {
  const path = resolve(REPO_ROOT, 'config', 'examples', file);
  const result = parseConfig(readFileSync(path, 'utf8'));
  if (!result.ok) {
    const issues = result.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');
    throw new Error(`Example config ${file} is invalid:\n${issues}`);
  }
  const env = result.config.environments.find((candidate) => candidate.id === envId);
  if (!env) {
    const known = result.config.environments.map((candidate) => candidate.id).join(', ');
    throw new Error(`Example config ${file} has no environment "${envId}" (found: ${known}).`);
  }
  return env;
}
