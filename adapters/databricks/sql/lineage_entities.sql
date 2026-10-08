-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/lineage
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: which schemas each job or pipeline writes to, over a lookback window. Lets the adapter
-- place untagged pipelines and jobs in spokes and tiers. :since and :until are TIMESTAMP.
SELECT workspace_id, entity_type, entity_id, target_table_catalog, target_table_schema,
       MAX(event_time) AS last_write
FROM system.access.table_lineage
WHERE event_date >= DATE_SUB(CAST(:since AS DATE), 1) AND event_date <= DATE_ADD(CAST(:until AS DATE), 1)
  AND event_time >= :since AND event_time < :until
  AND entity_type IN ('JOB', 'PIPELINE') AND entity_id IS NOT NULL
  AND target_table_catalog IS NOT NULL AND target_table_schema IS NOT NULL
GROUP BY workspace_id, entity_type, entity_id, target_table_catalog, target_table_schema
ORDER BY workspace_id, entity_type, entity_id, target_table_catalog, target_table_schema
LIMIT 50000
