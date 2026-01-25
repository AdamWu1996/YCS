# 實戰演習指南：許馨方 2025/6/16 三段碎片工時認領測試

## 前置準備

### 1. 執行測試數據 Migration

```bash
# 在 Supabase Dashboard 執行 migration，或使用 Supabase CLI
supabase migration up 006_practice_exercise_data
```

這會建立：
- 員工：許馨方
- 專案：PY_PRACTICE_001
- 任務：SR_PRACTICE_001（預算 2.0 MD）
- 三段工時紀錄（2025/6/16）：
  - 第一段：1.5 小時（08:00 - 09:30）
  - 第二段：2.0 小時（10:00 - 12:00）
  - 第三段：1.0 小時（14:00 - 15:00）
  - 總計：4.5 小時（建議 MD：1.0）

## 測試步驟

### 階段一：數據導入驗證（潔癖行為）

1. **驗證 5 分鐘過濾邏輯**
   - 嘗試導入一段小於 5 分鐘的工時（例如：4 分鐘）
   - 確認該筆數據被過濾，不會進入系統

### 階段二：認領測試

1. **進入看板**
   - 訪問 `/dashboard/billing`
   - 確認能看到許馨方 2025/6/16 的三段工時紀錄

2. **選擇工時進行認領**
   - 勾選這三段工時紀錄
   - 點擊「裁決」按鈕

3. **觀察裁決 Dialog**
   - ✅ **驗證點 1**：確認 Dialog 顯示「任務已用 MD：0.00 / 2.00 MD」
   - ✅ **驗證點 2**：確認顯示「本次裁決 MD：1.0」（系統建議）
   - ✅ **驗證點 3**：確認顯示「裁決後累計 MD：1.00 / 2.00 MD」
   - 選擇任務：SR_PRACTICE_001
   - 輸入裁決原因（例如：「實戰演習：認領測試」）
   - 確認最終 MD 為 1.0

4. **執行裁決**
   - 點擊「確認裁決」
   - 等待處理完成

5. **驗證 is_active 快照同步**
   - 查詢資料庫確認：
     ```sql
     -- 檢查 billing_decisions
     SELECT id, is_active, final_md, reason 
     FROM billing_decisions 
     WHERE reason LIKE '實戰演習%';
     
     -- 檢查 billing_decision_records 的 is_active 快照
     SELECT 
         bdr.id,
         bdr.billing_decision_id,
         bdr.time_record_id,
         bdr.is_active,
         bd.is_active as decision_is_active
     FROM billing_decision_records bdr
     JOIN billing_decisions bd ON bdr.billing_decision_id = bd.id
     WHERE bd.reason LIKE '實戰演習%';
     ```
   - ✅ **驗證點 4**：確認 `billing_decision_records.is_active` 與 `billing_decisions.is_active` 一致

6. **驗證任務已用 MD 更新**
   - 查詢 `task_billing_summary` 視圖：
     ```sql
     SELECT task_id, used_md
     FROM task_billing_summary
     WHERE task_id IN (
         SELECT id FROM tasks WHERE code = 'SR_PRACTICE_001'
     );
     ```
   - ✅ **驗證點 5**：確認 `used_md` 為 1.0

### 階段三：防搶測試

1. **嘗試第二次認領**
   - 再次進入 `/dashboard/billing`
   - 再次選擇同樣的三段工時紀錄
   - 點擊「裁決」按鈕

2. **驗證錯誤訊息**
   - ✅ **驗證點 6**：系統應該阻止第二次認領
   - ✅ **驗證點 7**：錯誤訊息應為「此段工時已被其他專案認領」
   - 這是由 `uniq_bdr_active_time_record` 索引觸發的 `unique_violation` 錯誤

## 驗證清單

- [ ] 潔癖行為：小於 5 分鐘的數據被過濾
- [ ] Dialog 正確顯示任務已用 MD（非專案進度）
- [ ] Dialog 正確顯示裁決後累計 MD
- [ ] 裁決執行成功，`billing_decisions` 建立正確
- [ ] `billing_decision_records.is_active` 快照與 `billing_decisions.is_active` 同步
- [ ] `task_billing_summary` 視圖正確計算任務已用 MD
- [ ] 防搶機制生效，第二次認領被阻止
- [ ] 錯誤訊息明確提示「此段工時已被其他專案認領」

## 清理測試數據

測試完成後，可以執行以下 SQL 清理：

```sql
DELETE FROM billing_decision_records WHERE billing_decision_id IN (
    SELECT id FROM billing_decisions WHERE reason LIKE '實戰演習%'
);
DELETE FROM billing_decisions WHERE reason LIKE '實戰演習%';
DELETE FROM time_records WHERE notes LIKE '實戰演習%';
DELETE FROM tasks WHERE code = 'SR_PRACTICE_001';
DELETE FROM projects WHERE code = 'PY_PRACTICE_001';
DELETE FROM staff_profiles WHERE email = 'practice_xu@example.com';
```
