# YCS

## 本機開發環境設定

本機資料庫由 [Supabase CLI](https://supabase.com/docs/guides/cli) 透過 Docker 啟動，專案根目錄已含 `supabase/config.toml` 與 `supabase/migrations/`。

### 前置條件

- **Docker Desktop** 已安裝並在執行（Windows 必須先開啟 Docker）。
- **Node.js**（建議與團隊一致版本）。

### 安裝依賴

```bash
npm install
```

### 啟動本機 Supabase

```bash
npm run supabase:start
```

等同 `npx supabase start`，會拉取映像並啟動 API、Postgres、Studio 等容器。

### 依 migrations 重建本機資料庫

```bash
npm run supabase:reset
```

等同 `npx supabase db reset`，會清空本機資料庫並依 `supabase/migrations/` 重新套用所有 migration。若 CLI 詢問確認，可改執行：

```bash
npx supabase db reset --yes
```

### 清空本機業務資料（保留 schema）

若只需刪除資料、**不**重跑 migration（表結構與 RLS 維持不變），可執行：

```bash
npm run supabase:truncate
```

等同對本機資料庫執行 [`scripts/truncate-public-data.sql`](scripts/truncate-public-data.sql)（`npx supabase db query -f … --local`）：會 `TRUNCATE` 指定的 `public` 業務表並連同 `auth.users`（`CASCADE`）。與 `supabase:reset` 的差異：`reset` 會整庫重建並重新套用 migrations；`truncate` 僅清資料，速度較快，適合本機／測試反覆灌資料。

### 環境變數

1. 複製 `.env.example` 為 `.env.local`（若尚未建立）。
2. 啟動 Supabase 後執行 `npx supabase status`，將輸出中的 **anon**、**service_role** 等金鑰填入 `.env.local`（勿將含密鑰的檔案提交至版本庫）。

`DATABASE_URL` 預設可對齊 `.env.example`（本機 Postgres 埠請以 `supabase/config.toml` 的 `[db] port` 為準，目前為 `55432`）。

#### 工號登入（過渡期）所需密鑰

本專案的工號登入使用簽章 Cookie（JWT）作為工作階段；伺服器端需設定密鑰以簽署/驗證 Cookie，避免被偽造。

在 `.env.local` 加入：

```bash
YCS_SESSION_SECRET="至少 32 字元的隨機字串（僅伺服器端使用，勿加 NEXT_PUBLIC_）"
```

建議用 Git Bash 產生（擇一）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

注意：更換 `YCS_SESSION_SECRET` 會使既有登入 Cookie 全部失效（需要重新登入）。

### 開發伺服器

```bash
npm run dev
```

### 讓同事從區網連到你電腦（建議用 Production 模式）

同事只是用瀏覽器連線，不需要也不應該取得你的 `.env.local`；你只要在「架站那台電腦」設定好環境變數並啟動伺服器即可。

```bash
npm run build && npm run start
```

接著讓同事以你的電腦 IP 連線（例如 `http://<你的IP>:3000`）。

### 可選：連 Docker 狀態一併重來

若容器或本機資料異常，可先停止再啟動並 reset：

```bash
npx supabase stop
npm run supabase:start
npm run supabase:reset
```

一般情況下僅需 `npm run supabase:reset` 即可重建資料庫 schema。

---

## 版本號與更新日誌

- **版本號（SSOT）**：`package.json` 的 `version`
- **網站更新內容**：瀏覽 `/changelog`（由 `CHANGELOG.md` 解析渲染）
- **Dashboard 側欄**：底部「更新內容」連結會顯示目前版本號

### 平常開發（AI 輔助流程）

每次做完功能或修正，切換到 **Cursor Agent mode**，貼 [`docs/versioning-workflow.md`](docs/versioning-workflow.md) 中的「Prompt A」，讓 AI 讀 `git diff` 後：

1. 提案繁體中文 Conventional Commits 格式的 commit 訊息
2. 同步寫入 `CHANGELOG.md` 的 `[Unreleased]`
3. 判斷本次是否建議發版（patch / minor / major）

你確認措辭後，AI 統一執行 commit + push。

### 發版

若 AI 建議發版且你確認，AI 會接著執行：

```bash
npm run version:bump -- minor   # 或 patch / major
git push --follow-tags
```

詳細 SOP 與 Prompt 模板見 [`docs/versioning-workflow.md`](docs/versioning-workflow.md)。

---

## 延伸閱讀

- Supabase 工作流程（baseline、migration、簽章）：[`docs/supabase-workflow.md`](docs/supabase-workflow.md)
- 版本號與更新日誌工作流程（發版 SOP、Changelog 怎麼寫）：[`docs/versioning-workflow.md`](docs/versioning-workflow.md)
