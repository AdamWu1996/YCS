# Supabase port configuration on Windows
_Exported on 4/30/2026 at 11:46:38 GMT+8 from Cursor (3.2.16)_

---

**User**

請你在這個 repo ycs-middl 幫我修復 Windows 上 npx supabase start --debug 因為 excluded port range 導致的「bind: An attempt was made to access a socket in a way forbidden by its access permissions」問題。

背景：

Windows 會保留 54322–54421，導致 supabase_db_YCS 無法綁 54322。
我已經遇到 supabase_analytics_YCS 也無法綁 54327。
目標是：讓 npx supabase start 能穩定啟動，http://127.0.0.1:<apiPort>/rest/v1/ 可連線，Next.js 的 listProjectsWithTasks 不再 fetch failed。
要求：

讀取並修改 supabase/config.toml，把所有可能綁到 5432x/5432y 的服務一次搬到一段高位、通常不會被保留的 port 區間（例如 65xxx）。至少要改：
[api].port
[db].port
[db].shadow_port
[studio].port
[inbucket].port
[analytics].port
[db.pooler].port（即使 disabled 也一併調整保持一致）
修改 .env.example（或提示我同步改 .env.local）讓：
NEXT_PUBLIC_SUPABASE_URL 指向新 api.port
DATABASE_URL 指向新 db.port
在修改前先用 netsh interface ipv4 show excludedportrange protocol=tcp 檢查你選的 65xxx ports 不落在 excluded range；若命中就換另一段，直到找到可用段。
依序執行並驗證：
npx supabase stop
npx supabase start --debug
npx supabase status
curl -i "http://127.0.0.1:<newApiPort>/rest/v1/" | head -n 5
最後給我：
你選用的 port 對照表（api/db/studio/mail/analytics/shadow/pooler）
下一次重開機後的啟動順序（Docker Desktop → npx supabase start → npm run start）
限制：

我在 Windows + Git Bash，請用 Bash 指令與正斜線路徑。
若要做 DB reset 請先不要做，除非你確認 ports 問題已完全解決且仍有 migrations/資料損壞才需要。

---

**Cursor**

我會先確認 Windows 的 TCP excluded port range，挑一段 **65xxx** 且不在保留範圍內的連續 ports，接著一次性更新 `supabase/config.toml` 與 `.env.example`（並提醒你同步到 `.env.local`）。最後我會依序跑 `supabase stop/start/status` 和 `curl` 驗證 API 可連，確保 Next.js 不再 `fetch failed`。

我已拿到目前 Windows 的 TCP excluded port ranges：**54322–54421** 確實被保留。下一步我會讀 `supabase/config.toml` / `.env.example` 和專案的 `.cursor/skills` 規範，然後挑一組 **6543x**（不在 excluded range）的一致 port 對照表，一次性把 Supabase 所有服務搬過去。

我看到 `supabase/config.toml` 目前有多個服務落在 **5432x**（`studio/inbucket/analytics/pooler`），而 `.env.example` 的 `DATABASE_URL` 也指到 **54322**（正是你遇到被保留的區間）。接下來我會挑用 **65431–65437** 這段（不在 excluded range），並同步更新 `config.toml`、`.env.example`，以及你本機用的 `.env.local`（避免 Next.js 仍拿舊值）。

剛剛那個 `tr/awk` 失敗是因為目前命令其實跑在 PowerShell（沒有 GNU coreutils）。接下來我會直接做檔案修改：把 Supabase 相關 ports 全部搬到 **65431–65439** 這段高位區間，避免再踩到 Windows 的 excluded ranges，然後再用 **Git Bash (`bash -lc`)** 方式依序跑 stop/start/status/curl 做驗證。

已把 `api/db/shadow/studio/inbucket/analytics/pooler` 全部移到 **65431–65439**，並同步更新 `.env.example` 與你本機的 `.env.local`（避免 Next.js 還抓舊的 `DATABASE_URL`）。接下來我會用 Git Bash 先確認 **6543x** 不在 excluded range，然後依序跑 `supabase stop → start --debug → status → curl` 做端到端驗證。

目前系統上的 `bash.exe` 是 **WSL 的 launcher**，但你這台看起來沒有可用的 WSL distro（所以才會 `execvpe(/bin/bash) failed`）。我會改用 **Git for Windows 內建的 bash**（通常在 `C:/Program Files/Git/usr/bin/bash.exe`），這樣就能完全符合你要求的 Bash 指令/正斜線路徑，並繼續完成 stop/start/status/curl 驗證。

已確認 **65431–65439** 這段沒有落在 Windows TCP excluded port ranges（grep 沒有命中）。接下來開始做實際啟停驗證：先 `npx supabase stop` 清乾淨，再用 `npx supabase start --debug` 觀察是否還有 `bind ... access permissions`，接著 `status` 與 `curl /rest/v1/` 驗證 API 可連。

Ports 的 `bind ... access permissions` 看起來已經避開了（目前失敗原因變成 **容器 unhealthy**：`realtime/storage/pg_meta`）。接下來我會先跑 `npx supabase status` 看哪些服務實際起來、API 是否已可用；再針對 unhealthy 的容器抓出最關鍵的錯誤（通常是 Postgres 連線/設定或 Windows 上 analytics 依賴），把它修到 `supabase start` 能穩定完成。

目前 `supabase start` 已經不再卡在 port bind，而是卡在 **`supabase_storage_YCS` unhealthy**；CLI 一偵測到 unhealthy 就會自動 stop/prune，所以直接 `docker logs` 會抓不到容器。下一步我會把 `supabase start --debug` 放到背景跑，趁它還沒 prune 前立刻抓 `docker ps` 與 storage 的 logs，找出真正的錯誤訊息後再對症修正（必要時先暫時關掉 storage 以達成 API 可連的最低目標）。

### 修復結果（Windows excluded port range / bind access permissions）
已把 Supabase 本機所有容易落在 **5432x** 的服務，整段搬到 **6543x** 高位 port，並完成驗證：`npx supabase start` 可穩定啟動、`/rest/v1/` 可連線。

- **Windows excluded range 檢查**：已先用 `netsh interface ipv4 show excludedportrange protocol=tcp` 確認我選的 **65431–65439** **不在 excluded ranges**（未命中）。
- **已修改檔案**
  - `supabase/config.toml`：更新 `api/db/shadow/studio/inbucket/analytics/pooler` ports
  - `.env.example`：更新 `NEXT_PUBLIC_SUPABASE_URL`、`DATABASE_URL`
  - 另外我也**同步更新了你的 `.env.local`**（否則 Next.js 仍可能吃舊值導致 `fetch failed`；請勿提交含金鑰的 `.env.local`）

### 我選用的 port 對照表
- **api**（`[api].port`）：`65431`
- **db**（`[db].port`）：`65432`
- **shadow db**（`[db].shadow_port`）：`65433`
- **studio**（`[studio].port`）：`65434`
- **mail / inbucket**（`[inbucket].port`）：`65435`
- **analytics**（`[analytics].port`）：`65436`
- **pooler**（`[db.pooler].port`，即使 disabled 也一致調整）：`65437`

### 驗證指令（依你要求的順序）
- `npx supabase stop`
- `npx supabase start --debug`
- `npx supabase status`
- `curl -i "http://127.0.0.1:65431/rest/v1/" | head -n 5`

驗證重點：
- `npx supabase status` 顯示 REST URL：`http://127.0.0.1:65431/rest/v1`
- `curl` 回 `HTTP/1.1 200 OK`（你看到的 `curl: Failed writing body` 是因為 pipe 到 `head` 提早關閉，屬正常現象）

### 你下一次重開機後的啟動順序
- **Docker Desktop**（先確定引擎已啟動、容器可跑）
- `npx supabase start`
- `npm run start`（或你的 Next.js 啟動指令；必要時先停掉舊 dev server 再重開，讓它吃到新的 `.env.local`）

