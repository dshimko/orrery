// SPDX-License-Identifier: Apache-2.0
// Expands `${env:NAME}` references from config. Values never appear in error messages.

export type EnvMap = Readonly<Record<string, string | undefined>>;

const ENV_REF = /^\$\{env:([A-Z_][A-Z0-9_]*)\}$/;

/** The variable name of an `${env:NAME}` reference, or undefined for anything else. */
export function refName(value: string): string | undefined {
  return ENV_REF.exec(value)?.[1];
}

/**
 * Returns the value of an `${env:NAME}` reference, a literal string unchanged, or undefined when
 * the input is undefined or the referenced variable is missing or empty. Never throws.
 */
export function resolveRef(value: string | undefined, env: EnvMap): string | undefined {
  if (value === undefined) return undefined;
  const name = refName(value);
  if (name === undefined) return value.length > 0 ? value : undefined;
  const resolved = env[name];
  return resolved !== undefined && resolved.length > 0 ? resolved : undefined;
}
