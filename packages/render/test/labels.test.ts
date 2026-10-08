// SPDX-License-Identifier: Apache-2.0
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { LabelLayer, labelTransform, projectToScreen } from '../src/scene/labels.js';
import { FakeEl } from './fake-dom.js';

const W = 1000;
const H = 500;

function cameraAt(z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(38, W / H, 0.5, 4000);
  camera.position.set(0, 0, z);
  camera.updateMatrixWorld();
  return camera;
}

describe('projectToScreen', () => {
  it('puts the point ahead of the camera at the viewport center', () => {
    const p = projectToScreen({ x: 0, y: 0, z: 0 }, cameraAt(100), W, H);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(W / 2, 3);
    expect(p.y).toBeCloseTo(H / 2, 3);
  });

  it('maps up to smaller y and right to larger x', () => {
    const up = projectToScreen({ x: 0, y: 5, z: 0 }, cameraAt(100), W, H);
    const right = projectToScreen({ x: 5, y: 0, z: 0 }, cameraAt(100), W, H);
    expect(up.y).toBeLessThan(H / 2);
    expect(right.x).toBeGreaterThan(W / 2);
  });

  it('hides points behind the camera', () => {
    expect(projectToScreen({ x: 0, y: 0, z: 200 }, cameraAt(100), W, H).visible).toBe(false);
  });

  it('hides points far outside the viewport and beyond the far plane', () => {
    expect(projectToScreen({ x: 500, y: 0, z: 0 }, cameraAt(100), W, H).visible).toBe(false);
    expect(projectToScreen({ x: 0, y: 0, z: -9000 }, cameraAt(100), W, H).visible).toBe(false);
  });

  it('is deterministic for a fixed camera', () => {
    const a = projectToScreen({ x: 3, y: 2, z: 1 }, cameraAt(80), W, H);
    const b = projectToScreen({ x: 3, y: 2, z: 1 }, cameraAt(80), W, H);
    expect(b).toEqual(a);
  });
});

describe('labelTransform', () => {
  it('parks hidden labels off screen and anchors visible ones at their bottom center', () => {
    expect(labelTransform({ x: 1, y: 2, visible: false })).toBe('translate(-9999px,-9999px)');
    expect(labelTransform({ x: 10.04, y: 20, visible: true })).toBe(
      'translate(10.0px,20.0px) translate(-50%,-100%)',
    );
  });
});

function layerWithClock() {
  const root = new FakeEl();
  const clock = { now: 0 };
  const layer = new LabelLayer(root as unknown as HTMLElement, 4, () => clock.now);
  return { root, clock, layer };
}

const spec = (id: string, x = 0) => ({
  id,
  className: 'planet',
  hasSmall: true,
  place: (out: { set(x: number, y: number, z: number): unknown }) => out.set(x, 0, 0),
});

describe('LabelLayer', () => {
  it('writes text through the gate: only on change and at most domHz times a second', () => {
    const { clock, layer } = layerWithClock();
    const label = layer.add(spec('a'));
    expect(layer.setText(label, 'Sales', '3.2 h')).toBe(true);
    expect(label.nameEl.textContent).toBe('Sales');
    expect(layer.setText(label, 'Sales', '3.2 h')).toBe(false);
    clock.now = 100;
    expect(layer.setText(label, 'Sales', '3.3 h')).toBe(false);
    expect(label.smallEl?.textContent).toBe('3.2 h');
    clock.now = 300;
    expect(layer.setText(label, 'Sales', '3.3 h')).toBe(true);
    expect(label.smallEl?.textContent).toBe('3.3 h');
  });

  it('keeps markup in names as literal text', () => {
    const { layer } = layerWithClock();
    const label = layer.add(spec('xss'));
    layer.setText(label, '<img src=x onerror=alert(1)>');
    expect(label.nameEl.textContent).toBe('<img src=x onerror=alert(1)>');
    // Only the name and small elements exist: no markup was parsed into extra nodes.
    expect((label.el as unknown as FakeEl).children).toHaveLength(2);
  });

  it('per frame writes only style.transform, and only when it changed', () => {
    const { layer } = layerWithClock();
    const label = layer.add(spec('a'));
    const camera = cameraAt(100);
    layer.project(camera, W, H, 100);
    layer.project(camera, W, H, 100);
    expect((label.el as unknown as FakeEl).style.transformWrites).toBe(1);
    expect((label.el as unknown as FakeEl).textContent).toBe('');
  });

  it('hides labels beyond their maxCam distance', () => {
    const { layer } = layerWithClock();
    const label = layer.add({ ...spec('tower'), maxCam: 95 });
    const camera = cameraAt(100);
    layer.project(camera, W, H, 120);
    expect(label.el.style.transform).toBe('translate(-9999px,-9999px)');
    layer.project(camera, W, H, 60);
    expect(label.el.style.transform).toContain('translate(-50%,-100%)');
  });

  it('removes and disposes label elements', () => {
    const { layer } = layerWithClock();
    const a = layer.add(spec('a'));
    const b = layer.add(spec('b'));
    layer.remove(a);
    expect((a.el as unknown as FakeEl).removed).toBe(true);
    layer.dispose();
    expect((b.el as unknown as FakeEl).removed).toBe(true);
  });
});
