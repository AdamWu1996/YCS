'use server';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * 建立計費裁決的參數介面
 */
export interface CreateBillingDecisionParams {
  time_record_ids: string[];
  task_id: string;
  decision_type: string;
  final_md: number;
  recommended_md?: number;
  is_forced_md?: boolean;
  reason?: string;
  decision_maker_id?: string;
  has_conflict?: boolean;
  conflict_type?: string;
  is_conflict_resolved?: boolean;
  conflict_resolution_notes?: string;
  is_billable?: boolean;
}

/**
 * 建立計費裁決 Server Action
 * 
 * 流程：
 * 1. 檢查傳入的 time_record_ids 是否已被任何 is_active = TRUE 的 billing_decision 關聯
 * 2. 若存在，先將舊 decision 設為 is_active = FALSE
 * 3. 更新該批工時的 task_id（認領動作）
 * 4. 建立新的 billing_decision（is_active = TRUE）
 * 5. 建立對應的 billing_decision_records
 * 
 * 整個流程在單一 Transaction 中完成，確保資料一致性。
 */
export async function createBillingDecision(
  params: CreateBillingDecisionParams
) {
  const supabase = createServerSupabaseClient();

  try {
    // 步驟 0: 基本驗證（未選任務禁止認領）
    if (!params.task_id) {
      return {
        success: false,
        error: '請先選擇專案任務',
      };
    }

    // 步驟 1: 檢查是否有現有的 active decision 關聯這些 time_record_ids
    // 透過 billing_decision_records 關聯表查詢，確保遵循數據血統原則
    const { data: existingRecords, error: checkError } = await supabase
      .from('billing_decision_records')
      .select(`
        billing_decision_id,
        billing_decisions!inner(id, is_active)
      `)
      .in('time_record_id', params.time_record_ids);

    if (checkError) {
      throw new Error(`檢查現有關聯時發生錯誤: ${checkError.message}`);
    }

    // 步驟 2: 收集需要停用的 decision IDs（僅限 is_active = TRUE 的決策）
    const decisionIdsToDeactivate = new Set<string>();
    if (existingRecords && existingRecords.length > 0) {
      existingRecords.forEach((record: any) => {
        const decision = record.billing_decisions;
        if (decision?.id && decision.is_active === true) {
          decisionIdsToDeactivate.add(decision.id);
        }
      });
    }

    // 步驟 3: 使用 Postgres Function 執行 Transaction
    // 此 Function 確保整個流程在單一 Transaction 中完成
    const { data: result, error: transactionError } = await supabase.rpc(
      'create_billing_decision_transaction',
      {
        p_time_record_ids: params.time_record_ids,
        p_decision_type: params.decision_type,
        p_final_md: params.final_md,
        p_recommended_md: params.recommended_md ?? null,
        p_is_forced_md: params.is_forced_md ?? false,
        p_reason: params.reason ?? null,
        p_decision_maker_id: params.decision_maker_id ?? null,
        p_has_conflict: params.has_conflict ?? false,
        p_conflict_type: params.conflict_type ?? null,
        p_is_conflict_resolved: params.is_conflict_resolved ?? false,
        p_conflict_resolution_notes: params.conflict_resolution_notes ?? null,
        p_is_billable: params.is_billable ?? false,
        p_decision_ids_to_deactivate: Array.from(decisionIdsToDeactivate),
        p_task_id: params.task_id,
      }
    );

    if (transactionError) {
      throw new Error(`Transaction 執行失敗: ${transactionError.message}`);
    }

    // Transaction 成功執行
    revalidatePath('/dashboard/billing');
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('createBillingDecision 錯誤:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤',
    };
  }
}
