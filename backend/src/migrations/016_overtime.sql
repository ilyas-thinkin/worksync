-- Migration 016: Overtime support on daily plans
-- Each line can have an optional overtime session on the same date:
--   overtime_minutes  = extra working minutes beyond the regular shift
--   overtime_target   = additional units to produce during overtime

ALTER TABLE line_daily_plans
    ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS overtime_target  INTEGER NOT NULL DEFAULT 0;
