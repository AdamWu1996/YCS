-- ============================================
-- staff_profiles.user_id 改為可為 NULL
-- 業務規則：允許員工先存在、後綁帳號
-- ============================================

ALTER TABLE staff_profiles
  ALTER COLUMN user_id DROP NOT NULL;
