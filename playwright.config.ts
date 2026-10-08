// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export const FAILING_PORT = 4174;
export const OPENLINEAGE_PORT = 4175;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL so visual tests run without a GPU (spec: headless test path).
        // The perf benchmark (ORRERY_PERF=1) needs the real GPU instead.
        launchOptions: {
          args: process.env.ORRERY_PERF
            ? []
            : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  // The real server: built web app plus the API over the all-mock demo config.
  webServer: [
    {
      command: `node apps/server/dist/main.js`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: { ORRERY_CONFIG: 'config/examples/demo.yaml', PORT: String(PORT), HOST: '127.0.0.1' },
    },
    // three-env.yaml: dev is mock; stg and prod use the not-yet-available databricks adapter,
    // so they are real failing environments for the error-face tests.
    {
      command: `node apps/server/dist/main.js`,
      url: `http://127.0.0.1:${FAILING_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        ORRERY_CONFIG: 'config/examples/three-env.yaml',
        PORT: String(FAILING_PORT),
        HOST: '127.0.0.1',
      },
    },
    // openlineage.yaml: the public OpenLineage sample events (milestone 7 acceptance).
    {
      command: `node apps/server/dist/main.js`,
      url: `http://127.0.0.1:${OPENLINEAGE_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        ORRERY_CONFIG: 'config/examples/openlineage.yaml',
        PORT: String(OPENLINEAGE_PORT),
        HOST: '127.0.0.1',
      },
    },
  ],
});
