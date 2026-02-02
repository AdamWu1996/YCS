# 匯入延遲與資料診斷

## 1. SQL 診斷：確認資料是否進庫

在 Supabase SQL Editor 或本機 `psql` 執行：

```sql
SELECT count(*) FROM time_records;
```

- 若筆數與預期不符，可能原因：
  - **潔癖過濾**：duration < 5 分鐘的列在匯入時被跳過（計入 skipped）
  - **防重**：相同 (staff_id, record_date, factory_location, check_in_time) 已存在則跳過
  - **前端/連線超時**：請求逾時但後端可能已寫入部分；可再查 `SELECT count(*)` 或依 `record_date` 篩選比對

依日期檢查筆數：

```sql
SELECT record_date, count(*) 
FROM time_records 
GROUP BY record_date 
ORDER BY record_date DESC 
LIMIT 30;
```

## 2. pending_billing_decisions_summary 與 duration 規則

**結論：此視圖沒有「duration < 5 分鐘」的過濾。**

視圖條件僅有：

- `tr.check_out_time IS NOT NULL`（已完成出場）
- `(bd.id IS NULL OR bd.is_billable = FALSE)`（尚未裁決或不可請款）

duration < 5 分鐘的過濾發生在**匯入階段**（`actions/upload/import.ts`），該類列不會寫入 `time_records`，因此也不會出現在此視圖。若畫面上筆數少於預期，應檢查匯入回傳的 `skipped` 是否包含被潔癖規則過濾的筆數。

## 3. 匯入優化（已實作）

- **批量 upsert**：依 `uniq_time_records_import_key` 做 ON CONFLICT DO NOTHING，每批約 150 筆，減少 round-trip。
- **task_id**：匯入時一律寫入 `null`（公海池），裁決中心再認領。
- **錯誤處理**：分批 try/catch，錯誤彙整於 `errors` 陣列回傳。

## 4. 超時與進度

- 若匯入仍逾時（例如 Vercel 預設 10s），可考慮：
  - 在該 route 或 layout 設定 `export const maxDuration = 60`（依方案上限調整）
  - 或改為「客戶端分批呼叫」：前端將資料切成多批，多次呼叫 `importTimeRecords` 並顯示進度（例如「第 2/7 批」）
