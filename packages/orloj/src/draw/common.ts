// SPDX-License-Identifier: Apache-2.0
import type { Visuals } from '@orrery/core';
import type { Geometry } from '../geometry.js';
import type { FaceSmooth } from '../smooth.js';
import { FONT_SANS, FONT_SERIF } from '../constants.js';

export type Ctx = CanvasRenderingContext2D;

/** Everything a draw function needs besides the face model. */
export interface DrawEnv {
  visuals: Visuals;
  geo: Geometry;
  /** Decorative clock in seconds; advances only while time runs and motion is allowed (rule 8). */
  deco: number;
  smooth: FaceSmooth;
}

export const serif = (weight: number, px: number): string => `${weight} ${px}px ${FONT_SERIF}`;
export const sans = (weight: number, px: number): string => `${weight} ${px}px ${FONT_SANS}`;

export function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = 'center',
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** A gothic arch: straight sides and a pointed-ish round top. */
export function archPath(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + w * 0.45);
  ctx.quadraticCurveTo(x, y, x + w / 2, y - w * 0.12);
  ctx.quadraticCurveTo(x + w, y, x + w, y + w * 0.45);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

export function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export function starShape(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  const points = 12;
  ctx.beginPath();
  for (let k = 0; k < points; k += 1) {
    const a = (k * Math.PI) / (points / 2);
    const rr = k % 2 === 1 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

const SHADE_FACTOR = 0.45;
const HEX_RADIX = 16;
const BYTE = 255;

/** Darker rim color for a hex medallion color. */
export function shade(hex: string): string {
  const n = Number.parseInt(hex.slice(1), HEX_RADIX);
  const r = Math.round((n >> 16) * SHADE_FACTOR);
  const g = Math.round(((n >> 8) & BYTE) * SHADE_FACTOR);
  const b = Math.round((n & BYTE) * SHADE_FACTOR);
  return `rgb(${r},${g},${b})`;
}

/** Splits text into lines no wider than maxWidth according to the supplied measure function. */
export function wrapLines(
  value: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/).filter((w) => w !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (line !== '' && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}
