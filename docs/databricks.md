# Databricks adapter

The adapter (`adapters/databricks`) runs only on the server. It reads Unity Catalog metadata and
system tables through a SQL warehouse with the SQL Statement Execution API, and never writes
anything. The browser receives JSON only and never a token.

## Configuration

```yaml
environments:
  - id: prod
    name: Production
    tier: prod
    topology: base
    adapter: databricks
    scope: { catalogs: ['prod_*', '*_prod'] } # or scope.tag: { env: prod }
    connection:
      host: ${env:ORRERY_PROD_HOST}
      warehouseId: ${env:ORRERY_PROD_WAREHOUSE}
      auth: app-service-principal # | on-behalf-of-user | oauth-m2m | pat
    federation:
      mode: single-workspace # | multi-workspace | multi-metastore
    options:
      sqlDir: config/private/sql # optional: override or add queries (see below)
      releaseTagKey: release # job tag that marks a release (default: release)
```

- **Release tag key precedence:** `promotion.tagKey` (only when `promotion.source` is `job-tag`),
  then `options.releaseTagKey`, then `release`.

- **Environment scope:** an environment owns the catalogs that match `scope.catalogs` globs
  (case-insensitive, with the environment tag at the start or the end) or carry every
  `scope.tag` tag. Spoke matchers then see the catalog name with the tag stripped, so `prod_sales`
  and `sales_prod` are both `sales`. If a catalog matches two environments, the health check fails
  and names both. Catalogs that no environment claims are listed in health as
  `unmatchedCatalogs`.
- **Federation modes:**
  - `single-workspace` uses one connection.
  - `multi-workspace` uses one connection too, because system tables span the metastore; the
    workspace id is a label.
  - `multi-metastore` queries each `federation.metastores[]` entry in parallel and merges the
    results by id. A metastore that fails is drawn as a dimmed region (`status: unavailable`)
    and the environment stays up.
- **Foreign catalogs** (Lakehouse Federation) are found through
  `information_schema.tables.table_type = 'FOREIGN'` and drawn as comets only when
  `federation.foreignCatalogs.show` is `true`; a missing block or `false` hides them. Reads of
  them are beams, never copies.

## Authentication

| `auth`                            | Token                                                                                                                                                           | Notes                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app-service-principal` (default) | OAuth client credentials with `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET` (injected by Databricks Apps), or `connection.clientId` / `clientSecret` refs | Cached and refreshed 60 s before expiry                                                                                                                                                          |
| `oauth-m2m`                       | OAuth client credentials from `connection.clientId` / `clientSecret`                                                                                            | For the standalone container                                                                                                                                                                     |
| `on-behalf-of-user`               | The viewer's `x-forwarded-access-token`                                                                                                                         | Trusted only behind the Databricks Apps proxy (`DATABRICKS_APP_PORT` set) or with `ORRERY_TRUST_FORWARDED_TOKEN=1`. Unity Catalog permissions apply per viewer, and caches are keyed per viewer. |
| `pat`                             | `connection.token` ref                                                                                                                                          | Local development only; logs a warning                                                                                                                                                           |

Secrets are accepted only as `${env:NAME}` references. Error messages and logs carry query
names and error codes, never SQL text, parameter values, or tokens.

## Permissions

The principal, whether the app's service principal or each viewer, needs:

- `USE CATALOG` / `USE SCHEMA` and `SELECT` on `system.lakeflow`, `system.access`,
  `system.query`, and `system.billing`. An account admin must enable these system schemas
  first.
- `USE CATALOG` on the catalogs in scope, so `information_schema` lists them.
- `CAN USE` on the SQL warehouse.
- Optional: `system.data_quality_monitoring` (Public Preview; account-admin-only by default) for
  the best freshness signal, and `system.lakeflow_pipeline_events_preview` (Beta) for
  ingest-gate pass and reject.

A missing or denied optional table moves health to `degraded`; the environment still renders. In
`on-behalf-of-user` mode these notes, and the row-limit notes, are kept per viewer (at most 1,000
viewers, least recently used dropped first), so one viewer's missing permissions never degrade
another viewer's health, and health reports the current viewer's notes only.

## Queries

Only the `.sql` files in `adapters/databricks/sql/` run, plus the files a fork registers in
`options.sqlDir`, where a same-named file replaces a shipped query. Each file must be a single
`SELECT`/`WITH` statement with bound `:name` parameters and a `-- Doc:` link to its source
page. A guard rejects anything else when the files load. Every execution has a row limit
(5,000 for lists, 50,000 for time windows) and a timeout of 30 s or less, with at most 4
statements in flight per environment.

| Query                                                                       | Source                                                    | Feeds                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `catalogs`, `catalog_tags`, `schemas`, `schema_tags`, `schema_tables`       | `information_schema`                                      | Scope, spokes, medallion tiers, planet size (products)               |
| `foreign_catalogs`                                                          | `information_schema.tables` (`FOREIGN`)                   | Comets                                                               |
| `pipelines`, `jobs`, `lineage_entities`                                     | `system.lakeflow`, `system.access.table_lineage`          | Planet size (pipelines), placement of pipelines and jobs into spokes |
| `table_freshness` → `job_runs` / `pipeline_updates` → `lineage_last_writes` | Data quality monitoring, then run timelines, then lineage | Freshness orbits, in that order of preference                        |
| `pipeline_updates`, `job_runs`, `lineage_writes`                            | `system.lakeflow`, `system.access`                        | Streams, batch pods, transfers, copies, gold products, ML, alerts    |
| `station_reads`                                                             | `system.query.history` joined to `table_lineage`          | Station reads, federated query beams                                 |
| `pipeline_expectations`                                                     | Pipeline events (Beta)                                    | Ingest gate pass and reject                                          |
| `job_changes`                                                               | `system.lakeflow.jobs` history                            | Deploys and the release calendar                                     |
| `billing_usage`                                                             | `system.billing.usage` × `list_prices`                    | Spend estimate (24 h average; billing lags up to 12 h)               |

Polling: topology hourly, freshness every 5 minutes, run timelines every 30 s. System tables lag
by up to about an hour, so live mode re-reads a 2-hour overlap and removes duplicates.

Late data: live mode holds back a "past target" freshness event whose time is newer than
`now - 60 min` (the ingestion lag, `INGESTION_LAG_MS`) and emits it on a later poll only if no run
refreshed the spoke in the meantime. Such an event can therefore arrive up to an hour after its
`ts`, out of order. Bounded `events(since, until)` replays hold nothing back: a window that ends
at or before `now - 60 min` is fully deterministic, while a window that touches the last hour
shows the rows present at query time, so a crossing in it can vanish from a later replay when a
late run arrives.

## Known limits

The full list is in `docs/decisions.md`, milestone 5:

- `sqlPredicate` matchers are not supported yet.
- `dashboardTag` cannot be resolved from documented system tables.
- The schedule is empty, because job trigger formats are unverified.
- Promotions are not detected yet.
- A live stream ends after 15 minutes, so a held crossing not yet released when it ends is
  reported only if the reconnecting client resumes from a `since` at or before its time.
- Volume is 0.

## Live smoke test

```sh
ORRERY_LIVE=1 ORRERY_CONFIG=config/private/orrery.config.yaml ORRERY_LIVE_ENV=prod \
  pnpm vitest run adapters/databricks/test/live.test.ts
```

It runs only with `ORRERY_LIVE=1` and credentials present. It checks that topology and
snapshot succeed and serialize to JSON, and it never prints secrets.
