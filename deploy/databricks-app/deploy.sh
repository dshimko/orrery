#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds the package and deploys it as a Databricks App with the Databricks CLI (bundles).
# Usage: WAREHOUSE_ID=<id> [TARGET=dev] ./deploy.sh
set -euo pipefail

TARGET="${TARGET:-dev}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"

if ! command -v databricks >/dev/null 2>&1; then
  echo "error: the databricks CLI is not installed. See https://docs.databricks.com/aws/en/dev-tools/cli/install" >&2
  exit 1
fi
if [[ -z "${WAREHOUSE_ID:-}" ]]; then
  echo "error: set WAREHOUSE_ID to the id of a SQL warehouse the app may use." >&2
  exit 1
fi
export BUNDLE_VAR_warehouse_id="${WAREHOUSE_ID}"

echo "==> Packaging (pnpm package)"
(cd "${ROOT}" && pnpm package)

cd "${HERE}"
echo "==> Validating bundle (target: ${TARGET})"
databricks bundle validate -t "${TARGET}"
echo "==> Deploying bundle"
databricks bundle deploy -t "${TARGET}"
echo "==> Starting the app"
databricks bundle run orrery -t "${TARGET}"
echo "Done. Open the app URL printed above (also under Compute > Apps in the workspace)."
