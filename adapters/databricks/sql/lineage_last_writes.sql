-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/lineage
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: last tracked write per target schema. Freshness fallback when neither data quality
-- results nor run timelines cover a spoke. Lineage records only a subset of writes.
SELECT target_table_catalog, target_table_schema, MAX(event_time) AS last_write
FROM system.access.table_lineage
WHERE event_date >= DATE_SUB(CAST(:since AS DATE), 1) AND event_date <= DATE_ADD(CAST(:until AS DATE), 1)
  AND event_time >= :since AND event_time < :until
  AND target_table_catalog IS NOT NULL AND target_table_schema IS NOT NULL
GROUP BY target_table_catalog, target_table_schema
ORDER BY target_table_catalog, target_table_schema
LIMIT 20000
