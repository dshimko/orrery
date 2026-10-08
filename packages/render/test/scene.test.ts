// SPDX-License-Identifier: Apache-2.0
// Builds the whole scene graph in Node (no WebGL needed) and drives it with the simulation.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CAPS,
  createPools,
  placeBodies,
  spawn,
  step,
  type Pools,
  type SceneModel,
} from '../src/index.js';
import { buildScene, type BuiltScene } from '../src/scene/build.js';
import type { Frame } from '../src/scene/context.js';
import { visibleSlots } from '../src/scene/fade.js';
import { LabelLayer } from '../src/scene/labels.js';
import { FakeEl } from './fake-dom.js';
import { AT, freshModel, loadFixture, visuals, type Fixture } from './fixture.js';

let fixture: Fixture;
beforeAll(async () => {
  fixture = await loadFixture();
});

function frameFor(model: SceneModel, pools: Pools, workload = 'all'): Frame {
  return {
    model,
    pools,
    dt: 1 / 60,
    spin: model.animTime,
    anim: model.animTime,
    reduced: false,
    slots: visibleSlots(workload, visuals.workloads),
    held: false,
    federated: false,
  };
}

function setup(): { model: SceneModel; pools: Pools; built: BuiltScene; root: FakeEl } {
  const model = freshModel(fixture);
  placeBodies(model);
  const root = new FakeEl();
  const labels = new LabelLayer(root as unknown as HTMLElement, 4, () => 0);
  return { model, pools: createPools(), built: buildScene(model, labels), root };
}

describe('buildScene', () => {
  it('registers a pickable for the hub, every spoke, site, station, comet, and the shipyard', () => {
    const { model, built } = setup();
    const picks = built.pickables.map((o) => o.userData['pick'] as { kind: string; id?: string });
    const count = (kind: string) => picks.filter((p) => p.kind === kind).length;
    expect(count('hub')).toBe(1);
    expect(count('spoke')).toBe(model.spokes.length);
    expect(count('site')).toBe(model.siteById.size);
    expect(count('useCase')).toBe(model.stations.length);
    expect(count('foreign')).toBe(model.comets.length);
    expect(count('shipyard')).toBe(1);
    built.dispose();
  });

  it('syncs frames with live vehicles and refreshes label text without throwing', () => {
    const { model, pools, built, root } = setup();
    fixture.events.forEach((event, i) => spawn(model, pools, event, i));
    const time = { at: AT, speed: 1, paused: false };
    for (let i = 0; i < 30; i += 1) {
      step(model, pools, 1 / 60, time);
      const frame = frameFor(model, pools);
      built.sync(frame);
      if (i === 0) built.refresh(frame);
    }
    expect(pools.dropped).toBeGreaterThanOrEqual(0);
    expect(CAPS.beacon).toBe(8);
    const texts = root.children.map((c) => c.children.map((n) => n.textContent).join('|'));
    expect(texts.some((t) => t.includes(model.topology.hub.name))).toBe(true);
    built.dispose();
  });

  it('adds a flag label per open alert and removes it when the alert closes', () => {
    const { model, pools, built, root } = setup();
    const frame = frameFor(model, pools);
    const alert = (id: string, severity: 'incident' | 'info') => ({
      id,
      severity,
      kind: 'transfer-hold',
      title: `Alert ${id}`,
      text: '',
      openedAt: AT.toISOString(),
      targets: ['hub' as const],
    });
    model.snapshot = { ...model.snapshot, alerts: [alert('a', 'incident'), alert('b', 'info')] };
    built.refresh(frame);
    const flags = () => root.children.filter((c) => !c.removed && c.className.includes('flag'));
    expect(flags().map((c) => c.className)).toEqual(['orrery-lab flag', 'orrery-lab flag info']);
    expect(flags().map((c) => c.children[0]?.textContent)).toEqual(['Alert a', 'Alert b']);
    model.snapshot = { ...model.snapshot, alerts: [] };
    built.refresh(frame);
    expect(flags()).toHaveLength(0);
    built.dispose();
  });

  it('can be disposed twice', () => {
    const { built } = setup();
    built.dispose();
    expect(() => built.dispose()).not.toThrow();
  });
});
