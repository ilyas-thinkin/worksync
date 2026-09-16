-- 048: Drop workstation_changeover_events rows whose cutover was retracted
--
-- Background
-- ----------
-- workstation_changeover_events records the snapshot taken when a workstation cuts over to
-- the changeover style: primary output at that moment, balance, pending WIP, feed given,
-- and which operator took it on. It is live state, not an append-only log — activate-
-- workstation overwrites the row via ON CONFLICT, and audit_logs keeps the history.
--
-- The revert path (POST /supervisor/changeover/revert-workstation) cleared
-- line_plan_workstations.ws_changeover_active but never deleted the matching event row, and
-- the line-wide force_sco_override reset had the same gap. So a reverted station left behind
-- a record asserting a cutover that no longer stands. The two tables then disagree about the
-- same station on the same day: line 17 / 2026-08-24 held 44 event rows against 0 active
-- flags, line 13 / 2026-05-16 held 57. Any report or UI deriving per-station changeover state
-- from the events table counted cutovers that had been undone.
--
-- The code fix deletes the event alongside the flag in both paths. This migration applies the
-- same rule retroactively.
--
-- Rule: delete an event when NO line_plan_workstations row for the same (line, date, station)
-- is flagged ws_changeover_active. Matching is done through canonical_ws_code (migration 044)
-- so spelling differences between the two tables do not hide a live flag and cause a row that
-- IS still in changeover to be deleted.
--
-- Deliberately NOT keyed on primary_workstation_id: that FK is ON DELETE SET NULL, so a plan
-- re-upload nulls it on 113 otherwise-valid rows, and keying on it would spare genuinely
-- retracted events while looking past live ones.
--
-- Verified before writing: all 191 matching rows have a surviving plan row for that station on
-- that date, it is simply not CO-active. None are rows whose plan was wiped, so nothing here
-- is the last surviving record of a cutover that really happened.

BEGIN;

-- Full-row backup so the delete is reversible. Same convention as migration 045.
CREATE TABLE IF NOT EXISTS workstation_changeover_events_backup_048 AS
SELECT * FROM workstation_changeover_events WHERE false;

INSERT INTO workstation_changeover_events_backup_048
SELECT wce.*
FROM workstation_changeover_events wce
WHERE NOT EXISTS (
    SELECT 1
    FROM line_plan_workstations lpw
    WHERE lpw.line_id   = wce.line_id
      AND lpw.work_date = wce.work_date
      AND canonical_ws_code(lpw.workstation_code) = canonical_ws_code(wce.workstation_code)
      AND lpw.ws_changeover_active = true
);

DELETE FROM workstation_changeover_events wce
WHERE NOT EXISTS (
    SELECT 1
    FROM line_plan_workstations lpw
    WHERE lpw.line_id   = wce.line_id
      AND lpw.work_date = wce.work_date
      AND canonical_ws_code(lpw.workstation_code) = canonical_ws_code(wce.workstation_code)
      AND lpw.ws_changeover_active = true
);

COMMIT;

-- Rollback, if ever needed:
--   INSERT INTO workstation_changeover_events
--   SELECT * FROM workstation_changeover_events_backup_048;
