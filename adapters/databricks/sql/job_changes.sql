-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/jobs
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: job definition changes in the window (SCD2 history, one row per change). The adapter
-- keeps rows carrying the release tag: deploy events and the calendar release counts.
SELECT workspace_id, job_id, name, to_json(tags) AS tags_json, change_time, delete_time
FROM system.lakeflow.jobs
WHERE change_time >= :since AND change_time < :until
ORDER BY change_time, workspace_id, job_id
LIMIT 50000
