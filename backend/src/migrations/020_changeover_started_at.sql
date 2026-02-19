-- Migration 020: Track when supervisor activates changeover on a line.
-- NULL = changeover not yet started; non-NULL = changeover is active.
-- Changeover can only be activated after the primary product target is met,
-- and is explicitly triggered by the supervisor.

ALTER TABLE line_daily_plans
    ADD COLUMN IF NOT EXISTS changeover_started_at TIMESTAMPTZ NULL DEFAULT NULL;
