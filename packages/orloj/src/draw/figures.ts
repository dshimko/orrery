// SPDX-License-Identifier: Apache-2.0
import {
  BONE,
  GOLD,
  GOLD_DARK,
  GOLD_RIM_EDGE,
  INK,
  LUTE_POS,
  LUTE_WOOD,
  MIRROR_POS,
  MISER_POS,
  MUTED,
  NICHE_FILL,
  SKELETON_POS,
  SUN_RAY,
} from '../constants.js';
import type { FaceModel } from '../model/index.js';
import { archPath, circle, sans, serif, text, type Ctx, type DrawEnv } from './common.js';

const BELL_SWING_SPEED = 9;
const BELL_SWING_AMPLITUDE = 0.5;
const WAVE_SPEED = 20;
const WAVE_PERIOD = 6;
const LUTE_NOTE_THRESHOLD = 0.45;
const LUTE_NOTE_COUNT = 3;
const LUTE_NOTE_SPEED = 0.6;
const MIRROR_BASE = '#B9C7DA';
const SKULL_EYE = '#0D1119';
const BAD_TEXT_INCIDENT = '#FF8A8C';
const BAD_TEXT_WARNING = '#FFC766';
const BAD_TEXT_LATE = '#FFC766';

function niche(ctx: Ctx, x: number, y: number): void {
  archPath(ctx, x - 27, y - 58, 54, 116);
  ctx.fillStyle = NICHE_FILL;
  ctx.fill();
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function caption(ctx: Ctx, x: number, y: number, value: string, label: string, color = INK): void {
  text(ctx, value, x, y + 30, serif(700, 15), color);
  text(ctx, label, x, y + 46, sans(500, 10), MUTED);
}

function drawMiser(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = MISER_POS;
  niche(ctx, x, y);
  const pr = 7 + 9 * env.smooth.purse;
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.ellipse(x, y - 8, pr * 0.85, pr, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GOLD_RIM_EDGE;
  ctx.fillRect(x - pr * 0.5, y - 8 - pr - 2, pr, 4);
  caption(ctx, x, y, String(model.figures.spend), 'spend per hour');
}

function drawMirror(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = MIRROR_POS;
  const late = model.figures.spokesPastTarget;
  niche(ctx, x, y);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y - 12, 11, 15, 0, 0, Math.PI * 2);
  if (late > 0) {
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(env.deco * 3);
    ctx.fillStyle = env.visuals.colors.warning;
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = MIRROR_BASE;
    ctx.fill();
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x, y + 14);
  ctx.stroke();
  caption(ctx, x, y, String(late), 'past target', late > 0 ? BAD_TEXT_LATE : INK);
}

function drawBell(ctx: Ctx, x: number, y: number, model: FaceModel, env: DrawEnv): void {
  const f = model.figures;
  const swing = env.smooth.bell * Math.sin(env.deco * BELL_SWING_SPEED) * BELL_SWING_AMPLITUDE;
  ctx.save();
  ctx.translate(x + 6, y - 24);
  ctx.rotate(swing);
  ctx.fillStyle = f.openIncidents > 0 ? f.incidentColor : GOLD;
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(5, 0);
  ctx.lineTo(8, 12);
  ctx.lineTo(-8, 12);
  ctx.closePath();
  ctx.fill();
  circle(ctx, 0, 13, 2);
  ctx.fill();
  ctx.restore();
  if (f.openIncidents <= 0) return;
  ctx.strokeStyle = f.incidentColor;
  ctx.globalAlpha = 0.5 * env.smooth.bell;
  ctx.lineWidth = 1.2;
  for (let w = 0; w < 2; w += 1) {
    ctx.beginPath();
    ctx.arc(x + 6, y - 18, 14 + w * 6 + ((env.deco * WAVE_SPEED) % WAVE_PERIOD), -0.8, 0.8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawSkeleton(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = SKELETON_POS;
  const f = model.figures;
  niche(ctx, x, y);
  ctx.fillStyle = BONE;
  circle(ctx, x - 6, y - 30, 6);
  ctx.fill();
  ctx.fillStyle = SKULL_EYE;
  ctx.fillRect(x - 9, y - 31, 2, 2);
  ctx.fillRect(x - 5, y - 31, 2, 2);
  ctx.strokeStyle = BONE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 24);
  ctx.lineTo(x - 6, y - 4);
  ctx.moveTo(x - 6, y - 18);
  ctx.lineTo(x + 4, y - 22);
  ctx.stroke();
  drawBell(ctx, x, y, model, env);
  const color =
    f.incidentLevel === 'incident'
      ? BAD_TEXT_INCIDENT
      : f.incidentLevel === 'warning'
        ? BAD_TEXT_WARNING
        : INK;
  caption(ctx, x, y, String(f.openIncidents), 'incidents', color);
}

function drawLute(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = LUTE_POS;
  niche(ctx, x, y);
  ctx.fillStyle = LUTE_WOOD;
  ctx.beginPath();
  ctx.ellipse(x - 2, y - 6, 9, 12, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = LUTE_WOOD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 4, y - 14);
  ctx.lineTo(x + 13, y - 30);
  ctx.stroke();
  ctx.fillStyle = '#2A1E06';
  circle(ctx, x - 2, y - 6, 2.5);
  ctx.fill();
  const activity = model.figures.consumerActivity;
  if (activity > LUTE_NOTE_THRESHOLD) {
    for (let n = 0; n < LUTE_NOTE_COUNT; n += 1) {
      const phase = (env.deco * LUTE_NOTE_SPEED + n / LUTE_NOTE_COUNT) % 1;
      const ny = y - 20 - phase * 28;
      const nx = x + 10 + Math.sin(phase * 6 + n) * 5;
      ctx.globalAlpha = 1 - phase;
      ctx.fillStyle = SUN_RAY;
      ctx.beginPath();
      ctx.ellipse(nx, ny, 2.6, 2, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(nx + 1.8, ny - 9, 1.2, 9);
    }
    ctx.globalAlpha = 1;
  }
  caption(ctx, x, y, `${Math.round(activity * 100)}%`, 'consumer activity');
}

/** Miser (spend), mirror (past target), skeleton with bell (incidents), lute (consumers). */
export function drawFigures(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  drawMiser(ctx, model, env);
  drawMirror(ctx, model, env);
  drawSkeleton(ctx, model, env);
  drawLute(ctx, model, env);
}
