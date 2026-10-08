-- Doc: https://docs.databricks.com/aws/en/sql/language-manual/information-schema/schemata
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: Unity Catalog tags on schemas, for the spoke "tag" matcher and the tag medallion strategy.
-- Optional. Best effort: the column list is by analogy with table_tags (the schema_tags page was
-- not read, see docs/databricks-sources.md "Unverified" item 2). A failure degrades health only.
SELECT catalog_name, schema_name, tag_name, tag_value
FROM system.information_schema.schema_tags
ORDER BY catalog_name, schema_name, tag_name
LIMIT 50000
