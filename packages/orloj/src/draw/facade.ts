// SPDX-License-Identifier: Apache-2.0
import {
  CHALK,
  FACADE_BOTTOM,
  FACADE_TOP,
  GOLD,
  GOLD_DARK,
  INK,
  INK_ON_LIGHT,
  PANEL,
  PLAQUE,
  ROOSTER_COMB,
  ROOSTER_POS,
  WINDOW_FILL,
} from '../constants.js';
import type { FaceModel } from '../model/index.js';
import {
  archPath,
  circle,
  roundRect,
  sans,
  serif,
  stringsOf,
  text,
  type Ctx,
  type DrawEnv,
} from './common.js';

const STONE_COURSE_START = 200;
const STONE_COURSE_STEP = 34;
const STONE_COURSE_MARGIN = 20;
const WINDOWS: readonly (readonly [number, number, number, number])[] = [
  [128, 70, 64, 58],
  [248, 70, 64, 58],
];
const FIGURE_SPACING = 22;
const FIGURE_BASE_Y = 106;
const FIGURE_TRACK_START = 110;
const FIGURE_TRACK_LENGTH = 230;
const WALK_BOB_AMPLITUDE = 1.2;
const WALK_BOB_SPEED = 6;
const CROW_SCALE = 1.25;
const CROW_PULSE = 0.1;
const CROW_SPEED = 14;

export function drawFacade(ctx: Ctx, env: DrawEnv): void {
  const { faceW: w, faceH: h } = env.geo;
  const mid = w / 2;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, FACADE_TOP);
  g.addColorStop(1, FACADE_BOTTOM);
  ctx.beginPath();
  ctx.moveTo(14, h - 8);
  ctx.lineTo(14, 150);
  ctx.quadraticCurveTo(14, 46, mid, 12);
  ctx.quadraticCurveTo(w - 14, 46, w - 14, 150);
  ctx.lineTo(w - 14, h - 8);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = GOLD_DARK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(24, h - 18);
  ctx.lineTo(24, 154);
  ctx.quadraticCurveTo(24, 58, mid, 24);
  ctx.quadraticCurveTo(w - 24, 58, w - 24, 154);
  ctx.lineTo(w - 24, h - 18);
  ctx.closePath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(217,182,90,.35)';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.035)';
  for (let y = STONE_COURSE_START; y < h - STONE_COURSE_MARGIN; y += STONE_COURSE_STEP) {
    ctx.beginPath();
    ctx.moveTo(26, y);
    ctx.lineTo(w - 26, y);
    ctx.stroke();
  }
}

export function drawPlaque(ctx: Ctx, model: FaceModel): void {
  const { x0, y0, x1, y1 } = PLAQUE;
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 4);
  ctx.fill();
  ctx.stroke();
  text(ctx, model.name, 214, y0 + 17, serif(700, 18), INK);
  ctx.fillStyle = model.tierColor;
  roundRect(ctx, x1 - 36, y0 + 8, 28, 16, 3);
  ctx.fill();
  text(ctx, model.tier, x1 - 22, y0 + 16.5, sans(600, 10.5), INK_ON_LIGHT);
}

function drawFigure(ctx: Ctx, x: number, bob: number, color: string): void {
  const y = FIGURE_BASE_Y + bob;
  ctx.fillStyle = color;
  circle(ctx, x, y - 14, 5);
  ctx.fill();
  roundRect(ctx, x - 6, y - 8, 12, 22, 4);
  ctx.fill();
}

/** The apostle windows, and the figures marching through them in the first minutes of the hour. */
export function drawProcession(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  for (const [x, y, w, h] of WINDOWS) {
    archPath(ctx, x, y, w, h);
    ctx.fillStyle = WINDOW_FILL;
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const { progress, figures } = model.procession;
  if (progress === null) return;
  const track = FIGURE_TRACK_LENGTH + figures.length * FIGURE_SPACING;
  for (const [x, y, w, h] of WINDOWS) {
    ctx.save();
    archPath(ctx, x, y, w, h);
    ctx.clip();
    figures.forEach((f, k) => {
      const fx = FIGURE_TRACK_START + progress * track - k * FIGURE_SPACING;
      const bob = Math.sin(env.deco * WALK_BOB_SPEED + k) * WALK_BOB_AMPLITUDE;
      drawFigure(ctx, fx, bob, f.color);
    });
    ctx.restore();
  }
}

export function drawRooster(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = ROOSTER_POS;
  const crow = model.rooster.isCrowing;
  const s = crow ? CROW_SCALE + CROW_PULSE * Math.sin(env.deco * CROW_SPEED) : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.ellipse(0, 4, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  circle(ctx, 8, -4, 4.5);
  ctx.fill();
  ctx.fillStyle = ROOSTER_COMB;
  ctx.beginPath();
  ctx.arc(8, -9, 2.4, 0, Math.PI * 2);
  ctx.arc(10.5, -8, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.moveTo(12, -4);
  ctx.lineTo(16, -3);
  ctx.lineTo(12, -2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-9, 2);
  ctx.quadraticCurveTo(-18, -10, -12, -12);
  ctx.quadraticCurveTo(-10, -4, -6, 0);
  ctx.fill();
  ctx.restore();
  if (crow) text(ctx, stringsOf(env).canvas.roosterCrowing, x, y + 22, sans(600, 11), CHALK);
}
