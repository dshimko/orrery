-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/lineage
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: writes per minute into schemas by entities other than jobs and pipelines (those come
-- from run timelines): notebooks, SQL queries, dashboards. Feeds copy and product.publish events.
SELECT DATE_TRUNC('MINUTE', event_time) AS event_minute,
       COALESCE(entity_type, 'UNKNOWN') AS entity_type,
       source_table_catalog, source_table_schema, target_table_catalog, target_table_schema,
       COUNT(*) AS writes
FROM system.access.table_lineage
WHERE event_date >= DATE_SUB(CAST(:since AS DATE), 1) AND event_date <= DATE_ADD(CAST(:until AS DATE), 1)
  AND event_time >= :since AND event_time < :until
  AND target_table_catalog IS NOT NULL AND target_table_schema IS NOT NULL
  AND (entity_type IS NULL OR entity_type NOT IN ('JOB', 'PIPELINE'))
GROUP BY DATE_TRUNC('MINUTE', event_time), COALESCE(entity_type, 'UNKNOWN'),
         source_table_catalog, source_table_schema, target_table_catalog, target_table_schema
ORDER BY event_minute, entity_type, target_table_catalog, target_table_schema,
         source_table_catalog, source_table_schema
LIMIT 50000
