import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * 建立 Supabase Server Client（用於 Server Actions）
 * 使用服務端金鑰，具備完整資料庫權限
 */
export function createServerSupabaseClient() {
  // Server-side runtime env first (avoid NEXT_PUBLIC being inlined at build time)
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    const missing = [
      !supabaseUrl && 'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)',
      !supabaseServiceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean);
    throw new Error(
      `Missing Supabase env: ${missing.join(', ')}. 請在專案根目錄建立 .env.local 並重啟 dev server。`
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * 建立 Supabase Server Client（用於 SSR，基於使用者 Session）
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  // Server-side runtime env first (avoid NEXT_PUBLIC being inlined at build time)
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = [
      !supabaseUrl && 'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)',
      !supabaseAnonKey && 'SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    ].filter(Boolean);
    throw new Error(
      `Missing Supabase env: ${missing.join(', ')}. 請在專案根目錄建立 .env.local 並重啟 dev server。`
    );
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // 在 Server Actions 中可能無法設定 cookies
        }
      },
    },
  });
}
