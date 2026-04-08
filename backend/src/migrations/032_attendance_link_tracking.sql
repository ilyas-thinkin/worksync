-- Migration 032: Track link time, late reason, and computed attendance start
-- linked_at: when supervisor confirmed the link (NULL = not linked yet)
-- late_reason: reason given if linked after 09:00; linking_took_time|meeting → shift start, permission|other → link time
-- attendance_start: computed shift start (used for efficiency denominator)

ALTER TABLE employee_workstation_assignments
    ADD COLUMN linked_at        TIMESTAMPTZ,
    ADD COLUMN late_reason      VARCHAR(30),
    ADD COLUMN attendance_start TIMESTAMPTZ;

ALTER TABLE employee_workstation_assignments
    ADD CONSTRAINT ewa_late_reason_check
    CHECK (late_reason IS NULL OR late_reason IN ('linking_took_time', 'meeting', 'permission', 'other'));

-- Backfill: existing linked rows get attendance_start = work_date + default_in_time
-- (best-effort; we don't know the original in_time so use 08:00)
UPDATE employee_workstation_assignments
SET attendance_start = (work_date::text || 'T08:00:00')::TIMESTAMPTZ
WHERE is_linked = true AND attendance_start IS NULL;

COMMENT ON COLUMN employee_workstation_assignments.linked_at IS 'Timestamp when supervisor confirmed link; NULL means not yet linked (absent)';
COMMENT ON COLUMN employee_workstation_assignments.late_reason IS 'Reason code when linked after 09:00 threshold';
COMMENT ON COLUMN employee_workstation_assignments.attendance_start IS 'Effective shift start used for efficiency calculation';
