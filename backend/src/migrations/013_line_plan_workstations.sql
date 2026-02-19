-- Line-specific workstation plans (per line, per date)
-- Replaces the static workstation_code on product_processes for line layout.
-- The same product balanced differently on different lines based on their target.

CREATE TABLE IF NOT EXISTS line_plan_workstations (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    workstation_number INTEGER NOT NULL,        -- 1 to 100
    workstation_code VARCHAR(20) NOT NULL,      -- e.g., "WS01"
    takt_time_seconds DECIMAL(10,2),           -- working_secs / target
    actual_sam_seconds DECIMAL(10,2),          -- SUM of SAM of processes in this WS
    workload_pct DECIMAL(5,2),                 -- actual_sam / takt_time * 100
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(line_id, work_date, workstation_number)
);

CREATE TABLE IF NOT EXISTS line_plan_workstation_processes (
    id SERIAL PRIMARY KEY,
    workstation_id INTEGER NOT NULL REFERENCES line_plan_workstations(id) ON DELETE CASCADE,
    product_process_id INTEGER NOT NULL REFERENCES product_processes(id),
    sequence_in_workstation INTEGER NOT NULL DEFAULT 1,
    UNIQUE(workstation_id, product_process_id)
);

-- Extend employee_workstation_assignments to be date-specific
ALTER TABLE employee_workstation_assignments
    ADD COLUMN IF NOT EXISTS work_date DATE,
    ADD COLUMN IF NOT EXISTS line_plan_workstation_id INTEGER
        REFERENCES line_plan_workstations(id) ON DELETE CASCADE;

-- Update old rows: set work_date = today as a safe default (legacy rows)
UPDATE employee_workstation_assignments
    SET work_date = CURRENT_DATE
    WHERE work_date IS NULL;

-- Drop old unique constraint and add date-aware one
ALTER TABLE employee_workstation_assignments
    DROP CONSTRAINT IF EXISTS employee_workstation_assignments_line_id_workstation_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ewa_line_date_ws
    ON employee_workstation_assignments(line_id, work_date, workstation_code);

CREATE INDEX IF NOT EXISTS idx_lpw_line_date
    ON line_plan_workstations(line_id, work_date);

CREATE INDEX IF NOT EXISTS idx_lpwp_workstation
    ON line_plan_workstation_processes(workstation_id);

CREATE INDEX IF NOT EXISTS idx_lpwp_process
    ON line_plan_workstation_processes(product_process_id);
