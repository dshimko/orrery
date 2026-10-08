-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/jobs
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: current (latest, not deleted) pipelines with tags. Dedupe the SCD2 history first, then
-- drop deleted rows. Tags are returned as JSON because map columns arrive as text.
-- settings.continuous marks streaming pipelines.
WITH latest AS (
  SELECT workspace_id, pipeline_id, name, pipeline_type, tags, settings, change_time, delete_time,
         ROW_NUMBER() OVER (PARTITION BY workspace_id, pipeline_id ORDER BY change_time DESC) AS rn
  FROM system.lakeflow.pipelines
)
SELECT workspace_id, pipeline_id, name, pipeline_type, to_json(tags) AS tags_json,
       CAST(settings.continuous AS STRING) AS continuous, change_time
FROM latest
WHERE rn = 1 AND delete_time IS NULL
ORDER BY workspace_id, pipeline_id
LIMIT 20000
