-- 045: Repair overlapping employee_workstation_assignment_history windows
--
-- Background
-- ----------
-- When a worker was moved mid-day (e.g. WS30 -> WS33), the old window was closed a
-- moment before the new one was written, so syncAssignmentHistoryForCurrentRow saw no
-- active row and took the "credit full shift" attendance_start branch, backdating the
-- new window to the shift start. The new window then overlapped the hours the worker
-- was still at the old workstation, and getEmployeeProgressForWindow summed both —
-- inflating the worker efficiency report. The same backdating produced duplicate
-- windows when a worker was unlinked and relinked at the SAME workstation.
--
-- The code fix (syncAssignmentHistoryForCurrentRow) now clamps a new window to start
-- after every already-closed window belonging to that employee that day. This migration
-- applies the same rule retroactively to rows written before the fix.
--
-- Rule: walking an employee's windows for one date in creation (id) order, a window may
-- not start at or before the last hour already consumed by an earlier-created window.
--   * start moved forward and hours remain  -> effective_from_hour is shifted
--   * no hours remain (every hour it claims is already claimed) -> row is deleted
--
-- A full snapshot is taken first; nothing here is unrecoverable.

BEGIN;

-- 1. Snapshot ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_workstation_assignment_history_backup_045
    AS SELECT * FROM employee_workstation_assignment_history;

-- 2. Build the repair plan --------------------------------------------------
CREATE TEMP TABLE repair_plan (
    id       int PRIMARY KEY,
    new_from int,
    action   text
) ON COMMIT DROP;

DO $$
DECLARE
    reg int[] := ARRAY[8,9,10,11,13,14,15,16];   -- REGULAR_HISTORY_HOURS
    ot  int[] := ARRAY[17,18,19];                -- OT_HISTORY_HOURS
    hs  int[];
    r   RECORD;
    key text := '';
    cur int;
    nf  int;
    act text;
BEGIN
    FOR r IN
        SELECT id, employee_id, work_date, is_overtime,
               effective_from_hour AS f, effective_to_hour AS t
        FROM employee_workstation_assignment_history
        ORDER BY employee_id, work_date, is_overtime, id
    LOOP
        IF key <> (r.employee_id || '|' || r.work_date || '|' || r.is_overtime) THEN
            key := r.employee_id || '|' || r.work_date || '|' || r.is_overtime;
            cur := NULL;
        END IF;
        hs := CASE WHEN r.is_overtime THEN ot ELSE reg END;

        nf  := r.f;
        act := 'keep';
        IF cur IS NOT NULL AND r.f <= cur THEN
            SELECT MIN(h) INTO nf FROM unnest(hs) h WHERE h > cur;
            IF nf IS NULL OR (r.t IS NOT NULL AND nf > r.t) THEN
                act := 'delete';
            ELSE
                act := 'shift';
            END IF;
        END IF;

        IF act <> 'keep' THEN
            INSERT INTO repair_plan VALUES
                (r.id, CASE WHEN act = 'shift' THEN nf END, act);
        END IF;

        -- only surviving windows consume hours
        IF act <> 'delete' THEN
            cur := GREATEST(COALESCE(cur, -1), COALESCE(r.t, hs[array_length(hs,1)]));
        END IF;
    END LOOP;
END $$;

-- 3. Apply ------------------------------------------------------------------
UPDATE employee_workstation_assignment_history h
   SET effective_from_hour = p.new_from,
       updated_at          = NOW()
  FROM repair_plan p
 WHERE p.id = h.id AND p.action = 'shift';

DELETE FROM employee_workstation_assignment_history h
 USING repair_plan p
 WHERE p.id = h.id AND p.action = 'delete';

COMMIT;
