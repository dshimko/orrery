# Deploy Orrery as a Databricks App

This deploys the packaged build (`build/app`) with the mock adapter first, so you can see the app
before connecting any data. Then you switch it to the Databricks adapter.

> The `databricks` CLI steps in `deploy.sh` and `databricks.yml` have not been validated against a
> live workspace by the project's CI. Run `databricks bundle validate` first and report any issue.

## Prerequisites

- A Databricks workspace on a tier that supports Databricks Apps (check your workspace's Apps
  page and the Databricks documentation for current availability by cloud and tier).
- A SQL warehouse you can use. Its id is on the warehouse's Connection details tab. The app is
  granted `CAN USE` on it through the bundle's `sql-warehouse` resource.
- The [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install) (v0.250 or
  newer, for bundle app support).
- Node.js 24 LTS (22.19 or newer also works) and pnpm (the repository pins pnpm through `packageManager`).

## Deploy with the mock adapter

1. Authenticate: `databricks auth login --host https://<your-workspace-host>`.
2. From the repository root: `pnpm install --frozen-lockfile`.
3. Deploy: `WAREHOUSE_ID=<warehouse id> deploy/databricks-app/deploy.sh`. The script runs
   `pnpm package`, then `databricks bundle validate`, `deploy`, and `run orrery`. Set `TARGET` to
   use a target other than `dev`.
4. Open the app URL printed at the end (also under Compute, then Apps). The demo config
   (`config/demo.yaml`, all mock data) is used by default.

The package has no dependencies to install: the server is one bundled file, and Databricks Apps
runs `node server/main.mjs` as set in `app.yaml`.

## Switch to the Databricks adapter

1. Grant the app's service principal the access in [docs/databricks.md](../../docs/databricks.md)
   (`CAN USE` on the warehouse is already granted by the bundle; add `SELECT` on the system
   tables and `USE CATALOG` or `BROWSE` on the catalogs you want shown).
2. Write a config that uses the Databricks adapter, for example starting from
   `config/examples/three-env.yaml`. Reference the warehouse as `${env:ORRERY_WAREHOUSE_ID}`;
   `app.yaml` fills it from the `sql-warehouse` resource. Do not put tokens or secrets in the file.
3. Package with your config: `ORRERY_PACKAGE_CONFIG=path/to/orrery.yaml` makes `pnpm package`
   copy it to `config/orrery.yaml` in the package and point `ORRERY_CONFIG` at it in `app.yaml`
   (`deploy.sh` passes the variable through).
4. Redeploy with `deploy.sh`.
5. Optional, per-viewer permissions: uncomment `user_api_scopes: [sql]` in `databricks.yml` and
   set the environment's auth mode to `on-behalf-of-user` in the config.

Databricks Apps limits files to 10 MB each; `pnpm package` fails if the package exceeds that or
25 MB in total.
