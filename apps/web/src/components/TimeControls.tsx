// SPDX-License-Identifier: Apache-2.0
import type { TimeState } from '@orrery/render';
import { formatClock, formatDate } from '../lib/format.js';
import { MINUTES_PER_DAY, minuteOfDay } from '../lib/time.js';

export interface TimeControlsProps {
  time: TimeState;
  speeds: readonly number[];
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
  onScrub: (minuteOfDay: number) => void;
}

/** Play/pause, speed buttons, UTC clock, and a scrubber over the simulated day. */
export function TimeControls({ time, speeds, onTogglePlay, onSpeed, onScrub }: TimeControlsProps) {
  const minute = Math.floor(minuteOfDay(time.at));
  return (
    <section className="time-controls" aria-label="Simulated time">
      <div className="clock" role="timer" aria-label="Simulated time, UTC">
        <span className="clock-time">{formatClock(time.at)}</span>
        <span className="clock-unit">UTC {formatDate(time.at)}</span>
      </div>
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
            aria-pressed={time.speed === speed}
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
        aria-label="Time of day in UTC"
        aria-valuetext={`${formatClock(time.at)} UTC`}
        onChange={(event) => {
          onScrub(Number(event.target.value));
        }}
      />
    </section>
  );
}
