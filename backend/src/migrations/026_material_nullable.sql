-- Migration 026: make material_provided nullable so NULL = not yet supervisor-confirmed
ALTER TABLE employee_workstation_assignments
    ALTER COLUMN material_provided DROP NOT NULL,
    ALTER COLUMN material_provided DROP DEFAULT;
-- NULL = assignment exists but supervisor hasn't confirmed yet
-- 0 or more = supervisor confirmed (0 = nothing provided)

-- Reset all existing rows that were inserted with the old DEFAULT 0
-- (those were never confirmed by supervisor — the 0 was automatic, not intentional)
UPDATE employee_workstation_assignments SET material_provided = NULL WHERE material_provided = 0;
