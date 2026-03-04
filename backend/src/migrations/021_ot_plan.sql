-- Migration 021: OT (Overtime) Plan
-- Adds per-line-per-date OT plan with separate workstations, processes, and employee assignments

-- 1. OT enabled flag on daily plan
ALTER TABLE line_daily_plans
  ADD COLUMN IF NOT EXISTS ot_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. OT plan (one per line per date)
CREATE TABLE IF NOT EXISTS line_ot_plans (
    id                SERIAL PRIMARY KEY,
    line_id           INTEGER NOT NULL REFERENCES production_lines(id),
    work_date         DATE NOT NULL,
    product_id        INTEGER NOT NULL REFERENCES products(id),
    global_ot_minutes INTEGER NOT NULL DEFAULT 60,
    ot_target_units   INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(line_id, work_date)
);

-- 3. OT workstations (per-WS active flag and time override)
CREATE TABLE IF NOT EXISTS line_ot_workstations (
    id                  SERIAL PRIMARY KEY,
    ot_plan_id          INTEGER NOT NULL REFERENCES line_ot_plans(id) ON DELETE CASCADE,
    workstation_code    VARCHAR(50) NOT NULL,
    workstation_number  INTEGER,
    group_name          VARCHAR(100),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    ot_minutes          INTEGER NOT NULL DEFAULT 0,
    actual_sam_seconds  NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ot_plan_id, workstation_code)
);

-- 4. OT workstation processes
CREATE TABLE IF NOT EXISTS line_ot_workstation_processes (
    id                      SERIAL PRIMARY KEY,
    ot_workstation_id       INTEGER NOT NULL REFERENCES line_ot_workstations(id) ON DELETE CASCADE,
    product_process_id      INTEGER NOT NULL REFERENCES product_processes(id),
    sequence_in_workstation INTEGER NOT NULL DEFAULT 0
);

-- Note: OT employee assignments reuse employee_workstation_assignments with is_overtime = TRUE
-- UNIQUE(line_id, work_date, workstation_code, is_overtime) already enforces separation
