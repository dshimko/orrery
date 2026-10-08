-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/jobs
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: current (latest, not deleted) jobs with tags. Dedupe the SCD2 history first, then
-- drop deleted rows. Tags are returned as JSON because map columns arrive as text.
WITH latest AS (
  SELECT workspace_id, job_id, name, tags, change_time, delete_time,
         ROW_NUMBER() OVER (PARTITION BY workspace_id, job_id ORDER BY change_time DESC) AS rn
  FROM system.lakeflow.jobs
)
SELECT workspace_id, job_id, name, to_json(tags) AS tags_json, change_time
FROM latest
WHERE rn = 1 AND delete_time IS NULL
ORDER BY workspace_id, job_id
LIMIT 20000
