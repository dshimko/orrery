-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/jobs
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: pipeline updates overlapping the window, one row per update. result_state is set only
-- on the final slice, so MAX() returns it (NULL while the update is still running).
SELECT workspace_id, pipeline_id, update_id,
       MIN(period_start_time) AS started_at, MAX(period_end_time) AS ended_at,
       MAX(result_state) AS result_state, MAX(trigger_type) AS trigger_type,
       MAX(trigger_details.job_task.job_id) AS trigger_job_id
FROM system.lakeflow.pipeline_update_timeline
WHERE period_end_time >= :since AND period_start_time < :until
GROUP BY workspace_id, pipeline_id, update_id
ORDER BY ended_at, workspace_id, pipeline_id, update_id
LIMIT 50000
