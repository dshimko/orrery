// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vite';

// JSX is compiled by Vite's built-in esbuild rather than @vitejs/plugin-react, whose Babel
// toolchain pulls in a dependency outside the license allowlist (see docs/decisions.md).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { conditions: ['source'] },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', sourcemap: true },
});
