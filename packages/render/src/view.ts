// SPDX-License-Identifier: Apache-2.0
// The framework-free system view: renderer, frame loop, input, and the public API.
import { Raycaster, PerspectiveCamera, Vector2, WebGLRenderer, type Object3D } from 'three';
import { focusDistance, focusPosition, describeScene, primeLevels } from './focus.js';
import { attachInput } from './input.js';
import { EventQueue, isTimeJump } from './queue.js';
import { buildScene } from './scene/build.js';
import type { Frame } from './scene/context.js';
import { visibleSlots } from './scene/fade.js';
import { LabelLayer } from './scene/labels.js';
import { LABEL_CSS } from './scene/labels-css.js';
import { COLOR_NIGHT } from './scene/palette.js';
import { CameraRig } from './sim/camera.js';
import { clamp, ORIGIN } from './sim/math.js';
import { createModel } from './sim/model.js';
import { clearPools, createPools } from './sim/particles.js';
import { spawn } from './sim/spawn.js';
import { applySnapshot, placeBodies, step } from './sim/step.js';
import type {
  CameraState,
  CameraViewKey,
  Filters,
  PickTarget,
  SystemView,
  SystemViewOptions,
} from './types.js';
import { createTextGate, type PlatformEvent, type Snapshot } from '@orrery/core';

const MAX_DT = 0.1;
const MS_PER_SECOND = 1000;
const TEXT_REFRESH_MS = 250;
const MAX_PIXEL_RATIO = 2;
const NEAR = 0.5;
const FAR = 4000;
const DEFAULT_ASPECT = 1.78;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isPick(value: unknown): value is PickTarget {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

function firstShownPick(hits: readonly { object: Object3D }[]): PickTarget | null {
  for (const { object } of hits) {
    let shown = true;
    for (let o: Object3D | null = object; o; o = o.parent) shown &&= o.visible;
    const pick: unknown = object.userData['pick'];
    if (shown && isPick(pick)) return pick;
  }
  return null;
}

export function createSystemView(container: HTMLElement, options: SystemViewOptions): SystemView {
  const { visuals } = options;
  const doc = container.ownerDocument;
  const reduced = options.reducedMotion ?? prefersReducedMotion();

  const model = createModel(options.topology, visuals, options.seed, options.snapshot);
  const pools = createPools();
  const queue = new EventQueue();
  placeBodies(model);
  primeLevels(model);

  const root = doc.createElement('div');
  root.className = 'orrery-view';
  const style = doc.createElement('style');
  style.textContent = LABEL_CSS;
  const labelsEl = doc.createElement('div');
  labelsEl.className = 'orrery-labels';
  const band = doc.createElement('div');
  band.className = 'orrery-band';
  band.style.background = options.tierColor;

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(COLOR_NIGHT, 1);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  root.append(style, canvas, labelsEl, band);
  container.appendChild(root);

  const labels = new LabelLayer(labelsEl, visuals.stability.domHz);
  const ariaGate = createTextGate(visuals.stability.domHz);
  const built = buildScene(model, labels);
  const camera = new PerspectiveCamera(visuals.camera.fovDeg, DEFAULT_ASPECT, NEAR, FAR);
  const rig = new CameraRig(visuals.camera, options.camera);
  const raycaster = new Raycaster();
  const pickListeners = new Set<(target: PickTarget | null) => void>();

  const frame: Frame = {
    model,
    pools,
    dt: 0,
    spin: 0,
    anim: 0,
    reduced,
    slots: visibleSlots(model.filters.workload, visuals.workloads),
    held: false,
    federated: false,
  };

  let width = 1;
  let height = 1;
  let currentView: CameraViewKey = 'over';
  let lastTs: number | null = null;
  let lastAtMs: number | null = null;
  let lastTextMs = -Infinity;
  let rafId = 0;
  let disposed = false;

  const viewContext = () => ({
    aspect: width / Math.max(1, height),
    ingest: model.ingest?.pos ?? null,
    yard: model.yard,
  });
  const ingestPosition = () => model.ingest?.pos ?? ORIGIN;

  const applyView = (key: CameraViewKey): void => {
    currentView = key;
    rig.userMoved = false;
    rig.goView(key, viewContext(), ingestPosition);
  };

  const resize = (): void => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!rig.userMoved && !options.camera) applyView(currentView);
  };

  const pickAt = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const target = firstShownPick(raycaster.intersectObjects([...built.pickables], false));
    for (const listener of pickListeners) listener(target);
  };

  const input = attachInput(canvas, rig, {
    viewportHeight: () => height,
    onClick: pickAt,
    onView: applyView,
    onLevel: () => rig.levelHorizon(),
    onReset: () => applyView('over'),
  });

  const clearTransient = (): void => {
    queue.clear();
    clearPools(pools);
  };

  const advanceTime = (dt: number): void => {
    const time = options.time();
    const atMs = time.at.getTime();
    if (lastAtMs !== null && isTimeJump(lastAtMs, atMs)) clearTransient();
    lastAtMs = atMs;
    queue.drain(atMs).forEach((q) => spawn(model, pools, q.event, q.index));
    step(model, pools, dt, time);
  };

  const syncFrame = (dt: number): void => {
    const alerts = model.snapshot.alerts;
    frame.dt = dt;
    frame.anim = model.animTime;
    frame.spin = reduced ? 0 : model.animTime;
    frame.held = alerts.some((a) => a.kind === 'transfer-hold');
    frame.federated = alerts.some((a) => a.kind === 'federated-query');
  };

  const refreshText = (nowMs: number): void => {
    if (nowMs - lastTextMs < TEXT_REFRESH_MS) return;
    lastTextMs = nowMs;
    built.refresh(frame);
    const summary = describeScene(model);
    if (ariaGate('aria', summary, nowMs)) canvas.setAttribute('aria-label', summary);
  };

  const tick = (ts: number): void => {
    if (disposed) return;
    const dt = lastTs === null ? 0 : clamp((ts - lastTs) / MS_PER_SECOND, 0, MAX_DT);
    lastTs = ts;
    advanceTime(dt);
    input.step(dt);
    rig.step(dt);
    camera.position.copy(rig.position());
    camera.quaternion.copy(rig.pose.rotation);
    camera.updateMatrixWorld();
    syncFrame(dt);
    built.sync(frame);
    refreshText(ts);
    labels.project(camera, width, height, rig.pose.distance);
    renderer.render(built.scene, camera);
    rafId = requestAnimationFrame(tick);
  };

  const onVisibility = (): void => {
    if (disposed) return;
    if (doc.hidden) {
      cancelAnimationFrame(rafId);
      return;
    }
    lastTs = null;
    rafId = requestAnimationFrame(tick);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  doc.addEventListener('visibilitychange', onVisibility);
  resize();
  if (!options.camera) {
    applyView('over');
    rig.setState(rig.getState());
  }
  if (!doc.hidden) rafId = requestAnimationFrame(tick);

  return {
    setSnapshot(snapshot: Snapshot) {
      applySnapshot(model, snapshot);
    },
    pushEvents(events: readonly PlatformEvent[]) {
      queue.push(events);
    },
    clearTransient,
    setFilters(filters: Partial<Filters>) {
      model.filters = { ...model.filters, ...filters };
      frame.slots = visibleSlots(model.filters.workload, visuals.workloads);
    },
    goView: applyView,
    focus(target: PickTarget) {
      rig.followTarget(focusPosition(model, target), focusDistance(target));
    },
    resetCamera: () => applyView('over'),
    levelHorizon: () => rig.levelHorizon(),
    getCamera: (): CameraState => rig.getState(),
    setCamera: (state: CameraState) => rig.setState(state),
    onPick(listener) {
      pickListeners.add(listener);
      return () => pickListeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      observer.disconnect();
      doc.removeEventListener('visibilitychange', onVisibility);
      input.dispose();
      pickListeners.clear();
      labels.dispose();
      built.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
