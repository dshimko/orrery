// SPDX-License-Identifier: Apache-2.0
// Reference-only values: colors and positions the prototype hard-codes and `Visuals` does not own.

export const GOLD = '#D9B65A';
export const GOLD_DARK = '#8C7334';
export const GOLD_RIM_EDGE = '#5A4A22';
export const INK = '#EDE3C8';
export const MUTED = '#A6B8D2';
export const NOTE = '#C8D4E6';
export const CHALK = '#F3E3B0';
export const PANEL = '#0B0E15';
export const DIAL_FACE = '#0B0E14';
export const NICHE_FILL = '#0D1119';
export const SILVER = '#D5DEEA';
export const BONE = '#E7E1D0';
export const STAR_COLOR = '#E7EDF6';
export const SUN_CORE = '#FFF3C4';
export const SUN_EDGE = '#E2A93A';
export const SUN_RAY = '#F3D36B';
export const NIGHT = '#05070C';
export const DAWN = '#5A3420';
export const SKY_TOP = '#2E66AB';
export const SKY_BOTTOM = '#163866';
export const INK_ON_LIGHT = '#06101E';
export const SECONDARY_METASTORE = '#3FC1CF';
export const ROOSTER_COMB = '#E0603F';
export const LUTE_WOOD = '#B07A3E';
export const FACADE_TOP = '#232A3A';
export const FACADE_BOTTOM = '#12161F';
export const WINDOW_FILL = '#0A1830';
export const ERROR_TEXT = '#FFC766';

export const FONT_SERIF = 'Cinzel, "Trajan Pro", Georgia, "Times New Roman", serif';
export const FONT_SANS = 'Barlow, "Helvetica Neue", Arial, sans-serif';

export interface Point {
  x: number;
  y: number;
}

export const MISER_POS: Point = { x: 44, y: 275 };
export const MIRROR_POS: Point = { x: 44, y: 420 };
export const SKELETON_POS: Point = { x: 396, y: 275 };
export const LUTE_POS: Point = { x: 396, y: 420 };
export const NICHE_HIT_RADIUS = 30;

export const PROCESSION_HIT: Point = { x: 220, y: 100 };
export const PROCESSION_HIT_RADIUS = 60;
export const ROOSTER_POS: Point = { x: 220, y: 40 };
export const ROOSTER_HIT_RADIUS = 16;
export const PLAQUE = { x0: 110, y0: 146, x1: 330, y1: 178 } as const;
export const PLAQUE_HIT_RADIUS = 40;

export const HUB_RADIUS = 15;
export const NOON_MARK_RADIUS = 2.6;
