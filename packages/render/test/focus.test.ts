// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { placeBodies } from '../src/index.js';
import { describeScene, focusDistance, focusPosition, primeLevels } from '../src/focus.js';
import { freshModel, loadFixture, type Fixture } from './fixture.js';

let fixture: Fixture;
beforeAll(async () => {
  fixture = await loadFixture();
});

describe('focus helpers', () => {
  it('follows a spoke as it moves and falls back to the origin for unknown ids', () => {
    const model = freshModel(fixture);
    placeBodies(model);
    const spoke = model.spokes[1];
    if (!spoke) throw new Error('no spoke');
    const at = focusPosition(model, { kind: 'spoke', id: spoke.id });
    expect(at()).toBe(spoke.pos);
    expect(focusPosition(model, { kind: 'spoke', id: 'gone' })()).toEqual({ x: 0, y: 0, z: 0 });
    expect(focusPosition(model, { kind: 'hub' })()).toEqual({ x: 0, y: 0, z: 0 });
    expect(focusPosition(model, { kind: 'shipyard' })()).toBe(model.yard);
    expect(focusDistance({ kind: 'shipyard' })).toBeGreaterThan(0);
  });

  it('summarizes the environment for assistive tech', () => {
    const text = describeScene(freshModel(fixture));
    expect(text).toContain('system view');
    expect(text).toContain(`${fixture.topology.spokes.length} spokes`);
    expect(text).toContain('open alerts');
  });

  it('primes site and station levels from the first snapshot', () => {
    const model = freshModel(fixture);
    primeLevels(model);
    const levels = fixture.snapshot.sourceGroups.flatMap((g) => g.sites.map((s) => s.activity));
    const primed = [...model.siteById.values()].map((s) => s.activity);
    expect(primed).toEqual(levels);
  });
});
