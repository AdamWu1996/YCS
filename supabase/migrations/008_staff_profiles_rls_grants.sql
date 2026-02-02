-- ============================================
-- staff_profiles 存取策略：RLS + GRANT
-- 解決「permission denied for table staff_profiles」與首次上傳 bootstrap
-- ============================================
-- 原因簡述：
-- 1. 表若經 Dashboard 啟用 RLS 或專案預設啟用 RLS，且無 policy，則 anon/authenticated 無法讀取。
-- 2. Service Role 雖可 bypass RLS，但若表未對 service_role 做 GRANT，仍可能出現 permission denied。
-- 3. 本 migration 同時滿足：authenticated 可 SELECT（登入後讀取）、service_role 可完整操作。
-- ============================================

-- 1. 啟用 RLS（若已啟用則無副作用）
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

-- 2. 允許已登入使用者讀取所有人員（用於上傳頁匹配、選單等）
CREATE POLICY "staff_profiles_select_authenticated"
  ON staff_profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. 僅允許 service_role 寫入（Server Action 用 Service Role 建立/更新人員，不經 anon/authenticated 直寫）
--    INSERT/UPDATE 不開放給 authenticated，由後端 Server Action 以 Service Role 執行。
CREATE POLICY "staff_profiles_insert_service_role"
  ON staff_profiles
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "staff_profiles_update_service_role"
  ON staff_profiles
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. 明確 GRANT，確保各角色有表級權限（部分環境建立表後未自動 grant 給 service_role）
GRANT SELECT ON public.staff_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.staff_profiles TO service_role;
