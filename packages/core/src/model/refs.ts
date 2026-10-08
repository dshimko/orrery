// SPDX-License-Identifier: Apache-2.0

/** Kinds of objects an event, alert, or deep link can point at. */
export const OBJECT_KINDS = [
  'hub',
  'spoke',
  'sourceGroup',
  'site',
  'useCase',
  'foreign',
  'metastore',
  'shipyard',
] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

/** `kind:id`, or a bare kind for singletons such as `shipyard`. Example: `spoke:sales`. */
export type ObjectRef = `${ObjectKind}:${string}` | ObjectKind;

export interface ParsedRef {
  kind: ObjectKind;
  id: string | undefined;
}

export function parseRef(ref: string): ParsedRef | undefined {
  const [kind, id, ...rest] = ref.split(':');
  if (rest.length > 0 || !(OBJECT_KINDS as readonly string[]).includes(kind ?? ''))
    return undefined;
  if (id === '') return undefined;
  return { kind: kind as ObjectKind, id };
}

export function ref(kind: ObjectKind, id?: string): ObjectRef {
  return id === undefined ? kind : `${kind}:${id}`;
}
