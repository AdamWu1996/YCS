/**
 * 診斷：time_records 與 pending_billing_decisions_summary 筆數
 * 使用方式：node --env-file=.env.local scripts/diagnose-pending-view.mjs
 * 若無 --env-file（Node 20+）：先 set 環境變數或使用 dotenv
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const envPath = join(root, '.env.local');

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（請設於 .env.local）');
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  console.log('--- 1) time_records 總數與有出場時間筆數 ---');
  const { count: total } = await supabase.from('time_records').select('*', { count: 'exact', head: true });
  const { count: withCheckOut } = await supabase
    .from('time_records')
    .select('*', { count: 'exact', head: true })
    .not('check_out_time', 'is', null);
  console.log('time_records 總數:', total);
  console.log('有 check_out_time 的筆數:', withCheckOut);

  console.log('\n--- 2) time_records 取樣（有出場、最近 3 筆）---');
  const { data: sample, error: e2 } = await supabase
    .from('time_records')
    .select('id, record_date, check_in_time, check_out_time, hours_worked')
    .not('check_out_time', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3);
  if (e2) console.error(e2);
  else console.log(JSON.stringify(sample, null, 2));

  console.log('\n--- 3) pending_billing_decisions_summary 筆數 ---');
  const { count: pendingCount, error: e3 } = await supabase
    .from('pending_billing_decisions_summary')
    .select('*', { count: 'exact', head: true });
  if (e3) {
    console.error('查詢 View 錯誤:', e3.message, e3.code, e3.details);
  } else {
    console.log('pending_billing_decisions_summary 筆數:', pendingCount);
  }

  console.log('\n--- 4) View 單筆取樣（若有）---');
  const { data: viewSample, error: e4 } = await supabase
    .from('pending_billing_decisions_summary')
    .select('time_record_id, record_date, has_decision, billing_decision_id')
    .limit(2);
  if (e4) console.error(e4);
  else console.log(JSON.stringify(viewSample, null, 2));
}

main();
