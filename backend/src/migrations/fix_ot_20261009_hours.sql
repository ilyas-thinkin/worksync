-- One-off data fix for 2026-10-09 OT hours (not a schema migration — run once, by hand).
-- OT on 9 Oct was entered as one total per workstation and split into OT hours afterwards by
-- fix_ot_hourly_20261009.sql, which could only split evenly across the PLANNED minutes. Two of
-- those splits were wrong (confirmed by the user 2026-10-12):
--   * Line 17 worked 2 OT hours, but its plan said 60 min, so 19 stations' two-hour totals all sit
--     in the 17:00 hour and read 160-200%. They are split across 17:00 and 18:00 here. WS18 and
--     WS24 saved their totals at 18:05, after one hour, and stay as one hour.
--   * Line 1 stations WS41, WS42 and WS48 worked ONE OT hour of 60; the split made it 30 + 30
--     over two hours (~51%). The 60 goes back into the 17:00 hour and the 18:00 row is removed.
-- Every workstation's day total (line_ot_progress.quantity) is unchanged. Safe to re-run: each
-- statement only matches rows still in the uncorrected state.
BEGIN;

-- Line 17: split each two-hour total across OT hour 1 and OT hour 2 (odd totals: extra piece in hour 1).
WITH src AS (
    SELECT h.id, h.line_id, h.ot_workstation_id, h.work_date, h.quantity, h.employee_id
    FROM line_ot_hourly_progress h
    JOIN line_ot_workstations low ON low.id = h.ot_workstation_id
    WHERE h.line_id = 17 AND h.work_date = '2026-10-09' AND h.hour_slot = 17
      AND low.workstation_code NOT IN ('WS18', 'WS24')
      AND NOT EXISTS (
          SELECT 1 FROM line_ot_hourly_progress h2
          WHERE h2.ot_workstation_id = h.ot_workstation_id AND h2.work_date = h.work_date AND h2.hour_slot = 18
      )
), added AS (
    INSERT INTO line_ot_hourly_progress
        (line_id, ot_workstation_id, work_date, hour_slot, quantity, qa_rejection, remarks, employee_id)
    SELECT line_id, ot_workstation_id, work_date, 18, quantity / 2, 0, NULL, employee_id
    FROM src
    RETURNING ot_workstation_id
)
UPDATE line_ot_hourly_progress h
SET quantity = src.quantity - src.quantity / 2, updated_at = NOW()
FROM src
WHERE h.id = src.id;

-- Line 17's OT that day ran 120 min. The two-hour stations follow that default (0 = default);
-- WS18 and WS24 keep their own 60.
UPDATE line_ot_plans
SET global_ot_minutes = 120, updated_at = NOW()
WHERE line_id = 17 AND work_date = '2026-10-09' AND global_ot_minutes = 60;

UPDATE line_ot_workstations low
SET ot_minutes = 0, updated_at = NOW()
FROM line_ot_plans lop
WHERE low.ot_plan_id = lop.id AND lop.line_id = 17 AND lop.work_date = '2026-10-09'
  AND low.ot_minutes = 60 AND low.workstation_code NOT IN ('WS18', 'WS24')
  AND EXISTS (
      SELECT 1 FROM line_ot_hourly_progress h
      WHERE h.ot_workstation_id = low.id AND h.work_date = lop.work_date AND h.hour_slot = 18
  );

-- Line 1, WS41 / WS42 / WS48: one OT hour of 60, not 30 + 30.
WITH pair AS (
    SELECT h17.id AS keep_id, h18.id AS drop_id, h17.quantity + h18.quantity AS total,
           h17.qa_rejection + h18.qa_rejection AS rejection
    FROM line_ot_hourly_progress h17
    JOIN line_ot_hourly_progress h18
      ON h18.ot_workstation_id = h17.ot_workstation_id AND h18.work_date = h17.work_date AND h18.hour_slot = 18
    JOIN line_ot_workstations low ON low.id = h17.ot_workstation_id
    WHERE h17.line_id = 1 AND h17.work_date = '2026-10-09' AND h17.hour_slot = 17
      AND low.workstation_code IN ('WS41', 'WS42', 'WS48')
), merged AS (
    UPDATE line_ot_hourly_progress h
    SET quantity = pair.total, qa_rejection = pair.rejection, updated_at = NOW()
    FROM pair
    WHERE h.id = pair.keep_id
    RETURNING pair.drop_id
)
DELETE FROM line_ot_hourly_progress h USING merged WHERE h.id = merged.drop_id;

-- Stored line OT target for the two plans: hourly target (day target / 8, rounded up) x OT hours.
UPDATE line_ot_plans lop
SET ot_target_units = ROUND(CEIL(ldp.target_units / 8.0) * lop.global_ot_minutes / 60.0)::int, updated_at = NOW()
FROM line_daily_plans ldp
WHERE ldp.line_id = lop.line_id AND ldp.work_date = lop.work_date AND lop.work_date = '2026-10-09';

-- Checks. 1) Hourly rows must still add up to every station's day total: expect 0 rows.
SELECT p.line_id, low.workstation_code, p.quantity AS day_total, COALESCE(SUM(h.quantity), 0) AS hourly_total
FROM line_ot_progress p
JOIN line_ot_workstations low ON low.id = p.ot_workstation_id
LEFT JOIN line_ot_hourly_progress h ON h.ot_workstation_id = p.ot_workstation_id AND h.work_date = p.work_date
WHERE p.work_date = '2026-10-09'
GROUP BY p.line_id, low.workstation_code, p.quantity
HAVING p.quantity <> COALESCE(SUM(h.quantity), 0);

-- 2) The corrected rows.
SELECT h.line_id, low.workstation_code, STRING_AGG(h.hour_slot || ':' || h.quantity, '  ' ORDER BY h.hour_slot) AS ot_hours
FROM line_ot_hourly_progress h
JOIN line_ot_workstations low ON low.id = h.ot_workstation_id
WHERE h.work_date = '2026-10-09'
  AND (h.line_id = 17 OR (h.line_id = 1 AND low.workstation_code IN ('WS41', 'WS42', 'WS48')))
GROUP BY h.line_id, low.workstation_code, low.workstation_number
ORDER BY h.line_id, low.workstation_number;

COMMIT;
