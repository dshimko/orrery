-- Doc: https://docs.databricks.com/aws/en/sql/language-manual/information-schema/schemata
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: every schema visible to the caller. Spoke "schema" matchers and medallion tiers
-- (schema-suffix strategy) are evaluated against these names.
SELECT catalog_name, schema_name
FROM system.information_schema.schemata
WHERE schema_name <> 'information_schema'
ORDER BY catalog_name, schema_name
LIMIT 20000
