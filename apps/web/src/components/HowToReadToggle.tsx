// SPDX-License-Identifier: Apache-2.0
import { GUIDANCE_TEXT } from '../lib/orloj-text.js';

export interface HowToReadToggleProps {
  isOn: boolean;
  onToggle: () => void;
}

/** Turns the Orloj annotation on or off. The `?` key does the same, announced by aria-keyshortcuts. */
export function HowToReadToggle({ isOn, onToggle }: HowToReadToggleProps) {
  return (
    <button
      type="button"
      className="btn sm"
      data-testid="how-to-read"
      aria-pressed={isOn}
      aria-keyshortcuts="?"
      onClick={onToggle}
    >
      {GUIDANCE_TEXT.toggle}
    </button>
  );
}
