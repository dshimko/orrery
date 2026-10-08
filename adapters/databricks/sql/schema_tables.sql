-- Doc: https://docs.databricks.com/aws/en/sql/language-manual/information-schema/tables
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: relation count per schema (views and materialized views included, foreign tables
-- excluded). Gold-tier schemas give a spoke its "products" metric. Optional.
SELECT table_catalog, table_schema, COUNT(*) AS table_count, MAX(last_altered) AS last_altered
FROM system.information_schema.tables
WHERE table_type <> 'FOREIGN' AND table_schema <> 'information_schema'
GROUP BY table_catalog, table_schema
ORDER BY table_catalog, table_schema
LIMIT 20000
