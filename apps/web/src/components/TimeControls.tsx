// SPDX-License-Identifier: Apache-2.0
import type { TimeState } from '@orrery/render';
import type { ReactNode } from 'react';
import { formatClock, formatDate, formatLocalClock } from '../lib/format.js';
import { MINUTES_PER_DAY, minuteOfDay } from '../lib/time.js';

export interface TimeControlsProps {
  time: TimeState;
  speeds: readonly number[];
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
  onScrub: (minuteOfDay: number) => void;
  /** Returns to the wall clock; shown in replay. */
  onGoLive: () => void;
  /** Extra status next to the clock, e.g. the freshness indicator. */
  status?: ReactNode;
  /** Extra controls after the scrubber, e.g. the How to read toggle. */
  extra?: ReactNode;
  /** IANA zone for the local time; the browser's by default. Injectable for tests. */
  timeZone?: string;
}

/**
 * Live badge or back-to-live button, play/pause, speed buttons, the clock in UTC and the
 * browser's zone, and a scrubber over the UTC day. In live mode, pausing, a speed other than
 * 1x, or dragging the scrubber starts a replay at the current instant.
 */
export function TimeControls({
  time,
  speeds,
  onTogglePlay,
  onSpeed,
  onScrub,
  onGoLive,
  status,
  extra,
  timeZone,
}: TimeControlsProps) {
  const minute = Math.floor(minuteOfDay(time.at));
  const isLive = time.live === true;
  return (
    <section className="time-controls" aria-label="Time">
      <div className="clock" role="timer" aria-label="Current time, UTC and local">
        <span className="clock-time">{formatClock(time.at)}</span>
        <span className="clock-unit">UTC {formatDate(time.at)}</span>
        <span className="clock-local" data-testid="clock-local">
          · {formatLocalClock(time.at, timeZone)}
        </span>
      </div>
      {isLive ? (
        <span className="live-badge" data-testid="live-badge">
          LIVE
        </span>
      ) : (
        <button type="button" className="btn solid" data-testid="back-to-live" onClick={onGoLive}>
          Back to live
        </button>
      )}
      {status}
      <button
        type="button"
        className="btn solid"
        data-testid="play"
        aria-pressed={!time.paused}
        onClick={onTogglePlay}
      >
        {time.paused ? 'Play' : 'Pause'}
      </button>
      <div className="row" role="group" aria-label="Playback speed">
        {speeds.map((speed) => (
          <button
            key={speed}
            type="button"
            className="btn sm"
            aria-pressed={!isLive && time.speed === speed}
            aria-label={isLive && speed !== 1 ? `Replay at ${speed}x` : `${speed}x`}
            title={isLive && speed !== 1 ? `Leave live and replay at ${speed}x` : undefined}
            onClick={() => {
              onSpeed(speed);
            }}
          >
            {speed}x
          </button>
        ))}
      </div>
      <input
        type="range"
        className="scrubber"
        data-testid="scrubber"
        min={0}
        max={MINUTES_PER_DAY - 1}
        step={1}
        value={minute}
        aria-label={isLive ? 'Time of day in UTC (dragging starts a replay)' : 'Time of day in UTC'}
        aria-valuetext={`${formatClock(time.at)} UTC`}
        onChange={(event) => {
          onScrub(Number(event.target.value));
        }}
      />
      {extra}
    </section>
  );
}
