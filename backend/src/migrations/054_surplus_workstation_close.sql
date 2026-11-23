-- 054: surplus workstations are closed by the supervisor, not by the changeover.
--
-- A surplus station exists only in the outgoing (primary) layout. It used to be assumed idle the
-- moment changeover started, so its operator had to be released before Convert to Primary would
-- run — and after Convert the station vanished from the hourly board. On the floor these stations
-- still have primary bundles to finish (line 13 / 2026-11-18: WS75–WS85 kept producing after the
-- CO style, 74 stations, replaced the 85-station primary). They now stay enterable until the
-- supervisor closes them with "Finish primary" (work done) or "Release" (operator taken off).
--
-- NULL surplus_closed_at = still running primary. surplus_closed_hour is the last hour slot the
-- station is credited with. Per plan row, so nothing carries into another day.

ALTER TABLE line_plan_workstations
    ADD COLUMN IF NOT EXISTS surplus_closed_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS surplus_close_reason VARCHAR(16),
    ADD COLUMN IF NOT EXISTS surplus_closed_hour  SMALLINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lpw_surplus_close_reason_chk'
    ) THEN
        ALTER TABLE line_plan_workstations
            ADD CONSTRAINT lpw_surplus_close_reason_chk
            CHECK (surplus_close_reason IS NULL OR surplus_close_reason IN ('finished', 'released'));
    END IF;
END $$;
