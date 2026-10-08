-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/pipeline-events
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: expectation pass and fail counts per pipeline per minute (ingest gate pass or reject).
-- Optional and best effort: the table is Beta and moves to the lakeflow schema at GA, and the
-- VARIANT path below was not validated against a live workspace. Expectation shape:
-- https://docs.databricks.com/aws/en/ldp/monitor-event-log-schema
WITH expectations AS (
  SELECT workspace_id, pipeline_id, DATE_TRUNC('MINUTE', event_time) AS event_minute,
         explode(from_json(to_json(details:flow_progress.data_quality.expectations),
           'array<struct<name:string,dataset:string,passed_records:bigint,failed_records:bigint>>')) AS e
  FROM system.lakeflow_pipeline_events_preview.pipeline_events
  WHERE event_type = 'flow_progress' AND event_time >= :since AND event_time < :until
)
SELECT workspace_id, pipeline_id, event_minute,
       SUM(e.passed_records) AS passed, SUM(e.failed_records) AS failed
FROM expectations
GROUP BY workspace_id, pipeline_id, event_minute
ORDER BY event_minute, workspace_id, pipeline_id
LIMIT 50000
