# Project listing fetch error
_Exported on 4/30/2026 at 11:47:47 GMT+8 from Cursor (3.2.16)_

---

**User**

listProjectsWithTasks 錯誤: Error: 查詢專案列表失敗: TypeError: fetch failed
    at c (D:\Github\ycs-middl\.next\server\app\dashboard\projects\page.js:7:1160)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async i (D:\Github\ycs-middl\.next\server\app\dashboard\projects\page.js:7:5299)



---

**Cursor**

我先在專案裡定位 `listProjectsWithTasks` 的定義與 `dashboard/projects` 頁面實際呼叫哪個 API/Server Action，確認它用 `fetch` 打到哪裡、用的是相對/絕對 URL、以及是否依賴環境變數。找到呼叫點後，再對照 Next.js（Server Component）常見的 `fetch failed` 成因，給你最短路徑的排查清單與修法建議。

我已找到錯誤的來源檔案：`app/dashboard/projects/page.tsx` 直接呼叫 `actions/projects/maintenance.ts` 的 `listProjectsWithTasks()`。接下來我會把這兩個檔案的 `fetch`/Supabase client 初始化與錯誤處理讀出來，確認「fetch failed」到底是打到哪個 endpoint 失敗（常見是 Supabase URL/DNS/ENV/cookie/代理）。

我已確認 `fetch failed` 不是你自己寫的 `fetch()`，而是 Supabase JS client 內部打 Supabase REST 端點時拋出的（所以堆疊才會在 `.next/server/...page.js`）。下一步是把 `createServerSupabaseClient()` 讀出來，看看它用的 `SUPABASE_URL/ANON_KEY`、cookie、以及是否有自訂 `fetch`/代理設定。

## 你這個錯誤「真正在哪裡壞掉」

`listProjectsWithTasks()` 本身沒有用你自己寫的 `fetch()`；它是透過 Supabase JS client 去打 **Supabase REST（PostgREST）** 時，在底層 `fetch` 直接失敗（所以才會是 `TypeError: fetch failed`）。

呼叫鏈是：

- `app/dashboard/projects/page.tsx` 會 `await listProjectsWithTasks()`  
- `actions/projects/maintenance.ts` 內用 `createServerSupabaseClient()` 查：
  - `projects` + `tasks(*)`
  - `task_billing_summary`

相關程式碼位置：

```40:76:z:\Github\ycs-middl\actions\projects\maintenance.ts
export async function listProjectsWithTasks(): Promise<ActionResult<ProjectWithTasks[]>> {
  const supabase = createServerSupabaseClient();

  try {
    const [projectRes, summaryRes] = await Promise.all([
      supabase
        .from('projects')
        .select('*, tasks(*)')
        .order('code', { ascending: true }),
      supabase
        .from('task_billing_summary')
        .select('task_id, used_md'),
    ]);
    // ...
  } catch (error) {
    console.error('listProjectsWithTasks 錯誤:', error);
    return { success: false, error: error instanceof Error ? error.message : '未知錯誤' };
  }
}
```

而 `createServerSupabaseClient()` 用的是 `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`：

```9:28:z:\Github\ycs-middl\lib\supabase\server.ts
export function createServerSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    // ...會丟 Missing Supabase env ...
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

## 最常見原因（依你 repo 的 `.env.example`，命中率最高）

你們 `.env.example` 預設是本機 Supabase：

```3:3:z:\Github\ycs-middl\.env.example
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
```

所以 **最常見** 的 `fetch failed` 是：

- **本機 Supabase 沒有啟動**（或被防火牆/port 佔用）  
  → Next.js server action 去打 `http://127.0.0.1:54321` 直接連不上，就會是 `TypeError: fetch failed`

## 你可以用最短路徑排查（Git Bash）

### 1) 先確認 URL 根本打得到
（即使沒帶 key，通常也至少會回 401/一些 JSON；重點是「能連線」）

```bash
curl -i "http://127.0.0.1:54321/rest/v1/"
```

- **如果連線失敗**：就是 Supabase 沒起來 / 端口不對 / 被擋
- **如果有 HTTP 回應**：網路通了，下一步看 key / schema / RLS 等（但那時通常不會是 `fetch failed`，而會是 Supabase 回傳的 `projectRes.error.message`）

### 2) 用你 repo 現成的診斷腳本（它跟你現在同樣用 `createClient(url, service_role_key)`）
檔案：`scripts/diagnose-pending-view.mjs`

```bash
node --env-file=.env.local scripts/diagnose-pending-view.mjs
```

- **如果這個也直接 `fetch failed`**：100% 是 URL/連線層問題（Supabase 沒啟、URL 錯、DNS/代理/憑證）
- **如果這個能跑**：代表 Supabase 可連線，錯就更可能在 Next runtime 環境變數沒有被正確載入（例如 dev server 沒重啟）或 `.env.local` 沒被吃到

## 其他會導致 `fetch failed` 的情況（較少，但要知道）

- **`NEXT_PUBLIC_SUPABASE_URL` 寫錯**：少了 `http(s)://`、多空白、打到不存在的 host
- **公司代理 / DNS / SSL 攔截**（若你用的是遠端 `https://xxxx.supabase.co`）：Node 的 `fetch` 可能因憑證/代理設定直接炸掉
- **用 `localhost` 在容器/WSL/不同網路命名空間**：這時 `127.0.0.1` 指到的不是你以為的那台（你這裡看起來是純 Windows，所以通常沒這問題，除非你把 Next 跑在 Docker 裡）

## 我會建議你直接先做的修復方向

- **本機開發**：先確保 `npx supabase start` 有跑起來，且 `NEXT_PUBLIC_SUPABASE_URL` 指到正確的 `http://127.0.0.1:54321`
- **遠端 Supabase**：把 `.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL` 換成你專案的 `https://<ref>.supabase.co`，並確認網路/代理允許連線

如果你把你目前 `.env.local` 的 **`NEXT_PUBLIC_SUPABASE_URL` 值（可以遮掉專案 ref 的中段）**、以及你 `curl -i .../rest/v1/` 的輸出貼上來，我可以精準判斷是「Supabase 沒啟動」還是「URL/網路層被擋」。

---

**User**

重開機要先執行docker還是npx supabase start，有一樣嗎?

---

**Cursor**

不一樣，取決於你專案的 Supabase 是「用 Supabase CLI 起本機 containers」還是「你自己用 `docker compose` 起」。

## 你這個 repo（依 `.env.example`）最可能的正確順序
- **先確保 Docker Desktop 已啟動**
- 再跑 **`npx supabase start`**

原因是：`npx supabase start` 本質上會用 Docker 去啟動本機 Supabase 需要的容器；Docker 沒先起來，CLI 也起不來（或會卡/報錯），最後就會導致你看到的 `fetch failed`（打 `127.0.0.1:54321` 但其實沒服務）。

## 什麼情況下「先跑 Docker」跟「跑 `npx supabase start`」看起來一樣？
- 你「先開 Docker Desktop」只是讓 Docker daemon 可用；真正把 Supabase 服務起來的還是 **`npx supabase start`**（或你自己的 compose）。
- 所以兩者不是同一件事：**Docker 只是引擎**，`supabase start` 才是「把 Postgres / Kong / PostgREST 等服務跑起來」。

## 如果你是用 `docker compose up -d` 那套（不是 Supabase CLI）
- **先開 Docker Desktop**
- 再跑 **`docker compose up -d`**
- 這時通常不需要 `npx supabase start`（兩套同時跑反而可能 port 衝突）

## 最快判斷你現在是哪一套
重開機後先跑：

```bash
npx supabase status
```

- **如果顯示 stopped / not running**：再跑 `npx supabase start`
- **如果顯示 API URL（通常 `http://127.0.0.1:54321`）等都在**：就不必再 start

結論：**重開機後，先把 Docker Desktop 開著，再用你實際採用的方式起服務；對你目前的錯誤情境，通常就是 `Docker Desktop -> npx supabase start`。**

---

**User**

重開機後
boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ npm run supabase:start

> ycs-project@0.5.0-beta.1 supabase:start
> npx supabase start

supabase start is already running.
supabase_db_YCS container is not running: exited
Try rerunning the command with --debug to troubleshoot the error.

---

**Cursor**

這個訊息代表 **Supabase CLI 以為「整套已在跑」**，但實際上 **核心的 Postgres 容器 `supabase_db_YCS` 已經掛掉（exited）**，所以你的 Next.js 連 `127.0.0.1:54321` 才會 `fetch failed`。

## 先講結論（你接下來該做什麼）
- **這不是順序問題**，是 **DB container 啟動失敗/啟動後立刻崩潰**。
- 需要看 **DB container 的 log** 才能知道原因。

## 最短排查流程（Git Bash）
### 1) 先確認容器狀態
```bash
docker ps -a --filter "name=supabase_db_YCS"
```

### 2) 直接看 DB 容器最後輸出（最關鍵）
```bash
docker logs --tail 200 supabase_db_YCS
```

通常會看到像：
- 資料檔案權限/損毀
- Port 54322 被佔用
- 磁碟空間不足
- Postgres 起不來（extension/設定/升版）

### 3) 用 debug 讓 Supabase CLI 把原因印完整
```bash
npx supabase start --debug
```

## 為什麼會顯示 “already running”？
Supabase CLI 會用自己的狀態判斷「project stack 已啟動」，但其中某個 container（你的 DB）可能在重開機後自動停止或啟動後 crash，於是就變成這種「表面在跑、實際不完整」的狀態。

---

把 `docker logs --tail 200 supabase_db_YCS` 的輸出貼上來（關鍵錯誤幾行就好），我可以直接告訴你是哪一類問題、對應要怎麼修。

---

**User**

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ docker ps -a --filter "name=supabase_db_YCS"
CONTAINER ID   IMAGE                                         COMMAND                    CREATED       STATUS                       PORTS     NAMES
32ef5f5424c6   public.ecr.aws/supabase/postgres:17.6.1.106   "sh -c '\ncat <<'EOF'…"   2 weeks ago   Exited (137) 8 minutes ago             supabase_db_YCS

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ docker logs --tail 200 supabase_db_YCS
 2026-04-24 06:58:09.665 UTC [60] LOG:  checkpoint complete: wrote 28 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.793 s, sync=0.083 s, total=3.199 s; sync files=11, longest=0.056 s, average=0.008 s; distance=149 kB, estimate=234 kB; lsn=0/1A8AF560, redo lsn=0/1A8AF4A8
 2026-04-24 07:03:06.690 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:03:09.309 UTC [60] LOG:  checkpoint complete: wrote 23 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.257 s, sync=0.082 s, total=2.620 s; sync files=11, longest=0.056 s, average=0.008 s; distance=105 kB, estimate=221 kB; lsn=0/1A8C9A70, redo lsn=0/1A8C99E8
 2026-04-24 07:08:06.379 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:08:08.470 UTC [60] LOG:  checkpoint complete: wrote 18 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=1.756 s, sync=0.081 s, total=2.092 s; sync files=8, longest=0.054 s, average=0.011 s; distance=89 kB, estimate=208 kB; lsn=0/1A8E00D8, redo lsn=0/1A8E0080
 2026-04-24 07:13:06.547 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:13:09.531 UTC [60] LOG:  checkpoint complete: wrote 22 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.158 s, sync=0.062 s, total=2.985 s; sync files=11, longest=0.060 s, average=0.006 s; distance=109 kB, estimate=198 kB; lsn=0/1A8FB520, redo lsn=0/1A8FB498
 2026-04-24 07:18:06.606 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:18:09.199 UTC [60] LOG:  checkpoint complete: wrote 23 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.258 s, sync=0.086 s, total=2.593 s; sync files=8, longest=0.058 s, average=0.011 s; distance=120 kB, estimate=190 kB; lsn=0/1A9195E0, redo lsn=0/1A919558
 2026-04-24 07:23:06.183 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:23:08.954 UTC [60] LOG:  checkpoint complete: wrote 25 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.458 s, sync=0.087 s, total=2.772 s; sync files=12, longest=0.061 s, average=0.008 s; distance=128 kB, estimate=184 kB; lsn=0/1A939828, redo lsn=0/1A939768
 2026-04-24 07:28:06.963 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:28:11.896 UTC [60] LOG:  checkpoint complete: wrote 43 buffers (0.3%); 0 WAL file(s) added, 0 removed, 0 recycled; write=4.267 s, sync=0.331 s, total=4.934 s; sync files=14, longest=0.156 s, average=0.024 s; distance=238 kB, estimate=238 kB; lsn=0/1A975258, redo lsn=0/1A9751A0
 2026-04-24 07:33:06.953 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:33:09.962 UTC [60] LOG:  checkpoint complete: wrote 27 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.659 s, sync=0.098 s, total=3.010 s; sync files=11, longest=0.070 s, average=0.009 s; distance=104 kB, estimate=225 kB; lsn=0/1A98F610, redo lsn=0/1A98F588
 2026-04-24 07:38:07.028 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:38:10.144 UTC [60] LOG:  checkpoint complete: wrote 28 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.760 s, sync=0.102 s, total=3.116 s; sync files=11, longest=0.100 s, average=0.010 s; distance=155 kB, estimate=218 kB; lsn=0/1A9B6460, redo lsn=0/1A9B63D8
 2026-04-24 07:43:07.189 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:43:09.804 UTC [60] LOG:  checkpoint complete: wrote 22 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.158 s, sync=0.106 s, total=2.616 s; sync files=8, longest=0.068 s, average=0.014 s; distance=113 kB, estimate=207 kB; lsn=0/1A9D2938, redo lsn=0/1A9D28B0
 2026-04-24 07:48:07.879 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:48:10.852 UTC [60] LOG:  checkpoint complete: wrote 27 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.660 s, sync=0.086 s, total=2.973 s; sync files=10, longest=0.060 s, average=0.009 s; distance=154 kB, estimate=202 kB; lsn=0/1A9F94A8, redo lsn=0/1A9F93C0
 2026-04-24 07:53:07.934 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:53:10.536 UTC [60] LOG:  checkpoint complete: wrote 23 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.259 s, sync=0.083 s, total=2.602 s; sync files=10, longest=0.057 s, average=0.009 s; distance=100 kB, estimate=192 kB; lsn=0/1AA127D8, redo lsn=0/1AA12750
 2026-04-24 07:58:07.617 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 07:58:16.293 UTC [60] LOG:  checkpoint complete: wrote 82 buffers (0.5%); 0 WAL file(s) added, 0 removed, 0 recycled; write=8.184 s, sync=0.091 s, total=8.677 s; sync files=14, longest=0.052 s, average=0.007 s; distance=469 kB, estimate=469 kB; lsn=0/1AA87D48, redo lsn=0/1AA87BC8
 2026-04-24 08:03:07.288 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:03:10.250 UTC [60] LOG:  checkpoint complete: wrote 27 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.608 s, sync=0.094 s, total=2.963 s; sync files=11, longest=0.067 s, average=0.009 s; distance=139 kB, estimate=436 kB; lsn=0/1AAAA998, redo lsn=0/1AAAA910
 2026-04-24 08:08:07.299 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:08:09.882 UTC [60] LOG:  checkpoint complete: wrote 23 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.256 s, sync=0.091 s, total=2.584 s; sync files=9, longest=0.065 s, average=0.011 s; distance=119 kB, estimate=404 kB; lsn=0/1AAC8890, redo lsn=0/1AAC8838
 2026-04-24 08:13:07.878 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:13:10.622 UTC [60] LOG:  checkpoint complete: wrote 24 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.358 s, sync=0.125 s, total=2.744 s; sync files=10, longest=0.099 s, average=0.013 s; distance=109 kB, estimate=375 kB; lsn=0/1AAE3F80, redo lsn=0/1AAE3EC0
 2026-04-24 08:18:07.706 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:18:12.096 UTC [60] LOG:  checkpoint complete: wrote 39 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=3.863 s, sync=0.219 s, total=4.391 s; sync files=15, longest=0.037 s, average=0.015 s; distance=208 kB, estimate=358 kB; lsn=0/1AB180D8, redo lsn=0/1AB17FD8
 2026-04-24 08:23:07.178 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:23:09.692 UTC [60] LOG:  checkpoint complete: wrote 22 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.157 s, sync=0.107 s, total=2.515 s; sync files=9, longest=0.080 s, average=0.012 s; distance=123 kB, estimate=334 kB; lsn=0/1AB36C50, redo lsn=0/1AB36BF8
 2026-04-24 08:28:07.725 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:28:10.647 UTC [60] LOG:  checkpoint complete: wrote 26 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.559 s, sync=0.083 s, total=2.922 s; sync files=12, longest=0.056 s, average=0.007 s; distance=144 kB, estimate=315 kB; lsn=0/1AB5AC70, redo lsn=0/1AB5AC18
 2026-04-24 08:33:07.650 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:33:10.207 UTC [60] LOG:  checkpoint complete: wrote 22 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.156 s, sync=0.093 s, total=2.557 s; sync files=8, longest=0.067 s, average=0.012 s; distance=121 kB, estimate=296 kB; lsn=0/1AB79438, redo lsn=0/1AB793E0
 2026-04-24 08:38:07.251 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:38:09.559 UTC [60] LOG:  checkpoint complete: wrote 20 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=1.957 s, sync=0.090 s, total=2.308 s; sync files=8, longest=0.064 s, average=0.012 s; distance=113 kB, estimate=278 kB; lsn=0/1AB95AE8, redo lsn=0/1AB95A90
 2026-04-24 08:43:07.635 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:43:10.846 UTC [60] LOG:  checkpoint complete: wrote 29 buffers (0.2%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.872 s, sync=0.104 s, total=3.212 s; sync files=13, longest=0.078 s, average=0.008 s; distance=156 kB, estimate=265 kB; lsn=0/1ABBCE60, redo lsn=0/1ABBCE08
 2026-04-24 08:48:07.891 UTC [60] LOG:  checkpoint starting: time
 2026-04-24 08:48:10.753 UTC [60] LOG:  checkpoint complete: wrote 21 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=2.108 s, sync=0.300 s, total=2.863 s; sync files=8, longest=0.164 s, average=0.038 s; distance=121 kB, estimate=251 kB; lsn=0/1ABDB5F8, redo lsn=0/1ABDB5A0

PostgreSQL Database directory appears to contain a database; Skipping initialization

 2026-04-30 02:03:47.154 UTC [11] LOG:  pgaudit extension initialized
 2026-04-30 02:03:54.319 UTC [11] LOG:  pgsodium primary server secret key loaded
 2026-04-30 02:03:55.948 UTC [11] LOG:  vault primary server secret key loaded
 2026-04-30 02:03:56.367 UTC [11] LOG:  starting PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
 2026-04-30 02:03:56.368 UTC [11] LOG:  listening on IPv4 address "0.0.0.0", port 5432
 2026-04-30 02:03:56.368 UTC [11] LOG:  listening on IPv6 address "::", port 5432
 2026-04-30 02:03:56.709 UTC [11] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
 2026-04-30 02:03:57.134 UTC [61] LOG:  database system was interrupted; last known up at 2026-04-24 08:48:10 UTC
172.19.0.4 2026-04-30 02:03:58.210 UTC [62] supabase_admin@postgres FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:00.259 UTC [63] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:00.259 UTC [64] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.7 2026-04-30 02:04:01.040 UTC [66] supabase_auth_admin@postgres FATAL:  the database system is starting up
172.19.0.7 2026-04-30 02:04:01.045 UTC [68] supabase_auth_admin@postgres FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:02.004 UTC [69] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:02.160 UTC [76] supabase_admin@_supabase FATAL:  the database system is starting up
127.0.0.1 2026-04-30 02:04:02.201 UTC [77] postgres@postgres FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:03.887 UTC [78] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:03.899 UTC [79] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:05.814 UTC [80] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.3 2026-04-30 02:04:05.998 UTC [81] authenticator@postgres FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:06.489 UTC [82] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.3 2026-04-30 02:04:06.549 UTC [83] authenticator@postgres FATAL:  the database system is starting up
172.19.0.3 2026-04-30 02:04:06.556 UTC [84] authenticator@postgres FATAL:  the database system is starting up
172.19.0.3 2026-04-30 02:04:06.572 UTC [85] authenticator@postgres FATAL:  the database system is starting up
172.19.0.3 2026-04-30 02:04:06.593 UTC [86] authenticator@postgres FATAL:  the database system is starting up
 2026-04-30 02:04:07.249 UTC [61] LOG:  syncing data directory (fsync), elapsed time: 10.00 s, current path: ./pg_logical/snapshots/0-1550A8E8.snap
172.19.0.4 2026-04-30 02:04:08.795 UTC [87] supabase_admin@postgres FATAL:  the database system is starting up
172.19.0.4 2026-04-30 02:04:08.800 UTC [88] supabase_admin@postgres FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:08.951 UTC [89] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.4 2026-04-30 02:04:10.910 UTC [90] supabase_admin@postgres FATAL:  the database system is starting up
172.19.0.7 2026-04-30 02:04:11.176 UTC [92] supabase_auth_admin@postgres FATAL:  the database system is starting up
172.19.0.7 2026-04-30 02:04:11.181 UTC [94] supabase_auth_admin@postgres FATAL:  the database system is starting up
172.19.0.11 2026-04-30 02:04:11.295 UTC [95] supabase_admin@_supabase FATAL:  the database system is starting up
172.19.0.4 2026-04-30 02:04:11.388 UTC [96] supabase_admin@postgres FATAL:  the database system is starting up
127.0.0.1 2026-04-30 02:04:12.291 UTC [104] postgres@postgres FATAL:  the database system is starting up
172.19.0.4 2026-04-30 02:04:13.675 UTC [105] supabase_admin@postgres FATAL:  the database system is starting up
172.19.0.4 2026-04-30 02:04:14.609 UTC [106] supabase_admin@postgres FATAL:  the database system is starting up
 2026-04-30 02:04:15.873 UTC [61] LOG:  database system was not properly shut down; automatic recovery in progress
 2026-04-30 02:04:16.376 UTC [61] LOG:  redo starts at 0/1ABDB5A0
 2026-04-30 02:04:16.752 UTC [61] LOG:  invalid record length at 0/1ABF2140: expected at least 24, got 0
 2026-04-30 02:04:16.752 UTC [61] LOG:  redo done at 0/1ABF2110 system usage: CPU: user: 0.00 s, system: 0.00 s, elapsed: 0.39 s
 2026-04-30 02:04:18.512 UTC [59] LOG:  checkpoint starting: end-of-recovery immediate wait
172.19.0.4 2026-04-30 02:04:21.140 UTC [107] supabase_admin@postgres FATAL:  the database system is not accepting connections
172.19.0.4 2026-04-30 02:04:21.140 UTC [107] supabase_admin@postgres DETAIL:  Hot standby mode is disabled.
 2026-04-30 02:04:21.309 UTC [59] LOG:  checkpoint complete: wrote 18 buffers (0.1%); 0 WAL file(s) added, 1 removed, 4 recycled; write=0.212 s, sync=0.359 s, total=2.924 s; sync files=10, longest=0.137 s, average=0.036 s; distance=90 kB, estimate=90 kB; lsn=0/1ABF2140, redo lsn=0/1ABF2140
 2026-04-30 02:04:21.454 UTC [11] LOG:  database system is ready to accept connections
 2026-04-30 02:04:23.898 UTC [111] LOG:  pg_cron scheduler started
172.19.0.11 2026-04-30 02:04:44.422 UTC [154] supabase_admin@_supabase LOG:  logical decoding found consistent point at 0/1ABF9C40
172.19.0.11 2026-04-30 02:04:44.422 UTC [154] supabase_admin@_supabase DETAIL:  There are no running transactions.
172.19.0.11 2026-04-30 02:04:44.422 UTC [154] supabase_admin@_supabase STATEMENT:  CREATE_REPLICATION_SLOT cainophile_y4g9qbju TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT
172.19.0.11 2026-04-30 02:04:44.423 UTC [154] supabase_admin@_supabase LOG:  starting logical decoding for slot "cainophile_y4g9qbju"
172.19.0.11 2026-04-30 02:04:44.423 UTC [154] supabase_admin@_supabase DETAIL:  Streaming transactions committing after 0/1ABF9C78, reading WAL from 0/1ABF9C40.
172.19.0.11 2026-04-30 02:04:44.423 UTC [154] supabase_admin@_supabase STATEMENT:  START_REPLICATION SLOT cainophile_y4g9qbju LOGICAL 0/0 (proto_version '1', publication_names '"logflare_pub"')
172.19.0.11 2026-04-30 02:04:44.424 UTC [154] supabase_admin@_supabase LOG:  logical decoding found consistent point at 0/1ABF9C40
172.19.0.11 2026-04-30 02:04:44.424 UTC [154] supabase_admin@_supabase DETAIL:  There are no running transactions.
172.19.0.11 2026-04-30 02:04:44.424 UTC [154] supabase_admin@_supabase STATEMENT:  START_REPLICATION SLOT cainophile_y4g9qbju LOGICAL 0/0 (proto_version '1', publication_names '"logflare_pub"')
172.19.0.11 2026-04-30 02:04:45.435 UTC [145] supabase_admin@_supabase ERROR:  duplicate key value violates unique constraint "users_lower_email_index"
172.19.0.11 2026-04-30 02:04:45.435 UTC [145] supabase_admin@_supabase DETAIL:  Key (lower(email::text))=(default@logflare.app) already exists.
172.19.0.11 2026-04-30 02:04:45.435 UTC [145] supabase_admin@_supabase STATEMENT:  INSERT INTO "users" ("name","token","email","api_key","provider","system_monitoring","partner_upgraded","email_preferred","email_me_product","api_quota","admin","billing_enabled","bigquery_enable_managed_service_accounts","endpoints_beta","provider_uid","inserted_at","updated_at") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING "id"
172.19.0.11 2026-04-30 02:04:45.771 UTC [163] postgres@_supabase LOG:  execute <unnamed>: CREATE SCHEMA IF NOT EXISTS _analytics
172.19.0.11 2026-04-30 02:04:45.771 UTC [162] postgres@_supabase LOG:  execute <unnamed>: CREATE SCHEMA IF NOT EXISTS _analytics
172.19.0.11 2026-04-30 02:04:45.771 UTC [164] postgres@_supabase LOG:  execute <unnamed>: CREATE SCHEMA IF NOT EXISTS _analytics
172.19.0.11 2026-04-30 02:04:45.780 UTC [164] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_42ad0ed1_6873_4dfd_95d3_74d7f68ac13d (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:45.780 UTC [164] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_42ad0ed1_6873_4dfd_95d3_74d7f68ac13d_timestamp_brin_idx ON log_events_42ad0ed1_6873_4dfd_95d3_74d7f68ac13d USING brin (timestamp)

172.19.0.11 2026-04-30 02:04:45.923 UTC [163] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_89efeb8a_ac61_47da_a5c8_82915ecc6e7c (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:45.924 UTC [163] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_89efeb8a_ac61_47da_a5c8_82915ecc6e7c_timestamp_brin_idx ON log_events_89efeb8a_ac61_47da_a5c8_82915ecc6e7c USING brin (timestamp)

172.19.0.11 2026-04-30 02:04:45.938 UTC [162] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_a6b2a998_6fb9_4b04_b6d2_fd3d8b35de9a (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:45.939 UTC [162] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_a6b2a998_6fb9_4b04_b6d2_fd3d8b35de9a_timestamp_brin_idx ON log_events_a6b2a998_6fb9_4b04_b6d2_fd3d8b35de9a USING brin (timestamp)

172.19.0.11 2026-04-30 02:04:45.951 UTC [164] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_b4610ec7_3a1b_4497_a43e_fb7e507375a0 (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:45.952 UTC [164] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_b4610ec7_3a1b_4497_a43e_fb7e507375a0_timestamp_brin_idx ON log_events_b4610ec7_3a1b_4497_a43e_fb7e507375a0 USING brin (timestamp)

172.19.0.11 2026-04-30 02:04:45.964 UTC [163] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_86a7ffcd_b171_4903_ad59_5beaa0dc4cf7 (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:45.965 UTC [163] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_86a7ffcd_b171_4903_ad59_5beaa0dc4cf7_timestamp_brin_idx ON log_events_86a7ffcd_b171_4903_ad59_5beaa0dc4cf7 USING brin (timestamp)

172.19.0.11 2026-04-30 02:04:45.978 UTC [162] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_eb751fef_864a_4984_91d7_2461c8ab2e8c (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:45.979 UTC [162] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_eb751fef_864a_4984_91d7_2461c8ab2e8c_timestamp_brin_idx ON log_events_eb751fef_864a_4984_91d7_2461c8ab2e8c USING brin (timestamp)

172.19.0.11 2026-04-30 02:04:46.023 UTC [164] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_cf086a3f_2edc_4f78_8f62_d72583cfdd93 (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:46.024 UTC [164] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_cf086a3f_2edc_4f78_8f62_d72583cfdd93_timestamp_brin_idx ON log_events_cf086a3f_2edc_4f78_8f62_d72583cfdd93 USING brin (timestamp)

172.19.0.11 2026-04-30 02:04:46.037 UTC [163] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_52c7a6cd_2d90_4e95_9b3e_4744bbb292b0 (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:46.038 UTC [163] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_52c7a6cd_2d90_4e95_9b3e_4744bbb292b0_timestamp_brin_idx ON log_events_52c7a6cd_2d90_4e95_9b3e_4744bbb292b0 USING brin (timestamp)

172.19.0.11 2026-04-30 02:04:46.051 UTC [162] postgres@_supabase LOG:  execute <unnamed>: CREATE TABLE IF NOT EXISTS log_events_fb4e5bc5_e00c_4038_9e0d_4bbb17ea3e01 (
          id TEXT PRIMARY KEY,
          body JSONB,
          event_message TEXT,
          timestamp TIMESTAMP
        )

172.19.0.11 2026-04-30 02:04:46.051 UTC [162] postgres@_supabase LOG:  execute <unnamed>: CREATE INDEX IF NOT EXISTS log_events_fb4e5bc5_e00c_4038_9e0d_4bbb17ea3e01_timestamp_brin_idx ON log_events_fb4e5bc5_e00c_4038_9e0d_4bbb17ea3e01 USING brin (timestamp)

172.19.0.7 2026-04-30 02:04:50.798 UTC [137] supabase_admin@postgres LOG:  unexpected EOF on client connection with an open transaction
172.19.0.3 2026-04-30 02:04:53.838 UTC [135] authenticator@postgres ERROR:  canceling statement due to statement timeout
172.19.0.3 2026-04-30 02:04:53.838 UTC [135] authenticator@postgres STATEMENT:  SELECT name FROM pg_timezone_names
 2026-04-30 02:09:18.363 UTC [59] LOG:  checkpoint starting: time
 2026-04-30 02:09:46.982 UTC [59] LOG:  checkpoint complete: wrote 281 buffers (1.7%); 0 WAL file(s) added, 0 removed, 0 recycled; write=28.066 s, sync=0.161 s, total=28.620 s; sync files=93, longest=0.050 s, average=0.002 s; distance=1715 kB, estimate=1715 kB; lsn=0/1AD9F0E0, redo lsn=0/1AD9EDB0
 2026-04-30 02:14:19.003 UTC [59] LOG:  checkpoint starting: time
 2026-04-30 02:14:20.532 UTC [59] LOG:  checkpoint complete: wrote 13 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=1.205 s, sync=0.100 s, total=1.530 s; sync files=8, longest=0.074 s, average=0.013 s; distance=27 kB, estimate=1546 kB; lsn=0/1ADA5D78, redo lsn=0/1ADA5CC0
 2026-04-30 02:19:19.531 UTC [59] LOG:  checkpoint starting: time
 2026-04-30 02:19:21.860 UTC [59] LOG:  checkpoint complete: wrote 20 buffers (0.1%); 0 WAL file(s) added, 0 removed, 0 recycled; write=1.982 s, sync=0.085 s, total=2.330 s; sync files=14, longest=0.058 s, average=0.007 s; distance=50 kB, estimate=1396 kB; lsn=0/1ADB25E0, redo lsn=0/1ADB2528

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ npx supabase start --debug
open C:\Users\BOYAWU\.supabase\profile: The system cannot find the file specified.
Supabase CLI 2.89.1
Using profile: supabase (supabase.co)
supabase start is already running.
2026/04/30 10:31:42 HTTP POST: https://eu.i.posthog.com/batch/
supabase_db_YCS container is not running: exited

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ 


---

**Cursor**

你這邊的關鍵其實已經出來了：

- `Exited (137)` 幾乎等同 **容器被 SIGKILL**，最常見原因是 **Docker Desktop 記憶體不足 / OOM 被殺**（或你手動/系統把 Docker restart，導致容器被硬殺）。
- 你貼的 `docker logs` 末段顯示 Postgres **其實有成功恢復並且 ready**，但後來整個 container 又被殺掉，所以 CLI 才會一直說「already running（整套 stack 還在）」但「db container exited」。

另外 `open ...\.supabase\profile: The system cannot find the file specified.` 只是 CLI 找不到 profile 檔，**不會導致 DB exited**，可先忽略。

## 先用 2 個指令「證實是不是 OOM」
在 Git Bash 跑：

```bash
docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} err={{.State.Error}}' supabase_db_YCS
```

- 若 `oom=true`：就是 **Docker 記憶體不夠**（最常見）

再補一個確認最後結束原因時間點：

```bash
docker inspect -f 'finished={{.State.FinishedAt}} started={{.State.StartedAt}}' supabase_db_YCS
```

## 如果真的是 OOM（oom=true），最有效的修法
- **Docker Desktop → Settings → Resources**
  - **Memory** 調高（建議至少 6–8GB；你如果還同時跑 Next/IDE/Browser，可能要更高）
  - **Swap** 開啟/加大（有時救命）
- 然後整套重啟一次（避免 CLI 卡在 “already running” 的半殘狀態）：

```bash
npx supabase stop
npx supabase start
```

（這兩個是 CLI 的「正規收斂」方式，比你只重跑 `start` 更不容易卡狀態）

## 如果 oom=false，那 Exit 137 也可能是「外力 kill」
例如 Docker Desktop 重啟、系統休眠恢復、或你電腦省電把 WSL/Docker 砍掉。這種情況也一樣建議先：

```bash
npx supabase stop
npx supabase start
```

## 你現在要我精準判斷，請貼這一行輸出就夠
把下面這個指令的單行結果貼上來（不含任何機密）：

```bash
docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}} {{.State.Error}}' supabase_db_YCS
```

我就能直接告訴你下一步應該調資源、排 port、還是查 volume/磁碟問題。

---

**User**

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} err={{.State.Error}}' supabase_db_YCS
exited exit=137 oom=false err=

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ docker inspect -f 'finished={{.State.FinishedAt}} started={{.State.StartedAt}}' supabase_db_YCS
finished=2026-04-30T02:22:58.338108503Z started=2026-04-30T02:02:49.636373703Z

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ 



---

**Cursor**

收到，**oom=false**，所以不是記憶體 OOM 自動殺掉。

## 這代表什麼
`exit=137` 仍然是 **被 SIGKILL**，但來源更像是「外力把容器砍掉」而不是 Postgres 自己崩潰：

- **Docker Desktop / Docker daemon 重啟**（最常見，尤其筆電睡眠/喚醒後）
- **Windows 省電/休眠**導致 Docker 後端重置
- 手動 stop / 某個清理工具把容器殺掉
- （較少）磁碟壓力或後端故障導致 Docker 強制終止

而且你 log 裡 Postgres 已經進到 `database system is ready to accept connections`，表示 **DB 啟得起來**；問題是後面被殺掉。

## 你現在卡在 “supabase start is already running” 的根本原因
Supabase CLI 仍認為 stack 在跑（其他容器可能還活著），但 DB 已死；所以你需要 **先讓 CLI 狀態收斂（stop）再 start**，不要一直 start。

## 建議你照這個順序做（Git Bash）
### 1) 先看整套 Supabase 容器目前誰還活著（確認是不是「半套」）
```bash
docker ps --filter "name=supabase_"
```

### 2) 乾淨停掉再重啟（最常解）
```bash
npx supabase stop
npx supabase start
```

### 3) 如果你一重啟又很快變 exited（137），就查「是不是 Docker daemon 有重啟紀錄」
在 Windows 端常見是 Docker Desktop 顯示 “Engine restarting / WSL integration restarting”。這時你需要：
- 避免睡眠/休眠後直接用（先重開 Docker Desktop）
- 或到 Docker Desktop 設定把 **“Start Docker Desktop when you log in”** 打開、並確認 WSL/Docker 後端穩定

## 我想「挑戰你」一下：現在最有效的驗證方式
你不用等 Next.js 出錯，重啟後立刻用這個做健康檢查：

```bash
npx supabase status
curl -i "http://127.0.0.1:54321/rest/v1/"
```

- `status` 看到 URL/ports 都在 + `curl` 有回應（即便 401 也行）→ 你的 `fetch failed` 就會消失
- 如果 DB 又死掉，再回頭看 **是不是 Docker Desktop 在你那段時間內重啟**（最符合 exit 137 + oom=false）

如果你貼一下 `docker ps --filter "name=supabase_"` 的輸出，我可以幫你判斷目前是不是「只剩 API / Kong 活著但 DB 死掉」的半殘狀態，並給你對應的最短修復指令組合。

---

**User**

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ docker ps --filter "name=supabase_"
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES

---

**Cursor**

目前 `docker ps` 顯示 **沒有任何 `supabase_*` 容器在跑**，所以「`supabase start is already running`」是 **Supabase CLI 的狀態卡住/殘留**（不是 Docker 真的還在跑）。

這種狀況最短解法是讓 CLI 先「收斂狀態」再重啟：

## 立刻可做（Git Bash）
```bash
npx supabase stop
npx supabase start
```

- `stop` 會把 CLI 記錄的 running 狀態清掉（即使容器已不在也應該能收斂）
- 然後 `start` 重新把整套拉起來

## 如果 `stop` 也說找不到/仍卡住
改用「完整清理 + 重啟」的方式（仍然是 CLI 正規流程）：

```bash
npx supabase stop --no-backup
npx supabase start --debug
```

## 為什麼你會遇到這個
你前面 DB 曾經跑起來又被 SIGKILL（137），接著整套容器都不在了，但 CLI 仍判定 “already running”。這通常發生在：
- Docker Desktop/daemon 重啟、或睡眠喚醒後後端重置
- CLI 來不及更新狀態檔

## 重啟成功後的「驗證兩步」
```bash
npx supabase status
curl -i "http://127.0.0.1:54321/rest/v1/"
```

只要這兩步 OK，你 `listProjectsWithTasks` 的 `fetch failed` 就會消失（因為 Supabase REST 有回應了）。

---

**User**


boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ npx supabase status
curl -i "http://127.0.0.1:54321/rest/v1/"
Stopped services: [supabase_imgproxy_YCS supabase_pooler_YCS]
supabase local development setup is running.

╭──────────────────────────────────────╮
│ 🔧 Development Tools                 │
├─────────┬────────────────────────────┤
│ Studio  │ http://127.0.0.1:54323     │
│ Mailpit │ http://127.0.0.1:54324     │
│ MCP     │ http://127.0.0.1:54321/mcp │
╰─────────┴────────────────────────────╯

╭──────────────────────────────────────────────────────╮
│ 🌐 APIs                                              │
├────────────────┬─────────────────────────────────────┤
│ Project URL    │ http://127.0.0.1:54321              │
│ REST           │ http://127.0.0.1:54321/rest/v1      │
│ GraphQL        │ http://127.0.0.1:54321/graphql/v1   │
│ Edge Functions │ http://127.0.0.1:54321/functions/v1 │
╰────────────────┴─────────────────────────────────────╯

╭───────────────────────────────────────────────────────────────╮
│ ⛁ Database                                                    │
├─────┬─────────────────────────────────────────────────────────┤
│ URL │ postgresql://postgres:postgres@127.0.0.1:54322/postgres │
╰─────┴─────────────────────────────────────────────────────────╯

╭──────────────────────────────────────────────────────────────╮
│ 🔑 Authentication Keys                                       │
├─────────────┬────────────────────────────────────────────────┤
│ Publishable │ sb_publishable_<local-dev-redacted>            │
│ Secret      │ sb_secret_<local-dev-redacted>                 │
╰─────────────┴────────────────────────────────────────────────╯

╭───────────────────────────────────────────────────────────────────────────────╮
│ 📦 Storage (S3)                                                               │
├────────────┬──────────────────────────────────────────────────────────────────┤
│ URL        │ http://127.0.0.1:54321/storage/v1/s3                             │
│ Access Key │ <local-s3-access-key-redacted>                                     │
│ Secret Key │ <local-s3-secret-key-redacted>                                     │
│ Region     │ local                                                            │
╰────────────┴──────────────────────────────────────────────────────────────────╯

A new version of Supabase CLI is available: v2.95.4 (currently installed v2.89.1)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
HTTP/1.1 200 OK
Content-Type: application/openapi+json; charset=utf-8
Content-Length: 77285
Connection: keep-alive
Date: Thu, 30 Apr 2026 02:35:31 GMT
Server: postgrest/14.8
Content-Profile: public
Access-Control-Allow-Origin: *
X-Kong-Upstream-Latency: 2608
X-Kong-Proxy-Latency: 2
Via: kong/2.8.1

{"swagger":"2.0","info":{"description":"","title":"standard public schema","version":"14.8"},"host":"0.0.0.0:3000","basePath":"/","schemes":["http"],"consumes":["application/json","application/vnd.pgrst.object+json;nulls=stripped","application/vnd.pgrst.object+json","text/csv"],"produces":["application/json","application/vnd.pgrst.object+json;nulls=stripped","application/vnd.pgrst.object+json","text/csv"],"paths":{"/":{"get":{"produces":["application/openapi+json","application/json"],"responses":{"200":{"description":"OK"}},"summary":"OpenAPI description (this document)","tags":["Introspection"]}},"/final_billings":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.final_billings.id"},{"$ref":"#/parameters/rowFilter.final_billings.billing_decision_id"},{"$ref":"#/parameters/rowFilter.final_billings.project_rate_id"},{"$ref":"#/parameters/rowFilter.final_billings.billing_date"},{"$ref":"#/parameters/rowFilter.final_billings.md_amount"},{"$ref":"#/parameters/rowFilter.final_billings.unit_price"},{"$ref":"#/parameters/rowFilter.final_billings.total_amount"},{"$ref":"#/parameters/rowFilter.final_billings.status"},{"$ref":"#/parameters/rowFilter.final_billings.created_at"},{"$ref":"#/parameters/rowFilter.final_billings.updated_at"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/final_billings"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["final_billings"]},"post":{"parameters":[{"$ref":"#/parameters/body.final_billings"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"tags":["final_billings"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.final_billings.id"},{"$ref":"#/parameters/rowFilter.final_billings.billing_decision_id"},{"$ref":"#/parameters/rowFilter.final_billings.project_rate_id"},{"$ref":"#/parameters/rowFilter.final_billings.billing_date"},{"$ref":"#/parameters/rowFilter.final_billings.md_amount"},{"$ref":"#/parameters/rowFilter.final_billings.unit_price"},{"$ref":"#/parameters/rowFilter.final_billings.total_amount"},{"$ref":"#/parameters/rowFilter.final_billings.status"},{"$ref":"#/parameters/rowFilter.final_billings.created_at"},{"$ref":"#/parameters/rowFilter.final_billings.updated_at"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["final_billings"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.final_billings.id"},{"$ref":"#/parameters/rowFilter.final_billings.billing_decision_id"},{"$ref":"#/parameters/rowFilter.final_billings.project_rate_id"},{"$ref":"#/parameters/rowFilter.final_billings.billing_date"},{"$ref":"#/parameters/rowFilter.final_billings.md_amount"},{"$ref":"#/parameters/rowFilter.final_billings.unit_price"},{"$ref":"#/parameters/rowFilter.final_billings.total_amount"},{"$ref":"#/parameters/rowFilter.final_billings.status"},{"$ref":"#/parameters/rowFilter.final_billings.created_at"},{"$ref":"#/parameters/rowFilter.final_billings.updated_at"},{"$ref":"#/parameters/body.final_billings"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["final_billings"]}},"/billing_decision_records":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.billing_decision_records.id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.billing_decision_id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.time_record_id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.is_active"},{"$ref":"#/parameters/rowFilter.billing_decision_records.created_at"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/billing_decision_records"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["billing_decision_records"]},"post":{"parameters":[{"$ref":"#/parameters/body.billing_decision_records"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"tags":["billing_decision_records"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.billing_decision_records.id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.billing_decision_id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.time_record_id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.is_active"},{"$ref":"#/parameters/rowFilter.billing_decision_records.created_at"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["billing_decision_records"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.billing_decision_records.id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.billing_decision_id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.time_record_id"},{"$ref":"#/parameters/rowFilter.billing_decision_records.is_active"},{"$ref":"#/parameters/rowFilter.billing_decision_records.created_at"},{"$ref":"#/parameters/body.billing_decision_records"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["billing_decision_records"]}},"/task_billing_summary":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.task_billing_summary.task_id"},{"$ref":"#/parameters/rowFilter.task_billing_summary.used_md"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/task_billing_summary"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["task_billing_summary"]}},"/pending_billing_decisions_summary":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.time_record_id"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.staff_id"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.task_id"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.record_date"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.factory_location"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.hours_worked"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.check_in_time"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.check_out_time"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.billing_decision_id"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.decision_type"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.has_conflict"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.is_conflict_resolved"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.is_billable"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.final_md"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.has_decision"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.merged_total_hours"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.staff_name"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.staff_employee_no"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.department_name"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.work_area_code"},{"$ref":"#/parameters/rowFilter.pending_billing_decisions_summary.facility_mapping_count"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/pending_billing_decisions_summary"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["pending_billing_decisions_summary"]}},"/project_rates":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.project_rates.id"},{"$ref":"#/parameters/rowFilter.project_rates.project_id"},{"$ref":"#/parameters/rowFilter.project_rates.year"},{"$ref":"#/parameters/rowFilter.project_rates.standard_rate"},{"$ref":"#/parameters/rowFilter.project_rates.currency"},{"$ref":"#/parameters/rowFilter.project_rates.created_at"},{"$ref":"#/parameters/rowFilter.project_rates.updated_at"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/project_rates"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["project_rates"]},"post":{"parameters":[{"$ref":"#/parameters/body.project_rates"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"tags":["project_rates"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.project_rates.id"},{"$ref":"#/parameters/rowFilter.project_rates.project_id"},{"$ref":"#/parameters/rowFilter.project_rates.year"},{"$ref":"#/parameters/rowFilter.project_rates.standard_rate"},{"$ref":"#/parameters/rowFilter.project_rates.currency"},{"$ref":"#/parameters/rowFilter.project_rates.created_at"},{"$ref":"#/parameters/rowFilter.project_rates.updated_at"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["project_rates"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.project_rates.id"},{"$ref":"#/parameters/rowFilter.project_rates.project_id"},{"$ref":"#/parameters/rowFilter.project_rates.year"},{"$ref":"#/parameters/rowFilter.project_rates.standard_rate"},{"$ref":"#/parameters/rowFilter.project_rates.currency"},{"$ref":"#/parameters/rowFilter.project_rates.created_at"},{"$ref":"#/parameters/rowFilter.project_rates.updated_at"},{"$ref":"#/parameters/body.project_rates"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["project_rates"]}},"/time_records":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.time_records.id"},{"$ref":"#/parameters/rowFilter.time_records.staff_id"},{"$ref":"#/parameters/rowFilter.time_records.task_id"},{"$ref":"#/parameters/rowFilter.time_records.record_date"},{"$ref":"#/parameters/rowFilter.time_records.factory_location"},{"$ref":"#/parameters/rowFilter.time_records.check_in_time"},{"$ref":"#/parameters/rowFilter.time_records.check_out_time"},{"$ref":"#/parameters/rowFilter.time_records.hours_worked"},{"$ref":"#/parameters/rowFilter.time_records.notes"},{"$ref":"#/parameters/rowFilter.time_records.created_at"},{"$ref":"#/parameters/rowFilter.time_records.updated_at"},{"$ref":"#/parameters/rowFilter.time_records.import_vendor_no"},{"$ref":"#/parameters/rowFilter.time_records.department_name"},{"$ref":"#/parameters/rowFilter.time_records.work_area_code"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/time_records"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["time_records"]},"post":{"parameters":[{"$ref":"#/parameters/body.time_records"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"tags":["time_records"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.time_records.id"},{"$ref":"#/parameters/rowFilter.time_records.staff_id"},{"$ref":"#/parameters/rowFilter.time_records.task_id"},{"$ref":"#/parameters/rowFilter.time_records.record_date"},{"$ref":"#/parameters/rowFilter.time_records.factory_location"},{"$ref":"#/parameters/rowFilter.time_records.check_in_time"},{"$ref":"#/parameters/rowFilter.time_records.check_out_time"},{"$ref":"#/parameters/rowFilter.time_records.hours_worked"},{"$ref":"#/parameters/rowFilter.time_records.notes"},{"$ref":"#/parameters/rowFilter.time_records.created_at"},{"$ref":"#/parameters/rowFilter.time_records.updated_at"},{"$ref":"#/parameters/rowFilter.time_records.import_vendor_no"},{"$ref":"#/parameters/rowFilter.time_records.department_name"},{"$ref":"#/parameters/rowFilter.time_records.work_area_code"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["time_records"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.time_records.id"},{"$ref":"#/parameters/rowFilter.time_records.staff_id"},{"$ref":"#/parameters/rowFilter.time_records.task_id"},{"$ref":"#/parameters/rowFilter.time_records.record_date"},{"$ref":"#/parameters/rowFilter.time_records.factory_location"},{"$ref":"#/parameters/rowFilter.time_records.check_in_time"},{"$ref":"#/parameters/rowFilter.time_records.check_out_time"},{"$ref":"#/parameters/rowFilter.time_records.hours_worked"},{"$ref":"#/parameters/rowFilter.time_records.notes"},{"$ref":"#/parameters/rowFilter.time_records.created_at"},{"$ref":"#/parameters/rowFilter.time_records.updated_at"},{"$ref":"#/parameters/rowFilter.time_records.import_vendor_no"},{"$ref":"#/parameters/rowFilter.time_records.department_name"},{"$ref":"#/parameters/rowFilter.time_records.work_area_code"},{"$ref":"#/parameters/body.time_records"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["time_records"]}},"/pip_inspection_records":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.pip_inspection_records.id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.vendor_no"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.staff_id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.staff_name"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.inspection_datetime"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.factory_location"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.work_content"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.location_tgcm"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.location_io_room"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_phone"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_electronic"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_usb"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_upper_pocket"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_pants_pocket"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_red_card"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pm_staff_id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pm_confirmed_at"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.created_at"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/pip_inspection_records"},"type":"array"}},"206":{"description":"Partial Content"}},"summary":"進廠 PIP 自我檢查紀錄（與工時／認領流程解耦）","tags":["pip_inspection_records"]},"post":{"parameters":[{"$ref":"#/parameters/body.pip_inspection_records"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"summary":"進廠 PIP 自我檢查紀錄（與工時／認領流程解耦）","tags":["pip_inspection_records"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.pip_inspection_records.id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.vendor_no"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.staff_id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.staff_name"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.inspection_datetime"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.factory_location"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.work_content"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.location_tgcm"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.location_io_room"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_phone"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_electronic"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_usb"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_upper_pocket"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_pants_pocket"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_red_card"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pm_staff_id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pm_confirmed_at"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.created_at"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"summary":"進廠 PIP 自我檢查紀錄（與工時／認領流程解耦）","tags":["pip_inspection_records"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.pip_inspection_records.id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.vendor_no"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.staff_id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.staff_name"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.inspection_datetime"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.factory_location"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.work_content"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.location_tgcm"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.location_io_room"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_phone"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_electronic"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_no_usb"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_upper_pocket"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_pants_pocket"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pip_checked_red_card"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pm_staff_id"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.pm_confirmed_at"},{"$ref":"#/parameters/rowFilter.pip_inspection_records.created_at"},{"$ref":"#/parameters/body.pip_inspection_records"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"summary":"進廠 PIP 自我檢查紀錄（與工時／認領流程解耦）","tags":["pip_inspection_records"]}},"/decided_billing_decisions_summary":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.time_record_id"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.staff_id"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.task_id"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.record_date"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.factory_location"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.hours_worked"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.check_in_time"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.check_out_time"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.billing_decision_id"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.decision_type"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.has_conflict"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.is_conflict_resolved"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.is_billable"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.final_md"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.has_decision"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.merged_total_hours"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.staff_name"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.staff_employee_no"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.department_name"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.work_area_code"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.reason"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.facility_mapping_count"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.decision_maker_id"},{"$ref":"#/parameters/rowFilter.decided_billing_decisions_summary.decision_maker_name"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/decided_billing_decisions_summary"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["decided_billing_decisions_summary"]}},"/staff_daily_factory_summary":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.staff_daily_factory_summary.staff_id"},{"$ref":"#/parameters/rowFilter.staff_daily_factory_summary.record_date"},{"$ref":"#/parameters/rowFilter.staff_daily_factory_summary.distinct_factory_count"},{"$ref":"#/parameters/rowFilter.staff_daily_factory_summary.factory_locations"},{"$ref":"#/parameters/rowFilter.staff_daily_factory_summary.total_record_count"},{"$ref":"#/parameters/rowFilter.staff_daily_factory_summary.total_hours_worked"},{"$ref":"#/parameters/rowFilter.staff_daily_factory_summary.time_record_ids"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/staff_daily_factory_summary"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["staff_daily_factory_summary"]}},"/tasks":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.tasks.id"},{"$ref":"#/parameters/rowFilter.tasks.project_id"},{"$ref":"#/parameters/rowFilter.tasks.code"},{"$ref":"#/parameters/rowFilter.tasks.name"},{"$ref":"#/parameters/rowFilter.tasks.description"},{"$ref":"#/parameters/rowFilter.tasks.status"},{"$ref":"#/parameters/rowFilter.tasks.created_at"},{"$ref":"#/parameters/rowFilter.tasks.updated_at"},{"$ref":"#/parameters/rowFilter.tasks.budgeted_md"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/tasks"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["tasks"]},"post":{"parameters":[{"$ref":"#/parameters/body.tasks"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"tags":["tasks"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.tasks.id"},{"$ref":"#/parameters/rowFilter.tasks.project_id"},{"$ref":"#/parameters/rowFilter.tasks.code"},{"$ref":"#/parameters/rowFilter.tasks.name"},{"$ref":"#/parameters/rowFilter.tasks.description"},{"$ref":"#/parameters/rowFilter.tasks.status"},{"$ref":"#/parameters/rowFilter.tasks.created_at"},{"$ref":"#/parameters/rowFilter.tasks.updated_at"},{"$ref":"#/parameters/rowFilter.tasks.budgeted_md"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["tasks"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.tasks.id"},{"$ref":"#/parameters/rowFilter.tasks.project_id"},{"$ref":"#/parameters/rowFilter.tasks.code"},{"$ref":"#/parameters/rowFilter.tasks.name"},{"$ref":"#/parameters/rowFilter.tasks.description"},{"$ref":"#/parameters/rowFilter.tasks.status"},{"$ref":"#/parameters/rowFilter.tasks.created_at"},{"$ref":"#/parameters/rowFilter.tasks.updated_at"},{"$ref":"#/parameters/rowFilter.tasks.budgeted_md"},{"$ref":"#/parameters/body.tasks"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["tasks"]}},"/time_record_facility_workarea":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.id"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.time_record_id"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.factory_location"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.work_area_code"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.created_at"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/time_record_facility_workarea"},"type":"array"}},"206":{"description":"Partial Content"}},"summary":"每筆工時的所有廠區/工作區代號配對；同一邏輯工時跨廠區時一筆 time_record 可對應多個配對","tags":["time_record_facility_workarea"]},"post":{"parameters":[{"$ref":"#/parameters/body.time_record_facility_workarea"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"summary":"每筆工時的所有廠區/工作區代號配對；同一邏輯工時跨廠區時一筆 time_record 可對應多個配對","tags":["time_record_facility_workarea"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.id"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.time_record_id"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.factory_location"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.work_area_code"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.created_at"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"summary":"每筆工時的所有廠區/工作區代號配對；同一邏輯工時跨廠區時一筆 time_record 可對應多個配對","tags":["time_record_facility_workarea"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.id"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.time_record_id"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.factory_location"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.work_area_code"},{"$ref":"#/parameters/rowFilter.time_record_facility_workarea.created_at"},{"$ref":"#/parameters/body.time_record_facility_workarea"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"summary":"每筆工時的所有廠區/工作區代號配對；同一邏輯工時跨廠區時一筆 time_record 可對應多個配對","tags":["time_record_facility_workarea"]}},"/staff_profiles":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.staff_profiles.id"},{"$ref":"#/parameters/rowFilter.staff_profiles.user_id"},{"$ref":"#/parameters/rowFilter.staff_profiles.name"},{"$ref":"#/parameters/rowFilter.staff_profiles.email"},{"$ref":"#/parameters/rowFilter.staff_profiles.created_at"},{"$ref":"#/parameters/rowFilter.staff_profiles.updated_at"},{"$ref":"#/parameters/rowFilter.staff_profiles.employee_no"},{"$ref":"#/parameters/rowFilter.staff_profiles.name_en"},{"$ref":"#/parameters/rowFilter.staff_profiles.department"},{"$ref":"#/parameters/rowFilter.staff_profiles.job_title"},{"$ref":"#/parameters/rowFilter.staff_profiles.mobile_phone"},{"$ref":"#/parameters/rowFilter.staff_profiles.card_no"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/staff_profiles"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["staff_profiles"]},"post":{"parameters":[{"$ref":"#/parameters/body.staff_profiles"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"tags":["staff_profiles"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.staff_profiles.id"},{"$ref":"#/parameters/rowFilter.staff_profiles.user_id"},{"$ref":"#/parameters/rowFilter.staff_profiles.name"},{"$ref":"#/parameters/rowFilter.staff_profiles.email"},{"$ref":"#/parameters/rowFilter.staff_profiles.created_at"},{"$ref":"#/parameters/rowFilter.staff_profiles.updated_at"},{"$ref":"#/parameters/rowFilter.staff_profiles.employee_no"},{"$ref":"#/parameters/rowFilter.staff_profiles.name_en"},{"$ref":"#/parameters/rowFilter.staff_profiles.department"},{"$ref":"#/parameters/rowFilter.staff_profiles.job_title"},{"$ref":"#/parameters/rowFilter.staff_profiles.mobile_phone"},{"$ref":"#/parameters/rowFilter.staff_profiles.card_no"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["staff_profiles"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.staff_profiles.id"},{"$ref":"#/parameters/rowFilter.staff_profiles.user_id"},{"$ref":"#/parameters/rowFilter.staff_profiles.name"},{"$ref":"#/parameters/rowFilter.staff_profiles.email"},{"$ref":"#/parameters/rowFilter.staff_profiles.created_at"},{"$ref":"#/parameters/rowFilter.staff_profiles.updated_at"},{"$ref":"#/parameters/rowFilter.staff_profiles.employee_no"},{"$ref":"#/parameters/rowFilter.staff_profiles.name_en"},{"$ref":"#/parameters/rowFilter.staff_profiles.department"},{"$ref":"#/parameters/rowFilter.staff_profiles.job_title"},{"$ref":"#/parameters/rowFilter.staff_profiles.mobile_phone"},{"$ref":"#/parameters/rowFilter.staff_profiles.card_no"},{"$ref":"#/parameters/body.staff_profiles"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["staff_profiles"]}},"/projects":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.projects.id"},{"$ref":"#/parameters/rowFilter.projects.code"},{"$ref":"#/parameters/rowFilter.projects.name"},{"$ref":"#/parameters/rowFilter.projects.description"},{"$ref":"#/parameters/rowFilter.projects.status"},{"$ref":"#/parameters/rowFilter.projects.created_at"},{"$ref":"#/parameters/rowFilter.projects.updated_at"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/projects"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["projects"]},"post":{"parameters":[{"$ref":"#/parameters/body.projects"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"tags":["projects"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.projects.id"},{"$ref":"#/parameters/rowFilter.projects.code"},{"$ref":"#/parameters/rowFilter.projects.name"},{"$ref":"#/parameters/rowFilter.projects.description"},{"$ref":"#/parameters/rowFilter.projects.status"},{"$ref":"#/parameters/rowFilter.projects.created_at"},{"$ref":"#/parameters/rowFilter.projects.updated_at"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["projects"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.projects.id"},{"$ref":"#/parameters/rowFilter.projects.code"},{"$ref":"#/parameters/rowFilter.projects.name"},{"$ref":"#/parameters/rowFilter.projects.description"},{"$ref":"#/parameters/rowFilter.projects.status"},{"$ref":"#/parameters/rowFilter.projects.created_at"},{"$ref":"#/parameters/rowFilter.projects.updated_at"},{"$ref":"#/parameters/body.projects"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["projects"]}},"/billing_decisions":{"get":{"parameters":[{"$ref":"#/parameters/rowFilter.billing_decisions.id"},{"$ref":"#/parameters/rowFilter.billing_decisions.decision_type"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_forced_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.recommended_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.final_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.reason"},{"$ref":"#/parameters/rowFilter.billing_decisions.decision_maker_id"},{"$ref":"#/parameters/rowFilter.billing_decisions.has_conflict"},{"$ref":"#/parameters/rowFilter.billing_decisions.conflict_type"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_conflict_resolved"},{"$ref":"#/parameters/rowFilter.billing_decisions.conflict_resolution_notes"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_billable"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_active"},{"$ref":"#/parameters/rowFilter.billing_decisions.created_at"},{"$ref":"#/parameters/rowFilter.billing_decisions.updated_at"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/order"},{"$ref":"#/parameters/range"},{"$ref":"#/parameters/rangeUnit"},{"$ref":"#/parameters/offset"},{"$ref":"#/parameters/limit"},{"$ref":"#/parameters/preferCount"}],"responses":{"200":{"description":"OK","schema":{"items":{"$ref":"#/definitions/billing_decisions"},"type":"array"}},"206":{"description":"Partial Content"}},"tags":["billing_decisions"]},"post":{"parameters":[{"$ref":"#/parameters/body.billing_decisions"},{"$ref":"#/parameters/select"},{"$ref":"#/parameters/preferPost"}],"responses":{"201":{"description":"Created"}},"tags":["billing_decisions"]},"delete":{"parameters":[{"$ref":"#/parameters/rowFilter.billing_decisions.id"},{"$ref":"#/parameters/rowFilter.billing_decisions.decision_type"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_forced_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.recommended_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.final_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.reason"},{"$ref":"#/parameters/rowFilter.billing_decisions.decision_maker_id"},{"$ref":"#/parameters/rowFilter.billing_decisions.has_conflict"},{"$ref":"#/parameters/rowFilter.billing_decisions.conflict_type"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_conflict_resolved"},{"$ref":"#/parameters/rowFilter.billing_decisions.conflict_resolution_notes"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_billable"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_active"},{"$ref":"#/parameters/rowFilter.billing_decisions.created_at"},{"$ref":"#/parameters/rowFilter.billing_decisions.updated_at"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["billing_decisions"]},"patch":{"parameters":[{"$ref":"#/parameters/rowFilter.billing_decisions.id"},{"$ref":"#/parameters/rowFilter.billing_decisions.decision_type"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_forced_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.recommended_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.final_md"},{"$ref":"#/parameters/rowFilter.billing_decisions.reason"},{"$ref":"#/parameters/rowFilter.billing_decisions.decision_maker_id"},{"$ref":"#/parameters/rowFilter.billing_decisions.has_conflict"},{"$ref":"#/parameters/rowFilter.billing_decisions.conflict_type"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_conflict_resolved"},{"$ref":"#/parameters/rowFilter.billing_decisions.conflict_resolution_notes"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_billable"},{"$ref":"#/parameters/rowFilter.billing_decisions.is_active"},{"$ref":"#/parameters/rowFilter.billing_decisions.created_at"},{"$ref":"#/parameters/rowFilter.billing_decisions.updated_at"},{"$ref":"#/parameters/body.billing_decisions"},{"$ref":"#/parameters/preferReturn"}],"responses":{"204":{"description":"No Content"}},"tags":["billing_decisions"]}},"/rpc/create_billing_decision_transaction":{"post":{"parameters":[{"in":"body","name":"args","required":true,"schema":{"properties":{"p_conflict_resolution_notes":{"format":"text","type":"string"},"p_conflict_type":{"format":"text","type":"string"},"p_decision_ids_to_deactivate":{"format":"uuid[]","items":{"type":"string"},"type":"array"},"p_decision_maker_id":{"format":"uuid","type":"string"},"p_decision_type":{"format":"text","type":"string"},"p_final_md":{"format":"numeric","type":"number"},"p_has_conflict":{"format":"boolean","type":"boolean"},"p_is_billable":{"format":"boolean","type":"boolean"},"p_is_conflict_resolved":{"format":"boolean","type":"boolean"},"p_is_forced_md":{"format":"boolean","type":"boolean"},"p_reason":{"format":"text","type":"string"},"p_recommended_md":{"format":"numeric","type":"number"},"p_task_id":{"format":"uuid","type":"string"},"p_time_record_ids":{"format":"uuid[]","items":{"type":"string"},"type":"array"}},"required":["p_time_record_ids","p_decision_type","p_final_md"],"type":"object"}},{"$ref":"#/parameters/preferParams"}],"produces":["application/json","application/vnd.pgrst.object+json;nulls=stripped","application/vnd.pgrst.object+json"],"responses":{"200":{"description":"OK"}},"tags":["(rpc) create_billing_decision_transaction"]}},"/rpc/pip_distinct_factory_locations":{"get":{"produces":["application/json","application/vnd.pgrst.object+json;nulls=stripped","application/vnd.pgrst.object+json"],"responses":{"200":{"description":"OK"}},"summary":"供 PIP 自我檢查表單載入廠區選項（與既有工時紀錄一致）","tags":["(rpc) pip_distinct_factory_locations"]},"post":{"parameters":[{"in":"body","name":"args","required":true,"schema":{"description":"供 PIP 自我檢查表單載入廠區選項（與既有工時紀錄一致）","type":"object"}},{"$ref":"#/parameters/preferParams"}],"produces":["application/json","application/vnd.pgrst.object+json;nulls=stripped","application/vnd.pgrst.object+json"],"responses":{"200":{"description":"OK"}},"summary":"供 PIP 自我檢查表單載入廠區選項（與既有工時紀錄一致）","tags":["(rpc) pip_distinct_factory_locations"]}}},"definitions":{"final_billings":{"required":["id","billing_decision_id","project_rate_id","billing_date","md_amount","unit_price","total_amount","status","created_at","updated_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"billing_decision_id":{"description":"Note:\nThis is a Foreign Key to `billing_decisions.id`.<fk table='billing_decisions' column='id'/>","format":"uuid","type":"string"},"project_rate_id":{"description":"Note:\nThis is a Foreign Key to `project_rates.id`.<fk table='project_rates' column='id'/>","format":"uuid","type":"string"},"billing_date":{"format":"date","type":"string"},"md_amount":{"format":"numeric","type":"number"},"unit_price":{"format":"numeric","type":"number"},"total_amount":{"format":"numeric","type":"number"},"status":{"default":"draft","format":"text","type":"string"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"updated_at":{"default":"now()","format":"timestamp with time zone","type":"string"}},"type":"object"},"billing_decision_records":{"required":["id","billing_decision_id","time_record_id","is_active","created_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"billing_decision_id":{"description":"Note:\nThis is a Foreign Key to `billing_decisions.id`.<fk table='billing_decisions' column='id'/>","format":"uuid","type":"string"},"time_record_id":{"description":"Note:\nThis is a Foreign Key to `time_records.id`.<fk table='time_records' column='id'/>","format":"uuid","type":"string"},"is_active":{"default":true,"format":"boolean","type":"boolean"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"}},"type":"object"},"task_billing_summary":{"properties":{"task_id":{"description":"Note:\nThis is a Foreign Key to `tasks.id`.<fk table='tasks' column='id'/>","format":"uuid","type":"string"},"used_md":{"format":"numeric","type":"number"}},"type":"object"},"pending_billing_decisions_summary":{"properties":{"time_record_id":{"description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"staff_id":{"description":"Note:\nThis is a Foreign Key to `staff_profiles.id`.<fk table='staff_profiles' column='id'/>","format":"uuid","type":"string"},"task_id":{"description":"Note:\nThis is a Foreign Key to `tasks.id`.<fk table='tasks' column='id'/>","format":"uuid","type":"string"},"record_date":{"format":"date","type":"string"},"factory_location":{"format":"text","type":"string"},"hours_worked":{"format":"numeric","type":"number"},"check_in_time":{"format":"timestamp with time zone","type":"string"},"check_out_time":{"format":"timestamp with time zone","type":"string"},"billing_decision_id":{"description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"decision_type":{"format":"text","type":"string"},"has_conflict":{"format":"boolean","type":"boolean"},"is_conflict_resolved":{"format":"boolean","type":"boolean"},"is_billable":{"format":"boolean","type":"boolean"},"final_md":{"format":"numeric","type":"number"},"has_decision":{"format":"boolean","type":"boolean"},"merged_total_hours":{"format":"numeric","type":"number"},"staff_name":{"format":"text","type":"string"},"staff_employee_no":{"format":"text","type":"string"},"department_name":{"format":"text","type":"string"},"work_area_code":{"format":"text","type":"string"},"facility_mapping_count":{"description":"time_record_facility_workarea 對應筆數；>1 表示多組廠區／代號 mapping","format":"int32","type":"integer"}},"type":"object"},"project_rates":{"required":["id","project_id","year","standard_rate","currency","created_at","updated_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"project_id":{"description":"Note:\nThis is a Foreign Key to `projects.id`.<fk table='projects' column='id'/>","format":"uuid","type":"string"},"year":{"format":"int32","type":"integer"},"standard_rate":{"format":"numeric","type":"number"},"currency":{"default":"TWD","format":"text","type":"string"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"updated_at":{"default":"now()","format":"timestamp with time zone","type":"string"}},"type":"object"},"time_records":{"required":["id","staff_id","record_date","factory_location","check_in_time","created_at","updated_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"staff_id":{"description":"Note:\nThis is a Foreign Key to `staff_profiles.id`.<fk table='staff_profiles' column='id'/>","format":"uuid","type":"string"},"task_id":{"description":"Note:\nThis is a Foreign Key to `tasks.id`.<fk table='tasks' column='id'/>","format":"uuid","type":"string"},"record_date":{"format":"date","type":"string"},"factory_location":{"format":"text","type":"string"},"check_in_time":{"format":"timestamp with time zone","type":"string"},"check_out_time":{"format":"timestamp with time zone","type":"string"},"hours_worked":{"format":"numeric","type":"number"},"notes":{"format":"text","type":"string"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"updated_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"import_vendor_no":{"description":"匯入時 Excel 廠商編號快照（優先於 staff_profiles.employee_no 顯示於裁決看板）","format":"text","type":"string"},"department_name":{"description":"匯入時部門名稱快照","format":"text","type":"string"},"work_area_code":{"description":"匯入時 Excel 工作區域代號快照（缺值時回退為 factory_location）","format":"text","type":"string"}},"type":"object"},"pip_inspection_records":{"description":"進廠 PIP 自我檢查紀錄（與工時／認領流程解耦）","required":["id","vendor_no","staff_name","inspection_datetime","factory_location","work_content","location_tgcm","location_io_room","pip_no_phone","pip_no_electronic","pip_no_usb","pip_checked_upper_pocket","pip_checked_pants_pocket","pip_checked_red_card","created_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"vendor_no":{"description":"去除 V001 等讀卡前綴後之廠商編號（與 Excel 廠商編號一致）","format":"text","type":"string"},"staff_id":{"description":"對應 staff_profiles；查無人員時為 NULL\n\nNote:\nThis is a Foreign Key to `staff_profiles.id`.<fk table='staff_profiles' column='id'/>","format":"uuid","type":"string"},"staff_name":{"format":"text","type":"string"},"inspection_datetime":{"format":"timestamp with time zone","type":"string"},"factory_location":{"format":"text","type":"string"},"work_content":{"format":"text","type":"string"},"location_tgcm":{"default":false,"format":"boolean","type":"boolean"},"location_io_room":{"default":false,"format":"boolean","type":"boolean"},"pip_no_phone":{"default":false,"description":"TRUE = 確認身上未攜帶私人手機（X）","format":"boolean","type":"boolean"},"pip_no_electronic":{"default":false,"description":"TRUE = 確認身上未攜帶電子設備（X）","format":"boolean","type":"boolean"},"pip_no_usb":{"default":false,"description":"TRUE = 確認身上未攜帶隨身碟（X）","format":"boolean","type":"boolean"},"pip_checked_upper_pocket":{"default":false,"format":"boolean","type":"boolean"},"pip_checked_pants_pocket":{"default":false,"format":"boolean","type":"boolean"},"pip_checked_red_card":{"default":false,"format":"boolean","type":"boolean"},"pm_staff_id":{"description":"維護紀錄：指派 PM（暫留空）\n\nNote:\nThis is a Foreign Key to `staff_profiles.id`.<fk table='staff_profiles' column='id'/>","format":"uuid","type":"string"},"pm_confirmed_at":{"description":"維護紀錄：PM 確認時間（暫留空）","format":"timestamp with time zone","type":"string"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"}},"type":"object"},"decided_billing_decisions_summary":{"properties":{"time_record_id":{"description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"staff_id":{"description":"Note:\nThis is a Foreign Key to `staff_profiles.id`.<fk table='staff_profiles' column='id'/>","format":"uuid","type":"string"},"task_id":{"description":"Note:\nThis is a Foreign Key to `tasks.id`.<fk table='tasks' column='id'/>","format":"uuid","type":"string"},"record_date":{"format":"date","type":"string"},"factory_location":{"format":"text","type":"string"},"hours_worked":{"format":"numeric","type":"number"},"check_in_time":{"format":"timestamp with time zone","type":"string"},"check_out_time":{"format":"timestamp with time zone","type":"string"},"billing_decision_id":{"description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"decision_type":{"format":"text","type":"string"},"has_conflict":{"format":"boolean","type":"boolean"},"is_conflict_resolved":{"format":"boolean","type":"boolean"},"is_billable":{"format":"boolean","type":"boolean"},"final_md":{"format":"numeric","type":"number"},"has_decision":{"format":"boolean","type":"boolean"},"merged_total_hours":{"format":"numeric","type":"number"},"staff_name":{"format":"text","type":"string"},"staff_employee_no":{"format":"text","type":"string"},"department_name":{"format":"text","type":"string"},"work_area_code":{"format":"text","type":"string"},"reason":{"format":"text","type":"string"},"facility_mapping_count":{"description":"time_record_facility_workarea 對應筆數；>1 表示多組廠區／代號 mapping","format":"int32","type":"integer"},"decision_maker_id":{"description":"Note:\nThis is a Foreign Key to `staff_profiles.id`.<fk table='staff_profiles' column='id'/>","format":"uuid","type":"string"},"decision_maker_name":{"format":"text","type":"string"}},"type":"object"},"staff_daily_factory_summary":{"properties":{"staff_id":{"description":"Note:\nThis is a Foreign Key to `staff_profiles.id`.<fk table='staff_profiles' column='id'/>","format":"uuid","type":"string"},"record_date":{"format":"date","type":"string"},"distinct_factory_count":{"format":"int64","type":"integer"},"factory_locations":{"format":"text","type":"string"},"total_record_count":{"format":"int64","type":"integer"},"total_hours_worked":{"format":"numeric","type":"number"},"time_record_ids":{"format":"uuid[]","items":{"type":"string"},"type":"array"}},"type":"object"},"tasks":{"required":["id","project_id","code","name","status","created_at","updated_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"project_id":{"description":"Note:\nThis is a Foreign Key to `projects.id`.<fk table='projects' column='id'/>","format":"uuid","type":"string"},"code":{"format":"text","type":"string"},"name":{"format":"text","type":"string"},"description":{"format":"text","type":"string"},"status":{"default":"active","format":"text","type":"string"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"updated_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"budgeted_md":{"format":"numeric","type":"number"}},"type":"object"},"time_record_facility_workarea":{"description":"每筆工時的所有廠區/工作區代號配對；同一邏輯工時跨廠區時一筆 time_record 可對應多個配對","required":["id","time_record_id","factory_location","work_area_code","created_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"time_record_id":{"description":"Note:\nThis is a Foreign Key to `time_records.id`.<fk table='time_records' column='id'/>","format":"uuid","type":"string"},"factory_location":{"description":"所屬廠區","format":"text","type":"string"},"work_area_code":{"description":"工作區域代號","format":"text","type":"string"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"}},"type":"object"},"staff_profiles":{"required":["id","name","email","created_at","updated_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"user_id":{"format":"uuid","type":"string"},"name":{"format":"text","type":"string"},"email":{"format":"text","type":"string"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"updated_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"employee_no":{"description":"工號（選填）","format":"text","type":"string"},"name_en":{"description":"英文姓名","format":"text","type":"string"},"department":{"description":"部門碼（含部門名稱）","format":"text","type":"string"},"job_title":{"description":"職稱","format":"text","type":"string"},"mobile_phone":{"description":"公務手機","format":"text","type":"string"},"card_no":{"description":"紅卡卡號","format":"text","type":"string"}},"type":"object"},"projects":{"required":["id","code","name","status","created_at","updated_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"code":{"format":"text","type":"string"},"name":{"format":"text","type":"string"},"description":{"format":"text","type":"string"},"status":{"default":"active","format":"text","type":"string"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"updated_at":{"default":"now()","format":"timestamp with time zone","type":"string"}},"type":"object"},"billing_decisions":{"required":["id","decision_type","is_forced_md","final_md","has_conflict","is_conflict_resolved","is_billable","is_active","created_at","updated_at"],"properties":{"id":{"default":"gen_random_uuid()","description":"Note:\nThis is a Primary Key.<pk/>","format":"uuid","type":"string"},"decision_type":{"format":"text","type":"string"},"is_forced_md":{"default":false,"format":"boolean","type":"boolean"},"recommended_md":{"format":"numeric","type":"number"},"final_md":{"format":"numeric","type":"number"},"reason":{"format":"text","type":"string"},"decision_maker_id":{"description":"Note:\nThis is a Foreign Key to `staff_profiles.id`.<fk table='staff_profiles' column='id'/>","format":"uuid","type":"string"},"has_conflict":{"default":false,"format":"boolean","type":"boolean"},"conflict_type":{"format":"text","type":"string"},"is_conflict_resolved":{"default":false,"format":"boolean","type":"boolean"},"conflict_resolution_notes":{"format":"text","type":"string"},"is_billable":{"default":true,"format":"boolean","type":"boolean"},"is_active":{"default":true,"format":"boolean","type":"boolean"},"created_at":{"default":"now()","format":"timestamp with time zone","type":"string"},"updated_at":{"default":"now()","format":"timestamp with time zone","type":"string"}},"type":"object"}},"parameters":{"preferParams":{"name":"Prefer","description":"Preference","required":false,"in":"header","type":"string"},"preferReturn":{"name":"Prefer","description":"Preference","required":false,"enum":["return=representation","return=minimal","return=none"],"in":"header","type":"string"},"preferCount":{"name":"Prefer","description":"Preference","required":false,"enum":["count=none"],"in":"header","type":"string"},"preferPost":{"name":"Prefer","description":"Preference","required":false,"enum":["return=representation","return=minimal","return=none","resolution=ignore-duplicates","resolution=merge-duplicates"],"in":"header","type":"string"},"select":{"name":"select","description":"Filtering Columns","required":false,"in":"query","type":"string"},"on_conflict":{"name":"on_conflict","description":"On Conflict","required":false,"in":"query","type":"string"},"order":{"name":"order","description":"Ordering","required":false,"in":"query","type":"string"},"range":{"name":"Range","description":"Limiting and Pagination","required":false,"in":"header","type":"string"},"rangeUnit":{"name":"Range-Unit","description":"Limiting and Pagination","required":false,"default":"items","in":"header","type":"string"},"offset":{"name":"offset","description":"Limiting and Pagination","required":false,"in":"query","type":"string"},"limit":{"name":"limit","description":"Limiting and Pagination","required":false,"in":"query","type":"string"},"body.final_billings":{"name":"final_billings","description":"final_billings","required":false,"in":"body","schema":{"$ref":"#/definitions/final_billings"}},"rowFilter.final_billings.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.final_billings.billing_decision_id":{"name":"billing_decision_id","required":false,"in":"query","type":"string"},"rowFilter.final_billings.project_rate_id":{"name":"project_rate_id","required":false,"in":"query","type":"string"},"rowFilter.final_billings.billing_date":{"name":"billing_date","required":false,"in":"query","type":"string"},"rowFilter.final_billings.md_amount":{"name":"md_amount","required":false,"in":"query","type":"string"},"rowFilter.final_billings.unit_price":{"name":"unit_price","required":false,"in":"query","type":"string"},"rowFilter.final_billings.total_amount":{"name":"total_amount","required":false,"in":"query","type":"string"},"rowFilter.final_billings.status":{"name":"status","required":false,"in":"query","type":"string"},"rowFilter.final_billings.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"rowFilter.final_billings.updated_at":{"name":"updated_at","required":false,"in":"query","type":"string"},"body.billing_decision_records":{"name":"billing_decision_records","description":"billing_decision_records","required":false,"in":"body","schema":{"$ref":"#/definitions/billing_decision_records"}},"rowFilter.billing_decision_records.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.billing_decision_records.billing_decision_id":{"name":"billing_decision_id","required":false,"in":"query","type":"string"},"rowFilter.billing_decision_records.time_record_id":{"name":"time_record_id","required":false,"in":"query","type":"string"},"rowFilter.billing_decision_records.is_active":{"name":"is_active","required":false,"in":"query","type":"string"},"rowFilter.billing_decision_records.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"body.task_billing_summary":{"name":"task_billing_summary","description":"task_billing_summary","required":false,"in":"body","schema":{"$ref":"#/definitions/task_billing_summary"}},"rowFilter.task_billing_summary.task_id":{"name":"task_id","required":false,"in":"query","type":"string"},"rowFilter.task_billing_summary.used_md":{"name":"used_md","required":false,"in":"query","type":"string"},"body.pending_billing_decisions_summary":{"name":"pending_billing_decisions_summary","description":"pending_billing_decisions_summary","required":false,"in":"body","schema":{"$ref":"#/definitions/pending_billing_decisions_summary"}},"rowFilter.pending_billing_decisions_summary.time_record_id":{"name":"time_record_id","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.staff_id":{"name":"staff_id","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.task_id":{"name":"task_id","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.record_date":{"name":"record_date","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.factory_location":{"name":"factory_location","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.hours_worked":{"name":"hours_worked","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.check_in_time":{"name":"check_in_time","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.check_out_time":{"name":"check_out_time","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.billing_decision_id":{"name":"billing_decision_id","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.decision_type":{"name":"decision_type","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.has_conflict":{"name":"has_conflict","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.is_conflict_resolved":{"name":"is_conflict_resolved","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.is_billable":{"name":"is_billable","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.final_md":{"name":"final_md","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.has_decision":{"name":"has_decision","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.merged_total_hours":{"name":"merged_total_hours","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.staff_name":{"name":"staff_name","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.staff_employee_no":{"name":"staff_employee_no","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.department_name":{"name":"department_name","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.work_area_code":{"name":"work_area_code","required":false,"in":"query","type":"string"},"rowFilter.pending_billing_decisions_summary.facility_mapping_count":{"name":"facility_mapping_count","description":"time_record_facility_workarea 對應筆數；>1 表示多組廠區／代號 mapping","required":false,"in":"query","type":"string"},"body.project_rates":{"name":"project_rates","description":"project_rates","required":false,"in":"body","schema":{"$ref":"#/definitions/project_rates"}},"rowFilter.project_rates.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.project_rates.project_id":{"name":"project_id","required":false,"in":"query","type":"string"},"rowFilter.project_rates.year":{"name":"year","required":false,"in":"query","type":"string"},"rowFilter.project_rates.standard_rate":{"name":"standard_rate","required":false,"in":"query","type":"string"},"rowFilter.project_rates.currency":{"name":"currency","required":false,"in":"query","type":"string"},"rowFilter.project_rates.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"rowFilter.project_rates.updated_at":{"name":"updated_at","required":false,"in":"query","type":"string"},"body.time_records":{"name":"time_records","description":"time_records","required":false,"in":"body","schema":{"$ref":"#/definitions/time_records"}},"rowFilter.time_records.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.time_records.staff_id":{"name":"staff_id","required":false,"in":"query","type":"string"},"rowFilter.time_records.task_id":{"name":"task_id","required":false,"in":"query","type":"string"},"rowFilter.time_records.record_date":{"name":"record_date","required":false,"in":"query","type":"string"},"rowFilter.time_records.factory_location":{"name":"factory_location","required":false,"in":"query","type":"string"},"rowFilter.time_records.check_in_time":{"name":"check_in_time","required":false,"in":"query","type":"string"},"rowFilter.time_records.check_out_time":{"name":"check_out_time","required":false,"in":"query","type":"string"},"rowFilter.time_records.hours_worked":{"name":"hours_worked","required":false,"in":"query","type":"string"},"rowFilter.time_records.notes":{"name":"notes","required":false,"in":"query","type":"string"},"rowFilter.time_records.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"rowFilter.time_records.updated_at":{"name":"updated_at","required":false,"in":"query","type":"string"},"rowFilter.time_records.import_vendor_no":{"name":"import_vendor_no","description":"匯入時 Excel 廠商編號快照（優先於 staff_profiles.employee_no 顯示於裁決看板）","required":false,"in":"query","type":"string"},"rowFilter.time_records.department_name":{"name":"department_name","description":"匯入時部門名稱快照","required":false,"in":"query","type":"string"},"rowFilter.time_records.work_area_code":{"name":"work_area_code","description":"匯入時 Excel 工作區域代號快照（缺值時回退為 factory_location）","required":false,"in":"query","type":"string"},"body.pip_inspection_records":{"name":"pip_inspection_records","description":"pip_inspection_records","required":false,"in":"body","schema":{"$ref":"#/definitions/pip_inspection_records"}},"rowFilter.pip_inspection_records.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.vendor_no":{"name":"vendor_no","description":"去除 V001 等讀卡前綴後之廠商編號（與 Excel 廠商編號一致）","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.staff_id":{"name":"staff_id","description":"對應 staff_profiles；查無人員時為 NULL","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.staff_name":{"name":"staff_name","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.inspection_datetime":{"name":"inspection_datetime","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.factory_location":{"name":"factory_location","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.work_content":{"name":"work_content","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.location_tgcm":{"name":"location_tgcm","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.location_io_room":{"name":"location_io_room","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.pip_no_phone":{"name":"pip_no_phone","description":"TRUE = 確認身上未攜帶私人手機（X）","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.pip_no_electronic":{"name":"pip_no_electronic","description":"TRUE = 確認身上未攜帶電子設備（X）","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.pip_no_usb":{"name":"pip_no_usb","description":"TRUE = 確認身上未攜帶隨身碟（X）","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.pip_checked_upper_pocket":{"name":"pip_checked_upper_pocket","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.pip_checked_pants_pocket":{"name":"pip_checked_pants_pocket","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.pip_checked_red_card":{"name":"pip_checked_red_card","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.pm_staff_id":{"name":"pm_staff_id","description":"維護紀錄：指派 PM（暫留空）","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.pm_confirmed_at":{"name":"pm_confirmed_at","description":"維護紀錄：PM 確認時間（暫留空）","required":false,"in":"query","type":"string"},"rowFilter.pip_inspection_records.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"body.decided_billing_decisions_summary":{"name":"decided_billing_decisions_summary","description":"decided_billing_decisions_summary","required":false,"in":"body","schema":{"$ref":"#/definitions/decided_billing_decisions_summary"}},"rowFilter.decided_billing_decisions_summary.time_record_id":{"name":"time_record_id","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.staff_id":{"name":"staff_id","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.task_id":{"name":"task_id","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.record_date":{"name":"record_date","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.factory_location":{"name":"factory_location","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.hours_worked":{"name":"hours_worked","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.check_in_time":{"name":"check_in_time","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.check_out_time":{"name":"check_out_time","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.billing_decision_id":{"name":"billing_decision_id","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.decision_type":{"name":"decision_type","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.has_conflict":{"name":"has_conflict","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.is_conflict_resolved":{"name":"is_conflict_resolved","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.is_billable":{"name":"is_billable","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.final_md":{"name":"final_md","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.has_decision":{"name":"has_decision","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.merged_total_hours":{"name":"merged_total_hours","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.staff_name":{"name":"staff_name","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.staff_employee_no":{"name":"staff_employee_no","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.department_name":{"name":"department_name","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.work_area_code":{"name":"work_area_code","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.reason":{"name":"reason","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.facility_mapping_count":{"name":"facility_mapping_count","description":"time_record_facility_workarea 對應筆數；>1 表示多組廠區／代號 mapping","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.decision_maker_id":{"name":"decision_maker_id","required":false,"in":"query","type":"string"},"rowFilter.decided_billing_decisions_summary.decision_maker_name":{"name":"decision_maker_name","required":false,"in":"query","type":"string"},"body.staff_daily_factory_summary":{"name":"staff_daily_factory_summary","description":"staff_daily_factory_summary","required":false,"in":"body","schema":{"$ref":"#/definitions/staff_daily_factory_summary"}},"rowFilter.staff_daily_factory_summary.staff_id":{"name":"staff_id","required":false,"in":"query","type":"string"},"rowFilter.staff_daily_factory_summary.record_date":{"name":"record_date","required":false,"in":"query","type":"string"},"rowFilter.staff_daily_factory_summary.distinct_factory_count":{"name":"distinct_factory_count","required":false,"in":"query","type":"string"},"rowFilter.staff_daily_factory_summary.factory_locations":{"name":"factory_locations","required":false,"in":"query","type":"string"},"rowFilter.staff_daily_factory_summary.total_record_count":{"name":"total_record_count","required":false,"in":"query","type":"string"},"rowFilter.staff_daily_factory_summary.total_hours_worked":{"name":"total_hours_worked","required":false,"in":"query","type":"string"},"rowFilter.staff_daily_factory_summary.time_record_ids":{"name":"time_record_ids","required":false,"in":"query","type":"string"},"body.tasks":{"name":"tasks","description":"tasks","required":false,"in":"body","schema":{"$ref":"#/definitions/tasks"}},"rowFilter.tasks.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.tasks.project_id":{"name":"project_id","required":false,"in":"query","type":"string"},"rowFilter.tasks.code":{"name":"code","required":false,"in":"query","type":"string"},"rowFilter.tasks.name":{"name":"name","required":false,"in":"query","type":"string"},"rowFilter.tasks.description":{"name":"description","required":false,"in":"query","type":"string"},"rowFilter.tasks.status":{"name":"status","required":false,"in":"query","type":"string"},"rowFilter.tasks.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"rowFilter.tasks.updated_at":{"name":"updated_at","required":false,"in":"query","type":"string"},"rowFilter.tasks.budgeted_md":{"name":"budgeted_md","required":false,"in":"query","type":"string"},"body.time_record_facility_workarea":{"name":"time_record_facility_workarea","description":"time_record_facility_workarea","required":false,"in":"body","schema":{"$ref":"#/definitions/time_record_facility_workarea"}},"rowFilter.time_record_facility_workarea.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.time_record_facility_workarea.time_record_id":{"name":"time_record_id","required":false,"in":"query","type":"string"},"rowFilter.time_record_facility_workarea.factory_location":{"name":"factory_location","description":"所屬廠區","required":false,"in":"query","type":"string"},"rowFilter.time_record_facility_workarea.work_area_code":{"name":"work_area_code","description":"工作區域代號","required":false,"in":"query","type":"string"},"rowFilter.time_record_facility_workarea.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"body.staff_profiles":{"name":"staff_profiles","description":"staff_profiles","required":false,"in":"body","schema":{"$ref":"#/definitions/staff_profiles"}},"rowFilter.staff_profiles.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.user_id":{"name":"user_id","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.name":{"name":"name","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.email":{"name":"email","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.updated_at":{"name":"updated_at","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.employee_no":{"name":"employee_no","description":"工號（選填）","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.name_en":{"name":"name_en","description":"英文姓名","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.department":{"name":"department","description":"部門碼（含部門名稱）","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.job_title":{"name":"job_title","description":"職稱","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.mobile_phone":{"name":"mobile_phone","description":"公務手機","required":false,"in":"query","type":"string"},"rowFilter.staff_profiles.card_no":{"name":"card_no","description":"紅卡卡號","required":false,"in":"query","type":"string"},"body.projects":{"name":"projects","description":"projects","required":false,"in":"body","schema":{"$ref":"#/definitions/projects"}},"rowFilter.projects.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.projects.code":{"name":"code","required":false,"in":"query","type":"string"},"rowFilter.projects.name":{"name":"name","required":false,"in":"query","type":"string"},"rowFilter.projects.description":{"name":"description","required":false,"in":"query","type":"string"},"rowFilter.projects.status":{"name":"status","required":false,"in":"query","type":"string"},"rowFilter.projects.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"rowFilter.projects.updated_at":{"name":"updated_at","required":false,"in":"query","type":"string"},"body.billing_decisions":{"name":"billing_decisions","description":"billing_decisions","required":false,"in":"body","schema":{"$ref":"#/definitions/billing_decisions"}},"rowFilter.billing_decisions.id":{"name":"id","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.decision_type":{"name":"decision_type","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.is_forced_md":{"name":"is_forced_md","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.recommended_md":{"name":"recommended_md","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.final_md":{"name":"final_md","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.reason":{"name":"reason","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.decision_maker_id":{"name":"decision_maker_id","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.has_conflict":{"name":"has_conflict","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.conflict_type":{"name":"conflict_type","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.is_conflict_resolved":{"name":"is_conflict_resolved","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.conflict_resolution_notes":{"name":"conflict_resolution_notes","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.is_billable":{"name":"is_billable","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.is_active":{"name":"is_active","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.created_at":{"name":"created_at","required":false,"in":"query","type":"string"},"rowFilter.billing_decisions.updated_at":{"name":"updated_at","required":false,"in":"query","type":"string"}},"externalDocs":{"description":"PostgREST Documentation","url":"https://postgrest.org/en/v14/references/api.html"}}
boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ npm run start

> ycs-project@0.5.0-beta.1 start
> next start

  ▲ Next.js 14.2.35
  - Local:        http://localhost:3000

 ✓ Starting...
 ✓ Ready in 3.6s
listProjectsWithTasks 錯誤: Error: 查詢專案列表失敗: TypeError: fetch failed
    at c (D:\Github\ycs-middl\.next\server\app\dashboard\projects\page.js:7:1160)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async i (D:\Github\ycs-middl\.next\server\app\dashboard\projects\page.js:7:5299)

---

**Cursor**

你現在這個狀況很關鍵：**`curl` 打 `http://127.0.0.1:54321/rest/v1/` 回 200**，代表 Supabase REST 本身是通的；但 Next.js 裡透過 supabase-js 仍然 `TypeError: fetch failed`，這通常不是「Supabase 沒起來」，而是 **Node 的 fetch 在帶 header / 走代理 / header 值不合法** 時直接在 client 端炸掉。

在你這個 repo，`listProjectsWithTasks()` 用的是 **Service Role** client（`SUPABASE_SERVICE_ROLE_KEY`），所以我會優先懷疑：

- **`SUPABASE_SERVICE_ROLE_KEY` 內容有換行/不可見字元（Windows CRLF、複製貼上多一行、尾端空白）**  
  → undici（Node 內建 fetch）遇到「不合法的 HTTP header 值」時，常常就只丟 `TypeError: fetch failed`，甚至連 request 都沒送出去  
  → 這也解釋為什麼你 `curl` 不帶 Authorization 會成功，但程式一帶 Authorization 就掛

下面用 3 個最短指令把原因釘死（Git Bash 直接貼上跑）：

## 1) 先確認 Node 自己 fetch 通不通（不帶 header）
```bash
node -e "fetch('http://127.0.0.1:54321/rest/v1/').then(r=>console.log('status',r.status)).catch(e=>console.error('fetch error',e))"
```

## 2) 再用 `.env.local` 的 Service Role Key 帶 Authorization header 測試
（這步會直接驗證「是不是 key 字串害的」）
```bash
node -e "const url=process.env.NEXT_PUBLIC_SUPABASE_URL; const key=process.env.SUPABASE_SERVICE_ROLE_KEY; console.log('url=',url); console.log('key_len=', key?.length); fetch(url+'/rest/v1/',{headers:{apikey:key,Authorization:'Bearer '+key}}).then(r=>console.log('status',r.status)).catch(e=>console.error('fetch error',e))"
```

> 請用你平常啟動 Next 的同一個環境變數來源來跑（如果你是靠 `.env.local`，就確保當前 shell 真的載入了它；最保險是直接在同一個 terminal、同一個 repo root 跑）。

## 3) 檢查 key 有沒有「換行」或「看不見的字元」
```bash
node -e "const k=process.env.SUPABASE_SERVICE_ROLE_KEY||''; console.log('has_newline',/[\\r\\n]/.test(k)); console.log('head',JSON.stringify(k.slice(0,20))); console.log('tail',JSON.stringify(k.slice(-20)));"
```

### 判讀結果
- **(1) 成功，但 (2) 失敗**：幾乎可確定是 `SUPABASE_SERVICE_ROLE_KEY` 的格式/字元問題（換行、尾端空白、被加了奇怪引號）
- **(1) 就失敗**：那是 Node fetch/代理層問題（例如 `HTTP_PROXY/HTTPS_PROXY/NO_PROXY`）
- **(2) 回 401/403（但沒有 fetch failed）**：代表網路 OK，換成是 key 權限/值不對（但你現在不是這種錯）

如果你把以上 (2)/(3) 的輸出貼上來（尤其 `has_newline` 與 `key_len`），我可以直接告訴你 `.env.local` 該怎麼修到「不會再 fetch failed」。

---

**User**

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ node -e "fetch('http://127.0.0.1:54321/rest/v1/').then(r=>console.log('status',r.status)).catch(e=>console.error('fetch error',e))"
fetch error TypeError: fetch failed
    at node:internal/deps/undici/undici:13502:13
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5) {
  [cause]: Error: connect ECONNREFUSED 127.0.0.1:54321
      at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1634:16) {
    errno: -4078,
    code: 'ECONNREFUSED',
    syscall: 'connect',
    address: '127.0.0.1',
    port: 54321
  }
}

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ node -e "const url=process.env.NEXT_PUBLIC_SUPABASE_URL; const key=process.env.SUPABASE_SERVICE_ROLE_KEY; console.log('url=',url); console.log('key_len=', key?.length); fetch(url+'/rest/v1/',{headers:{apikey:key,Authorization:'Bearer '+key}}).then(r=>console.log('status',r.status)).catch(e=>console.error('fetch error',e))"
url= undefined
key_len= undefined
fetch error TypeError: Failed to parse URL from undefined/rest/v1/
    at node:internal/deps/undici/undici:13502:13
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5) {
  [cause]: TypeError: Invalid URL
      at new URL (node:internal/url:818:25)
      at new Request (node:internal/deps/undici/undici:9578:25)
      at fetch (node:internal/deps/undici/undici:10307:25)
      at fetch (node:internal/deps/undici/undici:13500:10)
      at fetch (node:internal/bootstrap/web/exposed-window-or-worker:75:12)
      at [eval]:1:161
      at runScriptInThisContext (node:internal/vm:209:10)
      at node:internal/process/execution:449:12
      at [eval]-wrapper:6:24
      at runScriptInContext (node:internal/process/execution:447:60) {
    code: 'ERR_INVALID_URL',
    input: 'undefined/rest/v1/'
  }
}

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ node -e "const k=process.env.SUPABASE_SERVICE_ROLE_KEY||''; console.log('has_newline',/[\\r\\n]/.test(k)); console.log('head',JSON.stringify(k.slice(0,20))); console.log('tail',JSON.stringify(k.slice(-20)));"
has_newline false
head ""
tail ""

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ 

---

**Cursor**

現在答案很明確了：**不是 key 的問題**，而是你的 **Node 程式根本連不到 `127.0.0.1:54321`**，所以 Next.js / supabase-js 才會一律 `fetch failed`。

你同一台機器上出現了「`curl` 可以 200」但「`node fetch` `ECONNREFUSED`」這種矛盾，最常見原因是：

- 你跑 `curl` 的那次其實是 **不同環境的 curl**（例如 Git Bash 的 `curl` 走了不同 DNS/代理/或打到 IPv6/不同介面），但 Node（undici）是直接 TCP 連 `127.0.0.1`，結果 **該 port 當下其實沒在 listen**。
- 或者更直接：你貼的 `node fetch` 是 **真的拒絕連線**，表示「那個瞬間 Supabase API 沒有在 54321 上提供服務」；先前 `curl` 200 可能是 **Supabase 那時候還活著，後來又停了**。

此外，你的 Node 指令顯示 `process.env.NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 都是 **undefined**，代表你目前這個 terminal session **沒有載入 `.env.local`**；不過就算沒 env，第一個 `fetch('http://127.0.0.1:54321/...')` 仍然該連得上才對，所以「連線拒絕」才是主因。

## 立刻釐清「54321 到底有沒有在 listen」（最短兩步）
請在同一個 Git Bash 視窗連續跑這兩個：

```bash
curl -i "http://127.0.0.1:54321/rest/v1/" | head -n 5
node -e "fetch('http://127.0.0.1:54321/rest/v1/').then(r=>console.log('status',r.status)).catch(e=>console.error(e.cause||e))"
```

- 如果 **curl 也開始失敗**：就是 Supabase API 掛了/停了（要回頭處理 `supabase start` 是否真的穩定）
- 如果 **curl 成功但 node 仍 ECONNREFUSED**：那就高度指向 **你的 Node runtime 有代理/網路攔截/安全軟體**（但它報的是 `ECONNREFUSED`，比較不像代理，反而像真的沒服務）

## 再做一個「不靠 HTTP」的硬驗證：看 54321 是否在被 Docker 轉發
（這步最準）
```bash
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep 54321
```

- 若沒看到任何容器映射到 `0.0.0.0:54321->...`：那 54321 很可能根本沒對外開
- 若有映射：理論上 node fetch 不該被拒絕（除非服務短暫掛掉）

## 關於 env undefined：你 Next.js 為什麼還能跑？
Next 在 `next start` 時會讀 `.env*`（包含 `.env.local`），所以 **Next server 有 env**；但你手動跑 `node -e ...` 不會自動載入 `.env.local`，所以才是 undefined。

如果你要用 node 指令讀 `.env.local`，請用（Node 20+）：

```bash
node --env-file=.env.local -e "console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"
```

---

你先把下面兩個輸出貼上來就能收斂到單一原因：

1) `curl -i ... | head -n 5`  
2) `docker ps --format ... | grep 54321`

---

**User**


boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ curl -i "http://127.0.0.1:54321/rest/v1/" | head -n 5
node -e "fetch('http://127.0.0.1:54321/rest/v1/').then(r=>console.log('status',r.status)).catch(e=>console.error(e.cause||e))"
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
  0     0    0     0    0     0      0      0 --:--:--  0:00:02 --:--:--     0
curl: (7) Failed to connect to 127.0.0.1 port 54321 after 2078 ms: Could not connect to server
Error: connect ECONNREFUSED 127.0.0.1:54321
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1634:16) {
  errno: -4078,
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 54321
}

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ docker ps --format "table {{.Names}}\t{{.Ports}}" | grep 54321

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ node --env-file=.env.local -e "console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"
http://127.0.0.1:54321

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ 


---

**Cursor**

現在可以 100% 定案了：**Supabase API（54321）當下沒有在跑**。

證據你自己已經給齊：

- `curl` 連 `127.0.0.1:54321` → **Could not connect**
- `node fetch` → **ECONNREFUSED**
- `docker ps | grep 54321` → **沒有任何容器在映射 54321**
- `.env.local` 的 URL 是 `http://127.0.0.1:54321`（所以 Next.js 當然會打這裡，然後 `fetch failed`）

所以你之前 `supabase status` 顯示 “running” 那次，多半是 **Supabase 剛好短暫起來又掛了**（或你後來 Docker/daemon 又重啟讓容器全部掉了），現在已經完全不在了。

## 你現在要做的最短修復（Git Bash）
1) **先確認 Docker Desktop 是「真的在跑」**（不是只有 UI 開著）。最快是：

```bash
docker info >/dev/null && echo "docker ok"
```

如果這步卡住或報錯，先把 Docker Desktop 重啟到 `docker info` 正常。

2) 然後用 CLI 正規重啟 Supabase stack：

```bash
npx supabase stop
npx supabase start --debug
```

3) 起來後立刻驗證：

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep 54321
curl -i "http://127.0.0.1:54321/rest/v1/" | head -n 5
```

只要這兩步看到 54321 映射、curl 有回應，你 `listProjectsWithTasks` 的 `fetch failed` 就會消失。

## 如果又回到 Exit 137（你先前遇到的）
那就不是程式問題，而是 **Docker/daemon 不穩**（睡眠/喚醒、Docker Desktop 重啟、或背景清理）。這時最實用的作法是：

- **避免睡眠後直接用**：喚醒後先重開 Docker Desktop，再 `npx supabase start`
- 讓 Docker Desktop 開機自啟，減少 daemon 被重置的機會

你如果把 `npx supabase start --debug` 的輸出貼上來（它會列出哪些容器起不來/哪一步失敗），我可以直接指出是哪個容器在掉、下一步該調 Docker 還是要清掉殘留狀態。

---

**User**

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ docker info >/dev/null && echo "docker ok"
WARNING: DOCKER_INSECURE_NO_IPTABLES_RAW is set
docker ok

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ npx supabase stop
npx supabase start --debug
Stopped supabase local development setup.
A new version of Supabase CLI is available: v2.95.4 (currently installed v2.89.1)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
Local data are backed up to docker volume. Use docker to show them: docker volume ls --filter label=com.supabase.cli.project=YCS
open C:\Users\BOYAWU\.supabase\profile: The system cannot find the file specified.
Supabase CLI 2.89.1
Using profile: supabase (supabase.co)
Loading project ref from file: supabase\.temp\project-ref
[+] Pulling 13/13
 ✔ db Skipped - Image is already present locally                                                                                                                                     0.0s 
 ✔ studio Skipped - Image is already present locally                                                                                                                                 0.0s 
 ✔ vector Skipped - Image is already present locally                                                                                                                                 0.0s 
 ✔ gateway Skipped - Image is already present locally                                                                                                                                0.0s 
 ✔ storage Skipped - Image is already present locally                                                                                                                                0.0s 
 ✔ imgProxy Skipped - Image is already present locally                                                                                                                               0.0s 
 ✔ edgeRuntime Skipped - Image is already present locally                                                                                                                            0.0s 
 ✔ auth Skipped - Image is already present locally                                                                                                                                   0.0s 
 ✔ pgmeta Skipped - Image is already present locally                                                                                                                                 0.0s 
 ✔ analytics Skipped - Image is already present locally                                                                                                                              0.0s 
 ✔ api Skipped - Image is already present locally                                                                                                                                    0.0s 
 ✔ mailpit Skipped - Image is already present locally                                                                                                                                0.0s 
 ✔ realtime Skipped - Image is already present locally                                                                                                                               0.0s 
Starting database from backup...
Starting containers...
WARNING: Analytics on Windows requires Docker daemon exposed on tcp://localhost:2375.
See https://supabase.com/docs/guides/local-development/cli/getting-started?queryGroups=platform&platform=windows#running-supabase-locally for more details.
Waiting for health checks...
2026/04/30 10:42:04 HTTP HEAD: http://127.0.0.1:54321/rest-admin/v1/ready
2026/04/30 10:42:04 HTTP HEAD: http://127.0.0.1:54321/functions/v1/_internal/health
supabase_storage_YCS container logs:
Stopping containers...
Pruned containers: [d259f4ee9807054fed6087ebb418234310ddc1e69426aefb1db544d56705b337 e604d2afec59941126dd3e1a11c68caea56c3a4d274b0e9e82c94d4fddb193e6 9db634251df14f2f784a8e988e159f868e65e61ecc135d838ebd63a3069a15a5 6edf711a049bc6bb3394f5532b6ac124175887489e25147d11c759aad43f76bd a3affe4a4543e200b519fe12900ea84a3c2175d40728cb865760ba9d9af6d678 827e26258f859b803d237aa8823c81857e6686a2ce5bf7113d56ebcbf98f5ffd 49c2f367465e7ed09c998987b412b7c81dc984df4fd81d181664877e8ffe924f 2ffac5cefb8fb16d65dc5ccc503f69ec1abf479d5287372a5c6393e7e5e89004 85e956a2b8b1fb982b7339ec7316fb516b5d2006e59257943fea68600f886f58 df9d011ad474443fbf0efe20ca4693b5887d09ee13ad0c61aec4ef652bd09101 c07db5137e25df075d31b18d47932be37dd06ec8e82dd2d3cfc6769ab960e6da 584ac0487d29ce300549f1a54df20815a130356ca953daa629edcaeb7ff2e80a]
Pruned network: [supabase_network_YCS]
2026/04/30 10:42:53 HTTP POST: https://eu.i.posthog.com/batch/
supabase_storage_YCS container is not ready: unhealthy

---

**Cursor**

很好，現在「為什麼 54321 會消失」的原因抓到了：`supabase start` 失敗是因為 **`supabase_storage_YCS` health check 失敗（unhealthy）**，CLI 因此把整套容器 **全部停掉並 prune**，所以你才會看到 `ECONNREFUSED 54321`。

重點：**這不再是 Next.js / listProjectsWithTasks 的問題**，而是 Supabase local stack「Storage 服務」起不來，導致整套被 CLI 回收。

另外那行：

- `WARNING: Analytics on Windows requires Docker daemon exposed on tcp://localhost:2375.`  
  這只是 analytics 相關警告，通常 **不是** storage unhealthy 的主因（但也顯示 Windows 下某些服務有額外限制）。

## 下一步要看什麼（最短）
你這次 `--debug` 有印出 `supabase_storage_YCS container logs:` 但後面沒有內容，表示 CLI 沒把 log 帶出來或被截斷。你需要直接看那個容器的 log（或 inspect health 失敗原因）。

請你照下面跑（Git Bash）：

### 1) 先列出 storage 容器（確認它還在不在）
```bash
docker ps -a --filter "name=supabase_storage_YCS"
```

### 2) 如果還在，直接看它的健康檢查與 logs
```bash
docker inspect -f 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}}' supabase_storage_YCS
docker logs --tail 200 supabase_storage_YCS
```

### 3) 如果 storage 容器已經被 prune 掉（找不到）
那就改看 **上一輪被 prune 前的事件**很難追，所以請你立刻再跑一次 `start`，然後「立刻」在另一個 terminal 做：

```bash
npx supabase start --debug
```

同時（另一個 terminal）：

```bash
docker ps --filter "name=supabase_storage_YCS"
docker logs -f supabase_storage_YCS
```

（`-f` 會把它起不來的真正原因完整印出來）

## 常見造成 storage unhealthy 的幾個原因（讓你知道會看到什麼）
- **S3/MinIO credentials 不一致** 或初始化失敗
- **storage schema / migrations** 啟動時跑 SQL 失敗
- **連不到 DB**（Postgres 還在 recovery、或 networking 問題）
- **port 衝突**（但通常會在 logs 看到 bind 失敗）

你把 `docker logs --tail 200 supabase_storage_YCS` 貼上來，我就能直接對症下藥（通常 1–2 行 error 就能判斷要修什麼：DB、環境、或 storage 本身設定）。

---

**User**

不在了
$ docker ps -a --filter "name=supabase_storage_YCS"
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES


---

**Cursor**

了解，因為 CLI 失敗後有 **`Stopping containers...` + `Pruned containers...`**，所以 `supabase_storage_YCS` 已被刪掉，現在只能用「再起一次、立刻抓 log」的方式把真正錯誤撈出來。

## 你現在最短、最穩的抓法（兩個 Git Bash 視窗）
### 視窗 A：先把 start 跑起來（用 debug）
```bash
npx supabase start --debug
```

### 視窗 B：一看到容器出現就立刻追 storage logs
先在 B 視窗跑（會等你看到它出現）：

```bash
watch -n 0.5 "docker ps -a --filter name=supabase_storage_YCS --format '{{.Names}} {{.Status}}'"
```

當你看到 `supabase_storage_YCS` 出現後，立刻改跑：

```bash
docker logs -f supabase_storage_YCS
```

> 如果你沒有 `watch` 指令（有些 Git Bash 沒內建），就改用手動連打：
>
> ```bash
> docker ps -a --filter "name=supabase_storage_YCS"
> ```
> 看到出現後馬上 `docker logs -f supabase_storage_YCS`

## 為什麼一定要用 `-f`
因為 storage unhealthy 常常是「起來幾秒內就掛」，CLI 很快 prune 掉；用 `-f` 才能在它被刪前抓到關鍵錯誤行。

## 抓到錯誤後，你只要貼這三段就夠我判斷
- `docker logs -f supabase_storage_YCS` 裡第一個 `ERROR` 開始往上/下各 20 行
- `npx supabase start --debug` 最後 30 行（顯示是哪個 health check fail）
- 如果有看到「連 DB 失敗」，再補：
  ```bash
  docker logs --tail 80 supabase_db_YCS
  ```

抓到 storage 的真正錯誤訊息後，就能決定是：
- DB 起太慢/初始化順序問題
- storage migration/metadata 問題
- Windows 下 analytics/daemon 設定牽連（較少，但 debug 會露餡）
- port/網路問題

---

**User**

我打勾開機執行docker後，重開機在bash輸入
$ npx supabase start --debug
open C:\Users\BOYAWU\.supabase\profile: The system cannot find the file specified.
Supabase CLI 2.89.1
Using profile: supabase (supabase.co)
Loading project ref from file: supabase\.temp\project-ref
[+] Pulling 13/13
 ✔ imgProxy Skipped - Image is already present locally                                                                                                                               0.0s 
 ✔ studio Skipped - Image is already present locally                                                                                                                                 0.0s 
 ✔ pgmeta Skipped - Image is already present locally                                                                                                                                 0.0s 
 ✔ analytics Skipped - Image is already present locally                                                                                                                              0.0s 
 ✔ vector Skipped - Image is already present locally                                                                                                                                 0.0s 
 ✔ gateway Skipped - Image is already present locally                                                                                                                                0.0s 
 ✔ api Skipped - Image is already present locally                                                                                                                                    0.0s 
 ✔ mailpit Skipped - Image is already present locally                                                                                                                                0.0s 
 ✔ realtime Skipped - Image is already present locally                                                                                                                               0.0s 
 ✔ db Skipped - Image is already present locally                                                                                                                                     0.0s 
 ✔ edgeRuntime Skipped - Image is already present locally                                                                                                                            0.0s 
 ✔ auth Skipped - Image is already present locally                                                                                                                                   0.0s 
 ✔ storage Skipped - Image is already present locally                                                                                                                                0.0s 
Starting database from backup...
Stopping containers...
Pruned containers: [62b089ccf454c900e4ad82fd03bdc00c64b869c57b4ae28a6f82c4abac037dfb]
Pruned network: [supabase_network_YCS]
2026/04/30 10:49:31 HTTP POST: https://eu.i.posthog.com/batch/
failed to start docker container "supabase_db_YCS": Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:54322 -> 127.0.0.1:0: listen tcp 0.0.0.0:54322: bind: An attempt was made to access a socket in a way forbidden by its access permissions.

---

**Cursor**

關鍵錯誤已經很明確了：**Postgres 的對外 Port `54322` 綁定失敗**，所以整套 Supabase 直接啟不來，才會一路連鎖到 `54321` 不存在、Next.js `fetch failed`。

錯誤訊息：

- **`listen tcp 0.0.0.0:54322: bind: An attempt was made to access a socket in a way forbidden by its access permissions.`**

在 Windows 這個錯誤最常見的兩個原因：

## 1) `54322` 已被其他程式佔用（或殘留的 Docker/WSL 轉發佔住）
請先查是誰佔用（用 Windows 內建指令；這步最短最準）：

```bash
netstat -aon | grep ":54322"
```

如果有輸出，最後一欄會是 PID，例如：

- `TCP 0.0.0.0:54322 ... LISTENING ... 12345`

接著查是哪個程式：

```bash
tasklist | grep "12345"
```

（把 `12345` 換成你看到的 PID）

**處理方式**：把那個程式關掉（常見是本機 Postgres、PgBouncer、另一套 Supabase、或其他 DB 工具），再重跑 `npx supabase start --debug`。

## 2) Windows 防火牆/安全軟體/政策禁止綁定該 port
如果 `netstat` 查不到任何佔用，但 Docker 仍說 permission forbidden，那通常是：

- 公司端點防護軟體阻擋特定 port
- 防火牆規則/系統政策阻擋（較少見，但會發生）

這種情況的「工程上最穩解」是 **改 Supabase 本機的 DB port**（避開 54322），例如改成 55432；但這需要你調整 `supabase/config.toml`（我在 Ask mode 不能幫你改檔，但我可以告訴你要改哪裡）。

---

## 你現在先做這兩步就能往前推
1)

```bash
netstat -aon | grep ":54322"
```

2) 如果有 PID，貼 `tasklist | grep "<PID>"` 的輸出；如果沒有輸出也告訴我「完全空白」。

我會根據結果告訴你是「關掉衝突程式」還是「改 Supabase DB port」，並給你對應的最短操作。

---

**User**

boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ netstat -aon | grep ":54322"


---

**Cursor**

`netstat` 沒輸出，表示 **54322 並沒有被一般「使用者態程式」佔用**；但 Docker 仍然回「access permissions」錯，這在 Windows 幾乎都指向 **系統層/安全策略/保留端口（excluded port range）** 或 **防火牆/端點防護阻擋 Docker 綁定**，而不是單純衝突。

## 先用 2 個最短指令確認是不是「保留端口」卡住
請在 Git Bash 跑（會呼叫 Windows `netsh`，這是判斷用的官方工具）：

```bash
netsh interface ipv4 show excludedportrange protocol=tcp | grep -E "543(2[0-9]|[0-9])"
```

如果有看到包含 `54322` 的範圍（例如 `54320-54330`），那就定案：**這段端口被 Windows 保留，Docker 不能綁**。

（若你的 Git Bash 沒有 `grep -E` 也沒關係，直接跑不加 grep 的版本也行：）
```bash
netsh interface ipv4 show excludedportrange protocol=tcp
```

## 解法（最穩且不跟系統對抗）
**改 Supabase 本機 DB port，不用 54322。**  
例如改成 `55432` 或 `64322` 這種比較不會被保留的。

在 Supabase CLI 專案通常是改 `supabase/config.toml` 的 DB port（不同版本欄位名可能是 `db.port` 或類似）。你把 `supabase/config.toml` 相關段落貼我（或我可以幫你指出該找哪個 key），我就能給你「改哪一行、改成什麼值」的精準指令/內容。

## 額外快速驗證（不改設定前先試一個替代 port）
如果你想先賭一把看是不是只有 54322 被禁，你也可以試試看把 Docker Desktop 裡其他服務關掉再試，但通常不會解。**改 port 才是可持續的**。

---

你先把 `netsh interface ipv4 show excludedportrange protocol=tcp` 的輸出（包含 54322 附近那幾行）貼上來；我會直接告訴你該避開哪個範圍、建議換成哪個 port 最安全。

---

**User**

$ netsh interface ipv4 show excludedportrange protocol=tcp | grep -E "543(2[0-9]|[0-9])"
     54222       54321      
     54322       54421      


---

**Cursor**

定案了：`54322` **被 Windows 保留（excluded port range）**，所以 Docker **依法**不能綁 `0.0.0.0:54322`，才會出現你那個「access permissions」錯誤。

你看到的兩段保留範圍是：

- `54222–54321`
- **`54322–54421`** ← 你的 `54322` 就在這段裡

## 最穩解法
**把 Supabase local DB 的 port 從 `54322` 改到一個不在保留範圍的值**（例如 `55432`、`65432`、或 `15432`）。

建議優先用 **`55432`**（好記、也通常不會被保留）。

## 你要改哪裡（專案內）
在 Supabase CLI 專案通常是改 `supabase/config.toml` 的 DB port 設定（例如 `db.port` 或類似欄位）。你可以用這個快速定位：

```bash
ls supabase
```

然後把 `supabase/config.toml` 裡跟 `54322` / `port` / `db` 有關的那幾行貼我，我就能告訴你**精準要改哪個 key**、以及改完後需要跑的指令（通常是 `npx supabase stop` → `npx supabase start`）。

## 額外提醒（避免你踩下一個坑）
改 DB port 後，你的 `.env.local` 裡如果也有 `DATABASE_URL=...:54322/...`，也要同步改成新的 port；不然 Supabase 起得來，但你本機直連 DB 的腳本/工具會壞。

你把 `supabase/config.toml` 的相關段落貼上來就行（不用整份）。

---

**User**

為何之前可以

---

**Cursor**

之前會「可以」，是因為 **Windows 的 excluded port range 不是固定不變**，它會隨系統狀態動態變動；你這次重開機後剛好把 `54322–54421` 這段保留起來，Docker 就不能再綁 `54322` 了。

最常見造成「保留範圍變動」的來源：

- **Hyper-V / WSL2 / Docker Desktop** 啟動或重啟後，Windows 會重新分配一段 *excluded ports* 給 NAT/Port Proxy 用  
- **VPN / 企業端點防護/網路驅動** 介入後，保留範圍可能改掉  
- **Windows Update / 網路堆疊重置** 也會改掉保留區間

所以你之前能跑，只代表「當時 54322 沒在 excluded 範圍內」；現在它被保留了，就一定會失敗。

## 最實務的建議（避免下次又中招）
- **不要用 54322** 當你自己的固定 DB port（它很容易落在 Windows 動態保留區間附近）
- 直接把 Supabase local DB port 改成比較不容易被保留的（例如 **`55432`** 或 **`65432`**），這是最穩的長期解

如果你願意，我也可以給你一個「挑選安全 port」的規則：從 `55000+` 或 `65000+` 選一個，然後用 `netsh interface ipv4 show excludedportrange protocol=tcp` 確認不在任何區間內再定案。

---

**User**

我要改哪裡

---

**Cursor**

我先在你的 repo 裡找到 Supabase 的設定檔（通常是 `supabase/config.toml`），確認目前 DB port 設定在哪個 key，然後給你一個「改成安全 port」的具體修改點與重啟步驟。

你要改的點就在 `supabase/config.toml` 的 `[db]` 區塊，把 DB port 從 **54322** 換成一個不在 excluded range 的值（例如 **55432**）。

你目前檔案內容是：

```27:33:z:\Github\ycs-middl\supabase\config.toml
[db]
# Port to use for the local database URL.
port = 54322
# Port used by db diff command to initialize the shadow database.
shadow_port = 54320
```

## 你要改哪裡
- **`supabase/config.toml`**
  - 把 `port = 54322` 改成 `port = 55432`（或你想要的其他安全 port）
  - 建議同時把 `shadow_port = 54320` 也改到同一段安全區（例如 `55430`），避免它也落在保留範圍

## 你還要同步改哪裡（不然之後會踩雷）
- **`.env.local`** 如果你有 `DATABASE_URL=postgresql://...@127.0.0.1:54322/...`，也要把 `54322` 改成新 port  
  你 repo 的 `.env.example` 有這行：

```11:11:z:\Github\ycs-middl\.env.example
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

## 改完後怎麼做
```bash
npx supabase stop
npx supabase start --debug
npx supabase status
```

只要 DB 能成功綁定新 port，`54321` API 也會跟著起來，你的 Next.js `listProjectsWithTasks` 的 `fetch failed` 就會消失。

---

**User**

改完還是依樣
boyawu@BoyaWu-NB MINGW64 /d/Github/ycs-middl (main)
$ npx supabase start --debug
open C:\Users\BOYAWU\.supabase\profile: The system cannot find the file specified.
Supabase CLI 2.89.1
Using profile: supabase (supabase.co)
Loading project ref from file: supabase\.temp\project-ref
[+] Pulling 13/13
 ✔ gateway Skipped - Image is already present locally                                                                                                                                0.0s 
 ✔ api Skipped - Image is already present locally                                                                                                                                    0.0s 
 ✔ auth Skipped - Image is already present locally                                                                                                                                   0.0s 
 ✔ imgProxy Skipped - Image is already present locally                                                                                                                               0.0s 
 ✔ edgeRuntime Skipped - Image is already present locally                                                                                                                            0.0s 
 ✔ mailpit Skipped - Image is already present locally                                                                                                                                0.0s 
 ✔ db Skipped - Image is already present locally                                                                                                                                     0.0s 
 ✔ studio Skipped - Image is already present locally                                                                                                                                 0.0s 
 ✔ pgmeta Skipped - Image is already present locally                                                                                                                                 0.0s 
 ✔ realtime Skipped - Image is already present locally                                                                                                                               0.0s 
 ✔ storage Skipped - Image is already present locally                                                                                                                                0.0s 
 ✔ analytics Skipped - Image is already present locally                                                                                                                              0.0s 
 ✔ vector Skipped - Image is already present locally                                                                                                                                 0.0s 
Starting database from backup...
Starting containers...
Stopping containers...
Pruned containers: [1ff1b8bf6a9fedeab465ce07a00b913679d6402b11ed1d6115f7a19616b8bfb9 c09f33505b39c233de4d0c57d01054be7f82591f065fd2b084dee57f6e6427c5]
Pruned network: [supabase_network_YCS]
2026/04/30 10:56:07 HTTP POST: https://eu.i.posthog.com/batch/
failed to start docker container "supabase_analytics_YCS": Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:54327 -> 127.0.0.1:0: listen tcp 0.0.0.0:54327: bind: An attempt was made to access a socket in a way forbidden by its access permissions.

---

**Cursor**

這次卡的是 **`supabase_analytics_YCS` 綁定 `54327` 失敗**，同一種 Windows excluded port / 權限問題；所以你把 DB port 改掉後，下一個被保留的 port 又踩到了，CLI 一樣會整套停掉。

關鍵訊息：

- `failed to start docker container "supabase_analytics_YCS"... listen tcp 0.0.0.0:54327 ... forbidden by its access permissions`

## 先確認 `54327` 也在 excluded range（幾乎一定）
請跑：

```bash
netsh interface ipv4 show excludedportrange protocol=tcp | grep -E "5432[0-9]"
```

你很可能會看到包含 `54327` 的區間。

## 最穩的做法（我會挑戰你不要一個個改）
不要只改一個 port，因為你這台機器現在整段 `54xxx` 附近被保留得很兇；建議你把 **所有 Supabase 相關 port**（db、shadow、analytics、pooler 等）一次搬到一段「不容易被保留」的高位區間，例如 **`65xxx`**。

以你的 `supabase/config.toml` 來看，至少要動這些（你目前檔案裡有）：

- `[api].port`（54321）  
- `[db].port`（原 54322）  
- `[db].shadow_port`（54320）  
- `[analytics].port`（54327）  
- `[studio].port`（54323）  
- `[inbucket].port`（54324）  
- `[edge_runtime].inspector_port`（8083 這個通常不用動）  
- `[db.pooler].port`（54329，雖然你現在 disabled，但建議也搬）

### 建議一組「整段搬家」的安全配置（範例）
把整組改成：

- api: **65321**
- db: **65322**
- shadow db: **65320**
- studio: **65323**
- inbucket: **65324**
- analytics: **65327**
- pooler: **65329**（即使 disabled 也一致）

改完再：

```bash
npx supabase stop
npx supabase start --debug
```

然後用：

```bash
npx supabase status
```

確認新 URL/ports 都起來。

## 同步別忘了
- `.env.local` 裡的 `NEXT_PUBLIC_SUPABASE_URL` 也要改成 `http://127.0.0.1:65321`
- `DATABASE_URL` 改成 `...:65322/...`

---

如果你想先確認「65320–65329 這段是不是安全的」，跑：

```bash
netsh interface ipv4 show excludedportrange protocol=tcp | grep -E "6532[0-9]"
```

只要沒有命中，就可以用這段。

你回我兩個結果就能直接收斂：
1) `netsh ... | grep -E "5432[0-9]"`（看 54327 是否真的被保留）
2) `netsh ... | grep -E "6532[0-9]"`（確認新段落安全）

---

**User**

還是我重置資料庫?

---

**Cursor**

先不要。你現在的失敗點是 **port 綁定被 Windows 禁止（excluded port range）**，跟資料庫內容完全無關；你就算 `db reset`，它還是會在「容器綁不到 port」這一步就死掉。

**正確順序是：先把所有會用到的 port 搬到一段沒被保留的區間 → 確認 `npx supabase start` 能穩定起來 → 真的需要清資料才做 `db reset`。**

## 你該做什麼（最短）
1) 先找一段安全 port（我建議用 65000+）
```bash
netsh interface ipv4 show excludedportrange protocol=tcp | grep -E "6532[0-9]"
```
- 如果沒有輸出，代表 `65320–65329` 很可能安全

2) 然後在 `supabase/config.toml` 一次改掉這些（避免你一個個踩雷）：
- `[api].port`
- `[db].port`
- `[db].shadow_port`
- `[studio].port`
- `[inbucket].port`
- `[analytics].port`
- `[db.pooler].port`（即使 disabled 也一起改）

3) 同步改 `.env.local`：
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<新 api port>`
- `DATABASE_URL=...:<新 db port>/...`

4) 重啟：
```bash
npx supabase stop
npx supabase start --debug
```

## 什麼情況下才需要 reset？
- 你確定 port 都 OK、Supabase 能起來了，但資料結構/資料狀態壞掉、migrations 跑不過，才用：
```bash
npx supabase db reset
```

如果你願意，貼你打算用的那段新 port（例如 6532x），我可以幫你快速檢查是否落在 excluded range，避免你又改一輪。

---

**User**

給我一段prompt我到那台電腦請cursor直接修到好

---

**Cursor**

下面這段你直接貼給 Cursor（Agent mode，不要 Ask mode），它會把整套 Supabase local ports 一次搬到安全區、同步 `.env.local`，並驗證能正常 `supabase start`、`next start`。

---

請你在這個 repo `ycs-middl` 幫我修復 Windows 上 `npx supabase start --debug` 因為 *excluded port range* 導致的「bind: An attempt was made to access a socket in a way forbidden by its access permissions」問題。

背景：
- Windows 會保留 `54322–54421`，導致 `supabase_db_YCS` 無法綁 `54322`。
- 我已經遇到 `supabase_analytics_YCS` 也無法綁 `54327`。
- 目標是：讓 `npx supabase start` 能穩定啟動，`http://127.0.0.1:<apiPort>/rest/v1/` 可連線，Next.js 的 `listProjectsWithTasks` 不再 `fetch failed`。

要求：
1) 讀取並修改 `supabase/config.toml`，把所有可能綁到 5432x/5432y 的服務一次搬到一段高位、通常不會被保留的 port 區間（例如 65xxx）。至少要改：
   - `[api].port`
   - `[db].port`
   - `[db].shadow_port`
   - `[studio].port`
   - `[inbucket].port`
   - `[analytics].port`
   - `[db.pooler].port`（即使 disabled 也一併調整保持一致）
2) 修改 `.env.example`（或提示我同步改 `.env.local`）讓：
   - `NEXT_PUBLIC_SUPABASE_URL` 指向新 `api.port`
   - `DATABASE_URL` 指向新 `db.port`
3) 在修改前先用 `netsh interface ipv4 show excludedportrange protocol=tcp` 檢查你選的 65xxx ports 不落在 excluded range；若命中就換另一段，直到找到可用段。
4) 依序執行並驗證：
   - `npx supabase stop`
   - `npx supabase start --debug`
   - `npx supabase status`
   - `curl -i "http://127.0.0.1:<newApiPort>/rest/v1/" | head -n 5`
5) 最後給我：
   - 你選用的 port 對照表（api/db/studio/mail/analytics/shadow/pooler）
   - 下一次重開機後的啟動順序（Docker Desktop → `npx supabase start` → `npm run start`）

限制：
- 我在 Windows + Git Bash，請用 Bash 指令與正斜線路徑。
- 若要做 DB reset 請先不要做，除非你確認 ports 問題已完全解決且仍有 migrations/資料損壞才需要。

---

