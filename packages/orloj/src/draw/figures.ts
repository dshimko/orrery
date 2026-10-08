// SPDX-License-Identifier: Apache-2.0
import {
  CONSUMERS_POS,
  FRESHNESS_POS,
  GOLD,
  GOLD_DARK,
  INCIDENTS_POS,
  INK,
  MUTED,
  NICHE_FILL,
  SPEND_POS,
} from '../constants.js';
import type { FaceModel } from '../model/index.js';
import { clamp } from '../model/format.js';
import { archPath, sans, serif, stringsOf, text, type Ctx, type DrawEnv } from './common.js';
import {
  BELL_PIVOT_Y,
  BELL_SWING_AMPLITUDE,
  BIG_COIN,
  COIN_BOTTOM_Y,
  COIN_RX,
  COIN_RY,
  COIN_STEP,
  COIN_X,
  EYE_IRIS_RADIUS,
  ICON_CENTER_DY,
  ICON_RAY_STROKE,
  ICON_SCALE,
  ICON_STROKE,
  ICON_THIN_STROKE,
  ICON_WAVE_STROKE,
  MAX_COINS,
  PUPIL_MAX_RADIUS,
  PUPIL_MIN_RADIUS,
  fillIconPath,
  strokeIconPath,
} from './icons.js';

const BELL_SWING_SPEED = 9;
/** Below this ring strength the bell's wave arcs are not drawn. */
const RING_MIN = 0.05;
const RAYS_ACTIVITY_THRESHOLD = 0.45;
const RAYS_PULSE_SPEED = 3;
const RAYS_PULSE_BASE = 0.6;
const RAYS_PULSE_DEPTH = 0.4;
const SAND_DASH = 3;
const SAND_DASH_SPEED = 12;
const SAND_STREAM_STROKE = 1.6;
/** Spend levels (share of the full-purse rate) up to which 1, 2 and 3 coins are drawn. */
const COIN_LEVEL_THRESHOLDS = [0.25, 0.5, 0.75] as const;
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

/** The niche spans this far above and below its figure's anchor point (see `niche`). */
export const NICHE_HALF_HEIGHT = 58;
/** The last caption line must end at least this far inside the niche's bottom edge. */
const CAPTION_BOTTOM_MARGIN = 6;
const CAPTION_LINE_HEIGHT = 11;
const CAPTION_LABEL_PX = 9.5;
const CAPTION_VALUE_PX = 15;
const CAPTION_VALUE_GAP = 3;
/** Labels longer than this would spill out of the 54-unit niche, so they wrap onto two lines. */
const CAPTION_MAX_LINE_CHARS = 11;

/** Splits a long label at the space nearest its middle; short labels stay on one line. */
export function wrapCaption(label: string): string[] {
  if (label.length <= CAPTION_MAX_LINE_CHARS) return [label];
  const middle = label.length / 2;
  let best = -1;
  for (let i = label.indexOf(' '); i !== -1; i = label.indexOf(' ', i + 1)) {
    if (best === -1 || Math.abs(i - middle) < Math.abs(best - middle)) best = i;
  }
  if (best === -1) return [label];
  return [label.slice(0, best), label.slice(best + 1)];
}

/** Offsets from a figure's anchor y for a caption's lines (text is middle-baselined). */
export interface CaptionLayout {
  valueDy: number;
  labelDys: number[];
  /** Top of the value text, the lowest point the figure's icon may reach. */
  valueTop: number;
  /** Bottom of the last line. */
  bottom: number;
}

/**
 * Lays the caption block out upward from the niche bottom, so the last label line always ends
 * `CAPTION_BOTTOM_MARGIN` inside the niche whatever the line count; the value sits above the
 * label lines.
 */
export function captionLayout(lineCount: number): CaptionLayout {
  const lines = Math.max(1, Math.floor(lineCount));
  const halfLabel = CAPTION_LABEL_PX / 2;
  const lastDy = NICHE_HALF_HEIGHT - CAPTION_BOTTOM_MARGIN - halfLabel;
  const firstDy = lastDy - (lines - 1) * CAPTION_LINE_HEIGHT;
  const valueDy = firstDy - halfLabel - CAPTION_VALUE_GAP - CAPTION_VALUE_PX / 2;
  return {
    valueDy,
    labelDys: Array.from({ length: lines }, (_, i) => firstDy + i * CAPTION_LINE_HEIGHT),
    valueTop: valueDy - CAPTION_VALUE_PX / 2,
    bottom: lastDy + halfLabel,
  };
}

function caption(ctx: Ctx, x: number, y: number, value: string, label: string, color = INK): void {
  const lines = wrapCaption(label);
  const layout = captionLayout(lines.length);
  text(ctx, value, x, y + layout.valueDy, serif(700, CAPTION_VALUE_PX), color);
  lines.forEach((line, i) => {
    text(ctx, line, x, y + (layout.labelDys[i] ?? 0), sans(500, CAPTION_LABEL_PX), MUTED);
  });
}

/** Coins drawn for a spend level (0..1 of the full-purse rate): 1 to `MAX_COINS`. */
export function coinCount(level: number): number {
  const below = COIN_LEVEL_THRESHOLDS.filter((t) => level > t).length;
  return Math.min(MAX_COINS, 1 + below);
}

/** Share of spokes within their freshness target, 0..1 (1 when there are no spokes). */
export function freshShare(spokesPastTarget: number, spokeCount: number): number {
  if (spokeCount <= 0) return 1;
  return clamp(1 - spokesPastTarget / spokeCount, 0, 1);
}

/** Pupil radius in icon units: `PUPIL_MIN_RADIUS` at no activity, `PUPIL_MAX_RADIUS` at full. */
export function pupilRadius(activity: number): number {
  return PUPIL_MIN_RADIUS + (PUPIL_MAX_RADIUS - PUPIL_MIN_RADIUS) * clamp(activity, 0, 1);
}

export function showsRays(activity: number): boolean {
  return activity > RAYS_ACTIVITY_THRESHOLD;
}

/** Bell swing in radians: zero unless `bell` (0..1, eased from open incidents) is above zero. */
export function bellSwing(bell: number, deco: number): number {
  return bell * Math.sin(deco * BELL_SWING_SPEED) * BELL_SWING_AMPLITUDE;
}

/** Runs `draw` on the icon grid: scaled, centered `ICON_CENTER_DY` above the niche center. */
function onIconGrid(ctx: Ctx, x: number, y: number, color: string, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y + ICON_CENTER_DY);
  ctx.scale(ICON_SCALE, ICON_SCALE);
  ctx.strokeStyle = color;
  ctx.lineWidth = ICON_STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw();
  ctx.restore();
}

function drawCoins(ctx: Ctx, x: number, y: number, color: string, coins: number): void {
  onIconGrid(ctx, x, y, color, () => {
    ctx.fillStyle = NICHE_FILL;
    for (let k = 0; k < coins; k += 1) {
      ctx.save();
      ctx.translate(COIN_X, COIN_BOTTOM_Y - k * COIN_STEP);
      fillIconPath(ctx, 'coinSide');
      strokeIconPath(ctx, 'coinSide');
      ctx.beginPath();
      ctx.ellipse(0, 0, COIN_RX, COIN_RY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(BIG_COIN.x, BIG_COIN.y, BIG_COIN.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = ICON_THIN_STROKE;
    ctx.beginPath();
    ctx.arc(BIG_COIN.x, BIG_COIN.y, BIG_COIN.innerR, 0, Math.PI * 2);
    ctx.stroke();
    strokeIconPath(ctx, 'coinGlyph');
  });
}

function drawHourglass(
  ctx: Ctx,
  x: number,
  y: number,
  color: string,
  fresh: number,
  deco: number,
): void {
  onIconGrid(ctx, x, y, color, () => {
    strokeIconPath(ctx, 'hourglassBars');
    strokeIconPath(ctx, 'hourglassGlass');
    ctx.fillStyle = color;
    const top = -17 + (1 - fresh) * 8;
    ctx.beginPath();
    ctx.moveTo(-6 * fresh - 1, top);
    ctx.lineTo(6 * fresh + 1, top);
    ctx.lineTo(0, -6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-9, 23);
    ctx.quadraticCurveTo(0, 23 - 10 * (0.3 + (1 - fresh) * 0.7), 9, 23);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = SAND_STREAM_STROKE;
    ctx.setLineDash([SAND_DASH, SAND_DASH]);
    ctx.lineDashOffset = -deco * SAND_DASH_SPEED;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 14);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function drawBell(
  ctx: Ctx,
  x: number,
  y: number,
  color: string,
  swing: number,
  ring: number,
): void {
  onIconGrid(ctx, x, y, color, () => {
    ctx.save();
    ctx.translate(0, BELL_PIVOT_Y);
    ctx.rotate(swing);
    ctx.translate(0, -BELL_PIVOT_Y);
    ctx.fillStyle = NICHE_FILL;
    fillIconPath(ctx, 'bell');
    strokeIconPath(ctx, 'bell');
    strokeIconPath(ctx, 'bellClapper');
    ctx.restore();
    if (ring <= RING_MIN) return;
    ctx.globalAlpha = ring;
    ctx.lineWidth = ICON_WAVE_STROKE;
    strokeIconPath(ctx, 'bellWaves');
    ctx.globalAlpha = 1;
  });
}

function drawEye(
  ctx: Ctx,
  x: number,
  y: number,
  color: string,
  activity: number,
  deco: number,
): void {
  onIconGrid(ctx, x, y, color, () => {
    strokeIconPath(ctx, 'eye');
    ctx.beginPath();
    ctx.arc(0, 0, EYE_IRIS_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, pupilRadius(activity), 0, Math.PI * 2);
    ctx.fill();
    if (!showsRays(activity)) return;
    ctx.globalAlpha = RAYS_PULSE_BASE + RAYS_PULSE_DEPTH * Math.sin(deco * RAYS_PULSE_SPEED);
    ctx.lineWidth = ICON_RAY_STROKE;
    strokeIconPath(ctx, 'eyeRays');
    ctx.globalAlpha = 1;
  });
}

function drawSpend(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = SPEND_POS;
  niche(ctx, x, y);
  drawCoins(ctx, x, y, GOLD, coinCount(env.smooth.purse));
  caption(ctx, x, y, String(model.figures.spend), stringsOf(env).canvas.figureSpend);
}

function drawFreshness(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = FRESHNESS_POS;
  const f = model.figures;
  const late = f.spokesPastTarget;
  niche(ctx, x, y);
  const color = late > 0 ? env.visuals.colors.warning : GOLD;
  drawHourglass(ctx, x, y, color, freshShare(late, f.spokeCount), env.deco);
  caption(
    ctx,
    x,
    y,
    String(late),
    stringsOf(env).canvas.figureFreshness,
    late > 0 ? BAD_TEXT_LATE : INK,
  );
}

function drawIncidents(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = INCIDENTS_POS;
  const f = model.figures;
  niche(ctx, x, y);
  const color = f.openIncidents > 0 ? f.incidentColor : GOLD;
  drawBell(ctx, x, y, color, bellSwing(env.smooth.bell, env.deco), env.smooth.bell);
  const textColor =
    f.incidentLevel === 'incident'
      ? BAD_TEXT_INCIDENT
      : f.incidentLevel === 'warning'
        ? BAD_TEXT_WARNING
        : INK;
  caption(ctx, x, y, String(f.openIncidents), stringsOf(env).canvas.figureIncidents, textColor);
}

function drawConsumers(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { x, y } = CONSUMERS_POS;
  const activity = model.figures.consumerActivity;
  niche(ctx, x, y);
  drawEye(ctx, x, y, GOLD, activity, env.deco);
  caption(ctx, x, y, `${Math.round(activity * 100)}%`, stringsOf(env).canvas.figureConsumers);
}

/** Coins (spend), hourglass (past target), bell (incidents), eye (consumers). */
export function drawFigures(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  drawSpend(ctx, model, env);
  drawFreshness(ctx, model, env);
  drawIncidents(ctx, model, env);
  drawConsumers(ctx, model, env);
}
