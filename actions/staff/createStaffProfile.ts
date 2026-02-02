'use server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface CreateStaffProfileInput {
  name: string;
  email: string;
  employeeNo?: string;
}

export interface CreateStaffProfileResult {
  success: boolean;
  data?: { id: string; name: string };
  error?: string;
}

/**
 * 建立人員檔案（僅後端寫入，不可由前端直接操作 Supabase）
 * 先建立 auth.users，再寫入 staff_profiles；若該 email 已存在則回傳既有人員。
 */
export async function createStaffProfile(
  input: CreateStaffProfileInput
): Promise<CreateStaffProfileResult> {
  const { name, email, employeeNo } = input;
  const trimmedName = name?.trim() ?? '';
  const trimmedEmail = email?.trim() ?? '';

  if (!trimmedName || !trimmedEmail) {
    return { success: false, error: '姓名與 Email 為必填' };
  }

  const supabase = createServerSupabaseClient();

  try {
    // 先查是否已有此 email 的 staff_profile
    const { data: existing } = await supabase
      .from('staff_profiles')
      .select('id, name')
      .eq('email', trimmedEmail)
      .maybeSingle();

    if (existing) {
      return {
        success: true,
        data: { id: existing.id, name: existing.name },
      };
    }

    // 建立 auth 使用者（需 service role）
    const password =
      typeof process.env.STAFF_INVITE_DEFAULT_PASSWORD === 'string' &&
      process.env.STAFF_INVITE_DEFAULT_PASSWORD.length > 0
        ? process.env.STAFF_INVITE_DEFAULT_PASSWORD
        : crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: trimmedName },
    });

    if (authError) {
      if (authError.message.includes('already been registered')) {
        const { data: byEmail } = await supabase
          .from('staff_profiles')
          .select('id, name')
          .eq('email', trimmedEmail)
          .maybeSingle();
        if (byEmail) {
          return { success: true, data: { id: byEmail.id, name: byEmail.name } };
        }
      }
      return {
        success: false,
        error: authError.message || '建立帳號失敗',
      };
    }

    const userId = authData?.user?.id;
    if (!userId) {
      return { success: false, error: '建立帳號後未取得 user_id' };
    }

    const insertPayload: {
      user_id: string;
      name: string;
      email: string;
      employee_no?: string;
    } = {
      user_id: userId,
      name: trimmedName,
      email: trimmedEmail,
    };
    if (employeeNo?.trim()) insertPayload.employee_no = employeeNo.trim();

    const { data: inserted, error: insertError } = await supabase
      .from('staff_profiles')
      .insert(insertPayload)
      .select('id, name')
      .single();

    if (insertError) {
      return {
        success: false,
        error: insertError.message || '寫入人員資料失敗',
      };
    }

    return {
      success: true,
      data: { id: inserted.id, name: inserted.name },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : '未知錯誤';
    return { success: false, error: message };
  }
}

export interface EnsureStaffProfileFromAuthUserInput {
  name: string;
  email: string;
  employeeNo?: string;
}

/**
 * 當 auth.users 已有該 Email、但 staff_profiles 尚無對應時，建立一筆 staff_profile。
 * user_id 必來自 auth.users，不可假造。
 * 若 auth 中找不到該 Email：拒絕並回傳錯誤，不自動建立帳號。
 */
export async function ensureStaffProfileFromAuthUser(
  input: EnsureStaffProfileFromAuthUserInput
): Promise<CreateStaffProfileResult> {
  const { name, email, employeeNo } = input;
  const trimmedName = name?.trim() ?? '';
  const trimmedEmail = email?.trim() ?? '';

  if (!trimmedName || !trimmedEmail) {
    return { success: false, error: '姓名與 Email 為必填' };
  }

  const supabase = createServerSupabaseClient();

  try {
    const { data: existing } = await supabase
      .from('staff_profiles')
      .select('id, name')
      .eq('email', trimmedEmail)
      .maybeSingle();

    if (existing) {
      return { success: true, data: { id: existing.id, name: existing.name } };
    }

    const { data: listData } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const authUser = listData?.users?.find(
      (u) => u.email?.toLowerCase() === trimmedEmail.toLowerCase()
    );

    if (!authUser?.id) {
      return {
        success: false,
        error:
          '此 Email 尚未在系統註冊。請先使用「建立人員」建立新帳號，或確認 Email 是否正確。',
      };
    }

    const insertPayload: {
      user_id: string;
      name: string;
      email: string;
      employee_no?: string;
    } = {
      user_id: authUser.id,
      name: trimmedName,
      email: trimmedEmail,
    };
    if (employeeNo?.trim()) insertPayload.employee_no = employeeNo.trim();

    const { data: inserted, error: insertError } = await supabase
      .from('staff_profiles')
      .insert(insertPayload)
      .select('id, name')
      .single();

    if (insertError) {
      return {
        success: false,
        error: insertError.message || '寫入人員資料失敗',
      };
    }

    return {
      success: true,
      data: { id: inserted.id, name: inserted.name },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : '未知錯誤';
    return { success: false, error: message };
  }
}
