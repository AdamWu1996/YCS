-- ============================================
-- 實戰演習：許馨方 2025/6/16 三段碎片工時測試
-- ============================================

-- 清理測試資料（如果存在）
DELETE FROM billing_decision_records WHERE billing_decision_id IN (
    SELECT id FROM billing_decisions WHERE reason LIKE '實戰演習%'
);
DELETE FROM billing_decisions WHERE reason LIKE '實戰演習%';
DELETE FROM time_records WHERE notes LIKE '實戰演習%';
DELETE FROM tasks WHERE code = 'SR_PRACTICE_001';
DELETE FROM projects WHERE code = 'PY_PRACTICE_001';
DELETE FROM staff_profiles WHERE email = 'practice_xu@example.com';

-- ============================================
-- 步驟 1: 建立測試資料
-- ============================================

DO $$
DECLARE
    v_user_id UUID;
    v_staff_id UUID;
    v_project_id UUID;
    v_task_id UUID;
    v_tr_001_id UUID;
    v_tr_002_id UUID;
    v_tr_003_id UUID;
BEGIN
    -- 建立或取得測試用戶
    -- 使用現有的第一個 user_id，或使用預設 UUID
    SELECT id INTO v_user_id FROM auth.users LIMIT 1;
    
    IF v_user_id IS NULL THEN
        v_user_id := '00000000-0000-0000-0000-000000000001'::UUID;
    END IF;
    
    -- 建立員工資料（許馨方）
    -- 先檢查是否已存在（透過 email）
    SELECT id INTO v_staff_id 
    FROM staff_profiles 
    WHERE email = 'practice_xu@example.com'
    LIMIT 1;
    
    IF v_staff_id IS NULL THEN
        -- 不存在，檢查 user_id 是否已被使用
        -- 如果 user_id 已被使用，找一個在 auth.users 中存在但尚未在 staff_profiles 中使用的 user_id
        IF EXISTS (SELECT 1 FROM staff_profiles WHERE user_id = v_user_id) THEN
            -- user_id 已被使用，找一個可用的 user_id
            SELECT u.id INTO v_user_id 
            FROM auth.users u
            WHERE NOT EXISTS (
                SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id
            )
            LIMIT 1;
            
            -- 如果找不到未使用的 user_id，使用第一個 auth.users 的 id
            -- 如果這個也被使用，我們無法建立新記錄（會違反唯一約束）
            -- 這種情況下，我們應該使用現有的 staff_profiles 記錄
            IF v_user_id IS NULL THEN
                -- 所有 user_id 都被使用，使用第一個 staff_profiles 記錄（僅用於測試）
                SELECT id INTO v_staff_id FROM staff_profiles LIMIT 1;
                -- 更新為測試數據
                UPDATE staff_profiles 
                SET name = '許馨方', email = 'practice_xu@example.com'
                WHERE id = v_staff_id;
            ELSE
                -- 找到可用的 user_id，建立新記錄
                INSERT INTO staff_profiles (user_id, name, email)
                VALUES (
                    v_user_id,
                    '許馨方',
                    'practice_xu@example.com'
                )
                RETURNING id INTO v_staff_id;
            END IF;
        ELSE
            -- user_id 未被使用，直接建立新記錄
            INSERT INTO staff_profiles (user_id, name, email)
            VALUES (
                v_user_id,
                '許馨方',
                'practice_xu@example.com'
            )
            RETURNING id INTO v_staff_id;
        END IF;
    ELSE
        -- 已存在，更新名稱（如果需要）
        UPDATE staff_profiles 
        SET name = '許馨方'
        WHERE id = v_staff_id;
    END IF;

    -- 建立測試專案
    INSERT INTO projects (code, name, description)
    VALUES ('PY_PRACTICE_001', '實戰演習專案', '用於實戰演習的測試專案')
    ON CONFLICT (code) DO NOTHING
    RETURNING id INTO v_project_id;
    
    IF v_project_id IS NULL THEN
        SELECT id INTO v_project_id FROM projects WHERE code = 'PY_PRACTICE_001';
    END IF;

    -- 建立測試任務（預算 2.0 MD）
    INSERT INTO tasks (project_id, code, name, description, budgeted_md)
    VALUES (v_project_id, 'SR_PRACTICE_001', '實戰演習任務', '用於實戰演習的測試任務', 2.0)
    ON CONFLICT (project_id, code) DO UPDATE SET budgeted_md = 2.0
    RETURNING id INTO v_task_id;
    
    IF v_task_id IS NULL THEN
        SELECT id INTO v_task_id FROM tasks WHERE project_id = v_project_id AND code = 'SR_PRACTICE_001';
        -- 更新預算
        UPDATE tasks SET budgeted_md = 2.0 WHERE id = v_task_id;
    END IF;

    -- 建立三段碎片工時（2025/6/16）
    -- 第一段：1.5 小時（08:00 - 09:30）
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
        NULL, -- 先入池，尚未認領
        '2025-06-16'::DATE,
        '測試廠區A',
        '2025-06-16 08:00:00+08'::TIMESTAMPTZ,
        '2025-06-16 09:30:00+08'::TIMESTAMPTZ,
        '實戰演習：第一段工時（1.5小時）'
    )
    RETURNING id INTO v_tr_001_id;

    -- 第二段：2.0 小時（10:00 - 12:00）
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
        NULL, -- 先入池，尚未認領
        '2025-06-16'::DATE,
        '測試廠區B',
        '2025-06-16 10:00:00+08'::TIMESTAMPTZ,
        '2025-06-16 12:00:00+08'::TIMESTAMPTZ,
        '實戰演習：第二段工時（2.0小時）'
    )
    RETURNING id INTO v_tr_002_id;

    -- 第三段：1.0 小時（14:00 - 15:00）
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
        NULL, -- 先入池，尚未認領
        '2025-06-16'::DATE,
        '測試廠區C',
        '2025-06-16 14:00:00+08'::TIMESTAMPTZ,
        '2025-06-16 15:00:00+08'::TIMESTAMPTZ,
        '實戰演習：第三段工時（1.0小時）'
    )
    RETURNING id INTO v_tr_003_id;

    RAISE NOTICE '========================================';
    RAISE NOTICE '實戰演習測試資料建立完成';
    RAISE NOTICE '========================================';
    RAISE NOTICE '員工：許馨方 (ID: %)', v_staff_id;
    RAISE NOTICE '專案：PY_PRACTICE_001 (ID: %)', v_project_id;
    RAISE NOTICE '任務：SR_PRACTICE_001 (ID: %, 預算: 2.0 MD)', v_task_id;
    RAISE NOTICE '工時紀錄：';
    RAISE NOTICE '  TR_001: % (1.5小時)', v_tr_001_id;
    RAISE NOTICE '  TR_002: % (2.0小時)', v_tr_002_id;
    RAISE NOTICE '  TR_003: % (1.0小時)', v_tr_003_id;
    RAISE NOTICE '總時數：4.5 小時';
    RAISE NOTICE '建議 MD：1.0（>=4小時）';
    RAISE NOTICE '';
    RAISE NOTICE '下一步：';
    RAISE NOTICE '1. 進入 /dashboard/billing 看板';
    RAISE NOTICE '2. 選擇這三段工時進行認領';
    RAISE NOTICE '3. 選擇任務 SR_PRACTICE_001';
    RAISE NOTICE '4. 觀察 Dialog 中的任務已用 MD 顯示';
    RAISE NOTICE '5. 執行裁決後驗證 is_active 快照';
    RAISE NOTICE '6. 嘗試第二次認領驗證防搶機制';
    RAISE NOTICE '========================================';
END $$;

-- ============================================
-- 步驟 2: 顯示建立的測試資料
-- ============================================

SELECT 
    '=== 測試員工 ===' as section;

SELECT 
    id,
    name,
    email
FROM staff_profiles 
WHERE email = 'practice_xu@example.com';

SELECT 
    '=== 測試專案與任務 ===' as section;

SELECT 
    p.code as project_code,
    p.name as project_name,
    t.code as task_code,
    t.name as task_name,
    t.budgeted_md
FROM projects p
JOIN tasks t ON t.project_id = p.id
WHERE p.code = 'PY_PRACTICE_001';

SELECT 
    '=== 測試工時紀錄 ===' as section;

SELECT 
    id,
    record_date,
    factory_location,
    check_in_time,
    check_out_time,
    hours_worked,
    task_id,
    notes
FROM time_records
WHERE notes LIKE '實戰演習%'
ORDER BY check_in_time;

SELECT 
    '=== 任務已用 MD（應為 0） ===' as section;

SELECT 
    task_id,
    used_md
FROM task_billing_summary
WHERE task_id IN (
    SELECT id FROM tasks WHERE code = 'SR_PRACTICE_001'
);
