---
description: 定義 YCS 專案的核心技術棧與開發慣例
globs:
  - "**/*"
alwaysApply: true
---
# YCS 技術棧規範

- **框架**: Next.js 14+ (App Router), TypeScript.
- **UI**: Tailwind CSS, shadcn/ui, Lucide React.
- **資料庫**: Supabase (PostgreSQL, Auth, Functions).
- **Excel 處理**: 
  - 前端讀取：`xlsx` (SheetJS)。
  - 後端產出：`exceljs` (Node environment)。
- **開發風格**: 優先使用 Server Actions，所有業務邏輯註解使用「繁體中文」。