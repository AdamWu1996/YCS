-- ============================================
-- 測試排他鎖：嘗試建立第二個裁決
-- ============================================

-- 步驟 1: 查詢已認領的工時紀錄（用於測試）
SELECT 
    '=== 已認領的工時紀錄 ===' as section;

SELECT 
    tr.id as time_record_id,
    tr.record_date,
    tr.factory_location,
    tr.hours_worked,
    tr.task_id,
    bd.id as billing_decision_id,
    bd.final_md,
    bd.is_active as decision_is_active,
    bdr.is_active as record_is_active
FROM time_records tr
JOIN billing_decision_records bdr ON bdr.time_record_id = tr.id
JOIN billing_decisions bd ON bd.id = bdr.billing_decision_id
WHERE tr.notes LIKE '實戰演習%'
  AND bd.is_active = TRUE
ORDER BY tr.check_in_time;

-- 步驟 2: 取得第一筆已認領的工時 ID（用於測試）
DO $$
DECLARE
    v_test_time_record_id UUID;
    v_test_task_id UUID;
    v_existing_decision_id UUID;
    v_error_message TEXT;
BEGIN
    -- 取得第一筆已認領的工時
    SELECT tr.id, tr.task_id, bd.id
    INTO v_test_time_record_id, v_test_task_id, v_existing_decision_id
    FROM time_records tr
    JOIN billing_decision_records bdr ON bdr.time_record_id = tr.id
    JOIN billing_decisions bd ON bd.id = bdr.billing_decision_id
    WHERE tr.notes LIKE '實戰演習%'
      AND bd.is_active = TRUE
    LIMIT 1;
    
    IF v_test_time_record_id IS NULL THEN
        RAISE NOTICE '找不到已認領的工時紀錄，請先執行第一次裁決';
        RETURN;
    END IF;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '測試排他鎖機制';
    RAISE NOTICE '========================================';
    RAISE NOTICE '測試工時 ID: %', v_test_time_record_id;
    RAISE NOTICE '現有裁決 ID: %', v_existing_decision_id;
    RAISE NOTICE '現有任務 ID: %', v_test_task_id;
    RAISE NOTICE '';
    RAISE NOTICE '嘗試建立第二個裁決（應該會失敗）...';
    RAISE NOTICE '========================================';
    
    -- 嘗試建立第二個裁決（使用不同的任務）
    BEGIN
        -- 取得另一個任務（如果存在）
        SELECT id INTO v_test_task_id
        FROM tasks
        WHERE id != v_test_task_id
          AND code != 'SR_PRACTICE_001'
        LIMIT 1;
        
        IF v_test_task_id IS NULL THEN
            -- 如果沒有其他任務，使用同一個任務（測試排他鎖）
            SELECT task_id INTO v_test_task_id
            FROM time_records
            WHERE id = v_test_time_record_id;
        END IF;
        
        -- 嘗試建立第二個裁決
        PERFORM create_billing_decision_transaction(
            ARRAY[v_test_time_record_id]::UUID[],
            'manual_override_1md',
            1.0,  -- final_md
            1.0,  -- recommended_md
            FALSE, -- is_forced_md
            '測試排他鎖：嘗試第二次認領',
            NULL, -- decision_maker_id
            FALSE, -- has_conflict
            NULL, -- conflict_type
            FALSE, -- is_conflict_resolved
            NULL, -- conflict_resolution_notes
            TRUE, -- is_billable
            ARRAY[]::UUID[], -- p_decision_ids_to_deactivate
            v_test_task_id -- p_task_id
        );
        
        RAISE EXCEPTION '錯誤：排他鎖未生效！第二個裁決竟然成功建立了！';
        
    EXCEPTION
        WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
            RAISE NOTICE '';
            RAISE NOTICE '✓ 排他鎖測試成功！';
            RAISE NOTICE '✓ 觸發 Unique Violation 錯誤（預期行為）';
            RAISE NOTICE '錯誤訊息: %', v_error_message;
            RAISE NOTICE '';
            RAISE NOTICE '這表示 uniq_bdr_active_time_record 索引正常運作，';
            RAISE NOTICE '成功防止同一筆工時被重複認領。';
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
            RAISE NOTICE '';
            RAISE NOTICE '發生其他錯誤: %', v_error_message;
    END;
    
    RAISE NOTICE '========================================';
END $$;

-- 步驟 3: 驗證數據消隱（公海池邏輯）
SELECT 
    '=== 驗證數據消隱：公海池邏輯 ===' as section;

-- 檢查 pending_billing_decisions_summary 視圖中的記錄
SELECT 
    '待裁決視圖中的實戰演習記錄（應為空）' as check_type,
    COUNT(*) as count
FROM pending_billing_decisions_summary
WHERE time_record_id IN (
    SELECT id FROM time_records WHERE notes LIKE '實戰演習%'
);

-- 檢查 time_records 中已認領的記錄（task_id 不為 NULL）
SELECT 
    '已認領的實戰演習記錄（task_id 不為 NULL）' as check_type,
    COUNT(*) as count,
    STRING_AGG(id::TEXT, ', ') as time_record_ids
FROM time_records
WHERE notes LIKE '實戰演習%'
  AND task_id IS NOT NULL;

-- 檢查 billing_decision_records 中的 active 記錄
SELECT 
    'Active 的 billing_decision_records' as check_type,
    COUNT(*) as count,
    STRING_AGG(time_record_id::TEXT, ', ') as time_record_ids
FROM billing_decision_records bdr
JOIN billing_decisions bd ON bd.id = bdr.billing_decision_id
WHERE bdr.time_record_id IN (
    SELECT id FROM time_records WHERE notes LIKE '實戰演習%'
)
  AND bdr.is_active = TRUE
  AND bd.is_active = TRUE;

-- 步驟 4: 模擬公海池查詢（task_id 為 NULL 的記錄）
SELECT 
    '=== 公海池查詢結果（task_id 為 NULL） ===' as section;

SELECT 
    tr.id as time_record_id,
    tr.record_date,
    tr.factory_location,
    tr.hours_worked,
    tr.task_id,
    CASE 
        WHEN tr.task_id IS NULL THEN '公海池'
        ELSE '已認領'
    END as status
FROM time_records tr
WHERE tr.notes LIKE '實戰演習%'
ORDER BY tr.check_in_time;

-- 步驟 5: 驗證結論
SELECT 
    '=== 驗證結論 ===' as section;

SELECT 
    CASE 
        WHEN (
            SELECT COUNT(*) 
            FROM pending_billing_decisions_summary
            WHERE time_record_id IN (
                SELECT id FROM time_records WHERE notes LIKE '實戰演習%'
            )
        ) = 0 
        THEN '✓ 數據消隱正常：已認領的工時不在待裁決視圖中'
        ELSE '✗ 數據消隱異常：已認領的工時仍在待裁決視圖中'
    END as data_hiding_check,
    
    CASE 
        WHEN (
            SELECT COUNT(*) 
            FROM time_records
            WHERE notes LIKE '實戰演習%'
              AND task_id IS NOT NULL
        ) = 3
        THEN '✓ 認領狀態正常：三段工時都已認領（task_id 不為 NULL）'
        ELSE '✗ 認領狀態異常：部分工時未正確認領'
    END as claiming_status_check;
