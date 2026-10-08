// SPDX-License-Identifier: Apache-2.0
// Annotation mode: numbered markers with leader lines and one-line definitions on one face, and
// a dimming veil over the others. Static (no animation), so paused frames stay identical.
import { GOLD, GOLD_DARK, INK, INK_ON_LIGHT } from '../constants.js';
import { MARKER_RADIUS, type AnnotationAnchor } from '../model/index.js';
import { ORLOJ_STRINGS } from '../strings.js';
import { circle, roundRect, sans, text, type Ctx, type DrawEnv } from './common.js';

/** The background color at about 70% alpha, laid over every face that is not annotated. */
export const DIM_FILL = 'rgba(11,14,21,0.7)';
const PLATE_FILL = 'rgba(11,14,21,0.92)';
const LEADER_COLOR = 'rgba(217,182,90,.7)';
const LEADER_WIDTH = 0.9;
const TARGET_DOT_RADIUS = 2.4;
const LABEL_FONT_PX = 10.5;
const LABEL_HEIGHT = 18;
const LABEL_PAD = 6;
const NUMBER_DISC_RADIUS = 6.5;
const NUMBER_FONT_PX = 9;
const MARKER_FONT_PX = 10;
const MAX_LABEL_WIDTH = 408;
const ELLIPSIS = '…';

/** Veils the whole face cell so the annotated face stands out. */
export function drawDim(ctx: Ctx, env: DrawEnv): void {
  ctx.fillStyle = DIM_FILL;
  ctx.fillRect(0, 0, env.geo.faceW, env.geo.faceH);
}

/** Cuts `value` to fit `maxWidth`, ending with an ellipsis when shortened. */
function fit(ctx: Ctx, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let end = value.length;
  while (end > 1 && ctx.measureText(`${value.slice(0, end)}${ELLIPSIS}`).width > maxWidth) end -= 1;
  return `${value.slice(0, end)}${ELLIPSIS}`;
}

function line(ctx: Ctx, from: AnnotationAnchor['marker'], to: AnnotationAnchor['marker']): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function drawLabel(ctx: Ctx, anchor: AnnotationAnchor, env: DrawEnv): void {
  const label = anchor.label;
  if (!label) return;
  const part = (env.strings ?? ORLOJ_STRINGS).parts[anchor.part];
  const name = `${part.name}: `;
  ctx.font = sans(700, LABEL_FONT_PX);
  const nameWidth = ctx.measureText(name).width;
  const discWidth = NUMBER_DISC_RADIUS * 2 + LABEL_PAD;
  ctx.font = sans(500, LABEL_FONT_PX);
  const body = fit(ctx, part.short, MAX_LABEL_WIDTH - discWidth - nameWidth - LABEL_PAD * 2);
  const width = LABEL_PAD * 2 + discWidth + nameWidth + ctx.measureText(body).width;
  const left = label.align === 'left' ? label.x : label.x - width;
  ctx.fillStyle = PLATE_FILL;
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 1;
  roundRect(ctx, left, label.y - LABEL_HEIGHT / 2, width, LABEL_HEIGHT, 4);
  ctx.fill();
  ctx.stroke();
  const discX = left + LABEL_PAD + NUMBER_DISC_RADIUS;
  circle(ctx, discX, label.y, NUMBER_DISC_RADIUS);
  ctx.fillStyle = GOLD;
  ctx.fill();
  text(ctx, String(anchor.number), discX, label.y + 0.5, sans(700, NUMBER_FONT_PX), INK_ON_LIGHT);
  const nameX = left + LABEL_PAD + discWidth;
  text(ctx, name, nameX, label.y + 0.5, sans(700, LABEL_FONT_PX), GOLD, 'left');
  text(ctx, body, nameX + nameWidth, label.y + 0.5, sans(500, LABEL_FONT_PX), INK, 'left');
}

function drawMarker(ctx: Ctx, anchor: AnnotationAnchor): void {
  circle(ctx, anchor.marker.x, anchor.marker.y, MARKER_RADIUS);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.strokeStyle = INK_ON_LIGHT;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  text(
    ctx,
    String(anchor.number),
    anchor.marker.x,
    anchor.marker.y + 0.5,
    sans(700, MARKER_FONT_PX),
    INK_ON_LIGHT,
  );
}

/**
 * Draws markers, target dots, leader lines, and definition labels. Labels (when an anchor has
 * one) go in the neighbor's area, so the caller draws this after dimming the other faces.
 */
export function drawAnnotation(ctx: Ctx, anchors: readonly AnnotationAnchor[], env: DrawEnv): void {
  ctx.save();
  ctx.strokeStyle = LEADER_COLOR;
  ctx.lineWidth = LEADER_WIDTH;
  for (const a of anchors) {
    line(ctx, a.marker, a.target);
    if (a.label) line(ctx, a.marker, { x: a.label.x, y: a.label.y });
  }
  for (const a of anchors) {
    circle(ctx, a.target.x, a.target.y, TARGET_DOT_RADIUS);
    ctx.fillStyle = GOLD;
    ctx.fill();
  }
  for (const a of anchors) drawLabel(ctx, a, env);
  for (const a of anchors) drawMarker(ctx, a);
  ctx.restore();
}
