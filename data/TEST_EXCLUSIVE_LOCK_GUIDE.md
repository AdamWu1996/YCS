# 排他鎖測試與數據消隱驗證指南

## 測試目標

1. **排他鎖測試**：驗證 `uniq_bdr_active_time_record` 索引能防止同一筆工時被重複認領
2. **數據消隱驗證**：確認已認領的工時在公海池模式下自動隱藏

## 前置條件

- 已完成第一次裁決（三段工時已認領至 SR_PRACTICE_001）
- 三段工時的 `task_id` 已更新為任務 ID
- 已建立 `billing_decision` 和 `billing_decision_records`（`is_active = TRUE`）

## 測試步驟

### 步驟 1: 執行排他鎖測試腳本

在 Supabase SQL Editor 執行 `data/test_exclusive_lock.sql`：

```sql
-- 這個腳本會：
-- 1. 查詢已認領的工時紀錄
-- 2. 嘗試建立第二個裁決（使用同一筆 time_record_id）
-- 3. 驗證是否觸發 Unique Violation 錯誤
-- 4. 檢查數據消隱狀態
```

**預期結果**：
- ✅ 應該看到 `unique_violation` 錯誤
- ✅ 錯誤訊息應包含約束名稱或相關資訊
- ✅ 腳本會顯示「✓ 排他鎖測試成功！」

### 步驟 2: 驗證錯誤訊息

執行腳本後，檢查輸出中的錯誤訊息。應該類似：

```
ERROR: duplicate key value violates unique constraint "uniq_bdr_active_time_record"
DETAIL: Key (time_record_id)=(xxx) already exists.
```

或由函數拋出的錯誤：

```
ERROR: 此段工時已被其他專案認領
```

### 步驟 3: 驗證數據消隱

#### 3.1 檢查公海池模式

1. 進入 `/dashboard/billing` 頁面
2. 點擊「公海池」按鈕
3. **驗證點**：三段實戰演習工時應該**不在**公海池列表中

#### 3.2 檢查全部待裁決模式

1. 點擊「全部待裁決」按鈕
2. **驗證點**：三段實戰演習工時應該**不在**列表中（因為已認領且 `is_billable = TRUE`）

#### 3.3 執行 SQL 驗證

執行測試腳本中的「驗證數據消隱」部分，確認：

```sql
-- 待裁決視圖中的實戰演習記錄（應為 0）
SELECT COUNT(*) 
FROM pending_billing_decisions_summary
WHERE time_record_id IN (
    SELECT id FROM time_records WHERE notes LIKE '實戰演習%'
);
-- 預期結果：count = 0

-- 已認領的實戰演習記錄（task_id 不為 NULL）
SELECT COUNT(*) 
FROM time_records
WHERE notes LIKE '實戰演習%'
  AND task_id IS NOT NULL;
-- 預期結果：count = 3
```

## 驗證清單

### 排他鎖測試
- [ ] 執行測試腳本成功
- [ ] 觸發 `unique_violation` 錯誤（預期行為）
- [ ] 錯誤訊息明確提示「此段工時已被其他專案認領」或類似內容
- [ ] 腳本顯示「✓ 排他鎖測試成功！」

### 數據消隱驗證
- [ ] 公海池模式下，三段工時不在列表中
- [ ] 全部待裁決模式下，三段工時不在列表中
- [ ] SQL 查詢確認 `pending_billing_decisions_summary` 中沒有這三段工時
- [ ] SQL 查詢確認 `time_records.task_id` 不為 NULL（已認領）

## 技術細節

### 排他鎖機制

排他鎖由以下索引實現：

```sql
CREATE UNIQUE INDEX uniq_bdr_active_time_record
ON billing_decision_records (time_record_id)
WHERE is_active = TRUE;
```

這個索引確保：
- 同一筆 `time_record_id` 只能有一個 `is_active = TRUE` 的 `billing_decision_records` 記錄
- 嘗試插入第二個 active 記錄時會觸發 `unique_violation` 錯誤

### 數據消隱機制

公海池過濾邏輯（在 `decision-board.tsx` 中）：

```typescript
const poolData = useMemo(
  () => data.filter((item) => !item.task_id),
  [data]
);
```

這意味著：
- 只有 `task_id` 為 `NULL` 的工時會出現在公海池
- 已認領的工時（`task_id` 不為 `NULL`）會自動隱藏

### 待裁決視圖過濾

`pending_billing_decisions_summary` 視圖的過濾條件：

```sql
WHERE tr.check_out_time IS NOT NULL -- 已完成出場
  AND (bd.id IS NULL OR bd.is_billable = FALSE); -- 尚未裁決或不可請款
```

這意味著：
- 已認領且 `is_billable = TRUE` 的工時不會出現在待裁決視圖中
- 只有未認領或不可請款的工時才會顯示

## 截圖建議

1. **排他鎖錯誤截圖**：
   - Supabase SQL Editor 中的錯誤訊息
   - 包含錯誤類型（`unique_violation`）和詳細資訊

2. **公海池截圖**：
   - Billing 頁面的公海池模式
   - 確認三段工時不在列表中

3. **SQL 驗證截圖**：
   - 測試腳本的執行結果
   - 顯示驗證結論（✓ 或 ✗）

## 故障排除

### 如果排他鎖測試失敗

1. 檢查索引是否存在：
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE indexname = 'uniq_bdr_active_time_record';
   ```

2. 檢查是否有重複的 active 記錄：
   ```sql
   SELECT time_record_id, COUNT(*) 
   FROM billing_decision_records 
   WHERE is_active = TRUE 
   GROUP BY time_record_id 
   HAVING COUNT(*) > 1;
   ```

### 如果數據消隱失敗

1. 檢查 `task_id` 是否正確更新：
   ```sql
   SELECT id, task_id, notes 
   FROM time_records 
   WHERE notes LIKE '實戰演習%';
   ```

2. 檢查 `is_billable` 狀態：
   ```sql
   SELECT bd.id, bd.is_billable, bd.is_active, tr.notes
   FROM billing_decisions bd
   JOIN billing_decision_records bdr ON bdr.billing_decision_id = bd.id
   JOIN time_records tr ON tr.id = bdr.time_record_id
   WHERE tr.notes LIKE '實戰演習%';
   ```
