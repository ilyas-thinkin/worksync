-- Migration 040: Add is_custom_takt flag to line_plan_workstations
-- Allows the frontend to distinguish manually-overridden WS takts from
-- auto-calculated ones. Non-custom WSes always follow the live line target.
ALTER TABLE line_plan_workstations
    ADD COLUMN IF NOT EXISTS is_custom_takt BOOLEAN DEFAULT FALSE;
