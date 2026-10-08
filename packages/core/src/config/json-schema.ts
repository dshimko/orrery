// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { OrreryConfigInput } from './root.js';

export const CONFIG_SCHEMA_ID = 'https://orrery.invalid/schema/orrery.config.schema.json';

/**
 * JSON Schema for `orrery.config.yaml`, generated from the zod types so editors can validate and
 * autocomplete. Cross-reference checks (unknown topology, duplicate ids) run only in zod.
 */
export function configJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(OrreryConfigInput, { io: 'input', unrepresentable: 'any' });
  return { ...schema, $id: CONFIG_SCHEMA_ID, title: 'Orrery configuration' };
}
