-- Migration 019: Add is_ot_skipped flag to line_plan_workstations.
-- Allows IE to mark individual workstations as not running during overtime,
-- so employees don't need to be assigned to them in OT mode.

ALTER TABLE line_plan_workstations
    ADD COLUMN IF NOT EXISTS is_ot_skipped BOOLEAN NOT NULL DEFAULT false;
