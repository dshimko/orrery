#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Renders the visual-regression baselines in the official Playwright Linux container, the same
# platform CI uses. The repo is copied into the container (read-only mount) so local
# node_modules are never touched; only e2e/*-snapshots/ is written back.
set -e
# Usage: visual-baselines.sh [update|check] (default update).
MODE="${1:-update}"
FLAG=""
[ "$MODE" = "update" ] && FLAG="--update-snapshots"
IMAGE="mcr.microsoft.com/playwright:v1.64.0-noble-arm64"
docker run --rm --ipc=host -e FLAG="$FLAG" -v "$PWD:/src:ro" -v "$PWD/e2e:/out" "$IMAGE" bash -euc '
  mkdir /work && cd /src
  tar --exclude=node_modules --exclude=dist --exclude=test-results --exclude=playwright-report -cf - . | tar -xf - -C /work
  cd /work && corepack enable >/dev/null && CI=1 pnpm install --frozen-lockfile >/dev/null
  pnpm build >/dev/null
  pnpm exec playwright test e2e/visual.spec.ts $FLAG
  if [ -n "$FLAG" ]; then cp -r e2e/visual.spec.ts-snapshots /out/; fi
'
