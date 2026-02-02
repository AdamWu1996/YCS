-- ============================================
-- 匯入防重：同一人員、日期、廠區、進場時間僅允許一筆
-- 用於批量 upsert 的 ON CONFLICT 目標
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS uniq_time_records_import_key
ON time_records (staff_id, record_date, factory_location, check_in_time);

COMMENT ON INDEX uniq_time_records_import_key IS '匯入防重：用於批量 upsert，同一 clock-in 不重複寫入';
