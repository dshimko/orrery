// SPDX-License-Identifier: Apache-2.0
import { ERROR_TEXT, GOLD, GOLD_DARK, INK, PANEL } from '../constants.js';
import type { FaceModel } from '../model/index.js';
import { roundRect, sans, serif, text, wrapLines, type Ctx, type DrawEnv } from './common.js';
import { drawDialFrame, drawSky } from './dial.js';
import { drawHub, drawSunHand } from './hands.js';

const DIM_ALPHA = 0.28;
const PANEL_WIDTH = 196;
const LINE_HEIGHT = 17;
const MAX_LINES = 6;
const PANEL_PADDING = 14;
const TITLE_HEIGHT = 24;
const ELLIPSIS = '…';
const ERROR_TITLE = 'No data';

/** Wraps to the line limit, ending the last visible line with an ellipsis when cut. */
function limitLines(lines: readonly string[]): string[] {
  if (lines.length <= MAX_LINES) return [...lines];
  const kept = lines.slice(0, MAX_LINES);
  kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1] ?? ''}${ELLIPSIS}`;
  return kept;
}

/** A clearly dimmed dial with the failure message in a panel over it. */
export function drawErrorDial(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  const { cx, cy } = env.geo;
  ctx.save();
  ctx.globalAlpha = DIM_ALPHA;
  drawDialFrame(ctx, env);
  drawSky(ctx, env);
  drawSunHand(ctx, model, env);
  drawHub(ctx, null, env);
  ctx.restore();

  ctx.font = sans(500, 12.5);
  const lines = limitLines(
    wrapLines(
      model.errorMessage ?? '',
      PANEL_WIDTH - PANEL_PADDING * 2,
      (s) => ctx.measureText(s).width,
    ),
  );
  const height = TITLE_HEIGHT + lines.length * LINE_HEIGHT + PANEL_PADDING;
  const top = cy - height / 2;
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 1.5;
  roundRect(ctx, cx - PANEL_WIDTH / 2, top, PANEL_WIDTH, height, 6);
  ctx.fill();
  ctx.stroke();
  text(ctx, ERROR_TITLE, cx, top + PANEL_PADDING, serif(700, 13), GOLD);
  lines.forEach((line, i) => {
    text(
      ctx,
      line,
      cx,
      top + TITLE_HEIGHT + PANEL_PADDING / 2 + i * LINE_HEIGHT + LINE_HEIGHT / 2,
      sans(500, 12.5),
      i === 0 ? ERROR_TEXT : INK,
    );
  });
}
