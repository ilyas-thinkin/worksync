-- Migration 018: Add is_overtime flag to employee_workstation_assignments.
-- Allows separate employee sets for regular shift vs OT shift on the same workstation.
-- By default all existing rows are treated as regular (is_overtime = false).

ALTER TABLE employee_workstation_assignments
    ADD COLUMN IF NOT EXISTS is_overtime BOOLEAN NOT NULL DEFAULT false;

-- Replace old unique constraint (line_id, work_date, workstation_code)
-- with one that also includes is_overtime so each workstation can have
-- one regular employee AND one OT employee independently.
DROP INDEX IF EXISTS idx_ewa_line_date_ws;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ewa_line_date_ws_ot
    ON employee_workstation_assignments(line_id, work_date, workstation_code, is_overtime);
