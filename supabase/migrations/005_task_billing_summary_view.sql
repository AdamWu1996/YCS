-- ============================================
-- 任務已用 MD 彙整視圖
-- ============================================

CREATE OR REPLACE VIEW task_billing_summary AS
WITH decision_task AS (
    SELECT
        bd.id AS billing_decision_id,
        bd.final_md,
        tr.task_id
    FROM billing_decisions bd
    JOIN billing_decision_records bdr ON bdr.billing_decision_id = bd.id
    JOIN time_records tr ON tr.id = bdr.time_record_id
    WHERE bd.is_active = TRUE
      AND bd.is_billable = TRUE
      AND tr.task_id IS NOT NULL
    GROUP BY bd.id, bd.final_md, tr.task_id
)
SELECT
    task_id,
    COALESCE(SUM(final_md), 0) AS used_md
FROM decision_task
GROUP BY task_id;
