// SPDX-License-Identifier: Apache-2.0
import type { SelectionInfo } from '../lib/selection.js';

export interface SelectionCardProps {
  info: SelectionInfo;
  onClose: () => void;
}

export function SelectionCard({ info, onClose }: SelectionCardProps) {
  return (
    <section className="card" aria-labelledby="selection-h" data-testid="selection">
      <button type="button" className="x" aria-label="Close selection" onClick={onClose}>
        &times;
      </button>
      <h2 id="selection-h">{info.title}</h2>
      {info.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </section>
  );
}
