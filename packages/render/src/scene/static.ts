// SPDX-License-Identifier: Apache-2.0
// Fixed scenery: star field, visible sun with glow, ambient and directional light.
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  type Scene,
} from 'three';
import type { SceneModel } from '../sim/model.js';
import { starPositions } from './layout.js';
import { glowMaterial } from './materials.js';
import { COLOR_STAR, COLOR_SUN, COLOR_SUN_GLOW } from './palette.js';

const SUN_RADIUS = 34;
const SUN_GLOW_RADIUS = 62;
const SUN_GLOW_OPACITY = 0.18;
const SUN_LIGHT_COLOR = '#FFF1D6';
const SUN_LIGHT_INTENSITY = 1.15;
const STAR_SIZE = 1.6;

/** Adds stars, sun, and lights to the scene. Geometries and materials are disposed with it. */
export function buildStatic(scene: Scene, model: SceneModel): void {
  const { lighting } = model.visuals;
  scene.add(new AmbientLight(lighting.ambientColor, lighting.ambientIntensity));
  const sunLight = new DirectionalLight(SUN_LIGHT_COLOR, SUN_LIGHT_INTENSITY);
  sunLight.position.set(...lighting.sunPosition);
  scene.add(sunLight);

  const stars = new BufferGeometry();
  stars.setAttribute(
    'position',
    new BufferAttribute(starPositions(model.seed, lighting.starCount), 3),
  );
  scene.add(
    new Points(
      stars,
      new PointsMaterial({ color: COLOR_STAR, size: STAR_SIZE, sizeAttenuation: false }),
    ),
  );

  const sun = new Mesh(
    new SphereGeometry(SUN_RADIUS, 24, 16),
    new MeshBasicMaterial({ color: COLOR_SUN }),
  );
  sun.position.set(...lighting.sunPosition);
  scene.add(sun);
  const glow = new Mesh(
    new SphereGeometry(SUN_GLOW_RADIUS, 24, 16),
    glowMaterial(COLOR_SUN_GLOW, SUN_GLOW_OPACITY),
  );
  glow.position.copy(sun.position);
  scene.add(glow);
}
