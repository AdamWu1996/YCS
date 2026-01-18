---
description: 處理 MD (Man-Day) 判定與 4 小時規則邏輯
globs:
  - "app/api/billing/**"
  - "actions/billing/**"
  - "components/billing/**"
---
# MD 判定憲法

- **4小時判定標準**：
  - 進出場時數 >= 4h：建議為 1.0 MD。
  - 0 < 時數 < 4h：建議為 0.5 MD，但允許人工 Override 為 1.0 MD，且必須留下裁決紀錄。
- **決策完整性**：所有判定結果必須記錄在 `BillingDecision` 表，包含 `is_forced_md` 標記與 `reason`。