-- Doc: https://docs.databricks.com/aws/en/admin/system-tables/billing
-- SPDX-License-Identifier: Apache-2.0
-- Purpose: estimated list-price cost per day and product. Optional spend overlay. Billing lags by
-- up to 12 hours, so the adapter queries a 24 hour window. List prices: https://docs.databricks.com/aws/en/admin/system-tables/pricing
-- The price join is derived from documented columns; list price is not a negotiated price.
WITH u AS (
  SELECT sku_name, cloud, usage_unit, usage_date, billing_origin_product,
         SUM(usage_quantity) AS qty, MAX(usage_end_time) AS end_time
  FROM system.billing.usage
  WHERE usage_end_time >= :since AND usage_end_time < :until
    AND usage_date >= DATE_SUB(CAST(:since AS DATE), 1)
    AND usage_date <= DATE_ADD(CAST(:until AS DATE), 1)
  GROUP BY sku_name, cloud, usage_unit, usage_date, billing_origin_product
  HAVING SUM(usage_quantity) <> 0
)
SELECT u.usage_date, u.billing_origin_product,
       SUM(u.qty * p.pricing.`default`) AS est_cost, MAX(p.currency_code) AS currency
FROM u
JOIN system.billing.list_prices p
  ON p.sku_name = u.sku_name AND p.cloud = u.cloud AND p.usage_unit = u.usage_unit
 AND u.end_time >= p.price_start_time
 AND (p.price_end_time IS NULL OR u.end_time < p.price_end_time)
GROUP BY u.usage_date, u.billing_origin_product
ORDER BY u.usage_date, u.billing_origin_product
LIMIT 5000
