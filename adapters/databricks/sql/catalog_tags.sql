-- Doc: https://docs.databricks.com/aws/en/sql/language-manual/information-schema/catalogs
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: Unity Catalog tags on catalogs, for scope.tag and the spoke "tag" matcher.
-- Optional. Best effort: the column list is by analogy with table_tags (the catalog_tags page was
-- not read, see docs/databricks-sources.md "Unverified" item 2). A failure degrades health only.
SELECT catalog_name, tag_name, tag_value
FROM system.information_schema.catalog_tags
ORDER BY catalog_name, tag_name
LIMIT 20000
