-- 1) time_records 總數與有出場時間的筆數
SELECT
  COUNT(*) AS total,
  COUNT(check_out_time) AS with_check_out
FROM time_records;

-- 2) 取樣幾筆 time_records（有 check_out_time）
SELECT id, staff_id, record_date, factory_location, check_in_time, check_out_time, hours_worked
FROM time_records
WHERE check_out_time IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;

-- 3) pending_billing_decisions_summary 筆數
SELECT COUNT(*) AS pending_count FROM pending_billing_decisions_summary;

-- 4) View 的來源條件：有無被 bdr 關聯
SELECT
  tr.id,
  tr.check_out_time IS NOT NULL AS has_check_out,
  bdr.id AS bdr_id,
  bd.id AS bd_id,
  bd.is_active AS bd_active,
  bd.is_billable AS bd_billable
FROM time_records tr
LEFT JOIN billing_decision_records bdr ON tr.id = bdr.time_record_id
LEFT JOIN billing_decisions bd ON bdr.billing_decision_id = bd.id AND bd.is_active = TRUE
WHERE tr.check_out_time IS NOT NULL
LIMIT 10;
