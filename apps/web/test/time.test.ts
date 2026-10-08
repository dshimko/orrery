// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import { createTimeController, MAX_FRAME_MS, minuteOfDay } from '../src/lib/time.js';

const START = new Date('2026-03-04T10:40:00Z');

describe('time controller', () => {
  test('advances 24 simulated hours in secondsPerSimDay at 1x', () => {
    const controller = createTimeController({ start: START, secondsPerSimDay: 120 });
    controller.advance(1000);
    expect(controller.state().at.toISOString()).toBe('2026-03-04T10:52:00.000Z');
  });

  test('scales with speed', () => {
    const controller = createTimeController({ start: START, secondsPerSimDay: 120, speed: 2 });
    controller.advance(500);
    expect(controller.state().at.toISOString()).toBe('2026-03-04T10:52:00.000Z');
    controller.setSpeed(4);
    expect(controller.state().speed).toBe(4);
  });

  test('does not advance while paused', () => {
    const controller = createTimeController({ start: START, secondsPerSimDay: 120, paused: true });
    controller.advance(1000);
    expect(controller.state().at).toEqual(START);
    controller.setPaused(false);
    controller.advance(1000);
    expect(controller.state().at).not.toEqual(START);
  });

  test('clamps long frame gaps', () => {
    const controller = createTimeController({ start: START, secondsPerSimDay: 120 });
    controller.advance(MAX_FRAME_MS * 60);
    expect(controller.state().at.toISOString()).toBe('2026-03-04T10:52:00.000Z');
  });

  test('ignores invalid speeds', () => {
    const controller = createTimeController({ start: START, secondsPerSimDay: 120 });
    controller.setSpeed(0);
    controller.setSpeed(Number.NaN);
    expect(controller.state().speed).toBe(1);
  });

  test('rolls over to the next date at midnight', () => {
    const controller = createTimeController({
      start: new Date('2026-03-04T23:59:30Z'),
      secondsPerSimDay: 120,
    });
    controller.advance(1000);
    expect(controller.state().at.toISOString().slice(0, 10)).toBe('2026-03-05');
  });

  test('seeks to a minute of the current UTC day', () => {
    const controller = createTimeController({ start: START, secondsPerSimDay: 120 });
    controller.seekMinute(5);
    expect(controller.state().at.toISOString()).toBe('2026-03-04T00:05:00.000Z');
    controller.seekMinute(99999);
    expect(controller.state().at.toISOString()).toBe('2026-03-04T23:59:00.000Z');
  });

  test('rejects a non-positive day length', () => {
    expect(() => createTimeController({ start: START, secondsPerSimDay: 0 })).toThrow();
  });

  test('computes the minute of day', () => {
    expect(minuteOfDay(START)).toBe(640);
  });
});

describe('live mode', () => {
  function liveController() {
    let nowMs = START.getTime();
    const controller = createTimeController({
      start: new Date(0),
      secondsPerSimDay: 120,
      mode: 'live',
      now: () => nowMs,
    });
    return { controller, setNow: (ms: number) => (nowMs = ms) };
  }

  test('follows the wall clock and ignores advance', () => {
    const { controller, setNow } = liveController();
    expect(controller.mode()).toBe('live');
    expect(controller.state()).toEqual({ at: START, speed: 1, paused: false, live: true });
    setNow(START.getTime() + 5000);
    controller.advance(1000);
    expect(controller.state().at.getTime()).toBe(START.getTime() + 5000);
  });

  test('pausing switches to replay frozen at the current instant', () => {
    const { controller, setNow } = liveController();
    setNow(START.getTime() + 7000);
    controller.setPaused(true);
    setNow(START.getTime() + 60_000);
    expect(controller.mode()).toBe('replay');
    expect(controller.state()).toEqual({
      at: new Date(START.getTime() + 7000),
      speed: 1,
      paused: true,
      live: false,
    });
  });

  test('a speed other than 1 switches to replay and then advances', () => {
    const { controller, setNow } = liveController();
    setNow(START.getTime() + 1000);
    controller.setSpeed(2);
    expect(controller.mode()).toBe('replay');
    controller.advance(500);
    expect(controller.state().at.getTime()).toBe(START.getTime() + 1000 + 60_000 * 12);
    expect(controller.state().speed).toBe(2);
  });

  test('speed 1 and un-pausing are no-ops in live mode', () => {
    const { controller } = liveController();
    controller.setSpeed(1);
    controller.setPaused(false);
    expect(controller.mode()).toBe('live');
  });

  test('seeking switches to replay at that minute of the current day', () => {
    const { controller } = liveController();
    controller.seekMinute(60);
    expect(controller.mode()).toBe('replay');
    expect(controller.state().at.toISOString()).toBe('2026-03-04T01:00:00.000Z');
  });

  test('goLive returns to the wall clock at 1x, unpaused', () => {
    const { controller, setNow } = liveController();
    controller.setSpeed(4);
    controller.setPaused(true);
    setNow(START.getTime() + 90_000);
    const state = controller.goLive();
    expect(controller.mode()).toBe('live');
    expect(state).toEqual({
      at: new Date(START.getTime() + 90_000),
      speed: 1,
      paused: false,
      live: true,
    });
  });

  test('a replay controller reports live false', () => {
    const controller = createTimeController({ start: START, secondsPerSimDay: 120 });
    expect(controller.state().live).toBe(false);
  });
});
