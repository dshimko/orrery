// SPDX-License-Identifier: Apache-2.0
import type { Topology, Visuals, Snapshot } from '@orrery/core';
import {
  type CameraState,
  createSystemView,
  type SystemView,
  type TimeState,
} from '@orrery/render';
import { useEffect, useRef } from 'react';
import { loadCamera, saveCamera } from '../lib/camera-store.js';
import { seedFor } from '../lib/seed.js';

export interface SceneHostProps {
  envId: string;
  topology: Topology;
  visuals: Visuals;
  tierColor: string;
  initialSnapshot: Snapshot;
  reducedMotion: boolean;
  time: () => TimeState;
  /** Called when a view is created and with null when it is disposed. */
  onView: (view: SystemView | null) => void;
  onFailure: (message: string) => void;
}

/**
 * Mounts the framework-free system view. The camera is saved to sessionStorage when the view is
 * disposed (navigation away, or re-creation for a motion change) and restored on creation.
 */
export function SceneHost(props: SceneHostProps) {
  const { envId, topology, visuals, tierColor, reducedMotion, onView, onFailure } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let view: SystemView;
    try {
      const camera: CameraState | undefined = loadCamera(envId);
      view = createSystemView(container, {
        topology,
        visuals,
        tierColor,
        seed: seedFor(envId),
        snapshot: latest.current.initialSnapshot,
        time: () => latest.current.time(),
        reducedMotion,
        ...(camera ? { camera } : {}),
      });
    } catch {
      onFailure('The 3D view could not start. The data table below still shows the same data.');
      return;
    }
    onView(view);
    return () => {
      try {
        saveCamera(envId, view.getCamera());
      } finally {
        onView(null);
        view.dispose();
      }
    };
  }, [envId, topology, visuals, tierColor, reducedMotion, onView, onFailure]);

  return <div ref={containerRef} className="scene" data-testid="scene" />;
}
