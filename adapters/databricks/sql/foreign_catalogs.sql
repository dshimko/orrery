-- Doc: https://docs.databricks.com/aws/en/sql/language-manual/information-schema/tables
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: foreign catalogs (Lakehouse Federation), detected through their FOREIGN tables because
-- catalogs.catalog_type is not a documented column. Each one is drawn as a comet. Optional.
SELECT table_catalog, COUNT(*) AS foreign_tables, MAX(last_altered) AS last_altered
FROM system.information_schema.tables
WHERE table_type = 'FOREIGN'
GROUP BY table_catalog
ORDER BY table_catalog
LIMIT 1000
