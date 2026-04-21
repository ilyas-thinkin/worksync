-- Migration 034: Track workstation-level changeover events and preserve plan-specific assignment history
ALTER TABLE employee_workstation_assignment_history
    ADD COLUMN IF NOT EXISTS line_plan_workstation_id INTEGER NULL
    REFERENCES line_plan_workstations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ewah_line_plan_ws
    ON employee_workstation_assignment_history(line_plan_workstation_id);

UPDATE employee_workstation_assignment_history hist
SET line_plan_workstation_id = ewa.line_plan_workstation_id
FROM employee_workstation_assignments ewa
WHERE hist.line_plan_workstation_id IS NULL
  AND hist.line_id = ewa.line_id
  AND hist.work_date = ewa.work_date
  AND hist.employee_id = ewa.employee_id
  AND hist.workstation_code = ewa.workstation_code
  AND hist.is_overtime = ewa.is_overtime
  AND ewa.line_plan_workstation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workstation_changeover_events (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    workstation_code VARCHAR(100) NOT NULL,
    primary_workstation_id INTEGER REFERENCES line_plan_workstations(id) ON DELETE SET NULL,
    incoming_workstation_id INTEGER REFERENCES line_plan_workstations(id) ON DELETE SET NULL,
    primary_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    incoming_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    primary_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    changeover_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    same_employee BOOLEAN NOT NULL DEFAULT false,
    feed_given BOOLEAN NOT NULL DEFAULT false,
    feed_quantity INTEGER NOT NULL DEFAULT 0,
    primary_output_quantity INTEGER NOT NULL DEFAULT 0,
    primary_target_quantity INTEGER NOT NULL DEFAULT 0,
    primary_balance_quantity INTEGER NOT NULL DEFAULT 0,
    primary_pending_wip INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT workstation_changeover_events_feed_nonneg CHECK (feed_quantity >= 0),
    CONSTRAINT workstation_changeover_events_output_nonneg CHECK (primary_output_quantity >= 0),
    CONSTRAINT workstation_changeover_events_target_nonneg CHECK (primary_target_quantity >= 0),
    CONSTRAINT workstation_changeover_events_balance_nonneg CHECK (primary_balance_quantity >= 0),
    CONSTRAINT workstation_changeover_events_wip_nonneg CHECK (primary_pending_wip >= 0),
    CONSTRAINT workstation_changeover_events_unique UNIQUE (line_id, work_date, workstation_code)
);

CREATE INDEX IF NOT EXISTS idx_ws_changeover_events_line_date
    ON workstation_changeover_events(line_id, work_date);
