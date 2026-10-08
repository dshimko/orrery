// SPDX-License-Identifier: Apache-2.0
import type { Visuals } from '@orrery/core';
import {
  createOrlojView,
  type OrlojFace,
  type OrlojHit,
  type OrlojTime,
  type OrlojView,
} from '@orrery/orloj';
import { useEffect, useRef, useState } from 'react';

export interface OrlojStageProps {
  faces: readonly OrlojFace[];
  visuals: Visuals;
  time: () => OrlojTime;
  reducedMotion: boolean;
  onSelect: (envId: string) => void;
}

interface TooltipState {
  hit: OrlojHit;
  /** True when the pointer is in the right half, so the tooltip opens to the left. */
  isFlipped: boolean;
}

/**
 * Mounts the framework-free Orloj view and shows a tooltip near the hovered part. Tooltip text
 * is set as text content only. The canvas is not keyboard accessible; the at-a-glance table and
 * its summary buttons are the text equivalent.
 */
export function OrlojStage({ faces, visuals, time, reducedMotion, onSelect }: OrlojStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<OrlojView | null>(null);
  const latest = useRef({ faces, time, onSelect });
  latest.current = { faces, time, onSelect };
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let view: OrlojView;
    try {
      view = createOrlojView(container, {
        visuals,
        faces: latest.current.faces,
        time: () => latest.current.time(),
        reducedMotion,
      });
    } catch {
      setFailure('The clock faces could not start. The table below has the same information.');
      return;
    }
    viewRef.current = view;
    setFailure(null);
    const offHover = view.onHover((hit) => {
      setTooltip(hit ? { hit, isFlipped: hit.x > view.layout().width / 2 } : null);
    });
    const offSelect = view.onSelect((envId) => {
      latest.current.onSelect(envId);
    });
    return () => {
      offHover();
      offSelect();
      viewRef.current = null;
      view.dispose();
    };
  }, [visuals, reducedMotion]);

  useEffect(() => {
    viewRef.current?.setFaces(faces);
  }, [faces]);

  return (
    <section className="orloj-stage" aria-label="Environment clock faces">
      <div
        ref={containerRef}
        className="orloj"
        data-testid="orloj"
        role="img"
        aria-label="One astronomical clock face per environment, showing schedules, freshness, and incidents. The table below is a text equivalent."
        onPointerLeave={() => {
          setTooltip(null);
        }}
      />
      {tooltip && (
        <div
          className={tooltip.isFlipped ? 'tooltip flip' : 'tooltip'}
          data-testid="tooltip"
          role="tooltip"
          style={{ left: tooltip.hit.x, top: tooltip.hit.y }}
        >
          <b>{tooltip.hit.title}</b>
          {tooltip.hit.text}
        </div>
      )}
      {failure && <p className="scene-error">{failure}</p>}
    </section>
  );
}
