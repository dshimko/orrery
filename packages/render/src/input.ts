// SPDX-License-Identifier: Apache-2.0
// Pointer, wheel, touch, and keyboard input for the six-axis camera rig.
import { TAU } from './sim/math.js';
import type { CameraRig } from './sim/camera.js';
import type { CameraViewKey } from './types.js';

const DRAG_THRESHOLD_PX = 5;
const ROTATE_PER_PX = 0.005;
const ROLL_PER_PX = 0.006;
const WHEEL_ZOOM = 0.0012;
const WHEEL_LINE_PX = 16;
const MIN_FRAME_MS = 8;
const INERTIA_WINDOW_MS = 90;
const KEY_ROTATE_RATE = 1.4;
const KEY_PAN_RATE = 420;
const KEY_ZOOM_RATE = 1.5;
const MS_PER_SECOND = 1000;
const VIEW_KEYS: readonly CameraViewKey[] = [
  'over',
  'belt',
  'ingest',
  'earth',
  'planets',
  'stations',
  'yard',
];

type DragMode = 'rotate' | 'pan' | 'roll';

interface Pointer {
  x: number;
  y: number;
}

interface TwoFinger {
  cx: number;
  cy: number;
  distance: number;
  angle: number;
}

export interface InputHandlers {
  viewportHeight(): number;
  onClick(clientX: number, clientY: number): void;
  onView(key: CameraViewKey): void;
  onLevel(): void;
  onReset(): void;
}

export interface Input {
  /** Applies held keys. Call every frame with the frame's dt. */
  step(dt: number): void;
  dispose(): void;
}

function dragMode(e: PointerEvent): DragMode {
  if (e.button === 2 || e.button === 1 || e.shiftKey) return 'pan';
  return e.ctrlKey || e.altKey || e.metaKey ? 'roll' : 'rotate';
}

function twoFinger(pointers: Map<number, Pointer>): TwoFinger | null {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return null;
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    distance: Math.hypot(a.x - b.x, a.y - b.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function wrapAngle(a: number): number {
  if (a > Math.PI) return a - TAU;
  return a < -Math.PI ? a + TAU : a;
}

export function attachInput(canvas: HTMLCanvasElement, rig: CameraRig, h: InputHandlers): Input {
  const pointers = new Map<number, Pointer>();
  const keys = new Set<string>();
  let mode: DragMode = 'rotate';
  let moved = 0;
  let two: TwoFinger | null = null;
  let lastMoveMs = 0;

  const onDown = (e: PointerEvent): void => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    two = null;
    rig.dragging = true;
    rig.setInertia(0, 0);
    mode = dragMode(e);
  };

  const pinch = (): void => {
    const now = twoFinger(pointers);
    if (now && two) {
      rig.rotateLocal('z', -wrapAngle(now.angle - two.angle));
      if (now.distance > 0) rig.dolly(two.distance / now.distance);
      rig.pan(now.cx - two.cx, now.cy - two.cy, h.viewportHeight());
    }
    two = now;
    moved = Infinity;
  };

  const drag = (dx: number, dy: number): void => {
    if (mode === 'pan') {
      rig.pan(dx, dy, h.viewportHeight());
    } else if (mode === 'roll') {
      rig.rotateLocal('z', dx * ROLL_PER_PX);
    } else {
      const yaw = -dx * ROTATE_PER_PX;
      const pitch = -dy * ROTATE_PER_PX;
      rig.rotateLocal('y', yaw);
      rig.rotateLocal('x', pitch);
      const now = performance.now();
      const seconds = Math.max(MIN_FRAME_MS, now - lastMoveMs) / MS_PER_SECOND;
      lastMoveMs = now;
      rig.setInertia(yaw / seconds, pitch / seconds);
    }
  };

  const onMove = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size >= 2) {
      pinch();
      return;
    }
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > DRAG_THRESHOLD_PX) drag(dx, dy);
  };

  const onUp = (e: PointerEvent): void => {
    const had = pointers.delete(e.pointerId);
    two = null;
    if (pointers.size > 0) return;
    rig.dragging = false;
    if (performance.now() - lastMoveMs > INERTIA_WINDOW_MS) rig.setInertia(0, 0);
    if (had && moved <= DRAG_THRESHOLD_PX) h.onClick(e.clientX, e.clientY);
  };

  const onCancel = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    two = null;
    rig.dragging = pointers.size > 0;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
    rig.dolly(Math.exp(delta * WHEEL_ZOOM));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key.startsWith('Arrow')) e.preventDefault();
    keys.add(key);
    if (key === 'h') h.onLevel();
    else if (key === 'r' || key === '0') h.onReset();
    else if (key >= '1' && key <= '7') h.onView(VIEW_KEYS[Number(key) - 1] ?? 'over');
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  };
  const onBlur = (): void => keys.clear();
  const onContextMenu = (e: Event): void => e.preventDefault();

  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', onDown as EventListener],
    ['pointermove', onMove as EventListener],
    ['pointerup', onUp as EventListener],
    ['pointercancel', onCancel as EventListener],
    ['wheel', onWheel as EventListener, { passive: false }],
    ['keydown', onKeyDown as EventListener],
    ['keyup', onKeyUp as EventListener],
    ['blur', onBlur],
    ['contextmenu', onContextMenu],
  ];
  for (const [type, fn, opts] of listeners) canvas.addEventListener(type, fn, opts);

  return {
    step(dt) {
      if (keys.size === 0) return;
      const rotate = KEY_ROTATE_RATE * dt;
      const pan = KEY_PAN_RATE * dt;
      const shift = keys.has('Shift');
      const height = h.viewportHeight();
      const arrow = (key: string, axis: 'x' | 'y', sign: number): void => {
        if (!keys.has(key)) return;
        if (!shift) rig.rotateLocal(axis, sign * rotate);
        else if (axis === 'y') rig.pan(sign * pan, 0, height);
        else rig.pan(0, sign * pan, height);
      };
      arrow('ArrowLeft', 'y', 1);
      arrow('ArrowRight', 'y', -1);
      arrow('ArrowUp', 'x', 1);
      arrow('ArrowDown', 'x', -1);
      if (keys.has('q')) rig.rotateLocal('z', rotate);
      if (keys.has('e')) rig.rotateLocal('z', -rotate);
      if (keys.has('+') || keys.has('=')) rig.dolly(Math.exp(-dt * KEY_ZOOM_RATE));
      if (keys.has('-') || keys.has('_')) rig.dolly(Math.exp(dt * KEY_ZOOM_RATE));
    },
    dispose() {
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      pointers.clear();
      keys.clear();
    },
  };
}
