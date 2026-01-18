-- ============================================
-- 建立計費裁決 Transaction Function
-- 確保整個流程在單一 Transaction 中完成
-- ============================================

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
    p_decision_ids_to_deactivate UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_decision_id UUID;
    v_deactivated_count INTEGER;
    v_result JSONB;
BEGIN
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

    -- 步驟 2: 建立新的 billing_decision
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

    -- 步驟 3: 建立 billing_decision_records
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
        'records_created', array_length(p_time_record_ids, 1)
    );

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        -- 發生錯誤時自動回滾（Postgres Transaction 特性）
        RAISE EXCEPTION '建立計費裁決時發生錯誤: %', SQLERRM;
END;
$$;

-- 添加註解
COMMENT ON FUNCTION create_billing_decision_transaction IS 
'建立計費裁決的 Transaction Function，確保整個流程（停用舊決策、建立新決策、建立關聯記錄）在單一 Transaction 中完成';
