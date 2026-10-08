// SPDX-License-Identifier: Apache-2.0
import { ARC_INSET, NUMERAL_INSET, TICK_INSET, hourAngle } from '../geometry.js';
import {
  CHALK,
  DAWN,
  DIAL_FACE,
  GOLD,
  GOLD_DARK,
  GOLD_RIM_EDGE,
  NIGHT,
  NOON_MARK_RADIUS,
  SILVER,
  SKY_BOTTOM,
  SKY_TOP,
} from '../constants.js';
import type { FaceModel } from '../model/index.js';
import { circle, sans, serif, text, type Ctx, type DrawEnv } from './common.js';

const HOURS = 24;
const ACTIVE_ARC_WIDTH = 9;
const PLANNED_ARC_WIDTH = 6;
const IDLE_ARC_ALPHA = 0.55;
const SKY_STAR_COUNT = 26;
const NOON_DOT_OFFSET = 6;
const NOON_LABEL_INSET = 8;

/** Gold rim, dial face, hour numerals, and the inner ring line. */
export function drawDialFrame(ctx: Ctx, env: DrawEnv): void {
  const { cx, cy, radius: R, rimWidth, hourRingWidth } = env.geo;
  const rg = ctx.createRadialGradient(cx, cy, R - 4, cx, cy, R + rimWidth);
  rg.addColorStop(0, GOLD_RIM_EDGE);
  rg.addColorStop(0.5, GOLD);
  rg.addColorStop(1, GOLD_RIM_EDGE);
  circle(ctx, cx, cy, R + rimWidth);
  ctx.fillStyle = rg;
  ctx.fill();
  circle(ctx, cx, cy, R);
  ctx.fillStyle = DIAL_FACE;
  ctx.fill();
  for (let k = 0; k < HOURS; k += 1) {
    const a = hourAngle(k);
    const x = cx + Math.cos(a) * (R - NUMERAL_INSET);
    const y = cy + Math.sin(a) * (R - NUMERAL_INSET);
    text(ctx, String(k === 0 ? HOURS : k), x, y, serif(600, 11), GOLD);
  }
  circle(ctx, cx, cy, R - hourRingWidth);
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Schedule arcs (blue planned, amber warning, red incident) and silver transfer ticks. */
export function drawRing(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { cx, cy, radius: R } = env.geo;
  ctx.lineCap = 'round';
  for (const arc of model.arcs) {
    ctx.beginPath();
    ctx.arc(cx, cy, R - ARC_INSET, arc.startAngle, arc.endAngle);
    ctx.strokeStyle = arc.color;
    ctx.globalAlpha = arc.isActive ? 0.75 + 0.25 * Math.sin(env.deco * 5) : IDLE_ARC_ALPHA;
    ctx.lineWidth = arc.isActive ? ACTIVE_ARC_WIDTH : PLANNED_ARC_WIDTH;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
  for (const tick of model.ticks) {
    const x = cx + Math.cos(tick.angle) * (R - TICK_INSET);
    const y = cy + Math.sin(tick.angle) * (R - TICK_INSET);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tick.angle);
    ctx.fillStyle = SILVER;
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(-3, -3.5);
    ctx.lineTo(-3, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** The sky disk: black night, brown dawn band, blue upper disk, twinkling stars. */
export function drawSky(ctx: Ctx, env: DrawEnv): void {
  const { cx, cy, skyRadius: SR } = env.geo;
  ctx.save();
  circle(ctx, cx, cy, SR);
  ctx.clip();
  ctx.fillStyle = NIGHT;
  ctx.fillRect(cx - SR, cy - SR, SR * 2, SR * 2);
  for (let s = 0; s < SKY_STAR_COUNT; s += 1) {
    const sx = cx + Math.cos(s * 2.39) * SR * (0.3 + (0.65 * ((s * 37) % 10)) / 10);
    const sy = cy + SR * 0.25 + Math.abs(Math.sin(s * 1.7)) * SR * 0.7;
    ctx.fillStyle = `rgba(220,230,255,${0.25 + 0.25 * Math.sin(env.deco * 1.5 + s)})`;
    ctx.fillRect(sx, sy, 1.4, 1.4);
  }
  circle(ctx, cx, cy - SR * 0.33, SR * 1.02);
  ctx.fillStyle = DAWN;
  ctx.fill();
  const sky = ctx.createLinearGradient(0, cy - SR, 0, cy + SR * 0.4);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_BOTTOM);
  circle(ctx, cx, cy - SR * 0.36, SR * 0.9);
  ctx.fillStyle = sky;
  ctx.fill();
  ctx.restore();
  circle(ctx, cx, cy, SR);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Small suns: local noon for each source region and office. */
export function drawNoonSuns(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { cx, cy, skyRadius: SR } = env.geo;
  for (const sun of model.noonSuns) {
    const x = cx + Math.cos(sun.angle) * (SR + NOON_DOT_OFFSET);
    const y = cy + Math.sin(sun.angle) * (SR + NOON_DOT_OFFSET);
    ctx.fillStyle = sun.color;
    circle(ctx, x, y, NOON_MARK_RADIUS);
    ctx.fill();
    const lx = cx + Math.cos(sun.angle) * (SR - NOON_LABEL_INSET);
    const ly = cy + Math.sin(sun.angle) * (SR - NOON_LABEL_INSET);
    text(ctx, sun.code, lx, ly, sans(600, 9), CHALK);
  }
}
