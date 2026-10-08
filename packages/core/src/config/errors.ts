// SPDX-License-Identifier: Apache-2.0
import type { z } from 'zod';

export interface ConfigIssue {
  /** Dotted path into the config, with array indexes in brackets: `environments[1].mock`. */
  path: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(source: string, issues: readonly ConfigIssue[]) {
    super(formatIssues(source, issues));
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    const key = String(segment);
    return acc ? `${acc}.${key}` : key;
  }, '');
}

export function fromZodIssues(issues: readonly z.core.$ZodIssue[]): ConfigIssue[] {
  return issues.map((issue) => ({
    path: formatPath(issue.path) || '(root)',
    message: issue.message,
  }));
}

export function formatIssues(source: string, issues: readonly ConfigIssue[]): string {
  const lines = issues.map((issue) => `  - ${issue.path}: ${issue.message}`);
  const noun = issues.length === 1 ? 'problem' : 'problems';
  return `${source}: ${issues.length} config ${noun}\n${lines.join('\n')}`;
}
