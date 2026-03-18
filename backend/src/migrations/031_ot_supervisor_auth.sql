-- Migration 031: OT supervisor authorization
-- IE can authorize the supervisor to assign/modify workstations and employees during OT.
-- Also enforces OT duration must be 1-4 hours (enforced in UI).

ALTER TABLE line_ot_plans
    ADD COLUMN IF NOT EXISTS supervisor_authorized BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN line_ot_plans.supervisor_authorized
    IS 'IE has authorized the supervisor to assign/modify workstations and employees during OT';
