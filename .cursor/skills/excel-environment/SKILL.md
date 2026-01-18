---
description: 嚴格區分 Excel 處理的執行環境，防止 Bundling 錯誤
globs:
  - "app/**/*.{ts,tsx}"
  - "components/**/*.{ts,tsx}"
  - "actions/**/*.{ts,tsx}"
---
# Excel 環境規範

- **前端 (Client Side)**：解析上傳的 Excel 僅限使用 `xlsx` (SheetJS)。
- **後端 (Server Actions/API)**：產生報表 Excel 僅限使用 `exceljs` (Node runtime)。
- **環境檢查**：禁止在 Client Component 中引用 `exceljs`。