// SPDX-License-Identifier: Apache-2.0

/** Faces the Orloj canvas draws with: the weights imported in `main.tsx`. */
export const ORLOJ_FONT_FACES: readonly string[] = [
  '600 13px Cinzel',
  '700 13px Cinzel',
  '400 13px Barlow',
  '500 13px Barlow',
  '600 13px Barlow',
  '700 13px Barlow',
];

/** Never hold the clock faces back longer than this for a font that is slow or missing. */
export const FONT_WAIT_MS = 2500;

interface FontSet {
  load(font: string): Promise<unknown>;
  ready: Promise<unknown>;
}

/**
 * Resolves once the self-hosted faces have loaded, so the canvas never paints (and stays with)
 * fallback metrics. Always resolves: a missing font set, a failed load, or the timeout all fall
 * back to drawing with the fallback stack.
 */
export function whenFontsReady(
  fonts: FontSet | undefined = typeof document === 'undefined' ? undefined : document.fonts,
  waitMs: number = FONT_WAIT_MS,
): Promise<void> {
  if (!fonts) return Promise.resolve();
  const loaded = Promise.all(ORLOJ_FONT_FACES.map((face) => fonts.load(face)))
    .then(() => fonts.ready)
    .then(() => undefined)
    .catch(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  return Promise.race([loaded, timeout]);
}
