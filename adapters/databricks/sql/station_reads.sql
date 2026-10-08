-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/query-history
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: SELECT statements per minute and source schema, from query history joined to lineage
-- on statement_id (history has no tables-read column). Feeds serve.read (stations) and
-- federation.query (foreign catalogs). Lineage: https://docs.databricks.com/aws/en/admin/system-tables/lineage
SELECT DATE_TRUNC('MINUTE', h.start_time) AS read_minute,
       l.source_table_catalog, l.source_table_schema,
       COUNT(DISTINCT h.statement_id) AS statements,
       COUNT(DISTINCT h.executed_by) AS users
FROM system.query.history h
JOIN system.access.table_lineage l ON l.statement_id = h.statement_id
WHERE h.start_time >= :since AND h.start_time < :until
  AND l.event_date >= DATE_SUB(CAST(:since AS DATE), 1)
  AND l.event_date <= DATE_ADD(CAST(:until AS DATE), 1)
  AND h.statement_type = 'SELECT'
  AND l.target_type IS NULL
  AND l.source_table_catalog IS NOT NULL AND l.source_table_schema IS NOT NULL
GROUP BY DATE_TRUNC('MINUTE', h.start_time), l.source_table_catalog, l.source_table_schema
ORDER BY read_minute, l.source_table_catalog, l.source_table_schema
LIMIT 50000
