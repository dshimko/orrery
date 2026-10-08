// SPDX-License-Identifier: Apache-2.0
import { GOLD, INK_ON_LIGHT, SECONDARY_METASTORE } from '../constants.js';
import type { FaceModel, SpokeModel } from '../model/index.js';
import { circle, sans, shade, text, type Ctx, type DrawEnv } from './common.js';

const RAY_START = 16;
const RAY_END_INSET = 6;
const ZODIAC_RING_INSET = 4;
const ZODIAC_RING_LIFT = 6;
const HALO_PAD = 4;
const HALO_PULSE_SPEED = 4;
const HALO_ALPHA = 0.35;
const SECONDARY_RING_PAD = 2.5;
const MIN_CODE_RADIUS = 7;

function drawMedallion(ctx: Ctx, s: SpokeModel, x: number, y: number, env: DrawEnv): void {
  const r = s.size;
  const halo = env.smooth.spokes.get(s.id)?.halo ?? 0;
  if (halo > 0.01) {
    ctx.globalAlpha = HALO_ALPHA * halo;
    ctx.fillStyle = env.visuals.colors.warning;
    circle(ctx, x, y, r + HALO_PAD + Math.sin(env.deco * HALO_PULSE_SPEED));
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.25, s.color);
  g.addColorStop(1, shade(s.color));
  circle(ctx, x, y, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (s.isSecondaryMetastore) {
    ctx.setLineDash([2, 2]);
    circle(ctx, x, y, r + SECONDARY_RING_PAD);
    ctx.strokeStyle = SECONDARY_METASTORE;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (r >= MIN_CODE_RADIUS) text(ctx, s.code, x, y + 0.5, sans(700, 8.5), INK_ON_LIGHT);
}

/** The zodiac ring with one ray and medallion per spoke; closer to the hub means fresher. */
export function drawSpokes(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { cx, cy, skyRadius: SR } = env.geo;
  circle(ctx, cx, cy - ZODIAC_RING_LIFT, SR - ZODIAC_RING_INSET);
  ctx.strokeStyle = 'rgba(217,182,90,.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  for (const s of model.spokes) {
    const cos = Math.cos(s.angle);
    const sin = Math.sin(s.angle);
    const distance = env.smooth.spokes.get(s.id)?.distance ?? s.distance;
    ctx.strokeStyle = 'rgba(217,182,90,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + cos * RAY_START, cy + sin * RAY_START);
    ctx.lineTo(cx + cos * (SR - RAY_END_INSET), cy + sin * (SR - RAY_END_INSET));
    ctx.stroke();
    drawMedallion(ctx, s, cx + cos * distance, cy + sin * distance, env);
  }
}
