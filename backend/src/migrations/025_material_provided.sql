-- Migration 025: Add material_provided to employee_workstation_assignments
ALTER TABLE employee_workstation_assignments
    ADD COLUMN IF NOT EXISTS material_provided INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN employee_workstation_assignments.material_provided IS 'Units of material/WIP provided to this workstation at start of day';
