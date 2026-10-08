// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrlojView, type OrlojHit, type OrlojFace, type OrlojTime } from '../src/index.js';
import { createFakeContext, type FakeContext } from './fake-canvas.js';
import { loadFaces, visuals } from './fixture.js';

type Listener = (event: unknown) => void;

class FakeCanvas {
  width = 0;
  height = 0;
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<Listener>>();
  isRemoved = false;
  readonly fake: FakeContext = createFakeContext();
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getContext(): CanvasRenderingContext2D {
    return this.fake.ctx;
  }
  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 };
  }
  remove(): void {
    this.isRemoved = true;
  }
  fire(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

class FakeDocument {
  hidden = false;
  canvas = new FakeCanvas();
  listeners = new Set<Listener>();
  createElement(): FakeCanvas {
    return this.canvas;
  }
  addEventListener(_type: string, fn: Listener): void {
    this.listeners.add(fn);
  }
  removeEventListener(_type: string, fn: Listener): void {
    this.listeners.delete(fn);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const fn of this.listeners) fn({});
  }
}

let rafQueue = new Map<number, (ts: number) => void>();
let nextRafId = 1;
let observerDisconnects = 0;

function runFrame(ts: number): void {
  const callbacks = [...rafQueue.values()];
  rafQueue = new Map();
  for (const cb of callbacks) cb(ts);
}

function setup(
  time: () => OrlojTime,
  faces: readonly OrlojFace[],
  reducedMotion = false,
  width = 1200,
) {
  const doc = new FakeDocument();
  const container = {
    ownerDocument: doc,
    clientWidth: width,
    appendChild: vi.fn(),
  } as unknown as HTMLElement;
  const view = createOrlojView(container, { visuals, faces, time, reducedMotion });
  return { doc, canvas: doc.canvas, view };
}

/** Calls recorded for the frame that starts at the n-th clearRect. */
function frameCalls(calls: readonly string[], n: number): string[] {
  const starts = calls.flatMap((c, i) => (c.startsWith('clearRect') ? [i] : []));
  const from = starts[n];
  if (from === undefined) throw new Error(`no frame ${n}`);
  const next = starts[n + 1];
  // Each frame begins with an identity setTransform just before its clearRect.
  return calls.slice(from, next === undefined ? calls.length : next - 1);
}

let faces: OrlojFace[];
beforeAll(async () => {
  faces = await loadFaces();
});

beforeEach(() => {
  rafQueue = new Map();
  nextRafId = 1;
  observerDisconnects = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => {
    const id = nextRafId++;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => rafQueue.delete(id));
  vi.stubGlobal('devicePixelRatio', 3);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {
        observerDisconnects += 1;
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

const AT = new Date('2026-10-07T10:45:00Z');

describe('createOrlojView', () => {
  it('sizes the canvas from the layout with the pixel ratio capped at 2', () => {
    const { canvas, view } = setup(() => ({ at: AT, paused: true }), faces);
    const layout = view.layout();
    expect(layout.columns).toBe(3);
    expect(canvas.width).toBe(2400);
    expect(canvas.height).toBe(Math.round(Math.round(layout.height) * 2));
    expect(canvas.attributes.get('role')).toBe('img');
    view.dispose();
  });

  it('renders pixel-identical frames while paused with no input', () => {
    const { canvas, view } = setup(() => ({ at: AT, paused: true }), faces);
    for (let i = 0; i < 4; i += 1) runFrame(1000 + i * 16);
    const calls = canvas.fake.calls;
    expect(frameCalls(calls, 1)).toEqual(frameCalls(calls, 2));
    expect(frameCalls(calls, 2)).toEqual(frameCalls(calls, 3));
    view.dispose();
  });

  it('keeps decorative animation moving while time runs, and still with reduced motion', () => {
    const running = setup(() => ({ at: AT, paused: false }), faces);
    for (let i = 0; i < 3; i += 1) runFrame(1000 + i * 16);
    expect(frameCalls(running.canvas.fake.calls, 1)).not.toEqual(
      frameCalls(running.canvas.fake.calls, 2),
    );
    running.view.dispose();

    const reduced = setup(() => ({ at: AT, paused: false }), faces, true);
    for (let i = 0; i < 3; i += 1) runFrame(1000 + i * 16);
    expect(frameCalls(reduced.canvas.fake.calls, 1)).toEqual(
      frameCalls(reduced.canvas.fake.calls, 2),
    );
    reduced.view.dispose();
  });

  it('labels the canvas with every environment', () => {
    const { canvas, view } = setup(() => ({ at: AT, paused: true }), faces);
    runFrame(1000);
    const label = canvas.attributes.get('aria-label') ?? '';
    for (const id of ['DEV', 'STG', 'PROD']) expect(label).toContain(id);
    view.dispose();
  });

  it('reports hover regions and selects the clicked face', () => {
    const { canvas, view } = setup(() => ({ at: AT, paused: true }), faces);
    runFrame(1000);
    const hovered: (OrlojHit | null)[] = [];
    const selected: string[] = [];
    view.onHover((h) => hovered.push(h));
    view.onSelect((id) => selected.push(id));
    const layout = view.layout();
    const faceW = visuals.orloj.faceSize[0] * layout.scale;
    const offset = (layout.width - 3 * faceW) / 2;
    const plaqueX = offset + 2 * faceW + 220 * layout.scale;
    const plaqueY = 162 * layout.scale;
    canvas.fire('pointermove', { clientX: plaqueX, clientY: plaqueY });
    expect(hovered.at(-1)).toMatchObject({ envId: 'prod', part: 'plaque' });
    canvas.fire('pointermove', { clientX: 1, clientY: layout.height - 1 });
    expect(hovered.at(-1)).toBeNull();
    canvas.fire('click', { clientX: plaqueX, clientY: plaqueY });
    expect(selected).toEqual(['prod']);
    canvas.fire('pointerleave', {});
    expect(hovered.at(-1)).toBeNull();
    view.dispose();
  });

  it('pauses the loop while the document is hidden and resumes after', () => {
    const { doc, view } = setup(() => ({ at: AT, paused: true }), faces);
    runFrame(1000);
    expect(rafQueue.size).toBe(1);
    doc.setHidden(true);
    expect(rafQueue.size).toBe(0);
    doc.setHidden(false);
    expect(rafQueue.size).toBe(1);
    view.dispose();
  });

  it('disposes idempotently, removing the canvas, listeners, and observer', () => {
    const { doc, canvas, view } = setup(() => ({ at: AT, paused: true }), faces);
    runFrame(1000);
    view.dispose();
    view.dispose();
    expect(canvas.isRemoved).toBe(true);
    expect(canvas.listenerCount()).toBe(0);
    expect(doc.listeners.size).toBe(0);
    expect(rafQueue.size).toBe(0);
    expect(observerDisconnects).toBe(1);
  });

  it('re-lays out when faces change and ignores setFaces after dispose', () => {
    const { view } = setup(() => ({ at: AT, paused: true }), faces);
    view.setFaces(faces.slice(0, 1));
    expect(view.layout().columns).toBe(1);
    view.dispose();
    view.setFaces(faces);
    expect(view.layout().columns).toBe(1);
  });
});

describe('annotation mode', () => {
  const DIM_RECT = 'fillRect(0,0,440,820)';
  const paused = () => ({ at: AT, paused: true });
  const lastFrame = (calls: readonly string[]): string[] => {
    const n = calls.filter((c) => c.startsWith('clearRect')).length;
    return frameCalls(calls, n - 1);
  };

  it('draws no veil or markers until annotation is switched on', () => {
    const { canvas, view } = setup(paused, faces);
    runFrame(1000);
    expect(lastFrame(canvas.fake.calls).filter((c) => c === DIM_RECT).length).toBe(0);
    view.dispose();
  });

  it('veils every face but the first and draws numbered markers and labels', () => {
    const { canvas, view } = setup(paused, faces);
    runFrame(1000);
    const plain = lastFrame(canvas.fake.calls);
    view.setAnnotation(true);
    runFrame(1016);
    const annotated = lastFrame(canvas.fake.calls);
    expect(annotated.filter((c) => c === DIM_RECT).length).toBe(faces.length - 1);
    expect(annotated.some((c) => c === 'set fillStyle=rgba(11,14,21,0.7)')).toBe(true);
    const texts = annotated.filter((c) => c.startsWith('fillText'));
    expect(texts.length).toBeGreaterThan(plain.filter((c) => c.startsWith('fillText')).length);
    expect(texts.some((c) => c.includes('fillText(Sun hand: '))).toBe(true);
    expect(texts.some((c) => c.startsWith('fillText(14,'))).toBe(true);
    view.setAnnotation(false);
    runFrame(1032);
    expect(lastFrame(canvas.fake.calls).filter((c) => c === DIM_RECT).length).toBe(0);
    view.dispose();
  });

  it('keeps paused frames pixel-identical while annotating', () => {
    const { canvas, view } = setup(paused, faces);
    view.setAnnotation(true);
    for (let i = 0; i < 4; i += 1) runFrame(1000 + i * 16);
    const first = lastFrame(canvas.fake.calls);
    runFrame(2000);
    expect(lastFrame(canvas.fake.calls)).toEqual(first);
    view.dispose();
  });

  it('draws markers only, with no definitions, at one column', () => {
    const { canvas, view } = setup(paused, faces, false, 600);
    expect(view.layout().columns).toBe(1);
    view.setAnnotation(true);
    runFrame(1000);
    const annotated = lastFrame(canvas.fake.calls);
    expect(annotated.filter((c) => c === DIM_RECT).length).toBe(faces.length - 1);
    expect(annotated.some((c) => c.includes('fillText(Sun hand: '))).toBe(false);
    expect(annotated.some((c) => c.startsWith('fillText(14,'))).toBe(true);
    expect(annotated.some((c) => c.startsWith('fillText(UTC now,'))).toBe(false);
    view.dispose();
  });

  it('annotates the first non-error face and does not throw on error faces', () => {
    const withError = [{ ...(faces[0] as OrlojFace), error: 'boom' }, ...faces.slice(1)];
    const { canvas, view } = setup(paused, withError);
    view.setAnnotation(true);
    expect(() => runFrame(1000)).not.toThrow();
    const annotated = lastFrame(canvas.fake.calls);
    expect(annotated.filter((c) => c === DIM_RECT).length).toBe(withError.length - 1);
    expect(annotated.some((c) => c.includes('fillText(Sun hand: '))).toBe(true);
    view.dispose();
    const allError = faces.map((f) => ({ ...f, error: 'boom' }));
    const second = setup(paused, allError);
    second.view.setAnnotation(true);
    expect(() => runFrame(2000)).not.toThrow();
    second.view.dispose();
  });

  it('draws the permanent labels at three columns but not at one', () => {
    const wide = setup(paused, faces);
    runFrame(1000);
    expect(lastFrame(wide.canvas.fake.calls).some((c) => c.startsWith('fillText(UTC now,'))).toBe(
      true,
    );
    wide.view.dispose();
    const narrow = setup(paused, faces, false, 600);
    runFrame(1016);
    expect(lastFrame(narrow.canvas.fake.calls).some((c) => c.startsWith('fillText(UTC now,'))).toBe(
      false,
    );
    narrow.view.dispose();
  });
});
