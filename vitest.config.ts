// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

const STRICT = { lines: 80, functions: 80, branches: 80, statements: 80 };

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['{apps,packages,adapters,scripts}/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**', 'adapters/*/src/**'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        'packages/core/src/**': STRICT,
        'adapters/*/src/**': STRICT,
      },
    },
  },
});
