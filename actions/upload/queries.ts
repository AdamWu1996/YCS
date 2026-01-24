'use server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 員工資料型別
 */
export interface StaffProfile {
  id: string;
  name: string;
  email: string;
}

/**
 * 查詢所有員工資料（用於人員匹配）
 */
export async function getAllStaffProfiles(): Promise<{
  success: boolean;
  data?: StaffProfile[];
  error?: string;
}> {
  const supabase = createServerSupabaseClient();

  try {
    const { data, error } = await supabase
      .from('staff_profiles')
      .select('id, name, email')
      .order('name', { ascending: true });

    if (error) {
      throw new Error(`查詢員工資料失敗: ${error.message}`);
    }

    return {
      success: true,
      data: (data || []) as StaffProfile[],
    };
  } catch (error) {
    console.error('getAllStaffProfiles 錯誤:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤',
    };
  }
}

/**
 * 根據專案代碼和任務代碼查詢 task_id
 */
export async function getTaskIdByCodes(
  projectCode: string,
  taskCode: string
): Promise<{
  success: boolean;
  data?: string;
  error?: string;
}> {
  const supabase = createServerSupabaseClient();

  try {
    // 先查詢專案
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('code', projectCode)
      .eq('status', 'active')
      .single();

    if (projectError || !project) {
      throw new Error(`找不到專案代碼: ${projectCode}`);
    }

    // 再查詢任務
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id')
      .eq('project_id', project.id)
      .eq('code', taskCode)
      .eq('status', 'active')
      .single();

    if (taskError || !task) {
      throw new Error(`找不到任務代碼: ${taskCode}（專案: ${projectCode}）`);
    }

    return {
      success: true,
      data: task.id,
    };
  } catch (error) {
    console.error('getTaskIdByCodes 錯誤:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤',
    };
  }
}
