// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { NICHE_HALF_HEIGHT, captionLayout, wrapCaption } from '../src/draw/figures.js';

const LABEL_PX = 9.5;
const VALUE_PX = 15;
const MIN_BOTTOM_MARGIN = 6;

describe('captionLayout', () => {
  for (const lineCount of [1, 2]) {
    it(`keeps a ${lineCount}-line caption inside the niche interior`, () => {
      const layout = captionLayout(lineCount);
      expect(layout.labelDys).toHaveLength(lineCount);
      for (const dy of layout.labelDys) {
        expect(dy - LABEL_PX / 2).toBeGreaterThan(-NICHE_HALF_HEIGHT);
        expect(dy + LABEL_PX / 2).toBeLessThanOrEqual(NICHE_HALF_HEIGHT - MIN_BOTTOM_MARGIN);
      }
      expect(layout.valueDy - VALUE_PX / 2).toBeGreaterThan(-NICHE_HALF_HEIGHT);
      expect(layout.bottom).toBeLessThanOrEqual(NICHE_HALF_HEIGHT - MIN_BOTTOM_MARGIN);
    });
  }

  it('stacks the value above its label lines without overlap', () => {
    const layout = captionLayout(2);
    expect(layout.valueDy + VALUE_PX / 2).toBeLessThan((layout.labelDys[0] ?? 0) - LABEL_PX / 2);
    expect(layout.labelDys[1]).toBeGreaterThan(layout.labelDys[0] ?? Infinity);
  });

  it('moves the value up when the label takes two lines', () => {
    expect(captionLayout(2).valueDy).toBeLessThan(captionLayout(1).valueDy);
    expect(captionLayout(2).bottom).toBe(captionLayout(1).bottom);
  });

  it('wraps the two-word figure labels onto two lines', () => {
    expect(wrapCaption('spend per hour')).toHaveLength(2);
    expect(wrapCaption('consumer activity')).toHaveLength(2);
    expect(wrapCaption('incidents')).toEqual(['incidents']);
  });
});
