-- Migration 047: Worker return — make a departure a closable absence window
--
-- Incident (line 1 "A1 - GAFOOR", 2026-08-28): K. ESWARI (emp 9, WS54) left at 11:36 on a
-- two-hour personal permission and came back around 13:36. Nobody covered the station, so no
-- worker_adjustments row was ever written, and worker_departures had no way to record that
-- she came back. Every status expression in the app derives "vacant" purely from the presence
-- of that departure row, so WS54 stayed VACANT for the rest of the day: the Enter Output
-- button rendered disabled, the Adjustment panel refused to re-scan her ("not active on this
-- line today"), and her efficiency denominator was truncated to 4 of 8 hours. The only escape
-- was the destructive admin whole-day plan delete.
--
-- After this migration:
--   worker_departures.return_time NULL = still away (station reads vacant)
--   worker_departures.return_time SET  = came back (station active again)
--   worker_adjustments.ended_at   NULL = still covering
--   worker_adjustments.ended_at   SET  = coverage finished
-- and the two "one forever" unique indexes become "one OPEN at a time" partial indexes, so a
-- worker can leave the same station twice in one day.

BEGIN;

-- ─── worker_departures ──────────────────────────────────────────────────────────────────
ALTER TABLE worker_departures
    ADD COLUMN IF NOT EXISTS return_time  TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS return_notes TEXT NULL;

COMMENT ON COLUMN worker_departures.return_time IS
  'When the worker came back on the line. NULL = still away, the station reads vacant. Set by '
  'POST /supervisor/worker-return, or automatically by POST /workstation-assignments when the '
  'same worker is linked again the same day.';

-- Nothing may close a departure before it happened. Every pre-existing row has return_time
-- NULL, so this validates instantly.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'wd_return_after_departure'
          AND conrelid = 'worker_departures'::regclass
    ) THEN
        ALTER TABLE worker_departures
            ADD CONSTRAINT wd_return_after_departure
            CHECK (return_time IS NULL OR return_time >= departure_time);
    END IF;
END $$;

-- Was a TOTAL unique index (migration 027) on (line_id, work_date, workstation_code,
-- employee_id): the first departure of the day was permanent and a second outpass from the
-- same station was rejected with a 409. The real rule is one OPEN departure at a time.
-- Safe to rebuild as unique: every existing row has return_time NULL and the old total index
-- already guaranteed uniqueness across exactly that set.
DROP INDEX IF EXISTS idx_wd_line_date_ws_emp;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wd_line_date_ws_emp_open
    ON worker_departures(line_id, work_date, workstation_code, employee_id)
    WHERE return_time IS NULL;

-- "Does this worker have an open departure anywhere today?" — the auto-close lookup on the
-- POST /workstation-assignments path, hit on every supervisor link.
CREATE INDEX IF NOT EXISTS idx_wd_open_emp_date
    ON worker_departures(employee_id, work_date)
    WHERE return_time IS NULL;

-- ─── worker_adjustments ─────────────────────────────────────────────────────────────────
ALTER TABLE worker_adjustments
    ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN worker_adjustments.ended_at IS
  'When this coverage stopped, normally the moment the departed worker returned. '
  'NULL = still covering.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'wa_ended_after_reassignment'
          AND conrelid = 'worker_adjustments'::regclass
    ) THEN
        ALTER TABLE worker_adjustments
            ADD CONSTRAINT wa_ended_after_reassignment
            CHECK (ended_at IS NULL OR ended_at >= reassignment_time);
    END IF;
END $$;

-- Was idx_wa_departure_unique (migration 028), a TOTAL unique index on departure_id. One long
-- absence may need several successive covers; only one may be OPEN at a time. The non-unique
-- idx_wa_departure stays and still serves the departure_id lookups.
DROP INDEX IF EXISTS idx_wa_departure_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_departure_open
    ON worker_adjustments(departure_id)
    WHERE ended_at IS NULL;

COMMIT;
