'use server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 待裁決時數紀錄的資料型別
 */
export interface PendingBillingDecision {
  time_record_id: string;
  staff_id: string;
  task_id: string | null;
  record_date: string;
  factory_location: string;
  hours_worked: number;
  check_in_time: string;
  check_out_time: string | null;
  billing_decision_id: string | null;
  decision_type: string | null;
  has_conflict: boolean;
  is_conflict_resolved: boolean;
  is_billable: boolean;
  final_md: number | null;
  has_decision: boolean;
  merged_total_hours: number | null;
}

/**
 * 可認領任務資料型別
 */
export interface ClaimableTask {
  id: string;
  code: string;
  name: string;
  budgeted_md: number | null;
  used_md: number;
  project: {
    id: string;
    code: string;
    name: string;
  } | null;
}

/**
 * 查詢待裁決時數紀錄列表
 * 資料來源：pending_billing_decisions_summary View（唯讀）
 */
export async function getPendingBillingDecisions(): Promise<{
  success: boolean;
  data?: PendingBillingDecision[];
  error?: string;
}> {
  const supabase = createServerSupabaseClient();

  try {
    const { data, error } = await supabase
      .from('pending_billing_decisions_summary')
      .select('*')
      .order('record_date', { ascending: false })
      .order('check_in_time', { ascending: false });

    if (error) {
      throw new Error(`查詢待裁決紀錄失敗: ${error.message}`);
    }

    return {
      success: true,
      data: (data || []) as PendingBillingDecision[],
    };
  } catch (error) {
    console.error('getPendingBillingDecisions 錯誤:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤',
    };
  }
}

/**
 * 查詢可認領的任務列表（含專案資訊）
 */
export async function getClaimableTasks(): Promise<{
  success: boolean;
  data?: ClaimableTask[];
  error?: string;
}> {
  const supabase = createServerSupabaseClient();

  try {
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select(
        `
        id,
        code,
        name,
        budgeted_md,
        project:projects(id, code, name)
      `
      )
      .eq('status', 'active')
      .order('code', { ascending: true });

    if (taskError) {
      throw new Error(`查詢任務列表失敗: ${taskError.message}`);
    }

    const { data: summaryData, error: summaryError } = await supabase
      .from('task_billing_summary')
      .select('task_id, used_md');

    if (summaryError) {
      throw new Error(`查詢任務已用 MD 失敗: ${summaryError.message}`);
    }

    const usedMdByTaskId = new Map<string, number>();
    (summaryData || []).forEach((row: any) => {
      if (row.task_id) {
        usedMdByTaskId.set(row.task_id, Number(row.used_md) || 0);
      }
    });

    const mergedData = (taskData || []).map((task: any) => ({
      ...task,
      used_md: usedMdByTaskId.get(task.id) ?? 0,
    })) as ClaimableTask[];

    return {
      success: true,
      data: mergedData,
    };
  } catch (error) {
    console.error('getClaimableTasks 錯誤:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤',
    };
  }
}
