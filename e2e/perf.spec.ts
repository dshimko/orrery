// SPDX-License-Identifier: Apache-2.0
// Opt-in frame-time benchmark (ORRERY_PERF=1). The spec target is 60 fps at 1080p on integrated
// graphics with the prod mock; headless runs use software WebGL, so run this headed on the
// target machine: `ORRERY_PERF=1 pnpm exec playwright test e2e/perf.spec.ts --headed`.
import { test } from '@playwright/test';

test.skip(!process.env.ORRERY_PERF, 'Set ORRERY_PERF=1 to run the frame-time benchmark.');

const SAMPLE_MS = 8000;

test('prod at 1080p, playing at 4x: frame-time distribution', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/env/prod?date=2026-10-07&t=10:30&speed=4');
  await page.getByTestId('scene').locator('canvas').waitFor();
  await page.waitForTimeout(2000);
  const frames = await page.evaluate(
    (duration) =>
      new Promise<number[]>((resolve) => {
        const times: number[] = [];
        const start = performance.now();
        const tick = (now: number) => {
          times.push(now);
          if (now - start < duration) requestAnimationFrame(tick);
          else resolve(times.slice(1).map((t, i) => t - (times[i] ?? t)));
        };
        requestAnimationFrame(tick);
      }),
    SAMPLE_MS,
  );
  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const mean = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
  const report = {
    frames: frames.length,
    meanFps: Math.round(1000 / mean),
    p50Ms: pct(0.5).toFixed(1),
    p95Ms: pct(0.95).toFixed(1),
    p99Ms: pct(0.99).toFixed(1),
    over16_7ms: frames.filter((f) => f > 1000 / 60 + 1).length,
  };
  await info.attach('frame-times', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  process.stdout.write(`perf ${JSON.stringify(report)}\n`);
});
