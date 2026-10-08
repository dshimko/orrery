// SPDX-License-Identifier: Apache-2.0
// Permanent labels on every face: "UTC now" by the sun hand, "next" by the star hand, and a
// "fresher" arrow along one spoke ray pointing toward the hub. Static: no animation.
import { MUTED } from '../constants.js';
import type { FaceModel } from '../model/index.js';
import { ORLOJ_STRINGS } from '../strings.js';
import { sans, type Ctx, type DrawEnv } from './common.js';

const LABEL_FONT_PX = 9;
const HALO_WIDTH = 3;
const HALO_COLOR = 'rgba(5,7,12,.88)';
const HAND_LABEL_OFFSET = 8;
/** Sun label sits at this share of the dial radius, clear of the sun's hit region at the tip. */
const SUN_LABEL_SHARE = 0.5;
/** Star label sits this far inside the star's tip, clear of its hit region. */
const STAR_LABEL_INSET = 44;
const ARROW_OFFSET = 11;
const ARROW_TEXT_OFFSET = 17;
const ARROW_OUTER_INSET = 16;
const ARROW_INNER = 32;
const ARROW_HEAD = 4;
const ARROW_HEAD_SPREAD = 2.6;
const CENTERED_BELOW_X = 0.3;

interface Placement {
  x: number;
  y: number;
  align: CanvasTextAlign;
}

/** A point `radius` from the hub along `angle`, pushed `offset` sideways (side = +1 or -1). */
function besideRay(
  env: DrawEnv,
  angle: number,
  radius: number,
  offset: number,
  side: 1 | -1,
): Placement {
  const nx = -Math.sin(angle) * side;
  const ny = Math.cos(angle) * side;
  const align = Math.abs(nx) < CENTERED_BELOW_X ? 'center' : nx > 0 ? 'left' : 'right';
  return {
    x: env.geo.cx + Math.cos(angle) * radius + nx * offset,
    y: env.geo.cy + Math.sin(angle) * radius + ny * offset,
    align,
  };
}

/** Haloed text, readable over the sky, spokes, and hands. */
function haloText(ctx: Ctx, value: string, p: Placement): void {
  ctx.font = sans(600, LABEL_FONT_PX);
  ctx.textAlign = p.align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = HALO_WIDTH;
  ctx.strokeStyle = HALO_COLOR;
  ctx.strokeText(value, p.x, p.y);
  ctx.fillStyle = MUTED;
  ctx.fillText(value, p.x, p.y);
}

function drawFresherArrow(ctx: Ctx, model: FaceModel, env: DrawEnv, label: string): void {
  const spoke = model.spokes[0];
  if (!spoke) return;
  const outer = env.geo.skyRadius - ARROW_OUTER_INSET;
  const from = besideRay(env, spoke.angle, outer, ARROW_OFFSET, 1);
  const to = besideRay(env, spoke.angle, ARROW_INNER, ARROW_OFFSET, 1);
  const back = besideRay(env, spoke.angle, ARROW_INNER + ARROW_HEAD, ARROW_OFFSET, 1);
  const nx = -Math.sin(spoke.angle);
  const ny = Math.cos(spoke.angle);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = HALO_COLOR;
  ctx.lineWidth = HALO_WIDTH + 1;
  strokeArrow(ctx, from, to, back, nx, ny);
  ctx.strokeStyle = MUTED;
  ctx.lineWidth = 1.2;
  strokeArrow(ctx, from, to, back, nx, ny);
  const mid = (outer + ARROW_INNER) / 2;
  haloText(ctx, label, besideRay(env, spoke.angle, mid, ARROW_TEXT_OFFSET, 1));
}

function strokeArrow(
  ctx: Ctx,
  from: Placement,
  to: Placement,
  back: Placement,
  nx: number,
  ny: number,
): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.moveTo(back.x + nx * ARROW_HEAD_SPREAD, back.y + ny * ARROW_HEAD_SPREAD);
  ctx.lineTo(to.x, to.y);
  ctx.lineTo(back.x - nx * ARROW_HEAD_SPREAD, back.y - ny * ARROW_HEAD_SPREAD);
  ctx.stroke();
}

/** Draws the three permanent labels; does nothing when `env.showLabels` is false. */
export function drawDialLabels(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  if (env.showLabels === false) return;
  const strings = env.strings ?? ORLOJ_STRINGS;
  const R = env.geo.radius;
  ctx.save();
  haloText(
    ctx,
    strings.labelSunNow,
    besideRay(env, model.sunAngle, R * SUN_LABEL_SHARE, HAND_LABEL_OFFSET, 1),
  );
  if (model.star) {
    haloText(
      ctx,
      strings.labelNext,
      besideRay(env, model.star.angle, R - STAR_LABEL_INSET, HAND_LABEL_OFFSET, -1),
    );
  }
  drawFresherArrow(ctx, model, env, strings.labelFresher);
  ctx.restore();
}
