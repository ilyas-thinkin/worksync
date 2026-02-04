-- Migration: Defect and Downtime Tracking
-- Date: 2026-02-04
-- Purpose: Add defect tracking and downtime reason codes

-- =====================================================
-- DEFECT TYPES (Master Data)
-- =====================================================
CREATE TABLE IF NOT EXISTS defect_types (
    id SERIAL PRIMARY KEY,
    defect_code VARCHAR(20) NOT NULL UNIQUE,
    defect_name VARCHAR(100) NOT NULL,
    defect_category VARCHAR(50), -- e.g., 'stitching', 'material', 'finishing'
    severity VARCHAR(20) DEFAULT 'minor', -- 'minor', 'major', 'critical'
    is_reworkable BOOLEAN DEFAULT true,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for defect_types
CREATE INDEX IF NOT EXISTS idx_defect_types_code ON defect_types(defect_code);
CREATE INDEX IF NOT EXISTS idx_defect_types_category ON defect_types(defect_category);
CREATE INDEX IF NOT EXISTS idx_defect_types_active ON defect_types(is_active);

-- =====================================================
-- DEFECT LOG (Transaction Data)
-- =====================================================
CREATE TABLE IF NOT EXISTS defect_log (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id),
    process_id INTEGER REFERENCES product_processes(id),
    employee_id INTEGER REFERENCES employees(id),
    defect_type_id INTEGER NOT NULL REFERENCES defect_types(id),
    work_date DATE NOT NULL,
    hour_slot INTEGER CHECK (hour_slot >= 0 AND hour_slot <= 23),
    quantity INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) DEFAULT 'detected', -- 'detected', 'reworking', 'reworked', 'rejected'
    rework_employee_id INTEGER REFERENCES employees(id),
    rework_completed_at TIMESTAMP,
    notes TEXT,
    detected_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for defect_log
CREATE INDEX IF NOT EXISTS idx_defect_log_line_date ON defect_log(line_id, work_date);
CREATE INDEX IF NOT EXISTS idx_defect_log_process ON defect_log(process_id);
CREATE INDEX IF NOT EXISTS idx_defect_log_employee ON defect_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_defect_log_type ON defect_log(defect_type_id);
CREATE INDEX IF NOT EXISTS idx_defect_log_status ON defect_log(status);
CREATE INDEX IF NOT EXISTS idx_defect_log_date ON defect_log(work_date);

-- =====================================================
-- DOWNTIME REASON CODES (Master Data)
-- =====================================================
CREATE TABLE IF NOT EXISTS downtime_reasons (
    id SERIAL PRIMARY KEY,
    reason_code VARCHAR(20) NOT NULL UNIQUE,
    reason_name VARCHAR(100) NOT NULL,
    reason_category VARCHAR(50), -- e.g., 'machine', 'material', 'manpower', 'planning', 'other'
    is_planned BOOLEAN DEFAULT false, -- Planned vs unplanned downtime
    default_duration_minutes INTEGER, -- Typical duration for this reason
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for downtime_reasons
CREATE INDEX IF NOT EXISTS idx_downtime_reasons_code ON downtime_reasons(reason_code);
CREATE INDEX IF NOT EXISTS idx_downtime_reasons_category ON downtime_reasons(reason_category);
CREATE INDEX IF NOT EXISTS idx_downtime_reasons_active ON downtime_reasons(is_active);

-- =====================================================
-- DOWNTIME LOG (Transaction Data)
-- =====================================================
CREATE TABLE IF NOT EXISTS downtime_log (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id),
    reason_id INTEGER NOT NULL REFERENCES downtime_reasons(id),
    work_date DATE NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    duration_minutes INTEGER, -- Calculated or manual
    affected_processes TEXT[], -- Array of process IDs affected
    notes TEXT,
    reported_by INTEGER REFERENCES users(id),
    resolved_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for downtime_log
CREATE INDEX IF NOT EXISTS idx_downtime_log_line_date ON downtime_log(line_id, work_date);
CREATE INDEX IF NOT EXISTS idx_downtime_log_reason ON downtime_log(reason_id);
CREATE INDEX IF NOT EXISTS idx_downtime_log_date ON downtime_log(work_date);
CREATE INDEX IF NOT EXISTS idx_downtime_log_start ON downtime_log(start_time);

-- =====================================================
-- DAILY DEFECT SUMMARY VIEW
-- =====================================================
CREATE OR REPLACE VIEW v_daily_defect_summary AS
SELECT
    dl.work_date,
    dl.line_id,
    pl.line_name,
    dt.defect_category,
    dt.defect_code,
    dt.defect_name,
    dt.severity,
    COUNT(*) as defect_count,
    SUM(dl.quantity) as total_quantity,
    SUM(CASE WHEN dl.status = 'reworked' THEN dl.quantity ELSE 0 END) as reworked_quantity,
    SUM(CASE WHEN dl.status = 'rejected' THEN dl.quantity ELSE 0 END) as rejected_quantity
FROM defect_log dl
JOIN production_lines pl ON dl.line_id = pl.id
JOIN defect_types dt ON dl.defect_type_id = dt.id
GROUP BY dl.work_date, dl.line_id, pl.line_name, dt.defect_category,
         dt.defect_code, dt.defect_name, dt.severity
ORDER BY dl.work_date DESC, total_quantity DESC;

-- =====================================================
-- DAILY DOWNTIME SUMMARY VIEW
-- =====================================================
CREATE OR REPLACE VIEW v_daily_downtime_summary AS
SELECT
    dl.work_date,
    dl.line_id,
    pl.line_name,
    dr.reason_category,
    dr.reason_code,
    dr.reason_name,
    dr.is_planned,
    COUNT(*) as incident_count,
    SUM(COALESCE(dl.duration_minutes,
        EXTRACT(EPOCH FROM (COALESCE(dl.end_time, NOW()) - dl.start_time))/60
    )) as total_minutes
FROM downtime_log dl
JOIN production_lines pl ON dl.line_id = pl.id
JOIN downtime_reasons dr ON dl.reason_id = dr.id
GROUP BY dl.work_date, dl.line_id, pl.line_name, dr.reason_category,
         dr.reason_code, dr.reason_name, dr.is_planned
ORDER BY dl.work_date DESC, total_minutes DESC;

-- =====================================================
-- INSERT DEFAULT DEFECT TYPES
-- =====================================================
INSERT INTO defect_types (defect_code, defect_name, defect_category, severity, is_reworkable) VALUES
('ST001', 'Broken Stitch', 'stitching', 'minor', true),
('ST002', 'Skip Stitch', 'stitching', 'minor', true),
('ST003', 'Loose Stitch', 'stitching', 'minor', true),
('ST004', 'Wrong Thread Color', 'stitching', 'major', true),
('ST005', 'Uneven Stitch Line', 'stitching', 'minor', true),
('MT001', 'Material Tear', 'material', 'major', false),
('MT002', 'Material Stain', 'material', 'minor', true),
('MT003', 'Wrong Material', 'material', 'critical', false),
('MT004', 'Color Variation', 'material', 'major', false),
('FN001', 'Edge Damage', 'finishing', 'minor', true),
('FN002', 'Improper Folding', 'finishing', 'minor', true),
('FN003', 'Glue Marks', 'finishing', 'minor', true),
('FN004', 'Misalignment', 'finishing', 'minor', true),
('QA001', 'Dimension Error', 'quality', 'major', true),
('QA002', 'Missing Component', 'quality', 'critical', true),
('QA003', 'Wrong Specification', 'quality', 'critical', false)
ON CONFLICT (defect_code) DO NOTHING;

-- =====================================================
-- INSERT DEFAULT DOWNTIME REASONS
-- =====================================================
INSERT INTO downtime_reasons (reason_code, reason_name, reason_category, is_planned, default_duration_minutes) VALUES
('MC001', 'Machine Breakdown', 'machine', false, 30),
('MC002', 'Machine Maintenance', 'machine', true, 60),
('MC003', 'Needle Change', 'machine', false, 5),
('MC004', 'Thread Break', 'machine', false, 5),
('MC005', 'Machine Setup', 'machine', true, 15),
('MT001', 'Material Shortage', 'material', false, 30),
('MT002', 'Material Quality Issue', 'material', false, 20),
('MT003', 'Waiting for Material', 'material', false, 15),
('MP001', 'Operator Absent', 'manpower', false, NULL),
('MP002', 'Operator Training', 'manpower', true, 60),
('MP003', 'Break Time', 'manpower', true, 15),
('MP004', 'Meeting', 'manpower', true, 30),
('PL001', 'No Production Plan', 'planning', false, NULL),
('PL002', 'Style Change', 'planning', true, 30),
('PL003', 'Line Balancing', 'planning', true, 20),
('OT001', 'Power Outage', 'other', false, NULL),
('OT002', 'Quality Hold', 'other', false, NULL),
('OT003', 'Other', 'other', false, NULL)
ON CONFLICT (reason_code) DO NOTHING;

-- =====================================================
-- TRIGGERS FOR UPDATED_AT
-- =====================================================
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_defect_types_modtime ON defect_types;
CREATE TRIGGER update_defect_types_modtime
    BEFORE UPDATE ON defect_types
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_defect_log_modtime ON defect_log;
CREATE TRIGGER update_defect_log_modtime
    BEFORE UPDATE ON defect_log
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_downtime_reasons_modtime ON downtime_reasons;
CREATE TRIGGER update_downtime_reasons_modtime
    BEFORE UPDATE ON downtime_reasons
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_downtime_log_modtime ON downtime_log;
CREATE TRIGGER update_downtime_log_modtime
    BEFORE UPDATE ON downtime_log
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- =====================================================
-- ANALYZE TABLES
-- =====================================================
ANALYZE defect_types;
ANALYZE defect_log;
ANALYZE downtime_reasons;
ANALYZE downtime_log;
