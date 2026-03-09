-- Migration 023: Per-workstation changeover support
-- Allows individual workstations to independently switch to the changeover product
-- while other workstations on the same line continue with the primary product.
-- ws_changeover_active = true means this workstation is now running the changeover product.
-- ws_changeover_started_at records when the supervisor activated changeover for this WS.

ALTER TABLE line_plan_workstations
    ADD COLUMN IF NOT EXISTS ws_changeover_active BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ws_changeover_started_at TIMESTAMPTZ NULL;
