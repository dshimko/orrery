// SPDX-License-Identifier: Apache-2.0
import type { FaceModel } from '../model/index.js';
import type { Ctx, DrawEnv } from './common.js';
import { drawCalendar } from './calendar.js';
import { drawDialFrame, drawNoonSuns, drawRing, drawSky } from './dial.js';
import { drawErrorDial } from './error.js';
import { drawFacade, drawPlaque, drawProcession, drawRooster } from './facade.js';
import { drawFigures } from './figures.js';
import { drawHub, drawMoon, drawStarHand, drawSunHand } from './hands.js';
import { drawSpokes } from './spokes.js';

export type { DrawEnv } from './common.js';

/** Draws one face in face units; the caller sets the transform for the face's origin and scale. */
export function drawFace(ctx: Ctx, model: FaceModel, env: DrawEnv): void {
  drawFacade(ctx, env);
  if (model.errorMessage !== null) {
    drawPlaque(ctx, model);
    drawErrorDial(ctx, model, env);
    return;
  }
  drawProcession(ctx, model, env);
  drawRooster(ctx, model, env);
  drawPlaque(ctx, model);
  drawDialFrame(ctx, env);
  drawRing(ctx, model, env);
  drawSky(ctx, env);
  drawNoonSuns(ctx, model, env);
  drawSpokes(ctx, model, env);
  drawMoon(ctx, model, env);
  drawStarHand(ctx, model, env);
  drawSunHand(ctx, model, env);
  drawHub(ctx, model.products, env);
  drawFigures(ctx, model, env);
  drawCalendar(ctx, model, env);
}
