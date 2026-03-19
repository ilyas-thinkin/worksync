-- Migration 023: Add is_linked flag to employee_workstation_assignments
-- Unlink = employee stays assigned but is no longer confirmed at the workstation
ALTER TABLE employee_workstation_assignments
    ADD COLUMN is_linked BOOLEAN NOT NULL DEFAULT true;
