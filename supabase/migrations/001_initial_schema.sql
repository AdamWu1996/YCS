-- ============================================
-- YCS 專案初始資料表結構
-- 嚴格遵循裁決層邏輯與 MD 判定規則
-- ============================================

-- 啟用必要的擴展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. 業務使用者資料表 (staff_profiles)
-- ============================================
CREATE TABLE staff_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id),
    UNIQUE(email)
);

-- 建立索引
CREATE INDEX idx_staff_profiles_user_id ON staff_profiles(user_id);
CREATE INDEX idx_staff_profiles_email ON staff_profiles(email);

-- ============================================
-- 2. 專案表 (projects - PY)
-- ============================================
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE, -- PY 代碼
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active', -- active, completed, archived
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 建立索引
CREATE INDEX idx_projects_code ON projects(code);
CREATE INDEX idx_projects_status ON projects(status);

-- ============================================
-- 3. 任務表 (tasks - SR)
-- ============================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    code TEXT NOT NULL, -- SR 代碼
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active', -- active, completed, cancelled
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, code) -- 同一專案內 SR 代碼唯一
);

-- 建立索引
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_code ON tasks(code);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ============================================
-- 4. 時數紀錄表 (time_records)
-- 純事實記錄層：僅記錄原始進出事實，不承載業務判斷狀態
-- 支援同一人、同一天、多筆不同廠區紀錄，允許重複進出
-- ============================================
CREATE TABLE time_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    record_date DATE NOT NULL, -- 紀錄日期
    factory_location TEXT NOT NULL, -- 廠區位置
    check_in_time TIMESTAMPTZ NOT NULL, -- 進場時間
    check_out_time TIMESTAMPTZ, -- 出場時間（可為 NULL，表示尚未出場）
    hours_worked DECIMAL(5, 2), -- 工作時數（計算欄位，可為 NULL）
    notes TEXT, -- 備註
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- 注意：不設 UNIQUE 約束，允許同一人同一天同一廠區多次進出
    -- 衝突判定與狀態管理由裁決層（billing_decisions）處理
);

-- 建立索引（用於查詢與資料彙整）
CREATE INDEX idx_time_records_staff_date ON time_records(staff_id, record_date);
CREATE INDEX idx_time_records_staff_date_factory ON time_records(staff_id, record_date, factory_location);
CREATE INDEX idx_time_records_task_id ON time_records(task_id);
CREATE INDEX idx_time_records_check_out ON time_records(check_out_time) WHERE check_out_time IS NOT NULL;

-- ============================================
-- 5. 計費裁決表 (billing_decisions)
-- 裁決層集中化：所有業務判斷狀態（衝突、MD 判定、可請款性）由此表表達
-- 數據血統：不直接關聯 time_record，所有連結透過 billing_decision_records
-- ============================================
CREATE TABLE billing_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_type TEXT NOT NULL, -- 'auto_4h_1md', 'auto_under_4h_0.5md', 'manual_override_1md', 'manual_override_0.5md', 'conflict_pending', 'conflict_resolved', 'merged_records'
    is_forced_md BOOLEAN NOT NULL DEFAULT FALSE, -- 是否為人工強制 1.0 MD
    recommended_md DECIMAL(3, 1), -- 系統建議的 MD 值（0.5 或 1.0）
    final_md DECIMAL(3, 1) NOT NULL, -- 最終裁決的 MD 值
    reason TEXT, -- 裁決原因（特別是 override 時必須填寫）
    decision_maker_id UUID REFERENCES staff_profiles(id), -- 裁決者（PM）
    -- 衝突相關狀態（集中化表達）
    has_conflict BOOLEAN NOT NULL DEFAULT FALSE, -- 是否涉及衝突
    conflict_type TEXT, -- 'one_person_multiple_factories' 等（僅在 has_conflict = TRUE 時有效）
    is_conflict_resolved BOOLEAN NOT NULL DEFAULT FALSE, -- 衝突是否已解決
    conflict_resolution_notes TEXT, -- 衝突解決備註
    -- 可請款性狀態
    is_billable BOOLEAN NOT NULL DEFAULT FALSE, -- 是否可請款（僅在衝突解決後為 TRUE）
    -- 決策唯一性保證
    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- 是否為有效裁決（用於軟刪除）
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 建立索引
CREATE INDEX idx_billing_decisions_forced_md ON billing_decisions(is_forced_md);
CREATE INDEX idx_billing_decisions_decision_type ON billing_decisions(decision_type);
CREATE INDEX idx_billing_decisions_decision_maker ON billing_decisions(decision_maker_id);
CREATE INDEX idx_billing_decisions_conflict ON billing_decisions(has_conflict, is_conflict_resolved) WHERE has_conflict = TRUE;
CREATE INDEX idx_billing_decisions_billable ON billing_decisions(is_billable) WHERE is_billable = TRUE;
CREATE INDEX idx_billing_decisions_active ON billing_decisions(is_active) WHERE is_active = TRUE;

-- ============================================
-- 6. 計費裁決關聯表 (billing_decision_records)
-- 數據血統核心：所有決策與事實的連結必須透過此表
-- 正規化合併邏輯：支援一筆裁決對應多筆時數紀錄（N:1）
-- ============================================
CREATE TABLE billing_decision_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    billing_decision_id UUID NOT NULL REFERENCES billing_decisions(id) ON DELETE CASCADE,
    time_record_id UUID NOT NULL REFERENCES time_records(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(billing_decision_id, time_record_id)
);

-- 建立索引
CREATE INDEX idx_billing_decision_records_decision ON billing_decision_records(billing_decision_id);
CREATE INDEX idx_billing_decision_records_time_record ON billing_decision_records(time_record_id);

-- 決策唯一性保證：每一筆 time_record_id 在 is_active = true 的決策中只能被關聯一次
-- 注意：此約束需透過應用層邏輯或觸發器實現，因為需要檢查關聯的 billing_decision.is_active 狀態

-- ============================================
-- 7. 專案費率表 (project_rates)
-- 費率管理層：年度費率必須來自此表，禁止手動輸入無來源單價
-- ============================================
CREATE TABLE project_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year INTEGER NOT NULL, -- 年度（如 2024）
    standard_rate DECIMAL(10, 2) NOT NULL, -- 標準費率
    currency TEXT NOT NULL DEFAULT 'TWD', -- 幣別
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, year)
);

-- 建立索引
CREATE INDEX idx_project_rates_project ON project_rates(project_id);
CREATE INDEX idx_project_rates_year ON project_rates(year);

-- ============================================
-- 8. 最終請款表 (final_billings)
-- 必須關聯到 billing_decisions，禁止直接生成
-- 費率管理：單價必須關聯至 project_rates
-- ============================================
CREATE TABLE final_billings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    billing_decision_id UUID NOT NULL REFERENCES billing_decisions(id) ON DELETE RESTRICT, -- 強制關聯，禁止刪除
    project_rate_id UUID NOT NULL REFERENCES project_rates(id) ON DELETE RESTRICT, -- 費率來源（強制關聯）
    billing_date DATE NOT NULL, -- 請款日期
    md_amount DECIMAL(3, 1) NOT NULL, -- MD 數量（從 billing_decisions 同步）
    unit_price DECIMAL(10, 2) NOT NULL, -- 單價（從 project_rates 取得）
    total_amount DECIMAL(12, 2) NOT NULL, -- 總金額（計算：md_amount * unit_price）
    status TEXT NOT NULL DEFAULT 'draft', -- draft, submitted, approved, paid
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 確保每個 billing_decision 只對應一筆 final_billing
    UNIQUE(billing_decision_id)
);

-- 建立索引
CREATE INDEX idx_final_billings_decision ON final_billings(billing_decision_id);
CREATE INDEX idx_final_billings_project_rate ON final_billings(project_rate_id);
CREATE INDEX idx_final_billings_date ON final_billings(billing_date);
CREATE INDEX idx_final_billings_status ON final_billings(status);

-- ============================================
-- 觸發器：自動更新 updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_staff_profiles_updated_at
    BEFORE UPDATE ON staff_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_time_records_updated_at
    BEFORE UPDATE ON time_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_billing_decisions_updated_at
    BEFORE UPDATE ON billing_decisions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_final_billings_updated_at
    BEFORE UPDATE ON final_billings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_rates_updated_at
    BEFORE UPDATE ON project_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 觸發器：自動計算工作時數
-- ============================================
CREATE OR REPLACE FUNCTION calculate_hours_worked()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.check_out_time IS NOT NULL AND NEW.check_in_time IS NOT NULL THEN
        NEW.hours_worked := EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time)) / 3600.0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_time_record_hours
    BEFORE INSERT OR UPDATE ON time_records
    FOR EACH ROW
    EXECUTE FUNCTION calculate_hours_worked();

-- ============================================
-- 視圖：員工每日廠區統計（資料彙整，不含業務語意）
-- ============================================
CREATE OR REPLACE VIEW staff_daily_factory_summary AS
SELECT 
    tr.staff_id,
    tr.record_date,
    COUNT(DISTINCT tr.factory_location) as distinct_factory_count,
    STRING_AGG(DISTINCT tr.factory_location, ', ' ORDER BY tr.factory_location) as factory_locations,
    COUNT(tr.id) as total_record_count,
    SUM(tr.hours_worked) as total_hours_worked,
    ARRAY_AGG(DISTINCT tr.id ORDER BY tr.id) as time_record_ids
FROM time_records tr
WHERE tr.check_out_time IS NOT NULL -- 僅統計已完成出場的紀錄
GROUP BY tr.staff_id, tr.record_date;

-- ============================================
-- 視圖：待裁決時數紀錄彙整（不含視覺語意）
-- 透過 billing_decision_records 關聯表正確抓取多筆合併的時數加總
-- ============================================
CREATE OR REPLACE VIEW pending_billing_decisions_summary AS
SELECT 
    tr.id as time_record_id,
    tr.staff_id,
    tr.task_id,
    tr.record_date,
    tr.factory_location,
    tr.hours_worked,
    tr.check_in_time,
    tr.check_out_time,
    -- 裁決狀態（由 billing_decisions 透過關聯表提供）
    bd.id as billing_decision_id,
    bd.decision_type,
    bd.has_conflict,
    bd.is_conflict_resolved,
    bd.is_billable,
    bd.final_md,
    -- 計算欄位：是否已有裁決
    CASE WHEN bd.id IS NOT NULL THEN TRUE ELSE FALSE END as has_decision,
    -- 合併裁決的時數加總（透過關聯表彙整）
    (
        SELECT COALESCE(SUM(tr2.hours_worked), 0)
        FROM billing_decision_records bdr2
        JOIN time_records tr2 ON bdr2.time_record_id = tr2.id
        WHERE bdr2.billing_decision_id = bd.id
    ) as merged_total_hours
FROM time_records tr
LEFT JOIN billing_decision_records bdr ON tr.id = bdr.time_record_id
LEFT JOIN billing_decisions bd ON bdr.billing_decision_id = bd.id AND bd.is_active = TRUE
WHERE tr.check_out_time IS NOT NULL -- 已完成出場
    AND (bd.id IS NULL OR bd.is_billable = FALSE); -- 尚未裁決或不可請款
