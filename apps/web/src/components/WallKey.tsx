// SPDX-License-Identifier: Apache-2.0
import { GUIDANCE_TEXT } from '../lib/orloj-text.js';

/** The one-line key under the faces in wall mode, where the legend and toggle are hidden. */
export function WallKey() {
  return (
    <p className="wall-key" data-testid="wall-key">
      {GUIDANCE_TEXT.wallKey}
    </p>
  );
}
