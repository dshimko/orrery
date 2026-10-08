-- Doc: https://docs.databricks.com/aws/en/sql/language-manual/information-schema/catalogs
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: every catalog visible to the caller. The adapter assigns catalogs to environments
-- from these names (scope globs) and the catalog_tags query (scope tags).
SELECT catalog_name, created, last_altered
FROM system.information_schema.catalogs
ORDER BY catalog_name
LIMIT 5000
