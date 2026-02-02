# staff_profiles 權限、首批資料與首次上傳修復說明

## 一、釐清：「為什麼一開始能讀，現在不能讀」

### getAllStaffProfiles 使用的 Supabase client

- **實際使用**：`createServerSupabaseClient()`（來自 `@/lib/supabase/server`）
- **對應類型**：**Service Role client**（使用 `SUPABASE_SERVICE_ROLE_KEY`）
- **建立方式**：`createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } })`
- **呼叫情境**：僅在 Server Action 中呼叫（`getAllStaffProfiles` 在 `actions/upload/queries.ts`），前端不直接查詢 `staff_profiles`。

因此**不是** `createServerComponentClient` 或 `createServerActionClient`（那兩個是基於 cookie/session 的 anon key client）。

### staff_profiles 的 RLS 現況（修復前）

- **001_initial_schema.sql 及後續 migrations**：**未**對 `staff_profiles` 啟用 RLS，也**未**建立任何 policy。
- 若在 Supabase Dashboard 手動啟用 RLS，或專案預設對新表啟用 RLS，則會變成「RLS 啟用、無 policy」：
  - 對 **anon/authenticated**：沒有任何 row 通過 policy → 查詢結果為空或依環境回傳 permission 相關錯誤。
  - 對 **service_role**：理論上會 bypass RLS；但在部分環境下若表未對 `service_role` 做明確 **GRANT**，仍可能出現 `permission denied for table staff_profiles`。

因此「一開始能讀、現在不能讀」常見原因為：

1. 重建資料庫或重新跑 migration 後，RLS 被啟用（預設或手動），且沒有 policy；
2. 或表級權限未 GRANT 給 `service_role`/`authenticated`，導致實際執行查詢的角色沒有權限。

---

## 二、修正 staff_profiles 的存取策略（已實作）

採用 **選項 B（較嚴謹）**：為 `staff_profiles` 啟用 RLS 並補齊 policy，同時加上明確 GRANT。

- **authenticated**：僅允許 **SELECT**（登入後讀取人員列表，供上傳頁匹配等）。
- **service_role**：透過 policy + GRANT 允許 **SELECT, INSERT, UPDATE**（Server Action 建立/更新人員，不假造 `user_id`）。

實作位置：

- **Migration**：`supabase/migrations/008_staff_profiles_rls_grants.sql`
- **合併 schema**：`supabase/consolidated_schema.sql` 已同步加入相同 RLS/GRANT 區塊。

### 完整 SQL（與 008 一致）

```sql
-- 1. 啟用 RLS
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

-- 2. 已登入使用者可讀取所有人員
CREATE POLICY "staff_profiles_select_authenticated"
  ON staff_profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. 僅 service_role 可寫入（Server Action 用）
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

-- 4. 表級 GRANT
GRANT SELECT ON public.staff_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.staff_profiles TO service_role;
```

---

## 三、補齊「第一次上傳資料」的 Bootstrap 流程

### 1. 即使 staff_profiles 為空，流程仍可跑

- 上傳頁載入時會呼叫 `getAllStaffProfiles()`（Service Role），在 008 的 GRANT/RLS 下可正常執行。
- 空表時回傳 `{ success: true, data: [] }`，不會報錯。
- 預覽照常顯示，所有列因無法匹配而為「未匹配」狀態，UI 正確呈現「未匹配」與「建立人員」等操作。

### 2. 人員建立策略（auth 已存在、staff_profiles 尚未建立）

- **createStaffProfile**（既有）：  
  建立 **auth.users** 並寫入 **staff_profiles**，`user_id` 來自 `auth.admin.createUser`，不假造。
- **ensureStaffProfileFromAuthUser**（新增）：  
  僅當 **auth.users 已有該 Email**、**staff_profiles 尚無對應** 時，建立一筆 `staff_profiles`，`user_id` 必來自 `auth.users`（以 Admin API 查詢）。
- **若 auth 中找不到該 Email**：  
  **拒絕**，不回傳成功；錯誤訊息為：「此 Email 尚未在系統註冊。請先使用「建立人員」建立新帳號，或確認 Email 是否正確。」  
  不在後端自動建立 auth 帳號，也不接受亂塞 UUID。

上傳頁「建立人員」Popover 內：

- **建立人員**：沿用 `createStaffProfile`（新建 auth + staff）。
- **已有帳號？連結既有帳號**：改為呼叫 `ensureStaffProfileFromAuthUser`（僅建立 staff，且僅在 auth 已有該 email 時成功）。

---

## 四、修正後摘要

### getAllStaffProfiles 與 Supabase client 建立方式

- **檔案**：`actions/upload/queries.ts`
- **Client 建立**：`createServerSupabaseClient()`（定義在 `lib/supabase/server.ts`）
- **實作**：`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })`
- **用途**：僅 Server Action 呼叫，前端不直接查詢 `staff_profiles`。

### RLS 變動的完整 SQL

已寫入 `supabase/migrations/008_staff_profiles_rls_grants.sql`，並同步至 `supabase/consolidated_schema.sql`（見上一節「完整 SQL」）。

### 為什麼「重新建資料庫後，看得到 auth.users，但 staff_profiles 會壞掉」？

1. **auth.users** 由 Supabase Auth 管理，權限與 RLS 由系統處理，重建後仍可正常使用。
2. **staff_profiles** 是我們在 `public` 建立的表，若：
   - 重建後 RLS 被啟用（預設或事後手動），而我們從未下過 policy，或  
   - 表未對 `service_role` / `authenticated` 做 GRANT，  
   就會出現「permission denied for table staff_profiles」或查不到資料。
3. 因此「看得到 auth.users，但 staff_profiles 壞掉」＝**權限/RLS 只處理了 auth，沒有對 staff_profiles 做一致設定**。

### 這次修正如何永久解決首次上傳問題？

1. **008 migration**：  
   對 `staff_profiles` 明確啟用 RLS、建立「authenticated 可讀 / service_role 可寫」的 policy，並對 `authenticated`、`service_role` 做 GRANT。  
   之後無論是新建 DB 或重跑 migration，只要跑過 008，`staff_profiles` 的讀寫權限都會一致。

2. **Bootstrap 行為**：  
   - 空表時 `getAllStaffProfiles()` 仍回傳成功、`data: []`，上傳頁可載入、可預覽、可顯示「未匹配」。  
   - 提供「建立人員」與「連結既有帳號」兩種路徑，且 `user_id` 一律來自 auth，不假造，符合架構紅線。

---

## 架構紅線遵守情況

- 未在 Client Component 直接查詢 `staff_profiles`（僅透過 Server Action）。
- 未假造 `user_id`（createStaffProfile / ensureStaffProfileFromAuthUser 皆以 auth 為來源）。
- `staff_profiles` 作為 auth.users 的延伸層，FK 真實對應。
