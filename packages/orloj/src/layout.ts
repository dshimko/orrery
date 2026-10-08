// SPDX-License-Identifier: Apache-2.0
import type { Visuals } from '@orrery/core';
import type { OrlojLayout } from './types.js';

export interface FaceOrigin {
  x: number;
  y: number;
}

/** Column count: 3 at the wide breakpoint, 2 at the medium one, else 1; never more than faces. */
function columnsFor(widthPx: number, faceCount: number, cfg: Visuals['orloj']): number {
  const wanted = widthPx >= cfg.breakpoints.three ? 3 : widthPx >= cfg.breakpoints.two ? 2 : 1;
  return Math.max(1, Math.min(wanted, faceCount));
}

/** Pure grid layout of faces in a container of the given CSS pixel width. */
export function orlojLayout(widthPx: number, faceCount: number, visuals: Visuals): OrlojLayout {
  const cfg = visuals.orloj;
  const [faceW, faceH] = cfg.faceSize;
  const width = Math.max(0, widthPx);
  const count = Math.max(0, Math.floor(faceCount));
  const columns = columnsFor(width, count, cfg);
  const scale = Math.min(cfg.maxScale, width / (columns * faceW));
  const rows = Math.ceil(count / columns);
  return { columns, scale, width, height: rows * faceH * scale };
}

/** Top-left corner of face `index` in CSS pixels; the grid is centered horizontally. */
export function faceOrigin(layout: OrlojLayout, index: number, visuals: Visuals): FaceOrigin {
  const [faceW, faceH] = visuals.orloj.faceSize;
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  const offsetX = (layout.width - layout.columns * faceW * layout.scale) / 2;
  return { x: offsetX + column * faceW * layout.scale, y: row * faceH * layout.scale };
}

/** Index of the face under a point in CSS pixels, or -1. */
export function faceAt(
  layout: OrlojLayout,
  faceCount: number,
  x: number,
  y: number,
  visuals: Visuals,
): number {
  const [faceW, faceH] = visuals.orloj.faceSize;
  for (let i = 0; i < faceCount; i += 1) {
    const o = faceOrigin(layout, i, visuals);
    const inX = x >= o.x && x <= o.x + faceW * layout.scale;
    const inY = y >= o.y && y <= o.y + faceH * layout.scale;
    if (inX && inY) return i;
  }
  return -1;
}
