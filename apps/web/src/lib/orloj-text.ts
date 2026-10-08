// SPDX-License-Identifier: Apache-2.0
// The only place the web app reads guidance text keys from ORLOJ_STRINGS. No English lives in
// components: they take these values.
import { ORLOJ_STRINGS } from '@orrery/orloj';

export const GUIDANCE_TEXT = {
  /** Label of the controls-bar toggle. */
  toggle: ORLOJ_STRINGS.howToReadTitle,
  /** Shown while annotation is on, telling the viewer how to close it. */
  dismissHint: ORLOJ_STRINGS.howToReadDismissHint,
  /** The legend's <summary>. */
  legendTitle: ORLOJ_STRINGS.legendTitle,
  legendPurpose: ORLOJ_STRINGS.legendPurpose,
  legendHowToUse: ORLOJ_STRINGS.legendHowToUse,
  /** The one-line key strip under the faces in wall mode. */
  wallKey: ORLOJ_STRINGS.wallKey,
} as const;
