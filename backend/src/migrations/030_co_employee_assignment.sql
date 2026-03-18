-- Migration 030: Changeover employee pre-assignment by IE
-- Adds co_employee_id to line_plan_workstations so IE can pre-assign
-- a suggested changeover employee per workstation per product context.
-- This is tracked independently from employee_workstation_assignments.

ALTER TABLE line_plan_workstations
    ADD COLUMN IF NOT EXISTS co_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN line_plan_workstations.co_employee_id
    IS 'IE-pre-assigned changeover employee for this workstation (suggestion for supervisor to confirm or override)';
