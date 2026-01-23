-- ============================================
-- 測試 create_billing_decision_transaction Function
-- 驗證覆蓋裁決邏輯是否正確運作
-- ============================================

-- 清理測試資料（如果存在）
DELETE FROM billing_decision_records WHERE billing_decision_id IN (
    SELECT id FROM billing_decisions WHERE reason LIKE '測試%'
);
DELETE FROM billing_decisions WHERE reason LIKE '測試%';
DELETE FROM time_records WHERE notes LIKE '測試%';
DELETE FROM tasks WHERE code = 'SR_TEST_001';
DELETE FROM projects WHERE code = 'PY_TEST_001';
DELETE FROM staff_profiles WHERE email = 'test_cai@example.com';

-- ============================================
-- 步驟 1: 建立測試資料
-- ============================================

-- 建立測試員工（需要先有 auth.users，這裡假設已存在或使用現有資料）
-- 注意：實際執行時可能需要先建立 auth.users 或使用現有 user_id
DO $$
DECLARE
    v_user_id UUID;
    v_staff_id UUID;
    v_project_id UUID;
    v_task_id UUID;
    v_tr_001_id UUID;
    v_tr_002_id UUID;
BEGIN
    -- 建立或取得測試用戶（簡化版，實際可能需要先建立 auth.users）
    -- 這裡假設使用一個測試 UUID，實際執行時請替換為真實的 user_id
    -- 或者先手動建立 auth.users 記錄
    
    -- 建立員工資料
    INSERT INTO staff_profiles (user_id, name, email)
    VALUES (
        COALESCE(
            (SELECT id FROM auth.users LIMIT 1),
            '00000000-0000-0000-0000-000000000001'::UUID
        ),
        '蔡哲維',
        'test_cai@example.com'
    )
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_staff_id;

    -- 建立測試專案
    INSERT INTO projects (code, name, description)
    VALUES ('PY_TEST_001', '測試專案', '用於測試計費裁決的專案')
    ON CONFLICT (code) DO NOTHING
    RETURNING id INTO v_project_id;
    
    IF v_project_id IS NULL THEN
        SELECT id INTO v_project_id FROM projects WHERE code = 'PY_TEST_001';
    END IF;

    -- 建立測試任務
    INSERT INTO tasks (project_id, code, name, description)
    VALUES (v_project_id, 'SR_TEST_001', '測試任務', '用於測試的任務')
    ON CONFLICT (project_id, code) DO NOTHING
    RETURNING id INTO v_task_id;
    
    IF v_task_id IS NULL THEN
        SELECT id INTO v_task_id FROM tasks WHERE project_id = v_project_id AND code = 'SR_TEST_001';
    END IF;

    -- 建立時數紀錄 TR_001 (2h)
    INSERT INTO time_records (
        staff_id,
        task_id,
        record_date,
        factory_location,
        check_in_time,
        check_out_time,
        notes
    )
    VALUES (
        v_staff_id,
        v_task_id,
        CURRENT_DATE,
        '測試廠區A',
        CURRENT_TIMESTAMP - INTERVAL '2 hours',
        CURRENT_TIMESTAMP,
        '測試紀錄 TR_001'
    )
    RETURNING id INTO v_tr_001_id;

    -- 建立時數紀錄 TR_002 (2.5h)
    INSERT INTO time_records (
        staff_id,
        task_id,
        record_date,
        factory_location,
        check_in_time,
        check_out_time,
        notes
    )
    VALUES (
        v_staff_id,
        v_task_id,
        CURRENT_DATE,
        '測試廠區B',
        CURRENT_TIMESTAMP - INTERVAL '2.5 hours',
        CURRENT_TIMESTAMP,
        '測試紀錄 TR_002'
    )
    RETURNING id INTO v_tr_002_id;

    RAISE NOTICE '測試資料建立完成:';
    RAISE NOTICE '  Staff ID: %', v_staff_id;
    RAISE NOTICE '  Project ID: %', v_project_id;
    RAISE NOTICE '  Task ID: %', v_task_id;
    RAISE NOTICE '  TR_001 ID: %', v_tr_001_id;
    RAISE NOTICE '  TR_002 ID: %', v_tr_002_id;
END $$;

-- ============================================
-- 步驟 2: 取得測試資料的 IDs
-- ============================================

DO $$
DECLARE
    v_tr_001_id UUID;
    v_tr_002_id UUID;
    v_first_decision_id UUID;
    v_second_decision_id UUID;
    v_result JSONB;
    v_record_count INTEGER;
    v_old_record_count INTEGER;
    v_active_count INTEGER;
BEGIN
    -- 取得時數紀錄 IDs
    SELECT id INTO v_tr_001_id FROM time_records WHERE notes = '測試紀錄 TR_001' LIMIT 1;
    SELECT id INTO v_tr_002_id FROM time_records WHERE notes = '測試紀錄 TR_002' LIMIT 1;

    RAISE NOTICE '========================================';
    RAISE NOTICE '步驟 3: 執行第一次裁決';
    RAISE NOTICE '========================================';
    RAISE NOTICE '傳入 time_record_ids: [%, %]', v_tr_001_id, v_tr_002_id;
    RAISE NOTICE '設定 final_md = 1.0';

    -- 執行第一次裁決
    SELECT create_billing_decision_transaction(
        ARRAY[v_tr_001_id, v_tr_002_id]::UUID[],
        'auto_4h_1md',
        1.0,  -- final_md
        1.0,  -- recommended_md
        FALSE, -- is_forced_md
        '測試：第一次裁決，合併兩筆紀錄為 1.0 MD',
        NULL, -- decision_maker_id
        FALSE, -- has_conflict
        NULL, -- conflict_type
        FALSE, -- is_conflict_resolved
        NULL, -- conflict_resolution_notes
        TRUE, -- is_billable
        ARRAY[]::UUID[] -- p_decision_ids_to_deactivate (第一次沒有舊決策)
    ) INTO v_result;

    v_first_decision_id := (v_result->>'billing_decision_id')::UUID;
    
    RAISE NOTICE '第一次裁決完成:';
    RAISE NOTICE '  Decision ID: %', v_first_decision_id;
    RAISE NOTICE '  Deactivated Count: %', v_result->>'deactivated_count';
    RAISE NOTICE '  Records Created: %', v_result->>'records_created';

    -- 驗證第一次裁決
    RAISE NOTICE '';
    RAISE NOTICE '驗證第一次裁決結果:';
    
    PERFORM * FROM billing_decisions WHERE id = v_first_decision_id AND is_active = TRUE;
    IF FOUND THEN
        RAISE NOTICE '  ✓ 第一次決策 is_active = TRUE';
    ELSE
        RAISE EXCEPTION '  ✗ 第一次決策 is_active 不正確';
    END IF;

    PERFORM * FROM billing_decision_records 
    WHERE billing_decision_id = v_first_decision_id 
    AND time_record_id IN (v_tr_001_id, v_tr_002_id);
    IF FOUND THEN
        RAISE NOTICE '  ✓ 關聯記錄已建立';
    ELSE
        RAISE EXCEPTION '  ✗ 關聯記錄未建立';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '步驟 4: 執行第二次「覆蓋」裁決';
    RAISE NOTICE '========================================';
    RAISE NOTICE '傳入 time_record_ids: [%, %]', v_tr_001_id, v_tr_002_id;
    RAISE NOTICE '設定 final_md = 0.5';
    RAISE NOTICE '停用舊決策 ID: %', v_first_decision_id;

    -- 執行第二次覆蓋裁決
    SELECT create_billing_decision_transaction(
        ARRAY[v_tr_001_id, v_tr_002_id]::UUID[],
        'auto_under_4h_0.5md',
        0.5,  -- final_md
        0.5,  -- recommended_md
        FALSE, -- is_forced_md
        '測試：第二次覆蓋裁決，PM 發現錯誤，改為 0.5 MD',
        NULL, -- decision_maker_id
        FALSE, -- has_conflict
        NULL, -- conflict_type
        FALSE, -- is_conflict_resolved
        NULL, -- conflict_resolution_notes
        TRUE, -- is_billable
        ARRAY[v_first_decision_id]::UUID[] -- p_decision_ids_to_deactivate
    ) INTO v_result;

    v_second_decision_id := (v_result->>'billing_decision_id')::UUID;
    
    RAISE NOTICE '第二次裁決完成:';
    RAISE NOTICE '  Decision ID: %', v_second_decision_id;
    RAISE NOTICE '  Deactivated Count: %', v_result->>'deactivated_count';
    RAISE NOTICE '  Records Created: %', v_result->>'records_created';

    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '步驟 5: 驗證最終結果';
    RAISE NOTICE '========================================';

    -- 驗證 1: 舊決策的 is_active 必須是 false
    PERFORM * FROM billing_decisions WHERE id = v_first_decision_id AND is_active = FALSE;
    IF FOUND THEN
        RAISE NOTICE '  ✓ 舊決策 is_active = FALSE';
    ELSE
        RAISE EXCEPTION '  ✗ 舊決策 is_active 仍為 TRUE';
    END IF;

    -- 驗證 2: 新決策必須關聯到兩筆 time_records
    PERFORM * FROM billing_decision_records 
    WHERE billing_decision_id = v_second_decision_id 
    AND time_record_id = v_tr_001_id;
    IF FOUND THEN
        RAISE NOTICE '  ✓ 新決策關聯到 TR_001';
    ELSE
        RAISE EXCEPTION '  ✗ 新決策未關聯到 TR_001';
    END IF;

    PERFORM * FROM billing_decision_records 
    WHERE billing_decision_id = v_second_decision_id 
    AND time_record_id = v_tr_002_id;
    IF FOUND THEN
        RAISE NOTICE '  ✓ 新決策關聯到 TR_002';
    ELSE
        RAISE EXCEPTION '  ✗ 新決策未關聯到 TR_002';
    END IF;

    -- 驗證 3: billing_decision_records 必須正確增加兩筆關聯
    SELECT COUNT(*) INTO v_record_count FROM billing_decision_records 
    WHERE billing_decision_id = v_second_decision_id;
    
    IF v_record_count = 2 THEN
        RAISE NOTICE '  ✓ billing_decision_records 有 2 筆關聯記錄';
    ELSE
        RAISE EXCEPTION '  ✗ billing_decision_records 關聯記錄數量不正確: %', v_record_count;
    END IF;

    -- 驗證 4: 確保舊決策的關聯記錄仍然存在（歷史記錄保留）
    SELECT COUNT(*) INTO v_old_record_count FROM billing_decision_records 
    WHERE billing_decision_id = v_first_decision_id;
    
    IF v_old_record_count = 2 THEN
        RAISE NOTICE '  ✓ 舊決策的關聯記錄保留（歷史記錄）';
    ELSE
        RAISE NOTICE '  ⚠ 舊決策的關聯記錄數量: %', v_old_record_count;
    END IF;

    -- 驗證 5: 確保只有新決策是 active
    SELECT COUNT(*) INTO v_active_count FROM billing_decisions 
    WHERE id IN (v_first_decision_id, v_second_decision_id) AND is_active = TRUE;
    
    IF v_active_count = 1 THEN
        RAISE NOTICE '  ✓ 只有 1 個決策是 active（新決策）';
    ELSE
        RAISE EXCEPTION '  ✗ active 決策數量不正確: %', v_active_count;
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '所有驗證通過！✓';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE '查詢結果摘要:';
    RAISE NOTICE '  第一次決策 ID: % (is_active: false)', v_first_decision_id;
    RAISE NOTICE '  第二次決策 ID: % (is_active: true)', v_second_decision_id;
END $$;

-- ============================================
-- 步驟 6: 顯示最終查詢結果
-- ============================================

SELECT 
    '=== 所有 billing_decisions ===' as section;

SELECT 
    bd.id,
    bd.decision_type,
    bd.final_md,
    bd.is_active,
    bd.reason,
    COUNT(bdr.id) as record_count
FROM billing_decisions bd
LEFT JOIN billing_decision_records bdr ON bd.id = bdr.billing_decision_id
WHERE bd.reason LIKE '測試%'
GROUP BY bd.id, bd.decision_type, bd.final_md, bd.is_active, bd.reason
ORDER BY bd.created_at;

SELECT 
    '=== billing_decision_records 關聯 ===' as section;

SELECT 
    bdr.id,
    bdr.billing_decision_id,
    bdr.time_record_id,
    tr.notes as time_record_note,
    bd.is_active as decision_is_active,
    bd.final_md
FROM billing_decision_records bdr
JOIN billing_decisions bd ON bdr.billing_decision_id = bd.id
JOIN time_records tr ON bdr.time_record_id = tr.id
WHERE bd.reason LIKE '測試%'
ORDER BY bd.created_at, bdr.time_record_id;
