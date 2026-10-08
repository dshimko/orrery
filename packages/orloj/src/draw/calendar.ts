// SPDX-License-Identifier: Apache-2.0
import {
  DIAL_FACE,
  GOLD,
  GOLD_RIM_EDGE,
  INK,
  MUTED,
  NOTE,
  STAR_COLOR,
  SUN_RAY,
} from '../constants.js';
import type { FaceModel } from '../model/index.js';
import { circle, sans, serif, starShape, text, type Ctx, type DrawEnv } from './common.js';

const RELEASE_COLOR = '#9B8CFF';
const RELEASE_COLOR_FUTURE = 'rgba(155,140,255,.25)';
const PROMOTION_FUTURE = 'rgba(231,237,246,.25)';
const MAX_RELEASE_LINE = 36;
const RELEASE_LINE_PER_COUNT = 3;
const CENTER_DISC = 40;
const CENTER_FILL = '#10141D';
const LABEL_STEP = 5;

function dayColor(isToday: boolean, isPast: boolean): string {
  if (isToday) return GOLD;
  return isPast ? 'rgba(217,182,90,.45)' : 'rgba(217,182,90,.15)';
}

/** The release calendar dial: releases per day, promotions, month-end close, today's hand. */
export function drawCalendar(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const cal = model.calendar;
  if (!cal) return;
  const { calCx: cx, calCy: cy, calRadius: CR } = env.geo;
  const rim = ctx.createRadialGradient(cx, cy, CR - 4, cx, cy, CR + 8);
  rim.addColorStop(0, GOLD_RIM_EDGE);
  rim.addColorStop(0.5, GOLD);
  rim.addColorStop(1, GOLD_RIM_EDGE);
  circle(ctx, cx, cy, CR + 8);
  ctx.fillStyle = rim;
  ctx.fill();
  circle(ctx, cx, cy, CR);
  ctx.fillStyle = DIAL_FACE;
  ctx.fill();

  for (const d of cal.days) {
    const cos = Math.cos(d.midAngle);
    const sin = Math.sin(d.midAngle);
    ctx.beginPath();
    ctx.arc(cx, cy, CR - 6, d.startAngle + 0.01, d.endAngle - 0.01);
    ctx.strokeStyle = dayColor(d.isToday, d.isPast);
    ctx.lineWidth = 8;
    ctx.stroke();
    if (d.releases > 0) {
      const len = Math.min(MAX_RELEASE_LINE, d.releases * RELEASE_LINE_PER_COUNT);
      ctx.beginPath();
      ctx.moveTo(cx + cos * (CR - 12), cy + sin * (CR - 12));
      ctx.lineTo(cx + cos * (CR - 12 - len), cy + sin * (CR - 12 - len));
      ctx.strokeStyle = d.isPast ? RELEASE_COLOR : RELEASE_COLOR_FUTURE;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (d.promotion) {
      ctx.fillStyle = d.isPast ? STAR_COLOR : PROMOTION_FUTURE;
      circle(ctx, cx + cos * CR, cy + sin * CR, 1.8);
      ctx.fill();
    }
    if (d.monthEndClose) starShape(ctx, cx + cos * (CR - 22), cy + sin * (CR - 22), 5, SUN_RAY);
    if (d.day === 1 || d.day % LABEL_STEP === 0) {
      text(ctx, String(d.day), cx + cos * (CR - 56), cy + sin * (CR - 56), sans(600, 8.5), MUTED);
    }
  }

  const today = cal.days.find((d) => d.isToday);
  if (today) {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(today.midAngle) * (CR - 16),
      cy + Math.sin(today.midAngle) * (CR - 16),
    );
    ctx.stroke();
  }
  circle(ctx, cx, cy, CENTER_DISC);
  ctx.fillStyle = CENTER_FILL;
  ctx.fill();
  ctx.strokeStyle = model.tierColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, String(cal.totalReleases), cx, cy - 4, serif(700, 20), INK);
  text(ctx, 'releases this month', cx, cy + 15, sans(500, 9.5), MUTED);
  text(ctx, 'Release calendar', cx, cy + CR + 26, serif(600, 13), GOLD);
  text(ctx, `Next: ${cal.nextText}`, cx, cy + CR + 50, sans(500, 12.5), NOTE);
}
