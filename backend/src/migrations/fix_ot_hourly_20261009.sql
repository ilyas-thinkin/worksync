-- One-off data fix for 2026-10-09 OT (not a schema migration — run once, by hand).
-- OT before this date was entered as one total per workstation. This splits today's totals into
-- per-OT-hour rows (same totals), puts line 1's workstations on the plan's 120 min, re-activates
-- line 17 workstations that have OT output, and recalculates the stored OT targets.
-- Backups of the rows it touches: scratchpad backup_ot_*.csv from the 2026-10-09 session.
BEGIN;

-- Line 1: active workstations held a copy of the old 60-min default (or 120 = default); follow the plan's 120.
UPDATE line_ot_workstations low SET ot_minutes = 0, updated_at = NOW()
FROM line_ot_plans lop
WHERE low.ot_plan_id = lop.id AND lop.line_id = 1 AND lop.work_date = '2026-10-09'
  AND low.is_active AND low.ot_minutes IN (60, 120);

-- Line 17: workstations with OT output entered are active (they were worked).
UPDATE line_ot_workstations low SET is_active = true, updated_at = NOW()
FROM line_ot_progress p
WHERE p.ot_workstation_id = low.id AND p.work_date = '2026-10-09' AND NOT low.is_active;

-- Split each day total into its OT hours (17:00 onward), evenly, remainder to the earliest hours.
INSERT INTO line_ot_hourly_progress (line_id, ot_workstation_id, work_date, hour_slot, quantity, qa_rejection, remarks, employee_id)
SELECT d.line_id, d.ot_workstation_id, d.work_date, 17 + g.i,
       d.quantity / d.n + CASE WHEN g.i < d.quantity % d.n THEN 1 ELSE 0 END,
       CASE WHEN g.i = 0 THEN d.qa_rejection ELSE 0 END,
       CASE WHEN g.i = 0 THEN d.remarks END,
       d.employee_id
FROM (
    SELECT p.*, GREATEST(1, CEIL(COALESCE(NULLIF(low.ot_minutes, 0), lop.global_ot_minutes) / 60.0))::int AS n
    FROM line_ot_progress p
    JOIN line_ot_workstations low ON low.id = p.ot_workstation_id
    JOIN line_ot_plans lop ON lop.id = low.ot_plan_id
    WHERE p.work_date = '2026-10-09'
      AND NOT EXISTS (SELECT 1 FROM line_ot_hourly_progress h WHERE h.ot_workstation_id = p.ot_workstation_id AND h.work_date = p.work_date)
) d
CROSS JOIN LATERAL generate_series(0, d.n - 1) AS g(i);

-- Stored per-workstation OT target/balance for today: own takt when set, else daily target / 8 per hour.
UPDATE line_ot_progress p SET
    ot_target_units = t.tgt,
    balance_quantity = GREATEST(0, t.tgt - p.quantity),
    updated_at = NOW()
FROM (
    SELECT p2.id,
           ROUND(CASE WHEN lpw.is_custom_takt AND lpw.takt_time_seconds > 0 THEN 3600.0 / lpw.takt_time_seconds
                      ELSE COALESCE(ldp.target_units, 0) / 8.0 END
                 * COALESCE(NULLIF(low.ot_minutes, 0), lop.global_ot_minutes) / 60.0)::int AS tgt
    FROM line_ot_progress p2
    JOIN line_ot_workstations low ON low.id = p2.ot_workstation_id
    JOIN line_ot_plans lop ON lop.id = low.ot_plan_id
    LEFT JOIN line_daily_plans ldp ON ldp.line_id = lop.line_id AND ldp.work_date = lop.work_date
    LEFT JOIN line_plan_workstations lpw ON lpw.id = low.source_line_plan_workstation_id
    WHERE p2.work_date = '2026-10-09'
) t
WHERE t.id = p.id;

-- Line OT target on every plan: daily rate x OT duration (it was a sum over workstations).
UPDATE line_ot_plans lop SET ot_target_units = ROUND(
        (CASE WHEN ldp.incoming_product_id IS NOT NULL AND lop.product_id = ldp.incoming_product_id
              THEN COALESCE(ldp.incoming_target_units, 0) ELSE COALESCE(ldp.target_units, 0) END) / 8.0
        * lop.global_ot_minutes / 60.0)::int,
    updated_at = NOW()
FROM line_daily_plans ldp
WHERE ldp.line_id = lop.line_id AND ldp.work_date = lop.work_date;

-- Check: hourly rows must add up to the day totals.
SELECT p.line_id, count(*) AS ws, sum(p.quantity) AS day_total,
       (SELECT sum(quantity) FROM line_ot_hourly_progress h WHERE h.work_date = '2026-10-09' AND h.line_id = p.line_id) AS hourly_total
FROM line_ot_progress p WHERE p.work_date = '2026-10-09' GROUP BY p.line_id;

COMMIT;
