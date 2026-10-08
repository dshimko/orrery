-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/data-quality-monitoring
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: latest data quality freshness result per table (last commit time and status).
-- Optional: Public Preview, admin-only by default, and only for schemas with monitoring enabled.
SELECT catalog_name, schema_name, table_name, status,
       freshness.status AS freshness_status,
       freshness.commit_freshness.last_value AS last_commit,
       freshness.commit_freshness.predicted_value AS expected_commit,
       event_time
FROM system.data_quality_monitoring.table_results
WHERE event_time >= :since AND event_time < :until
QUALIFY ROW_NUMBER() OVER (PARTITION BY table_id ORDER BY event_time DESC) = 1
ORDER BY catalog_name, schema_name, table_name
LIMIT 20000
