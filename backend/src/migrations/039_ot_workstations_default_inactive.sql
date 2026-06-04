-- Migration 039: OT workstations default inactive
-- IE explicitly activates OT workstations as needed.

ALTER TABLE line_ot_workstations
    ALTER COLUMN is_active SET DEFAULT FALSE;
