-- ============================================
-- 工時認領中心：排他保護 + 認領流程
-- ============================================

-- 1) 工時紀錄允許先入池再認領
ALTER TABLE time_records
ALTER COLUMN task_id DROP NOT NULL;

-- 2) 任務增加預算 MD 欄位
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS budgeted_md DECIMAL(6, 2);

-- 3) 關聯表加入 active 快照欄位
ALTER TABLE billing_decision_records
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 4) 回填歷史資料的 active 狀態
UPDATE billing_decision_records bdr
SET is_active = bd.is_active
FROM billing_decisions bd
WHERE bdr.billing_decision_id = bd.id;

-- 5) 觸發器：插入關聯時同步 active 狀態
CREATE OR REPLACE FUNCTION set_bdr_is_active_from_decision()
RETURNS TRIGGER AS $$
BEGIN
    SELECT is_active
    INTO NEW.is_active
    FROM billing_decisions
    WHERE id = NEW.billing_decision_id;

    IF NEW.is_active IS NULL THEN
        NEW.is_active := TRUE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bdr_set_active_on_insert ON billing_decision_records;
CREATE TRIGGER trg_bdr_set_active_on_insert
BEFORE INSERT ON billing_decision_records
FOR EACH ROW
EXECUTE FUNCTION set_bdr_is_active_from_decision();

-- 6) 觸發器：裁決狀態變更時同步關聯表
CREATE OR REPLACE FUNCTION sync_bdr_is_active_on_decision_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        UPDATE billing_decision_records
        SET is_active = NEW.is_active
        WHERE billing_decision_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bdr_sync_active_on_decision_update ON billing_decisions;
CREATE TRIGGER trg_bdr_sync_active_on_decision_update
AFTER UPDATE OF is_active ON billing_decisions
FOR EACH ROW
EXECUTE FUNCTION sync_bdr_is_active_on_decision_update();

-- 7) 物理排他：同一筆工時只能存在於一個 active 關聯中
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bdr_active_time_record
ON billing_decision_records (time_record_id)
WHERE is_active = TRUE;

-- 8) 更新裁決 Transaction：加入 task_id 認領
CREATE OR REPLACE FUNCTION create_billing_decision_transaction(
    p_time_record_ids UUID[],
    p_decision_type TEXT,
    p_final_md DECIMAL(3, 1),
    p_recommended_md DECIMAL(3, 1) DEFAULT NULL,
    p_is_forced_md BOOLEAN DEFAULT FALSE,
    p_reason TEXT DEFAULT NULL,
    p_decision_maker_id UUID DEFAULT NULL,
    p_has_conflict BOOLEAN DEFAULT FALSE,
    p_conflict_type TEXT DEFAULT NULL,
    p_is_conflict_resolved BOOLEAN DEFAULT FALSE,
    p_conflict_resolution_notes TEXT DEFAULT NULL,
    p_is_billable BOOLEAN DEFAULT FALSE,
    p_decision_ids_to_deactivate UUID[] DEFAULT ARRAY[]::UUID[],
    p_task_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_decision_id UUID;
    v_deactivated_count INTEGER;
    v_updated_count INTEGER;
    v_result JSONB;
BEGIN
    IF p_task_id IS NULL THEN
        RAISE EXCEPTION '請先選擇專案任務';
    END IF;

    -- 步驟 1: 停用舊的 active decisions
    IF array_length(p_decision_ids_to_deactivate, 1) > 0 THEN
        UPDATE billing_decisions
        SET is_active = FALSE,
            updated_at = NOW()
        WHERE id = ANY(p_decision_ids_to_deactivate)
          AND is_active = TRUE;

        GET DIAGNOSTICS v_deactivated_count = ROW_COUNT;
    ELSE
        v_deactivated_count := 0;
    END IF;

    -- 步驟 2: 更新工時認領（先入池後認領）
    UPDATE time_records
    SET task_id = p_task_id,
        updated_at = NOW()
    WHERE id = ANY(p_time_record_ids);

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> array_length(p_time_record_ids, 1) THEN
        RAISE EXCEPTION '部分工時紀錄不存在或已被刪除';
    END IF;

    -- 步驟 3: 建立新的 billing_decision
    INSERT INTO billing_decisions (
        decision_type,
        final_md,
        recommended_md,
        is_forced_md,
        reason,
        decision_maker_id,
        has_conflict,
        conflict_type,
        is_conflict_resolved,
        conflict_resolution_notes,
        is_billable,
        is_active
    ) VALUES (
        p_decision_type,
        p_final_md,
        p_recommended_md,
        p_is_forced_md,
        p_reason,
        p_decision_maker_id,
        p_has_conflict,
        p_conflict_type,
        p_is_conflict_resolved,
        p_conflict_resolution_notes,
        p_is_billable,
        TRUE
    )
    RETURNING id INTO v_new_decision_id;

    -- 步驟 4: 建立 billing_decision_records
    INSERT INTO billing_decision_records (
        billing_decision_id,
        time_record_id
    )
    SELECT
        v_new_decision_id,
        unnest(p_time_record_ids)
    ON CONFLICT (billing_decision_id, time_record_id) DO NOTHING;

    -- 返回結果
    v_result := jsonb_build_object(
        'billing_decision_id', v_new_decision_id,
        'deactivated_count', v_deactivated_count,
        'records_updated', v_updated_count,
        'records_created', array_length(p_time_record_ids, 1)
    );

    RETURN v_result;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION '此段工時已被其他專案認領';
    WHEN OTHERS THEN
        -- 發生錯誤時自動回滾（Postgres Transaction 特性）
        RAISE EXCEPTION '建立計費裁決時發生錯誤: %', SQLERRM;
END;
$$;
