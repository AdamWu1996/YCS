-- ============================================
-- 檢查並修復實戰演習測試數據
-- ============================================

-- 1. 檢查測試員工是否存在
SELECT 
    '=== 檢查測試員工 ===' as section;

SELECT 
    id,
    name,
    email,
    user_id
FROM staff_profiles 
WHERE email = 'practice_xu@example.com' OR name = '許馨方';

-- 2. 檢查測試專案和任務
SELECT 
    '=== 檢查測試專案與任務 ===' as section;

SELECT 
    p.id as project_id,
    p.code as project_code,
    p.name as project_name,
    t.id as task_id,
    t.code as task_code,
    t.name as task_name,
    t.budgeted_md
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id AND t.code = 'SR_PRACTICE_001'
WHERE p.code = 'PY_PRACTICE_001';

-- 3. 檢查測試工時紀錄
SELECT 
    '=== 檢查測試工時紀錄 ===' as section;

SELECT 
    tr.id,
    tr.record_date,
    tr.factory_location,
    tr.check_in_time,
    tr.check_out_time,
    tr.hours_worked,
    tr.task_id,
    tr.notes,
    sp.name as staff_name
FROM time_records tr
LEFT JOIN staff_profiles sp ON sp.id = tr.staff_id
WHERE tr.notes LIKE '實戰演習%' OR sp.name = '許馨方'
ORDER BY tr.record_date DESC, tr.check_in_time;

-- 4. 檢查 pending_billing_decisions_summary 中的記錄
SELECT 
    '=== 檢查待裁決視圖中的記錄 ===' as section;

SELECT 
    time_record_id,
    record_date,
    factory_location,
    hours_worked,
    check_in_time,
    check_out_time,
    has_decision,
    is_billable
FROM pending_billing_decisions_summary
WHERE record_date = '2025-06-16'::DATE
ORDER BY check_in_time;

-- ============================================
-- 如果數據不存在，手動建立
-- ============================================

DO $$
DECLARE
    v_staff_id UUID;
    v_project_id UUID;
    v_task_id UUID;
    v_user_id UUID;
BEGIN
    -- 取得或建立員工
    SELECT id INTO v_staff_id 
    FROM staff_profiles 
    WHERE email = 'practice_xu@example.com' OR name = '許馨方'
    LIMIT 1;
    
    IF v_staff_id IS NULL THEN
        -- 找一個可用的 user_id
        SELECT id INTO v_user_id 
        FROM auth.users 
        WHERE NOT EXISTS (
            SELECT 1 FROM staff_profiles sp WHERE sp.user_id = auth.users.id
        )
        LIMIT 1;
        
        IF v_user_id IS NULL THEN
            -- 如果所有 user_id 都被使用，使用第一個
            SELECT id INTO v_user_id FROM auth.users LIMIT 1;
        END IF;
        
        -- 建立員工
        INSERT INTO staff_profiles (user_id, name, email)
        VALUES (
            COALESCE(v_user_id, (SELECT id FROM auth.users LIMIT 1)),
            '許馨方',
            'practice_xu@example.com'
        )
        ON CONFLICT (email) DO UPDATE SET name = '許馨方'
        RETURNING id INTO v_staff_id;
        
        IF v_staff_id IS NULL THEN
            SELECT id INTO v_staff_id FROM staff_profiles WHERE email = 'practice_xu@example.com';
        END IF;
    END IF;

    -- 取得或建立專案
    INSERT INTO projects (code, name, description)
    VALUES ('PY_PRACTICE_001', '實戰演習專案', '用於實戰演習的測試專案')
    ON CONFLICT (code) DO NOTHING
    RETURNING id INTO v_project_id;
    
    IF v_project_id IS NULL THEN
        SELECT id INTO v_project_id FROM projects WHERE code = 'PY_PRACTICE_001';
    END IF;

    -- 取得或建立任務
    INSERT INTO tasks (project_id, code, name, description, budgeted_md)
    VALUES (v_project_id, 'SR_PRACTICE_001', '實戰演習任務', '用於實戰演習的測試任務', 2.0)
    ON CONFLICT (project_id, code) DO UPDATE SET budgeted_md = 2.0
    RETURNING id INTO v_task_id;
    
    IF v_task_id IS NULL THEN
        SELECT id INTO v_task_id FROM tasks WHERE project_id = v_project_id AND code = 'SR_PRACTICE_001';
        UPDATE tasks SET budgeted_md = 2.0 WHERE id = v_task_id;
    END IF;

    -- 清理舊的測試工時（如果存在）
    DELETE FROM time_records WHERE notes LIKE '實戰演習%';

    -- 建立三段碎片工時（2025/6/16）
    INSERT INTO time_records (
        staff_id,
        task_id,
        record_date,
        factory_location,
        check_in_time,
        check_out_time,
        notes
    ) VALUES
    (
        v_staff_id,
        NULL, -- 先入池，尚未認領
        '2025-06-16'::DATE,
        '測試廠區A',
        '2025-06-16 08:00:00+08'::TIMESTAMPTZ,
        '2025-06-16 09:30:00+08'::TIMESTAMPTZ,
        '實戰演習：第一段工時（1.5小時）'
    ),
    (
        v_staff_id,
        NULL,
        '2025-06-16'::DATE,
        '測試廠區B',
        '2025-06-16 10:00:00+08'::TIMESTAMPTZ,
        '2025-06-16 12:00:00+08'::TIMESTAMPTZ,
        '實戰演習：第二段工時（2.0小時）'
    ),
    (
        v_staff_id,
        NULL,
        '2025-06-16'::DATE,
        '測試廠區C',
        '2025-06-16 14:00:00+08'::TIMESTAMPTZ,
        '2025-06-16 15:00:00+08'::TIMESTAMPTZ,
        '實戰演習：第三段工時（1.0小時）'
    );

    RAISE NOTICE '測試數據建立完成';
    RAISE NOTICE '員工 ID: %', v_staff_id;
    RAISE NOTICE '專案 ID: %', v_project_id;
    RAISE NOTICE '任務 ID: %', v_task_id;
END $$;

-- 5. 再次檢查建立的數據
SELECT 
    '=== 最終檢查：測試工時紀錄 ===' as section;

SELECT 
    tr.id,
    tr.record_date,
    tr.factory_location,
    tr.check_in_time,
    tr.check_out_time,
    tr.hours_worked,
    tr.task_id,
    tr.notes
FROM time_records tr
WHERE tr.notes LIKE '實戰演習%'
ORDER BY tr.check_in_time;

SELECT 
    '=== 最終檢查：待裁決視圖 ===' as section;

SELECT 
    time_record_id,
    record_date,
    factory_location,
    hours_worked,
    check_in_time,
    check_out_time,
    has_decision,
    is_billable
FROM pending_billing_decisions_summary
WHERE record_date = '2025-06-16'::DATE
ORDER BY check_in_time;
