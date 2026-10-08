// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { AdapterRegistry, BUILTIN_ADAPTERS, Environment, adapterList } from './environment.js';
import { Id, strictObject, suggestKey } from './strict.js';
import { TopologyInput } from './topology.js';
import { Visuals } from './visuals.js';

const Product = strictObject({
  title: z.string().min(1).default('Orrery'),
  timezone: z.string().min(1).default('UTC'),
});

const Promotion = strictObject({
  order: z.array(Id).min(1),
  source: z.enum(['job-tag', 'git-tag', 'none']).default('none'),
  tagKey: z.string().min(1).optional(),
});

const RootShape = strictObject({
  version: z.literal(1),
  product: Product.prefault({}),
  adapters: AdapterRegistry.optional(),
  topologies: z.record(Id, TopologyInput),
  environments: z.array(Environment).min(1),
  promotion: Promotion.optional(),
  visuals: Visuals.prefault({}),
});

type Root = z.infer<typeof RootShape>;
type Ctx = z.RefinementCtx;

function didYouMean(value: string, known: readonly string[]): string {
  const suggestion = suggestKey(value, known);
  return suggestion ? ` Did you mean "${suggestion}"?` : '';
}

function checkUniqueIds(root: Root, ctx: Ctx): void {
  const seen = new Map<string, number>();
  root.environments.forEach((env, index) => {
    const first = seen.get(env.id);
    if (first !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['environments', index, 'id'],
        message: `Duplicate environment id "${env.id}" (also at environments[${first}]).`,
      });
    }
    seen.set(env.id, index);
  });
}

function checkReferences(root: Root, ctx: Ctx): void {
  const topologyNames = Object.keys(root.topologies);
  const adapterNames = [...BUILTIN_ADAPTERS, ...Object.keys(root.adapters ?? {})];
  root.environments.forEach((env, index) => {
    if (!root.topologies[env.topology]) {
      ctx.addIssue({
        code: 'custom',
        path: ['environments', index, 'topology'],
        message: `Unknown topology "${env.topology}".${didYouMean(env.topology, topologyNames)} Defined topologies: ${topologyNames.join(', ') || 'none'}.`,
      });
    }
    for (const adapter of adapterList(env)) {
      if (!adapterNames.includes(adapter)) {
        ctx.addIssue({
          code: 'custom',
          path: ['environments', index, 'adapter'],
          message: `Unknown adapter "${adapter}".${didYouMean(adapter, adapterNames)} Register fork adapters under "adapters".`,
        });
      }
    }
  });
  Object.entries(root.topologies).forEach(([name, topology]) => {
    if (topology.extends && !root.topologies[topology.extends]) {
      ctx.addIssue({
        code: 'custom',
        path: ['topologies', name, 'extends'],
        message: `Topology "${name}" extends unknown topology "${topology.extends}".${didYouMean(topology.extends, topologyNames)}`,
      });
    }
  });
}

function checkAdapterBlocks(root: Root, ctx: Ctx): void {
  root.environments.forEach((env, index) => {
    if (!adapterList(env).includes('databricks')) return;
    const federation = env.federation;
    if (federation?.mode === 'multi-metastore') {
      if (!federation.metastores?.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['environments', index, 'federation', 'metastores'],
          message: 'multi-metastore mode needs at least one entry in federation.metastores.',
        });
      }
      federation.metastores?.forEach((metastore, msIndex) => {
        if (!metastore.host || !metastore.warehouseId) {
          ctx.addIssue({
            code: 'custom',
            path: ['environments', index, 'federation', 'metastores', msIndex],
            message: `The databricks adapter needs host and warehouseId for metastore "${metastore.id}".`,
          });
        }
      });
      return;
    }
    if (!env.connection?.host || !env.connection.warehouseId) {
      ctx.addIssue({
        code: 'custom',
        path: ['environments', index, 'connection'],
        message: 'The databricks adapter needs connection.host and connection.warehouseId.',
      });
    }
  });
}

function checkPromotion(root: Root, ctx: Ctx): void {
  if (!root.promotion) return;
  const envIds = root.environments.map((env) => env.id);
  const seen = new Set<string>();
  root.promotion.order.forEach((id, index) => {
    if (!envIds.includes(id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['promotion', 'order', index],
        message: `Unknown environment "${id}".${didYouMean(id, envIds)}`,
      });
    }
    if (seen.has(id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['promotion', 'order', index],
        message: `Environment "${id}" appears twice in promotion.order.`,
      });
    }
    seen.add(id);
  });
  if (root.promotion.source === 'job-tag' && !root.promotion.tagKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['promotion', 'tagKey'],
      message: 'promotion.source "job-tag" needs a tagKey.',
    });
  }
}

/** The `orrery.config.yaml` schema, before topology resolution. */
export const OrreryConfigInput = RootShape.superRefine((root, ctx) => {
  checkUniqueIds(root, ctx);
  checkReferences(root, ctx);
  checkAdapterBlocks(root, ctx);
  checkPromotion(root, ctx);
});

export type OrreryConfigInput = z.infer<typeof OrreryConfigInput>;
