-- 055: split hours in assignment history.
--
-- When a workstation switches to the changeover style part-way through an hour (supervisor picks
-- H:15 / H:30 / H:45), the operator ran the outgoing style for the first part of hour H and the
-- new style for the rest. Both windows now cover hour H: the outgoing one ends at H with
-- effective_to_minute = m, the new one starts at H with effective_from_minute = m. Each reads its
-- own plan row's output and SAM, so the hour's output and SAH add up across the two styles and the
-- hour is still counted once in the efficiency denominator.
--
-- The minutes only qualify the boundary hours: from_minute applies to effective_from_hour,
-- to_minute to effective_to_hour. Defaults (0 / 60) mean "whole hour", which is every existing row.
-- No-overlap rule per employee/date is now on minutes: [from_h*60+from_m, to_h*60+to_m) must not
-- intersect.

ALTER TABLE employee_workstation_assignment_history
    ADD COLUMN IF NOT EXISTS effective_from_minute SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS effective_to_minute   SMALLINT NOT NULL DEFAULT 60;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ewah_split_minutes_chk') THEN
        ALTER TABLE employee_workstation_assignment_history
            ADD CONSTRAINT ewah_split_minutes_chk
            CHECK (effective_from_minute BETWEEN 0 AND 59
               AND effective_to_minute BETWEEN 1 AND 60
               AND (effective_to_hour IS NULL OR effective_to_hour > effective_from_hour
                    OR effective_to_minute > effective_from_minute));
    END IF;
END $$;
