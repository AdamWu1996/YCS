---
description: 確保裁決層 (Decision Layer) 不被繞過
globs:
  - "actions/**"
  - "lib/database/**"
  - "app/api/**"
---
# 資料庫寫入守則

- **禁止直寫條款**：
  - 嚴禁繞過裁決紀錄直接寫入 `FinalBilling` 表。
  - 所有 MD 結果必須先有對應的 `BillingDecision` 紀錄作為審計軌跡。
- **Schema 遵循**：每一筆產生的請款紀錄都必須能回溯至對應的 `BillingDecision` ID。
- **數據血統 (Data Lineage)**：
  - 嚴禁在 `billing_decisions` 表中使用 `time_record_id` 欄位。
  - 決策與事實的關聯「必須」完全透過 `billing_decision_records` 關聯表達成，以支援多筆紀錄合併裁決。
- **排他保護 (Exclusive Lock)**：
  - `billing_decision_records` 必須保存 `is_active` 快照欄位，並以 Trigger 與 `billing_decisions.is_active` 同步。
  - 必須建立 `UNIQUE(time_record_id) WHERE is_active = TRUE` 的 Partial Unique Index。
  - 禁止硬刪關聯紀錄，以保留完整認領歷史與審計軌跡。
- **費率管理 (Rate Management)**：
  - 系統必須支援 `project_rates` 年度費率表，禁止在請款單中手動輸入無來源的單價。
