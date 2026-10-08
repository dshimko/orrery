// SPDX-License-Identifier: Apache-2.0

/** Drains an async iterable into an array, stopping early (and closing the source) at `limit`. */
export async function collect<T>(source: AsyncIterable<T>, limit = Infinity): Promise<T[]> {
  const items: T[] = [];
  if (limit <= 0) return items;
  for await (const item of source) {
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}
