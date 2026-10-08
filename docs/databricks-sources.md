# Databricks data sources reference

Research notes for the read-only Databricks adapter. Every entry was read from the official docs on 2026-10-07 (AWS paths; Azure/GCP differences noted only where material). Re-open each Doc URL before committing the matching `.sql` file, as the spec requires. Anything not confirmed is listed under "Unverified" at the end; no column below is invented.

Global facts (source: https://docs.databricks.com/aws/en/admin/system-tables/):

- Access: users holding both account admin and metastore admin have access by default. Everyone else needs `USE CATALOG` on `system`, plus `USE SCHEMA` and `SELECT` on each system schema. The metastore must be on Privilege Model Version 1.0, and the account needs at least one Unity Catalog workspace.
- "Regional" tables contain records from every workspace in the account that is in the same cloud region as the workspace you query from. "Global" tables are account-wide from any region.
- Timestamps in system tables are UTC.
- Typical ingestion latency is about 1 hour for lakeflow/query tables and up to 12 hours for `system.billing.usage`.

| Table                                                                       | Status           | Retention  | Scope                                                |
| --------------------------------------------------------------------------- | ---------------- | ---------- | ---------------------------------------------------- |
| system.lakeflow.jobs / job_tasks / job_run_timeline / job_task_run_timeline | not labeled (GA) | 365 d      | Regional                                             |
| system.lakeflow.pipelines / pipeline_update_timeline                        | Public Preview   | 365 d      | Regional                                             |
| system.lakeflow.zerobus_ingest / zerobus_stream                             | Beta             | 365 d      | Regional                                             |
| system.lakeflow_pipeline_events_preview.pipeline_events                     | Beta             | 13 months  | Regional                                             |
| system.access.table_lineage / column_lineage                                | not labeled      | 365 d      | Regional                                             |
| system.access.audit                                                         | Public Preview   | 365 d      | Regional (workspace events), Global (account events) |
| system.query.history                                                        | not labeled      | 365 d      | Regional                                             |
| system.billing.usage                                                        | not labeled      | 365 d      | Global                                               |
| system.billing.list_prices                                                  | not labeled      | indefinite | Global                                               |
| system.data_quality_monitoring.table_results                                | Public Preview   | 13 months  | Regional                                             |

---

## 1. system.lakeflow.jobs, job_tasks, job_run_timeline, job_task_run_timeline

Doc URL: https://docs.databricks.com/aws/en/admin/system-tables/jobs

Schema was formerly `system.workflow`; same content now under `system.lakeflow`. Tables: `system.lakeflow.jobs`, `system.lakeflow.job_tasks`, `system.lakeflow.job_run_timeline`, `system.lakeflow.job_task_run_timeline`.

`jobs` (SCD2; key `workspace_id, job_id`):

| Column                              | Type          | Meaning                                                                                   |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| workspace_id                        | string        | Workspace ID                                                                              |
| job_id                              | string        | Unique only within a workspace                                                            |
| name                                | string        | Job name                                                                                  |
| tags                                | map           | User-supplied custom tags (this is the only lakeflow table besides `pipelines` with tags) |
| change_time                         | timestamp     | Last modification (UTC); SCD2 ordering column                                             |
| delete_time                         | timestamp     | Deletion time (UTC)                                                                       |
| create_time                         | timestamp     | Creation time (UTC)                                                                       |
| creator_user_name, run_as_user_name | string        | Creator and run-as identity (not populated before early Dec 2025)                         |
| trigger_type, triggers              | string, array | Trigger config (not populated before early Dec 2025)                                      |
| paused                              | boolean       | Whether paused                                                                            |
| deployment                          | struct        | Deployment info for externally managed jobs                                               |

`job_tasks` (SCD2; key `workspace_id, job_id, task_key`): `task_key` string, `depends_on_keys` array, `change_time`, `delete_time`.

`job_run_timeline` (immutable, one row per time slice of a run):

| Column                             | Type      | Meaning                                                             |
| ---------------------------------- | --------- | ------------------------------------------------------------------- |
| workspace_id, job_id, run_id       | string    | Run key                                                             |
| period_start_time, period_end_time | timestamp | Slice bounds (UTC); availability is measured from `period_end_time` |
| trigger_type                       | string    | Trigger that fired the run                                          |
| run_type                           | string    | Run type                                                            |
| run_name                           | string    | User-supplied run name                                              |
| result_state                       | string    | Outcome; set only on the final slice, NULL on intermediate slices   |
| termination_code                   | string    | Set only on the final slice                                         |
| compute_ids                        | array     | Compute IDs used                                                    |
| job_parameters                     | map       | Job-level parameters                                                |

`job_task_run_timeline` (immutable): same shape, plus `job_run_id` (parent job run), `parent_run_id`, `task_key`, `task_parameters`; `run_id` here is the task run ID.

Values:

- `result_state` (job and task timelines): `SUCCEEDED`, `FAILED`, `SKIPPED`, `CANCELLED`, `TIMED_OUT`, `ERROR`, `BLOCKED`, or NULL for non-final slices.
- `termination_code` includes `SUCCESS`, `CANCELLED`, `SKIPPED`, `DRIVER_ERROR`, `CLUSTER_ERROR`, `RUN_EXECUTION_ERROR`, `STORAGE_ACCESS_ERROR`, `UNAUTHORIZED_ERROR`, `LIBRARY_INSTALLATION_ERROR`, `CLOUD_FAILURE`, and others (full list on the page).

Notes:

- Tags: only `jobs.tags` (map) exists. The timeline tables have no tags column, so release-tag matching ("deploys and promotions") must read `jobs.tags` and detect changes via the SCD2 history (`change_time`).
- Current job state: `QUALIFY ROW_NUMBER() OVER (PARTITION BY workspace_id, job_id ORDER BY change_time DESC) = 1`, THEN filter `delete_time IS NULL`. Filtering in the same step as the dedup returns the pre-deletion row.
- SCD2 tables keep the latest row per entity beyond 365 days; timelines are immutable and need no dedup.
- A run spans many slices. Aggregate by `(workspace_id, run_id)` and take the row where `result_state IS NOT NULL` for the final outcome; start = `MIN(period_start_time)`.
- The five `*_duration_seconds` columns on `job_run_timeline` are only meaningful for single-task legacy jobs (0 otherwise); use task timelines.
- `job_id` is unique only per workspace; always key on `(workspace_id, job_id)`.
- Regional scope: results cover all workspaces of the account in the queried workspace's region.

## 2. system.lakeflow.pipelines, pipeline_update_timeline

Doc URL: https://docs.databricks.com/aws/en/admin/system-tables/jobs (same page as section 1)

Both tables exist and are Public Preview (365 d, regional).

`pipelines` (SCD2; key `workspace_id, pipeline_id`):

| Column                    | Type      | Meaning                                                                                           |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| workspace_id, pipeline_id | string    | Key; ID unique within a workspace                                                                 |
| pipeline_type             | string    | `ETL_PIPELINE`, `MATERIALIZED_VIEW`, `STREAMING_TABLE`, `INGESTION_PIPELINE`, `INGESTION_GATEWAY` |
| name                      | string    | Pipeline name                                                                                     |
| created_by, run_as        | string    | Identities                                                                                        |
| tags                      | map       | User-supplied tags                                                                                |
| settings                  | struct    | Keys include `photon`, `development`, `continuous`, `serverless`, `edition`, `channel`            |
| configuration             | map       | User-supplied configuration                                                                       |
| change_time, delete_time  | timestamp | SCD2 columns (UTC)                                                                                |
| create_time               | timestamp | Not populated before early Dec 2025                                                               |

`pipeline_update_timeline` (immutable, slices):

| Column                                    | Type      | Meaning                                                                                                                                                                                                  |
| ----------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace_id, pipeline_id, update_id      | string    | Update key (`update_id` unique within a workspace)                                                                                                                                                       |
| update_type                               | string    | `FULL_REFRESH`, `REFRESH`, `VALIDATE`                                                                                                                                                                    |
| trigger_type                              | string    | `API_CALL`, `RETRY_ON_FAILURE`, `SERVICE_UPGRADE`, `SCHEMA_CHANGE`, `JOB_TASK`, `USER_ACTION`, `DBSQL_REQUEST`, `SETTINGS_CHANGE`, `SCHEMA_EXPLORATION`, `INFRASTRUCTURE_MAINTENANCE`, `START_RESOURCES` |
| trigger_details                           | struct    | For `JOB_TASK`: `job_task.job_id`, `job_task.job_task_run_id`                                                                                                                                            |
| result_state                              | string    | `COMPLETED`, `FAILED`, `CANCELED`; set only on the final slice                                                                                                                                           |
| period_start_time, period_end_time        | timestamp | Slice bounds (UTC)                                                                                                                                                                                       |
| refresh_selection, full_refresh_selection | array     | Tables refreshed                                                                                                                                                                                         |
| request_id                                | string    | Shows retries/restarts                                                                                                                                                                                   |

Notes:

- Same dedup rule as jobs for `pipelines` (partition by `workspace_id, pipeline_id`, order by `change_time DESC`, then `delete_time IS NULL`).
- Per-flow update state (running/idle/failed per flow) is NOT in these tables; it lives in the pipeline event log (section 9).
- Pipeline owner is `run_as`, which may be a user, service principal, or group name.

## 3. system.lakeflow.zerobus_ingest (and zerobus_stream)

Doc URL: https://docs.databricks.com/aws/en/admin/system-tables/zerobus-ingest

Exists. Beta, 365 d, regional, supports streaming. Records data ingested into Delta tables through Zerobus Ingest (direct record-push ingestion). It is not record-level: each row aggregates one Delta commit (`commit_version`).

`system.lakeflow.zerobus_ingest`:

| Column                             | Type      | Meaning                                                                      |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------- |
| workspace_id                       | string    | Workspace of the stream                                                      |
| stream_id                          | string    | Stream that performed the ingest                                             |
| commit_version                     | bigint    | Delta commit version                                                         |
| table_id, table_name               | string    | Target table (name is fully qualified)                                       |
| commit_time                        | timestamp | Commit time                                                                  |
| committed_bytes, committed_records | bigint    | Size and record count                                                        |
| tags                               | array     | Custom tags from Zerobus Ingest                                              |
| errors                             | array     | Elements: `error_code` bigint, `error_message` string, `timestamp` timestamp |

`system.lakeflow.zerobus_stream` (lifecycle): `stream_id`, `event_time`, `opened_time`, `closed_time`, `table_id`, `table_name`, `protocol` (`GRPC`/`HTTP`), `data_format` (`PROTOBUF`/`JSON`), `errors` array. `producer_id` is documented as not currently supported. Join the two on `stream_id`.

Notes:

- Beta: schema may change; treat the adapter query as best-effort and tolerate the table being missing or inaccessible (degrade to "no streams").
- Billed under the Jobs Serverless SKU (usage with `billing_origin_product = 'LAKEFLOW_CONNECT'`).

## 4. system.access.table_lineage and column_lineage

Doc URL: https://docs.databricks.com/aws/en/admin/system-tables/lineage

365 d rolling window, regional. The `system.access` schema must be enabled first (see Unverified for how). Latency is not documented on the page.

| Column                                                                               | Type      | Meaning                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace_id, metastore_id                                                           | string    | Scope                                                                                                                                                                                   |
| entity_type                                                                          | string    | `NOTEBOOK`, `JOB`, `PIPELINE`, `DASHBOARD_V3`, `DBSQL_DASHBOARD` (deprecated), `DBSQL_QUERY`, or NULL                                                                                   |
| entity_id, entity_run_id                                                             | string    | Entity and its run; NULL if none                                                                                                                                                        |
| entity_metadata                                                                      | struct    | `job_info.{job_id,job_run_id}`, `dlt_pipeline_info.{dlt_pipeline_id,dlt_update_id}`, `notebook_id`, `dashboard_id`, `legacy_dashboard_id`, `sql_query_id`, `genie_space_id`, `alert_id` |
| source_table_full_name, source_table_catalog, source_table_schema, source_table_name | string    | Source (three-part)                                                                                                                                                                     |
| source_path, source_type                                                             | string    | `source_type`: `TABLE`, `PATH`, `VIEW`, `MATERIALIZED_VIEW`, `METRIC_VIEW`, `STREAMING_TABLE`                                                                                           |
| target_table_full_name, target_table_catalog, target_table_schema, target_table_name | string    | Target (three-part)                                                                                                                                                                     |
| target_path, target_type                                                             | string    | Same `target_type` values                                                                                                                                                               |
| created_by                                                                           | string    | User, service principal, group, "System-User", or NULL                                                                                                                                  |
| event_time                                                                           | timestamp | When lineage was generated (UTC)                                                                                                                                                        |
| event_date                                                                           | date      | Partition column: filter on it                                                                                                                                                          |
| statement_id                                                                         | string    | Joins to `system.query.history.statement_id` (SQL warehouse/serverless runs only)                                                                                                       |
| direct_access                                                                        | boolean   | false = intermediate dependency from view expansion                                                                                                                                     |

`column_lineage` has the same columns plus `source_column_name` and `target_column_name`.

Notes:

- Read-only event: `source_type` set, `target_type` NULL. Write-only: reverse. Read+write: both set. A copy between spokes is a row with both source and target catalog set.
- Only a subset of events is captured (lineage is recorded only when inferable; only for Lakeflow pipelines, notebooks, jobs, SQL queries, dashboards, Genie spaces, alerts). Absence is not proof of no activity.
- Column lineage omits events with no source (for example INSERT of literals).
- External tables referenced by path appear with `*_path` and no table name.
- `record_id` and `event_id` are not joinable to other tables.
- Filter `event_date` plus `event_time` for partition pruning.

## 5. system.access.audit and system.query.history

### system.access.audit

Doc URL: https://docs.databricks.com/aws/en/admin/system-tables/audit-logs (also https://docs.databricks.com/aws/en/admin/account-settings/audit-logs for event names)

Public Preview, 365 d, regional for workspace events, global for account events (`workspace_id = 0`).

| Column                                                                       | Type      | Meaning                                                                                                                                         |
| ---------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace_id                                                                 | string    | 0 for account-level events                                                                                                                      |
| event_time                                                                   | timestamp | UTC                                                                                                                                             |
| event_date                                                                   | date      | Filter on this for performance                                                                                                                  |
| service_name, action_name                                                    | string    | Event identity (example: `unityCatalog` / `getTable`)                                                                                           |
| user_identity                                                                | struct    | Actor (`email` inside; field list not captured)                                                                                                 |
| request_params                                                               | map       | Parameters; `function_info`, `view_definition`, `definition_json`, `managed_definition` omitted unless account admin or `databricks_pii_access` |
| response                                                                     | struct    | Status                                                                                                                                          |
| identity_metadata                                                            | struct    | `run_by`, `run_as`, `acting_resource`, etc.                                                                                                     |
| source_ip_address, user_agent, session_id, request_id, event_id, audit_level | misc      | Context                                                                                                                                         |

Notes:

- The docs do not enumerate Unity Catalog read action names on these pages; only `unityCatalog`/`getTable` is shown. Dashboard/Genie query events: `executeQuery`, `getQueryResult` (service `dashboards`, `aibiGenie`). SQL warehouse query events (`databrickssql`/`commandSubmit`) were NOT found in the pages read.
- Audit volume is high (every API call). Always bound by `event_date` and `service_name`/`action_name`, aggregate in SQL, and cap rows.
- Recommendation: use `system.query.history` joined to `table_lineage` (by `statement_id`) as the primary "station reads" source; use audit only as an optional supplement.
- Needs the audit schema enabled; reading is admin-oriented in practice.

### system.query.history

Doc URL: https://docs.databricks.com/aws/en/admin/system-tables/query-history

Not labeled preview, 365 d (overview table), regional. Default access: admins only. `statement_text` returns `<REDACTED>` unless account admin or in `databricks_pii_access`.

| Column                                                            | Type      | Meaning                                                                                                                          |
| ----------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| workspace_id, statement_id, session_id                            | string    | Keys; `statement_id` joins lineage                                                                                               |
| statement_type                                                    | string    | e.g. SELECT, INSERT, COPY, ALTER                                                                                                 |
| execution_status                                                  | string    | Status (values not captured)                                                                                                     |
| executed_by, executed_by_user_id                                  | string    | Email/username and ID of the user                                                                                                |
| executed_as, executed_as_user_id                                  | string    | Identity executed as                                                                                                             |
| client_application                                                | string    | e.g. SQL editor, Tableau, Power BI; derived from client info, values not stable                                                  |
| compute                                                           | struct    | `type` (`WAREHOUSE`, `SERVERLESS_COMPUTE`, `CLASSIC_COMPUTE`), `warehouse_id` (only for WAREHOUSE); `cluster_id` never populated |
| start_time, end_time                                              | timestamp | UTC; `start_time` is when the request was received; `end_time` excludes result fetch                                             |
| total_duration_ms, execution_duration_ms                          | bigint    | Timings                                                                                                                          |
| read_rows, read_bytes, read_files, read_partitions, written_bytes | bigint    | I/O                                                                                                                              |
| query_source                                                      | struct    | Originating entity (field list not captured)                                                                                     |
| query_tags                                                        | map       | Tags (type not captured)                                                                                                         |
| statement_text                                                    | string    | Redacted for most users                                                                                                          |

Notes:

- There is NO "tables read" column. Which tables a statement read comes from `system.access.table_lineage` joined on `statement_id` (source_* columns), or by parsing `statement_text` (redacted; avoid).
- Records typically appear within about 1 hour (CMK workspaces: up to 24 h).

## 6. system.billing.usage and system.billing.list_prices

Doc URLs: https://docs.databricks.com/aws/en/admin/system-tables/billing and https://docs.databricks.com/aws/en/admin/system-tables/pricing

`usage`: global (all regions visible from any workspace), 365 d, records typically available within 12 hours.

| Column                           | Type      | Meaning                                                                                                                                                  |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_id                        | string    | Unique ID                                                                                                                                                |
| workspace_id                     | string    | Workspace                                                                                                                                                |
| sku_name, cloud, usage_unit      | string    | Join keys to list_prices                                                                                                                                 |
| usage_start_time, usage_end_time | timestamp | UTC                                                                                                                                                      |
| usage_date                       | date      | Daily aggregation / partition-friendly filter                                                                                                            |
| usage_quantity                   | decimal   | Units consumed                                                                                                                                           |
| usage_type                       | string    | `COMPUTE_TIME`, `STORAGE_SPACE`, `NETWORK_BYTE`, `NETWORK_HOUR`, `API_OPERATION`, `TOKEN`, `GPU_TIME`, `ANSWER`                                          |
| billing_origin_product           | string    | e.g. `JOBS`, `SQL`, `DLT`                                                                                                                                |
| usage_metadata                   | struct    | Strings: `job_id`, `job_run_id`, `dlt_pipeline_id`, `dlt_update_id`, `warehouse_id`, `cluster_id`, `notebook_id`, `app_id`, and more; sparsely populated |
| identity_metadata                | struct    | `run_as`, `owned_by`, `created_by`                                                                                                                       |
| custom_tags                      | map       | Tags on the record                                                                                                                                       |
| record_type                      | string    | `ORIGINAL`, `RETRACTION`, `RESTATEMENT`                                                                                                                  |
| product_features                 | struct    | `is_serverless`, `is_photon`, `jobs_tier`, `sql_tier`, `dlt_tier`, etc.                                                                                  |

`list_prices`: global, indefinite retention.

| Column                                     | Type      | Meaning                                                                                                              |
| ------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------- |
| sku_name, cloud, usage_unit, currency_code | string    | Join keys / currency                                                                                                 |
| price_start_time                           | timestamp | When price took effect (UTC)                                                                                         |
| price_end_time                             | timestamp | When it stopped (NULL for the current price is likely but not stated; see Unverified)                                |
| pricing                                    | struct    | `default` (single price), `promotional`, `effective_list` (list + promo resolved, used for cost); more keys possible |

Notes:

- Corrections: a RETRACTION has negated `usage_quantity`; a RESTATEMENT has corrected values. Always `SUM(usage_quantity)` grouped by the dimension columns, never filter to `ORIGINAL` only.
- Join pattern: usage `sku_name = list_prices.sku_name AND cloud = cloud AND usage_unit = usage_unit AND usage_end_time >= price_start_time AND (price_end_time IS NULL OR usage_end_time < price_end_time)`. Cost = `usage_quantity * pricing.default`. The page documents no official join example; the join above is derived from the documented columns.
- `list_prices` only gets a row when a price changes, hence the time-range join.
- List price is not the customer's negotiated price: label as an estimate.
- Several products share a SKU; separate with `billing_origin_product` and `product_features`.

## 7. Unity Catalog metadata (information_schema, sharing, federation)

Doc URLs:

- Overview: https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-information-schema
- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/catalogs
- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/schemata
- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/tables
- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/table_tags
- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/shares
- https://docs.databricks.com/aws/en/sql/language-manual/sql-ref-syntax-aux-show-shares

Scope: `system.information_schema` covers all catalogs in the metastore (not `hive_metastore`); each catalog also has its own `information_schema`. Rows are limited to objects the caller has privileges on; no explicit SELECT grant is required. It is metastore-scoped, not region-scoped (but only shows catalogs bound to the current workspace).

`catalogs`: `CATALOG_NAME`, `CATALOG_OWNER`, `COMMENT`, `CREATED` timestamp, `CREATED_BY`, `LAST_ALTERED` timestamp, `LAST_ALTERED_BY`. The reference page lists NO `catalog_type` column. See Unverified; fallback is `DESCRIBE CATALOG EXTENDED <name>`, which shows a "Catalog Type" field (examples show "Regular" and "Delta Sharing").

`schemata`: `CATALOG_NAME`, `SCHEMA_NAME`, `SCHEMA_OWNER`, `COMMENT`, `CREATED`, `CREATED_BY`, `LAST_ALTERED`, `LAST_ALTERED_BY`.

`tables`: `TABLE_CATALOG`, `TABLE_SCHEMA`, `TABLE_NAME` (primary key), `TABLE_TYPE` (`VIEW`, `FOREIGN`, `MANAGED`, `STREAMING_TABLE`, `MATERIALIZED_VIEW`, `EXTERNAL`, `MANAGED_SHALLOW_CLONE`, `EXTERNAL_SHALLOW_CLONE`), `TABLE_OWNER`, `COMMENT`, `CREATED`, `CREATED_BY`, `LAST_ALTERED` timestamp, `LAST_ALTERED_BY`, `DATA_SOURCE_FORMAT`, `STORAGE_PATH`.

`catalog_tags`, `schema_tags`: listed in the information schema overview, but column pages were not fetched. By analogy `table_tags` is documented as: `CATALOG_NAME`, `SCHEMA_NAME`, `TABLE_NAME`, `TAG_NAME`, `TAG_VALUE` (all STRING). Treat the `catalog_tags` / `schema_tags` column lists as Unverified until their pages are read.

`shares`: `SHARE_NAME`, `SHARE_OWNER`, `COMMENT`, `CREATED`, `CREATED_BY`, `LAST_ALTERED`, `LAST_ALTERED_BY`. `recipients`, `providers`, `share_recipient_privileges`, `catalog_provider_share_usage`, `connections` exist per the overview; their columns are Unverified.

SQL commands that are read-only and listable: `SHOW SHARES [LIKE pattern]` returns `name`, `created_at`, `created_by`, `comment`; `SHOW ALL IN SHARE <name>` lists share contents. `SHOW CATALOGS`, `SHOW RECIPIENTS`, `SHOW PROVIDERS`, `SHOW CONNECTIONS` exist but their output columns were not verified.

Notes:

- `tables.last_altered` is "when the definition was last changed in any way". It is a metadata-change time, not necessarily a data-write time; for a Delta table, whether data commits bump it is not documented. Do not treat it as a data-freshness signal without verifying (see section 8).
- Foreign tables from Lakehouse Federation show `TABLE_TYPE = 'FOREIGN'`; foreign catalogs themselves are identified either by `DESCRIBE CATALOG EXTENDED` or by the connection; the docs do not give a SELECT-able catalog-type column.
- Metastore admin requirement for listing shares/recipients/providers: NOT documented on the pages read. The pages say results are limited to objects the caller can interact with. Plan for partial results with a non-admin service principal.
- All of these are cheap metadata queries; they do not require a warehouse beyond running the statement.

## 8. Data quality monitoring (anomaly detection) and freshness fallback

Doc URLs:

- https://docs.databricks.com/aws/en/admin/system-tables/data-quality-monitoring
- Feature overview: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/anomaly-detection/

Table `system.data_quality_monitoring.table_results`: Public Preview, 13 months, regional. By default only account admins can read it (grant explicitly; contains sample values). Monitoring must be enabled per schema (Schema details tab, Data Quality Monitoring, Enable; up to 50 schemas at once from the catalog Details tab); tables in non-enabled schemas have no rows.

| Column                                | Type      | Meaning                                                                                                                            |
| ------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| event_time                            | timestamp | Row generation time (UTC)                                                                                                          |
| catalog_name, schema_name, table_name | string    | Table identity                                                                                                                     |
| catalog_id, schema_id, table_id       | string    | Stable IDs                                                                                                                         |
| status                                | string    | Table roll-up: `Healthy`, `Unhealthy`, `Unknown`                                                                                   |
| freshness                             | struct    | `status`; `commit_freshness.{status, error_code, last_value timestamp (last commit), predicted_value timestamp (expected update)}` |
| completeness                          | struct    | `status`                                                                                                                           |
| total_row_count, daily_row_count      | struct    | `status`, `error_code`, `last_value`, `min_predicted_value`, `max_predicted_value` (ints)                                          |

Notes:

- Append-only history; get the current state per table with `QUALIFY ROW_NUMBER() OVER (PARTITION BY table_id ORDER BY event_time DESC) = 1` (the official example does the same).
- Freshness is based on commit history: stale when the next commit is unusually late. Completeness is rows committed in the last 24 h versus the predicted lower bound.
- The reference page also lists `downstream_impact` (Beta) and `root_cause_analysis` (`upstream_jobs`); those were described in search results, not confirmed from the page body. Not needed.
- Fallbacks when this table is empty or unreadable (all SELECT-able):
  1. Last write per table from `system.access.table_lineage`: `MAX(event_time)` where `target_table_full_name = X` (only captures writes by tracked entities).
  2. `system.lakeflow.zerobus_ingest.commit_time` for Zerobus-fed tables.
  3. `system.information_schema.tables.last_altered` (metadata changes; verify it moves on data commits before relying on it).
  4. `system.storage.predictive_optimization_operations_history` is listed in the system tables index but was not read; do not use.
- `DESCRIBE HISTORY` is the exact write log but is not a SELECT; the spec's SELECT-only rule excludes it. The `table_changes()` and `delta_table history` alternatives were not evaluated.

## 9. Pipeline expectations (ingest gate pass/reject)

Doc URLs:

- https://docs.databricks.com/aws/en/sql/language-manual/functions/event_log
- https://docs.databricks.com/aws/en/ldp/monitor-event-log-schema
- https://docs.databricks.com/aws/en/ldp/expectations
- System-table form (Beta): https://docs.databricks.com/aws/en/admin/system-tables/pipeline-events

SELECT-able via the `event_log` table-valued function: `SELECT * FROM event_log(<pipeline_id>)` or `event_log(TABLE(<catalog.schema.table>))`. Supported on Databricks SQL and DBR 13.3 LTS+.

Event columns: `id`, `sequence`, `origin`, `timestamp` (UTC), `message`, `level` (`INFO`, `WARN`, `ERROR`, `METRICS`), `maturity_level`, `error`, `details` (JSON string, shape depends on `event_type`), `event_type`.

- `event_type` values include `create_update`, `update_progress`, `flow_progress`, `flow_definition`, `dataset_definition`, `user_action`.
- `flow_progress.status`: `QUEUED`, `STARTING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, `STOPPED`, `IDLE`, `EXCLUDED`.
- `update_progress.state`: `QUEUED`, `CREATED`, `WAITING_FOR_RESOURCES`, `INITIALIZING`, `RESETTING`, `SETTING_UP_TABLES`, `RUNNING`, `STOPPING`, `COMPLETED`, `FAILED`, `CANCELED`.
- Expectation metrics: `details:flow_progress.data_quality` has `dropped_records` and `expectations[]` with `name`, `dataset`, `passed_records`, `failed_records`.

Gotchas:

- Only the OWNER of the streaming table / materialized view can call `event_log()`; a view over it is owner-only and cannot be shared. For a service principal this means the SP must own the pipeline, or the adapter must use the system table below. This is a significant limitation for a generic read-only adapter.
- It needs one call per pipeline ID (no cross-pipeline scan), so enumerate pipelines from `system.lakeflow.pipelines` and cap the count.
- `failed_records` does not say whether records were warned, dropped, or failed the update. A COMPLETED flow may carry no metrics; metrics can instead arrive per micro-batch on `RUNNING` events, so include RUNNING events.
- Metrics are reported for any violation policy (warn/drop/fail).
- Alternative: `system.lakeflow_pipeline_events_preview.pipeline_events` (Beta, 13 months, regional) with columns `account_id`, `workspace_id`, `pipeline_id`, `update_id`, `pipeline_event_id`, `event_type`, `origin` (struct), `message`, `level`, `maturity_level`, `error` (struct), `details` (VARIANT), `event_time`; append-only. It will move to the `lakeflow` schema at GA, so queries will need updating. This avoids the owner-only restriction but access depends on system schema grants.

## 10. SQL Statement Execution API

Doc URLs:

- https://docs.databricks.com/api/workspace/statementexecution/executestatement
- https://docs.databricks.com/aws/en/dev-tools/sql-execution-tutorial

Endpoints (base: workspace URL):

| Method | Path                                                                 | Use                   |
| ------ | -------------------------------------------------------------------- | --------------------- |
| POST   | `/api/2.0/sql/statements/`                                           | Execute               |
| GET    | `/api/2.0/sql/statements/{statement_id}`                             | Status / first result |
| GET    | `/api/2.0/sql/statements/{statement_id}/result/chunks/{chunk_index}` | Fetch a chunk         |
| POST   | `/api/2.0/sql/statements/{statement_id}/cancel`                      | Cancel                |

Request body:

| Field                 | Notes                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| warehouse_id          | Required                                                                                                            |
| statement             | Required; up to 16 MiB                                                                                              |
| parameters            | Array of `{name, value, type}`; `type` defaults to `STRING`; named markers `:name` only, positional `?` unsupported |
| catalog, schema       | Optional defaults                                                                                                   |
| wait_timeout          | Default `10s`; `0s` = async; otherwise 5s to 50s                                                                    |
| on_wait_timeout       | `CONTINUE` (default) or `CANCEL`                                                                                    |
| row_limit, byte_limit | Caps; `manifest.truncated = true` if hit                                                                            |
| disposition           | `INLINE` (default) or `EXTERNAL_LINKS`                                                                              |
| format                | `JSON_ARRAY` (default; the only INLINE format), `ARROW_STREAM`, `CSV`                                               |
| query_tags            | Up to 20 key/value tags                                                                                             |

Response (`StatementResponse`):

- `statement_id`; `status.state` in `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELED`, `CLOSED`.
- `status.error`: `{error_code, message}` (`sql_state` populated when FAILED). The top-level HTTP error shape is not described on the pages read.
- `manifest`: `format`, `schema.columns[]` (`name`, `position`, `type_name`, `type_text`, `precision`/`scale` for decimals), `total_chunk_count`, `chunks`, `total_row_count`, `total_byte_count`, `truncated`.
- `result`: `data_array` (array of arrays of strings or null for JSON_ARRAY inline), `chunk_index`, `row_offset`, `row_count`, `byte_count`, `next_chunk_index`, `next_chunk_internal_link`; `external_links[]` with `external_link` and `expiration` for EXTERNAL_LINKS. Absence of `next_chunk_*` means last chunk.

Limits and behavior:

- INLINE results over 25 MiB fail (statement aborted, no result). EXTERNAL_LINKS up to 100 GiB, 15-minute presigned URLs; do not send an `Authorization` header to them.
- A statement in a terminal state is retained for at least 12 hours, then returns 404. After the last chunk of a fetch the statement can be closed.
- Only the user who ran a statement can fetch its results.
- Caller needs Databricks SQL entitlement, CAN USE on the warehouse, and UC privileges on the data.
- Cell values arrive as strings (JSON_ARRAY); convert using `manifest.schema.columns[].type_name`.
- Adapter guidance: set `wait_timeout` to 30s to 50s, poll `GET` while `PENDING`/`RUNNING`, `POST cancel` on abort, always use named parameters, always send `row_limit`.

## 11. Authentication

Doc URLs:

- OAuth M2M: https://docs.databricks.com/aws/en/dev-tools/auth/oauth-m2m
- Apps authorization: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth
- Apps headers: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/http-headers

OAuth machine-to-machine (service principal):

- Workspace token endpoint: `POST https://<workspace-host>/oidc/v1/token`. Account endpoint: `https://accounts.cloud.databricks.com/oidc/accounts/<account-id>/v1/token`.
- Body (form): `grant_type=client_credentials`, `scope=all-apis`; HTTP Basic auth with client ID as user and OAuth secret as password.
- Response: `access_token`, `token_type` = `Bearer`, `expires_in` = 3600 (1 hour). Re-request on expiry; cache with a safety margin (for example refresh at 50 minutes).
- SDK environment variables: `DATABRICKS_HOST` (no `/api` suffix), `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`. Unset `DATABRICKS_TOKEN`.
- Personal access tokens: sent as `Authorization: Bearer <token>`. The statement execution page recommends OAuth, or PATs tied to service principals, for automation. PAT docs page was not fetched.

Databricks Apps:

- App authorization: each app gets its own service principal, created and deleted with the app. Injected env: `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_HOST` (listed on the environment page), plus `DATABRICKS_APP_NAME`, `DATABRICKS_WORKSPACE_ID`, `DATABRICKS_APP_PORT`.
- User authorization (on-behalf-of): the user's token arrives in the `x-forwarded-access-token` request header (stated on the auth page; NOT in the separate headers page's list). UC policies, row filters, and column masks then apply to the user.
- Other forwarded headers: `X-Forwarded-Host`, `X-Forwarded-Preferred-Username`, `X-Forwarded-User`, `X-Forwarded-Email`, `X-Real-Ip`, `X-Request-Id`. They exist only inside Databricks Apps; simulate them locally.
- Scopes: user authorization is limited by configured scopes (examples: `sql`, `genie`, `files`, `model-serving`, `vector-search`). With none set, only `iam.access-control:read` and `iam.current-user:read` apply, which grant no data access. To run SQL, add `sql`.
- Limitations: the forwarded token is scoped to the workspace the app runs in (cross-workspace warehouse needs M2M instead, losing per-user enforcement); scopes block anything outside them even if the user has permission; scopes can only be removed before updating if the workspace disallows them. Preview status of user authorization is not stated on the page.
- Warehouse access: add the SQL warehouse as an app resource with CAN USE for the app service principal; expose its ID with `env: - name: ... valueFrom: sql-warehouse` (default resource key `sql-warehouse`; exact `valueFrom` resolution is on a separate page not read).

## 12. Databricks Apps runtime and bundle

Doc URLs:

- https://docs.databricks.com/aws/en/dev-tools/databricks-apps/app-runtime
- https://docs.databricks.com/aws/en/dev-tools/databricks-apps/system-env
- https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources
- https://docs.databricks.com/aws/en/dev-tools/bundles/resources (apps resource)

- `app.yaml` (or `.yml`) lives at the project root. `command` is an optional list (not run in a shell, so outer env vars are unavailable); `env` is a list of `{name, value}` or `{name, valueFrom}`. `DATABRICKS_APP_PORT` is substituted into `command` at runtime. Default for Node.js apps without a command is `npm run start`.
- Port: the app must listen on `DATABRICKS_APP_PORT` (Dash/Express frameworks also get `PORT` set to the same value). Bind to `0.0.0.0`.
- Node.js 22.16 reported by search summary of the environment page (not directly confirmed on the fetched excerpt); dependencies come from `package.json` (npm or pnpm), nothing pre-installed, installed at deploy so `node_modules` need not be uploaded.
- Source file size limit: 10 MB per file (develop-apps page, via search summary); an oversized file in the app directory fails deployment. Total-size limit not confirmed. Apps per workspace: 100 on AWS (limits page; GCP page says 50).
- Bundle (`databricks.yml`) apps resource: `resources.apps.<key>` with `name` (lowercase letters, digits, hyphens), `source_code_path`, `description`, `config.command`, `config.env` (override `app.yaml`), `resources` (list with `sql_warehouse: {id, permission: CAN_USE|CAN_MANAGE|IS_OWNER}`), `user_api_scopes`. Other keys exist (`permissions`, `lifecycle`, `compute_size`, `git_source`).

---

## Suggested queries

Each uses named parameters (`:since`, `:until`, `:catalog_pattern`) and a LIMIT. Pass `:since`/`:until` as `TIMESTAMP` parameters, and `:catalog_pattern` as a `STRING` (SQL `LIKE` pattern). Place the doc URL in a comment at the top of the matching `.sql` file.

**Hub, spokes, tiers (catalog/schema/tag listing)**

```sql
-- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/schemata
SELECT s.catalog_name, s.schema_name, s.schema_owner, s.created, s.last_altered
FROM system.information_schema.schemata s
WHERE s.catalog_name LIKE :catalog_pattern
ORDER BY s.catalog_name, s.schema_name
LIMIT 5000;
```

```sql
-- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/table_tags
SELECT catalog_name, schema_name, table_name, tag_name, tag_value
FROM system.information_schema.table_tags
WHERE catalog_name LIKE :catalog_pattern
LIMIT 20000;
```

**Source streams and batch pods (job runs, final state per run)**

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/jobs
SELECT workspace_id, job_id, run_id,
       MIN(period_start_time) AS started_at,
       MAX(period_end_time) AS ended_at,
       MAX_BY(result_state, period_end_time) FILTER (WHERE result_state IS NOT NULL) AS result_state
FROM system.lakeflow.job_run_timeline
WHERE period_end_time >= :since AND period_start_time < :until
GROUP BY workspace_id, job_id, run_id
LIMIT 10000;
```

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/jobs
SELECT workspace_id, pipeline_id, update_id, update_type, trigger_type,
       MIN(period_start_time) AS started_at,
       MAX(period_end_time) AS ended_at,
       MAX_BY(result_state, period_end_time) FILTER (WHERE result_state IS NOT NULL) AS result_state
FROM system.lakeflow.pipeline_update_timeline
WHERE period_end_time >= :since AND period_start_time < :until
GROUP BY workspace_id, pipeline_id, update_id, update_type, trigger_type
LIMIT 10000;
```

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/zerobus-ingest
SELECT table_name, DATE_TRUNC('HOUR', commit_time) AS hour,
       SUM(committed_records) AS records, SUM(committed_bytes) AS bytes, COUNT(*) AS commits
FROM system.lakeflow.zerobus_ingest
WHERE commit_time >= :since AND commit_time < :until
GROUP BY table_name, DATE_TRUNC('HOUR', commit_time)
LIMIT 10000;
```

**Planet size by pipelines (current jobs and pipelines)**

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/jobs
WITH latest AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY workspace_id, job_id ORDER BY change_time DESC) AS rn
  FROM system.lakeflow.jobs
)
SELECT workspace_id, job_id, name, tags, change_time
FROM latest
WHERE rn = 1 AND delete_time IS NULL
LIMIT 20000;
```

Dedup first, then filter `delete_time IS NULL` (never in the same step). Pipelines:

```sql
WITH latest AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY workspace_id, pipeline_id ORDER BY change_time DESC) AS rn
  FROM system.lakeflow.pipelines
)
SELECT workspace_id, pipeline_id, name, pipeline_type, tags, change_time
FROM latest
WHERE rn = 1 AND delete_time IS NULL
LIMIT 20000;
```

**Copies out and products returning (lineage edges)**

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/lineage
SELECT source_table_catalog, target_table_catalog,
       entity_type, COUNT(*) AS events, MAX(event_time) AS last_event
FROM system.access.table_lineage
WHERE event_date >= CAST(:since AS DATE) AND event_time >= :since AND event_time < :until
  AND source_table_catalog IS NOT NULL AND target_table_catalog IS NOT NULL
  AND source_table_catalog <> target_table_catalog
  AND (source_table_catalog LIKE :catalog_pattern OR target_table_catalog LIKE :catalog_pattern)
GROUP BY source_table_catalog, target_table_catalog, entity_type
LIMIT 5000;
```

**Freshness orbit (anomaly detection, with lineage fallback)**

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/data-quality-monitoring
SELECT catalog_name, schema_name, table_name, status,
       freshness.status AS freshness_status,
       freshness.commit_freshness.last_value AS last_commit,
       freshness.commit_freshness.predicted_value AS expected_commit,
       event_time
FROM system.data_quality_monitoring.table_results
WHERE catalog_name LIKE :catalog_pattern AND event_time >= :since
QUALIFY ROW_NUMBER() OVER (PARTITION BY table_id ORDER BY event_time DESC) = 1
LIMIT 10000;
```

```sql
-- Fallback: last tracked write per table. https://docs.databricks.com/aws/en/admin/system-tables/lineage
SELECT target_table_full_name, MAX(event_time) AS last_write
FROM system.access.table_lineage
WHERE event_date >= CAST(:since AS DATE) AND event_time >= :since AND event_time < :until
  AND target_table_full_name IS NOT NULL AND target_table_catalog LIKE :catalog_pattern
GROUP BY target_table_full_name
LIMIT 10000;
```

**Ingest gate pass and reject (per pipeline; owner-only caveat applies)**

```sql
-- https://docs.databricks.com/aws/en/sql/language-manual/functions/event_log
-- :pipeline_id is an additional STRING parameter (one call per pipeline).
WITH exp AS (
  SELECT timestamp,
         explode(from_json(details:flow_progress.data_quality.expectations,
           'array<struct<name:string,dataset:string,passed_records:bigint,failed_records:bigint>>')) AS e
  FROM event_log(:pipeline_id)
  WHERE event_type = 'flow_progress' AND timestamp >= :since AND timestamp < :until
)
SELECT e.dataset, e.name, SUM(e.passed_records) AS passed, SUM(e.failed_records) AS failed
FROM exp GROUP BY e.dataset, e.name
LIMIT 5000;
```

Note: whether `event_log()` accepts a bound named parameter as its argument was not verified; fall back to inlining a validated pipeline ID (`^[0-9a-f-]{36}$`).

**Station reads (queries reading a table, via lineage joined to query history)**

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/query-history
-- https://docs.databricks.com/aws/en/admin/system-tables/lineage
SELECT l.source_table_full_name, h.client_application, h.compute.type AS compute_type,
       COUNT(DISTINCT h.statement_id) AS statements, COUNT(DISTINCT h.executed_by) AS users,
       MAX(h.start_time) AS last_read
FROM system.query.history h
JOIN system.access.table_lineage l ON l.statement_id = h.statement_id
WHERE h.start_time >= :since AND h.start_time < :until
  AND l.event_date >= CAST(:since AS DATE)
  AND h.statement_type = 'SELECT'
  AND l.source_table_catalog LIKE :catalog_pattern AND l.target_type IS NULL
GROUP BY l.source_table_full_name, h.client_application, h.compute.type
LIMIT 10000;
```

**Deploys and promotions (job definition changes)**

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/jobs
SELECT workspace_id, job_id, name, tags, change_time, delete_time
FROM system.lakeflow.jobs
WHERE change_time >= :since AND change_time < :until
ORDER BY change_time DESC
LIMIT 10000;
```

Release-tag matching is done client-side on the `tags` map. Note the SCD2 row records the job state at each change, not a diff.

**Cost overlay (estimate)**

```sql
-- https://docs.databricks.com/aws/en/admin/system-tables/billing
-- https://docs.databricks.com/aws/en/admin/system-tables/pricing
WITH u AS (
  SELECT sku_name, cloud, usage_unit, usage_date, billing_origin_product,
         usage_metadata.job_id AS job_id, usage_metadata.dlt_pipeline_id AS pipeline_id,
         SUM(usage_quantity) AS qty, MAX(usage_end_time) AS end_time
  FROM system.billing.usage
  WHERE usage_date >= CAST(:since AS DATE) AND usage_date < CAST(:until AS DATE)
  GROUP BY ALL
  HAVING SUM(usage_quantity) <> 0
)
SELECT u.usage_date, u.billing_origin_product, u.job_id, u.pipeline_id,
       SUM(u.qty * p.pricing.default) AS est_cost, MAX(p.currency_code) AS currency
FROM u JOIN system.billing.list_prices p
  ON p.sku_name = u.sku_name AND p.cloud = u.cloud AND p.usage_unit = u.usage_unit
 AND u.end_time >= p.price_start_time
 AND (p.price_end_time IS NULL OR u.end_time < p.price_end_time)
GROUP BY u.usage_date, u.billing_origin_product, u.job_id, u.pipeline_id
LIMIT 10000;
```

**Cross-metastore tethers (Delta Sharing; multi-metastore mode only)**

```sql
-- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/shares
SELECT share_name, share_owner, created, last_altered FROM system.information_schema.shares LIMIT 1000;
```

Also `SHOW SHARES` (output: `name`, `created_at`, `created_by`, `comment`). Recipients/providers: use `SHOW RECIPIENTS` / `SHOW PROVIDERS` after verifying output columns.

**Comets (foreign catalogs and foreign tables)**

```sql
-- https://docs.databricks.com/aws/en/sql/language-manual/information-schema/tables
SELECT table_catalog, COUNT(*) AS foreign_tables, MAX(last_altered) AS last_altered
FROM system.information_schema.tables
WHERE table_type = 'FOREIGN' AND table_catalog LIKE :catalog_pattern
GROUP BY table_catalog
LIMIT 1000;
```

Federation query activity: from `system.query.history` joined to lineage where the source catalog is one of the foreign catalogs found above.

---

## Unverified

Items below were not confirmed from official docs in this pass. Do not rely on them without checking the live page or a real workspace.

1. `system.information_schema.catalogs.catalog_type` (and values `FOREIGN_CATALOG`, `DELTA_SHARING`): the CATALOGS reference page lists no such column. The only documented way to see the type is `DESCRIBE CATALOG EXTENDED` ("Catalog Type": "Regular", "Delta Sharing"). Foreign catalog detection via SELECT-only SQL is therefore unconfirmed. Candidate: `information_schema.tables.table_type = 'FOREIGN'` (documented) as a proxy, or `SHOW CONNECTIONS` / `system.information_schema.connections` (columns unread).
2. Columns of `information_schema.catalog_tags`, `schema_tags`, `recipients`, `providers`, `share_recipient_privileges`, `connections`, `catalog_provider_share_usage`: the relations are listed in the overview, but only `table_tags` and `shares` column pages were read.
3. Metastore-admin requirement for `SHOW SHARES`, `SHOW RECIPIENTS`, `SHOW PROVIDERS`: not stated on the pages read.
4. How to enable `system.access` and other system schemas (API/UI, who may enable, which are auto-enabled): the main system tables page does not describe it. The Unity Catalog `system-schemas` API is the likely route but was not verified.
5. Audit log `service_name` / `action_name` values for table reads and SQL warehouse queries (for example `databrickssql`/`commandSubmit`, `unityCatalog` read actions): only `unityCatalog`/`getTable`, dashboard `executeQuery`/`getQueryResult`, and similar were seen; the reference page was truncated at 100,000 of about 440,000 characters. Audit volume figures and latency are undocumented on the pages read.
6. `system.query.history` retention is not on its own page (the system tables index says 365 days). Values of `execution_status` and the full field list of `query_source` and `query_tags` were not captured.
7. `system.billing.list_prices`: whether the current price row has `price_end_time IS NULL`; whether `pricing.effective_list.default` exists as a nested field (only the three keys `default`, `promotional`, `effective_list` are documented). The cost join is derived, not documented.
8. `information_schema.tables.last_altered` semantics for Delta data commits (documented only as last definition change).
9. SELECT-only equivalent of `DESCRIBE HISTORY`: none confirmed. `system.storage.predictive_optimization_operations_history` appears in the index but was not read.
10. Whether `event_log()` accepts a bound named parameter as its argument (the docs show string pipeline IDs and `TABLE(name)`).
11. `system.data_quality_monitoring.table_results` check-level `status` value sets beyond `Healthy`/`Unhealthy`/`Unknown`; `completeness` struct shows only `status` on the page body; `downstream_impact` and `root_cause_analysis` columns came from search summary only.
12. Databricks Apps: Node.js 22.16 and the 10 MB per-file limit came from search summaries of the environment and develop-apps pages rather than the fetched page text. Total source size limit unknown. `valueFrom` resolution for a SQL warehouse resource, and the preview status of user authorization, are not stated on the pages read.
13. Personal access token details (lifetime, workspace setting to disable PATs) were not fetched.
14. The Statement Execution API top-level HTTP error body (outside `status.error`) is not described on the pages read; the 25 MiB inline limit and 12 hour terminal retention are confirmed.
15. Azure/GCP differences: not investigated beyond noting the Apps-per-workspace count differs (100 AWS vs 50 GCP per the limits pages). Table names and schemas are shared across clouds per the AWS pages, but availability by region was not confirmed per cloud.
