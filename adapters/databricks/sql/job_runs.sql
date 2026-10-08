-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/jobs
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: job runs overlapping the window, one row per run. result_state and termination_code
-- are set only on the final slice, so MAX() returns them (NULL while the run is still going).
SELECT workspace_id, job_id, run_id,
       MIN(period_start_time) AS started_at, MAX(period_end_time) AS ended_at,
       MAX(result_state) AS result_state, MAX(termination_code) AS termination_code,
       MAX(trigger_type) AS trigger_type
FROM system.lakeflow.job_run_timeline
WHERE period_end_time >= :since AND period_start_time < :until
GROUP BY workspace_id, job_id, run_id
ORDER BY ended_at, workspace_id, job_id, run_id
LIMIT 50000
