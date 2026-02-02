-- 工號為選填，用於匯入時快速建立人員
ALTER TABLE staff_profiles
ADD COLUMN IF NOT EXISTS employee_no TEXT;

COMMENT ON COLUMN staff_profiles.employee_no IS '工號（選填）';
