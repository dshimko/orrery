// SPDX-License-Identifier: Apache-2.0
import { HAND_TIP_INSET, STAR_HAND_INSET, SUN_INSET } from '../geometry.js';
import { GOLD, HUB_RADIUS, SILVER, STAR_COLOR, SUN_CORE, SUN_EDGE, SUN_RAY } from '../constants.js';
import type { FaceModel } from '../model/index.js';
import { circle, sans, starShape, text, type Ctx, type DrawEnv } from './common.js';

const MOON_ORBIT_SHARE = 0.62;
const MOON_RADIUS = 8;
const MOON_SHADOW = '#11151E';
const MOON_RIM = '#8FA3BF';
const HAND_COLOR = '#C9D3E0';
const SUN_RAY_COUNT = 12;
const SUN_SPIN = 0.4;
const HUB_EDGE = '#9C7A2A';
const HUB_TEXT = '#2A1E06';
const FULL_MOON_CUTOFF = 0.98;

/** Moon phase: share of the ingest yard in use (smoothed). */
export function drawMoon(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { cx, cy, skyRadius: SR } = env.geo;
  const phase = env.smooth.moon;
  const mx = cx + Math.cos(model.moon.angle) * SR * MOON_ORBIT_SHARE;
  const my = cy + Math.sin(model.moon.angle) * SR * MOON_ORBIT_SHARE;
  circle(ctx, mx, my, MOON_RADIUS);
  ctx.fillStyle = SILVER;
  ctx.fill();
  if (phase < FULL_MOON_CUTOFF) {
    ctx.beginPath();
    ctx.ellipse(
      mx + (1 - phase) * MOON_RADIUS * 0.5,
      my,
      MOON_RADIUS * (1 - phase),
      MOON_RADIUS,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = MOON_SHADOW;
    ctx.fill();
  }
  circle(ctx, mx, my, MOON_RADIUS);
  ctx.strokeStyle = MOON_RIM;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Star hand pointing at the next scheduled window. */
export function drawStarHand(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  if (!model.star) return;
  const { cx, cy, radius: R } = env.geo;
  const x = cx + Math.cos(model.star.angle) * (R - STAR_HAND_INSET);
  const y = cy + Math.sin(model.star.angle) * (R - STAR_HAND_INSET);
  ctx.strokeStyle = HAND_COLOR;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x, y);
  ctx.stroke();
  const twinkle = 1 + 0.12 * Math.sin(env.deco * 3);
  starShape(ctx, x, y, 5 * twinkle, STAR_COLOR);
}

/** Sun hand: current UTC time, midnight at the bottom and noon at the top. */
export function drawSunHand(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { cx, cy, radius: R } = env.geo;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(model.sunAngle);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(R - HAND_TIP_INSET, 0);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.moveTo(R - HAND_TIP_INSET, -5);
  ctx.lineTo(R - 10, 0);
  ctx.lineTo(R - HAND_TIP_INSET, 5);
  ctx.closePath();
  ctx.fill();
  const sr = R - SUN_INSET;
  const g = ctx.createRadialGradient(sr, 0, 1, sr, 0, 9);
  g.addColorStop(0, SUN_CORE);
  g.addColorStop(1, SUN_EDGE);
  circle(ctx, sr, 0, 8.5);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = SUN_RAY;
  ctx.lineWidth = 1.4;
  for (let q = 0; q < SUN_RAY_COUNT; q += 1) {
    const qa = (q * Math.PI) / (SUN_RAY_COUNT / 2) + env.deco * SUN_SPIN;
    ctx.beginPath();
    ctx.moveTo(sr + Math.cos(qa) * 10, Math.sin(qa) * 10);
    ctx.lineTo(sr + Math.cos(qa) * 14, Math.sin(qa) * 14);
    ctx.stroke();
  }
  ctx.restore();
}

/** The hub with the product count, when known. */
export function drawHub(ctx: Ctx, products: number | null, env: DrawEnv): void {
  const { cx, cy } = env.geo;
  const g = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, HUB_RADIUS);
  g.addColorStop(0, SUN_CORE);
  g.addColorStop(1, HUB_EDGE);
  circle(ctx, cx, cy, HUB_RADIUS);
  ctx.fillStyle = g;
  ctx.fill();
  if (products !== null) text(ctx, String(products), cx, cy + 0.5, sans(700, 9.5), HUB_TEXT);
}
