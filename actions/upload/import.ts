'use server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

/** 單筆匯入用 payload，task_id 匯入時一律不寫入（公海池） */
export interface ImportTimeRecord {
  staff_id: string;
  task_id?: string | null;
  record_date: string; // YYYY-MM-DD
  factory_location: string;
  check_in_time: string; // ISO 8601
  check_out_time: string | null; // ISO 8601
  notes?: string;
}

const BATCH_SIZE = 150;
const IMPORT_UNIQUE_KEY = 'staff_id,record_date,factory_location,check_in_time';

/**
 * 匯入時數紀錄（批量 upsert）
 * - 潔癖：duration < 5 分鐘的列不寫入，計入 skipped
 * - 防重：依 uniq_time_records_import_key 衝突則跳過，計入 skipped
 * - 公海池：匯入時 task_id 一律為 null
 */
export async function importTimeRecords(
  records: ImportTimeRecord[]
): Promise<{
  success: boolean;
  data?: {
    imported: number;
    skipped: number;
    errors: string[];
  };
  error?: string;
}> {
  const supabase = createServerSupabaseClient();
  const errors: string[] = [];
  let imported = 0;
  let skippedDuration = 0;

  try {
    // 1) 潔癖：過濾 duration < 5 分鐘，並組出要寫入的列（task_id 強制 null）
    const toInsert: Array<{
      staff_id: string;
      task_id: null;
      record_date: string;
      factory_location: string;
      check_in_time: string;
      check_out_time: string | null;
      notes: string | null;
    }> = [];

    for (const record of records) {
      if (record.check_in_time && record.check_out_time) {
        const checkIn = new Date(record.check_in_time);
        const checkOut = new Date(record.check_out_time);
        const durationMinutes = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60);
        if (durationMinutes < 5) {
          skippedDuration++;
          continue;
        }
      }

      toInsert.push({
        staff_id: record.staff_id,
        task_id: null, // 公海池：匯入時不寫入專案/任務，裁決中心再認領
        record_date: record.record_date,
        factory_location: record.factory_location,
        check_in_time: record.check_in_time,
        check_out_time: record.check_out_time,
        notes: record.notes ?? null,
      });
    }

    // 2) 分批 upsert（ON CONFLICT DO NOTHING），依回傳列數計入 imported
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const chunk = toInsert.slice(i, i + BATCH_SIZE);
      try {
        const { data, error } = await supabase
          .from('time_records')
          .upsert(chunk, {
            onConflict: IMPORT_UNIQUE_KEY,
            ignoreDuplicates: true,
          })
          .select('id');

        if (error) {
          errors.push(`批次 ${Math.floor(i / BATCH_SIZE) + 1} 寫入失敗: ${error.message}`);
          continue;
        }
        imported += data?.length ?? 0;
      } catch (chunkError) {
        const msg = chunkError instanceof Error ? chunkError.message : String(chunkError);
        errors.push(`批次 ${Math.floor(i / BATCH_SIZE) + 1} 例外: ${msg}`);
      }
    }

    const skippedDuplicates = toInsert.length - imported;
    const skipped = skippedDuration + skippedDuplicates;

    return {
      success: true,
      data: { imported, skipped, errors },
    };
  } catch (error) {
    console.error('importTimeRecords 錯誤:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤',
    };
  }
}
