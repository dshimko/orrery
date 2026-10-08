// SPDX-License-Identifier: Apache-2.0
// The framework-free Orloj view: canvas, frame loop, input, and the public API.
import { createTextGate } from '@orrery/core';
import { describeFaces } from './aria.js';
import { drawFace } from './draw/index.js';
import { geometryFor } from './geometry.js';
import { findHit, toPixelHits } from './hit-test.js';
import { faceAt, faceOrigin, orlojLayout } from './layout.js';
import { createFaceModel, faceHits, maxPipelinesAcross, type FaceModel } from './model/index.js';
import { settledSmooth, spokeDistances, stepSmooth, type FaceSmooth } from './smooth.js';
import type { OrlojFace, OrlojHit, OrlojLayout, OrlojOptions, OrlojView } from './types.js';

const MS_PER_SECOND = 1000;
const MAX_FRAME_SECONDS = 0.05;
const MAX_PIXEL_RATIO = 2;
const FALLBACK_WIDTH_PX = 1200;
const ARIA_KEY = 'aria';

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createOrlojView(container: HTMLElement, options: OrlojOptions): OrlojView {
  const { visuals } = options;
  const geo = geometryFor(visuals);
  const doc = container.ownerDocument;
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isReduced = options.reducedMotion ?? prefersReducedMotion();
  const gate = createTextGate(visuals.stability.domHz);

  const canvas = doc.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', describeFaces([]));
  canvas.style.display = 'block';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let faces: readonly OrlojFace[] = options.faces;
  let maxPipelines = maxPipelinesAcross(faces);
  let smooth = new Map<string, FaceSmooth>();
  let hits: OrlojHit[] = [];
  let layout: OrlojLayout = orlojLayout(FALLBACK_WIDTH_PX, faces.length, visuals);
  let pixelRatio = 1;
  let deco = 0;
  let lastTs: number | null = null;
  let rafId: number | null = null;
  let isDisposed = false;
  const hoverListeners = new Set<(hit: OrlojHit | null) => void>();
  const selectListeners = new Set<(envId: string) => void>();

  function resize(): void {
    const width = container.clientWidth || FALLBACK_WIDTH_PX;
    pixelRatio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    layout = orlojLayout(width, faces.length, visuals);
    const height = Math.round(layout.height);
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const cssWidth = `${width}px`;
    const cssHeight = `${height}px`;
    if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
    if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
  }

  function renderFrame(dt: number): void {
    if (!ctx) return;
    const time = options.time();
    if (!time.paused && !isReduced) deco += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const nextSmooth = new Map<string, FaceSmooth>();
    const nextHits: OrlojHit[] = [];
    const models: FaceModel[] = [];
    faces.forEach((face, index) => {
      const model = createFaceModel(face, time, visuals, maxPipelines);
      const prev = smooth.get(model.envId) ?? settledSmooth(model);
      const state = stepSmooth(prev, model, dt, visuals);
      nextSmooth.set(model.envId, state);
      models.push(model);
      const origin = faceOrigin(layout, index, visuals);
      const k = pixelRatio * layout.scale;
      ctx.setTransform(k, 0, 0, k, pixelRatio * origin.x, pixelRatio * origin.y);
      drawFace(ctx, model, { visuals, geo, deco, smooth: state });
      nextHits.push(
        ...toPixelHits(
          model.envId,
          faceHits(model, geo, spokeDistances(state), { at: time.at, timeZone }),
          origin.x,
          origin.y,
          layout.scale,
        ),
      );
    });
    smooth = nextSmooth;
    hits = nextHits;
    const label = describeFaces(models);
    if (gate(ARIA_KEY, label, performance.now())) canvas.setAttribute('aria-label', label);
  }

  function frame(ts: number): void {
    rafId = null;
    if (isDisposed) return;
    const dt = lastTs === null ? 0 : Math.min(MAX_FRAME_SECONDS, (ts - lastTs) / MS_PER_SECOND);
    lastTs = ts;
    renderFrame(dt);
    schedule();
  }

  function schedule(): void {
    if (isDisposed || doc.hidden || rafId !== null) return;
    rafId = requestAnimationFrame(frame);
  }

  function pointerPosition(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function emitHover(hit: OrlojHit | null): void {
    for (const listener of hoverListeners) listener(hit);
  }

  const onPointerMove = (event: PointerEvent): void => {
    const p = pointerPosition(event);
    emitHover(findHit(hits, p.x, p.y));
  };
  const onPointerLeave = (): void => emitHover(null);
  const onClick = (event: MouseEvent): void => {
    const p = pointerPosition(event);
    const index = faceAt(layout, faces.length, p.x, p.y, visuals);
    const face = faces[index];
    if (!face) return;
    for (const listener of selectListeners) listener(face.env.id);
  };
  const onVisibility = (): void => {
    if (doc.hidden) {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      return;
    }
    lastTs = null;
    schedule();
  };

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('click', onClick);
  doc.addEventListener('visibilitychange', onVisibility);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(container);

  resize();
  schedule();

  return {
    setFaces(next) {
      if (isDisposed) return;
      faces = next;
      maxPipelines = maxPipelinesAcross(next);
      resize();
    },
    onHover(listener) {
      hoverListeners.add(listener);
      return () => void hoverListeners.delete(listener);
    },
    onSelect(listener) {
      selectListeners.add(listener);
      return () => void selectListeners.delete(listener);
    },
    layout: () => layout,
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      observer?.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      doc.removeEventListener('visibilitychange', onVisibility);
      hoverListeners.clear();
      selectListeners.clear();
      canvas.remove();
    },
  };
}
