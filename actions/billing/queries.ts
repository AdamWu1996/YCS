'use server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 待裁決時數紀錄的資料型別
 */
export interface PendingBillingDecision {
  time_record_id: string;
  staff_id: string;
  task_id: string;
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
