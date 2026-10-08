// SPDX-License-Identifier: Apache-2.0
import { parseDocument } from 'yaml';
import { ConfigError, fromZodIssues, type ConfigIssue } from './errors.js';
import type { Environment } from './environment.js';
import { resolveTopology } from './resolve.js';
import { OrreryConfigInput } from './root.js';
import type { Topology } from './topology.js';

export interface ResolvedEnvironment extends Environment {
  resolvedTopology: Topology;
}

export interface OrreryConfig extends Omit<OrreryConfigInput, 'environments'> {
  environments: ResolvedEnvironment[];
}

export type ConfigResult =
  { ok: true; config: OrreryConfig } | { ok: false; issues: ConfigIssue[] };

function resolveEnvironments(input: OrreryConfigInput): ConfigResult {
  const issues: ConfigIssue[] = [];
  const environments: ResolvedEnvironment[] = [];
  input.environments.forEach((env, index) => {
    const result = resolveTopology(
      env.topology,
      input.topologies,
      env.overrides,
      `environments[${index}].topology`,
    );
    if (result.ok) environments.push({ ...env, resolvedTopology: result.topology });
    else issues.push(...result.issues);
  });
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, config: { ...input, environments } };
}

/** Validates an already-parsed config object and resolves each environment's topology. */
export function validateConfig(raw: unknown): ConfigResult {
  const parsed = OrreryConfigInput.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: fromZodIssues(parsed.error.issues) };
  return resolveEnvironments(parsed.data);
}

/** Parses and validates YAML text. YAML syntax errors are reported as issues, not thrown. */
export function parseConfig(text: string): ConfigResult {
  const doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      issues: doc.errors.map((error) => ({ path: '(yaml)', message: error.message })),
    };
  }
  return validateConfig(doc.toJS());
}

/** Like `parseConfig`, but throws a `ConfigError` naming the source on any problem. */
export function parseConfigOrThrow(text: string, source: string): OrreryConfig {
  const result = parseConfig(text);
  if (!result.ok) throw new ConfigError(source, result.issues);
  return result.config;
}
