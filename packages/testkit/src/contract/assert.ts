// SPDX-License-Identifier: Apache-2.0

/** Throws a contract violation with a readable message. */
export function fail(message: string): never {
  throw new Error(`Contract violation: ${message}`);
}

export function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) fail(message);
}

export function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

export function ensureUnique(ids: readonly string[], what: string): void {
  const duplicates = findDuplicates(ids);
  ensure(
    duplicates.length === 0,
    `${what} ids must be unique, duplicated: ${duplicates.join(', ')}`,
  );
}

export function ensureKnown(id: string, known: ReadonlySet<string>, what: string): void {
  ensure(known.has(id), `${what} "${id}" is not in the topology (known: ${[...known].join(', ')})`);
}
