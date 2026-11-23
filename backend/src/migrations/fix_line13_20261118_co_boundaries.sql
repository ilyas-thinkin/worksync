-- One-off: line 13 (HALL B), 2026-11-18 — credit CO output that no history window pointed at.
--
-- Supervisors switched stations to CO during the hourly entry round and then entered the hour just
-- finished. activate-workstation closed the old-style window at the hour in progress and opened CO
-- at the next hour (10:31 → old style 8..10, CO from 11), while the card had already moved to CO
-- processes, so hours 9 and 10 were saved against CO. The reports credit by window, so 6,160 pieces
-- on 51 operators were credited to nobody. The operators really did run CO in those hours
-- (confirmed by the line), so the fix moves each window's style boundary to the station's first
-- hour with CO output. WHO worked an hour never changes — only which style's plan row it points at.
--
-- Same-hour double entries (WS34/WS68 hour 9, WS43–45 hour 10: the full hour entered on both
-- styles) count once, as CO; their old-style rows stay in the table, uncredited.
--
-- Usage: psql ... -v line=13 -v d=2026-11-18 -v commit=0 -f this.sql   (commit=1 to apply)

\set ON_ERROR_STOP on
\if :{?commit}
\else
\set commit 0
\endif

BEGIN;

CREATE TABLE IF NOT EXISTS employee_workstation_assignment_history_backup_fix20261118
    AS SELECT * FROM employee_workstation_assignment_history WHERE false;
-- Back up only the first time, so a re-run never overwrites the original state.
INSERT INTO employee_workstation_assignment_history_backup_fix20261118
    SELECT * FROM employee_workstation_assignment_history
    WHERE line_id = :line AND work_date = :'d' AND NOT is_overtime
      AND NOT EXISTS (SELECT 1 FROM employee_workstation_assignment_history_backup_fix20261118
                      WHERE line_id = :line AND work_date = :'d');
SELECT set_config('fix.d', :'d', true);

CREATE TEMP TABLE before_windows ON COMMIT DROP AS
    SELECT h.id, h.workstation_code, h.employee_id, h.effective_from_hour, h.effective_to_hour, l.product_id
    FROM employee_workstation_assignment_history h
    JOIN line_plan_workstations l ON l.id = h.line_plan_workstation_id
    WHERE h.line_id = :line AND h.work_date = :'d' AND NOT h.is_overtime;

CREATE FUNCTION pg_temp.fix_co_boundaries(p_line int, p_date date) RETURNS int AS $$
DECLARE
    v_primary int;
    v_incoming int;
    st record;
    w record;
    v_b int;
    v_changed int := 0;
    v_hours int[] := ARRAY[8, 9, 10, 11, 13, 14, 15, 16];
BEGIN
    SELECT product_id, incoming_product_id INTO v_primary, v_incoming
    FROM line_daily_plans WHERE line_id = p_line AND work_date = p_date;
    IF v_incoming IS NULL THEN RAISE EXCEPTION 'No changeover product on % / %', p_line, p_date; END IF;

    FOR st IN
        SELECT p.workstation_code AS code, p.id AS p_id, c.id AS c_id
        FROM line_plan_workstations p
        JOIN line_plan_workstations c
          ON c.line_id = p.line_id AND c.work_date = p.work_date
         AND c.workstation_code = p.workstation_code AND c.product_id = v_incoming
        WHERE p.line_id = p_line AND p.work_date = p_date AND p.product_id = v_primary
    LOOP
        SELECT MIN(lph.hour_slot) INTO v_b
        FROM line_plan_workstation_processes x
        JOIN line_process_hourly_progress lph
          ON lph.process_id = x.product_process_id AND lph.line_id = p_line AND lph.work_date = p_date
        WHERE x.workstation_id = st.c_id;
        CONTINUE WHEN v_b IS NULL;

        FOR w IN
            SELECT * FROM employee_workstation_assignment_history
            WHERE line_id = p_line AND work_date = p_date AND NOT is_overtime
              AND workstation_code = st.code
            ORDER BY effective_from_hour, id
        LOOP
            IF w.line_plan_workstation_id = st.p_id AND COALESCE(w.effective_to_hour, 99) >= v_b THEN
                -- Old-style window reaching into the CO hours.
                IF w.effective_from_hour >= v_b THEN
                    UPDATE employee_workstation_assignment_history
                    SET line_plan_workstation_id = st.c_id, updated_at = NOW() WHERE id = w.id;
                ELSE
                    UPDATE employee_workstation_assignment_history
                    SET effective_to_hour = v_b - 1, updated_at = NOW() WHERE id = w.id;
                    INSERT INTO employee_workstation_assignment_history
                        (line_id, work_date, employee_id, workstation_code, is_overtime,
                         effective_from_hour, effective_to_hour, linked_at, attendance_start, late_reason,
                         line_plan_workstation_id)
                    VALUES (w.line_id, w.work_date, w.employee_id, w.workstation_code, false,
                            v_b, w.effective_to_hour, w.linked_at, w.attendance_start, w.late_reason, st.c_id);
                END IF;
                v_changed := v_changed + 1;
            ELSIF w.line_plan_workstation_id = st.c_id AND w.effective_from_hour < v_b
                  AND EXISTS (
                      SELECT 1 FROM line_plan_workstation_processes x
                      JOIN line_process_hourly_progress lph
                        ON lph.process_id = x.product_process_id AND lph.line_id = p_line AND lph.work_date = p_date
                      WHERE x.workstation_id = st.p_id
                        AND lph.hour_slot BETWEEN w.effective_from_hour AND v_b - 1) THEN
                -- CO window starting before any CO output while old-style output exists there.
                IF COALESCE(w.effective_to_hour, 99) < v_b THEN
                    UPDATE employee_workstation_assignment_history
                    SET line_plan_workstation_id = st.p_id, updated_at = NOW() WHERE id = w.id;
                ELSE
                    UPDATE employee_workstation_assignment_history
                    SET effective_from_hour = v_b, updated_at = NOW() WHERE id = w.id;
                    INSERT INTO employee_workstation_assignment_history
                        (line_id, work_date, employee_id, workstation_code, is_overtime,
                         effective_from_hour, effective_to_hour, linked_at, attendance_start, late_reason,
                         line_plan_workstation_id)
                    VALUES (w.line_id, w.work_date, w.employee_id, w.workstation_code, false,
                            w.effective_from_hour, v_b - 1, w.linked_at, w.attendance_start, w.late_reason, st.p_id);
                END IF;
                v_changed := v_changed + 1;
            END IF;
        END LOOP;
    END LOOP;

    -- Merge back-to-back windows of the same operator on the same plan row (no working hour between
    -- them), keeping the earlier row's link fields.
    LOOP
        WITH pair AS (
            SELECT a.id AS keep_id, b.id AS drop_id, b.effective_to_hour AS new_to
            FROM employee_workstation_assignment_history a
            JOIN employee_workstation_assignment_history b
              ON b.employee_id = a.employee_id AND b.work_date = a.work_date AND b.is_overtime = a.is_overtime
             AND b.line_id = a.line_id AND b.workstation_code = a.workstation_code
             AND b.line_plan_workstation_id = a.line_plan_workstation_id
             AND a.effective_to_hour IS NOT NULL
             AND b.effective_from_hour > a.effective_to_hour
             AND NOT EXISTS (SELECT 1 FROM unnest(v_hours) h
                             WHERE h > a.effective_to_hour AND h < b.effective_from_hour)
            WHERE a.line_id = p_line AND a.work_date = p_date AND NOT a.is_overtime
            ORDER BY a.effective_from_hour
            LIMIT 1
        ), upd AS (
            UPDATE employee_workstation_assignment_history t
            SET effective_to_hour = pair.new_to, updated_at = NOW()
            FROM pair WHERE t.id = pair.keep_id
            RETURNING pair.drop_id
        )
        DELETE FROM employee_workstation_assignment_history WHERE id IN (SELECT drop_id FROM upd);
        EXIT WHEN NOT FOUND;
    END LOOP;

    RETURN v_changed;
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.fix_co_boundaries(:line, :'d') AS windows_changed;

-- Invariant: no operator may hold two windows covering the same hour.
DO $$
DECLARE n int;
BEGIN
    SELECT COUNT(*) INTO n
    FROM employee_workstation_assignment_history a
    JOIN employee_workstation_assignment_history b
      ON b.employee_id = a.employee_id AND b.work_date = a.work_date
     AND b.is_overtime = a.is_overtime AND b.id > a.id
    WHERE a.work_date = current_setting('fix.d')::date
      AND a.effective_from_hour <= COALESCE(b.effective_to_hour, 999)
      AND b.effective_from_hour <= COALESCE(a.effective_to_hour, 999);
    IF n > 0 THEN RAISE EXCEPTION 'Overlapping windows after fix: %', n; END IF;
END $$;

-- Before/after, per station whose windows changed.
SELECT b.workstation_code AS ws,
       string_agg(DISTINCT b.employee_id || ':' || b.effective_from_hour || '-' || COALESCE(b.effective_to_hour::text, '') || '@' || b.product_id, ' ') AS before,
       (SELECT string_agg(h.employee_id || ':' || h.effective_from_hour || '-' || COALESCE(h.effective_to_hour::text, '') || '@' || l.product_id, ' ' ORDER BY h.effective_from_hour)
          FROM employee_workstation_assignment_history h JOIN line_plan_workstations l ON l.id = h.line_plan_workstation_id
         WHERE h.line_id = :line AND h.work_date = :'d' AND NOT h.is_overtime AND h.workstation_code = b.workstation_code) AS after
FROM before_windows b
GROUP BY b.workstation_code
HAVING string_agg(DISTINCT b.employee_id || ':' || b.effective_from_hour || '-' || COALESCE(b.effective_to_hour::text, '') || '@' || b.product_id, ' ')
    IS DISTINCT FROM
       (SELECT string_agg(DISTINCT h.employee_id || ':' || h.effective_from_hour || '-' || COALESCE(h.effective_to_hour::text, '') || '@' || l.product_id, ' ')
          FROM employee_workstation_assignment_history h JOIN line_plan_workstations l ON l.id = h.line_plan_workstation_id
         WHERE h.line_id = :line AND h.work_date = :'d' AND NOT h.is_overtime AND h.workstation_code = b.workstation_code)
ORDER BY MIN(b.id);

\if :commit
INSERT INTO audit_logs (table_name, record_id, action, new_values, reason)
VALUES ('employee_workstation_assignment_history', :line, 'co_boundary_fix',
        jsonb_build_object('line_id', :line, 'work_date', :'d',
                           'backup_table', 'employee_workstation_assignment_history_backup_fix20261118'),
        'CO output entered after the switch was credited to nobody; window style boundary moved to the first CO-output hour');
COMMIT;
\echo 'COMMITTED'
\else
ROLLBACK;
\echo 'ROLLED BACK (preview only — rerun with -v commit=1 to apply)'
\endif
