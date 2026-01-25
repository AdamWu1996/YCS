'use server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 匯入的時數紀錄資料型別
 */
export interface ImportTimeRecord {
  staff_id: string;
  task_id: string;
  record_date: string; // YYYY-MM-DD
  factory_location: string;
  check_in_time: string; // ISO 8601
  check_out_time: string | null; // ISO 8601
  notes?: string;
}

/**
 * 匯入時數紀錄
 * 防重機制：若相同人員、日期、時間與廠區的紀錄已存在，則跳過該筆
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

  try {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const record of records) {
      try {
        // 潔癖行為：過濾小於 5 分鐘的雜訊數據
        if (record.check_in_time && record.check_out_time) {
          const checkIn = new Date(record.check_in_time);
          const checkOut = new Date(record.check_out_time);
          const durationMinutes = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60);
          
          if (durationMinutes < 5) {
            skipped++;
            continue; // 跳過小於 5 分鐘的數據
          }
        }

        // 檢查是否已存在相同紀錄
        // 防重條件：相同 staff_id、record_date、factory_location、check_in_time
        const { data: existing, error: checkError } = await supabase
          .from('time_records')
          .select('id')
          .eq('staff_id', record.staff_id)
          .eq('record_date', record.record_date)
          .eq('factory_location', record.factory_location)
          .eq('check_in_time', record.check_in_time)
          .maybeSingle();

        if (checkError) {
          errors.push(`檢查重複紀錄失敗: ${checkError.message}`);
          continue;
        }

        if (existing) {
          skipped++;
          continue;
        }

        // 插入新紀錄
        const { error: insertError } = await supabase
          .from('time_records')
          .insert({
            staff_id: record.staff_id,
            task_id: record.task_id,
            record_date: record.record_date,
            factory_location: record.factory_location,
            check_in_time: record.check_in_time,
            check_out_time: record.check_out_time,
            notes: record.notes || null,
          });

        if (insertError) {
          errors.push(`匯入失敗: ${insertError.message}`);
          continue;
        }

        imported++;
      } catch (error) {
        errors.push(
          `處理紀錄時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`
        );
      }
    }

    return {
      success: true,
      data: {
        imported,
        skipped,
        errors,
      },
    };
  } catch (error) {
    console.error('importTimeRecords 錯誤:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤',
    };
  }
}
