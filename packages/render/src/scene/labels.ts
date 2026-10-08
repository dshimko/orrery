// SPDX-License-Identifier: Apache-2.0
// DOM label overlay (stability rule 6). Per frame the only DOM write is `style.transform`;
// text goes through the shared gate so it changes at most `domHz` times a second, and only
// when it differs. Text is always set with `textContent`, never parsed as HTML.
import { createTextGate } from '@orrery/core';
import { Vector3, type Camera } from 'three';
import type { Vec3 } from '../sim/math.js';

const HIDDEN = 'translate(-9999px,-9999px)';
const OFFSCREEN_MARGIN = 1.25;

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Projects a world point to CSS pixels inside a width x height viewport. Not visible when
 * behind the camera, beyond the far plane, or well outside the viewport. The camera's world
 * matrices must be current.
 */
export function projectToScreen(
  point: Vec3,
  camera: Camera,
  width: number,
  height: number,
  scratch: Vector3 = new Vector3(),
): ScreenPoint {
  scratch.set(point.x, point.y, point.z).project(camera);
  const inDepth = scratch.z >= -1 && scratch.z <= 1;
  const inView = Math.abs(scratch.x) <= OFFSCREEN_MARGIN && Math.abs(scratch.y) <= OFFSCREEN_MARGIN;
  return {
    x: (scratch.x * 0.5 + 0.5) * width,
    y: (-scratch.y * 0.5 + 0.5) * height,
    visible: inDepth && inView,
  };
}

/** The CSS transform that anchors a label's bottom center at a screen point. */
export function labelTransform(point: ScreenPoint): string {
  if (!point.visible) return HIDDEN;
  return `translate(${point.x.toFixed(1)}px,${point.y.toFixed(1)}px) translate(-50%,-100%)`;
}

export interface LabelSpec {
  /** Unique key; also the text-gate key. */
  id: string;
  className: string;
  /** CSS color for the name, e.g. a spoke color. */
  color?: string;
  hasSmall?: boolean;
  /** Hidden while the camera is farther than this from its target. */
  maxCam?: number;
  /** Writes the world anchor into `out`. */
  place(out: Vector3): void;
}

export interface Label {
  readonly spec: LabelSpec;
  readonly el: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly smallEl: HTMLElement | null;
  lastTransform: string;
}

export class LabelLayer {
  private readonly labels = new Set<Label>();
  private readonly gate: (key: string, text: string, nowMs: number) => boolean;
  private readonly anchor = new Vector3();
  private readonly scratch = new Vector3();

  constructor(
    private readonly root: HTMLElement,
    domHz: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.gate = createTextGate(domHz);
  }

  add(spec: LabelSpec): Label {
    const doc = this.root.ownerDocument;
    const el = doc.createElement('div');
    el.className = `orrery-lab ${spec.className}`;
    const nameEl = doc.createElement('span');
    if (spec.color) nameEl.style.color = spec.color;
    el.appendChild(nameEl);
    let smallEl: HTMLElement | null = null;
    if (spec.hasSmall) {
      smallEl = doc.createElement('small');
      el.appendChild(smallEl);
    }
    this.root.appendChild(el);
    const label: Label = { spec, el, nameEl, smallEl, lastTransform: '' };
    this.labels.add(label);
    return label;
  }

  remove(label: Label): void {
    if (this.labels.delete(label)) label.el.remove();
  }

  /** Sets the label text if the gate allows it. Returns true when the DOM was written. */
  setText(label: Label, name: string, small = '', late = false): boolean {
    const key = label.spec.id;
    if (!this.gate(key, `${name}\n${small}\n${late}`, this.now())) return false;
    label.nameEl.textContent = name;
    if (label.smallEl) {
      label.smallEl.textContent = small;
      label.smallEl.className = late ? 'late' : '';
    }
    return true;
  }

  /** Projects every label; writes `style.transform` only when it changed. */
  project(camera: Camera, width: number, height: number, cameraDistance: number): void {
    for (const label of this.labels) {
      const { maxCam = Infinity } = label.spec;
      label.spec.place(this.anchor);
      const screen =
        cameraDistance <= maxCam
          ? projectToScreen(this.anchor, camera, width, height, this.scratch)
          : { x: 0, y: 0, visible: false };
      const transform = labelTransform(screen);
      if (transform === label.lastTransform) continue;
      label.lastTransform = transform;
      label.el.style.transform = transform;
    }
  }

  dispose(): void {
    for (const label of this.labels) label.el.remove();
    this.labels.clear();
  }
}
