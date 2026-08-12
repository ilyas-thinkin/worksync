-- 043_canonicalize_workstation_codes.sql
--
-- Repairs workstation codes that are not in the canonical "WS" + zero-padded-number
-- form (WS01 … WS98). Codes like "WS010" describe the same physical workstation as
-- "WS10", but plans, assignments, progress and changeover events are joined on exact
-- code equality, so the odd spelling silently breaks the employee lookup: the
-- supervisor's mapping is done against one plan (correct code) while the hourly
-- output save resolves the workstation through another plan (odd code), finds no
-- matching assignment row, and fails with "No employee assigned to this workstation".
--
-- Seen in production on line 17 (A5 - WASEEM) WS10 for the changeover product, and on
-- line 13, originating from a hand-typed "WS010" in an uploaded Excel plan template and
-- then carried forward day after day.
--
-- api.routes.js canonicalWsCode() now normalizes codes on every user-facing write path,
-- so this repair is one-time. It is written to be idempotent and safe to re-run.

BEGIN;

-- Canonical form for any code ending in digits: WS + the number, zero-padded to 2.
-- Codes without trailing digits (e.g. "SPARE") are left untouched.
CREATE OR REPLACE FUNCTION pg_temp.canonical_ws_code(code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN code ~ '\d+$'
      THEN 'WS' || lpad(((regexp_match(code, '(\d+)$'))[1])::bigint::text, 2, '0')
    ELSE code
  END;
$$;

UPDATE line_plan_workstations
   SET workstation_code = pg_temp.canonical_ws_code(workstation_code)
 WHERE workstation_code <> pg_temp.canonical_ws_code(workstation_code);

UPDATE employee_workstation_assignments
   SET workstation_code = pg_temp.canonical_ws_code(workstation_code)
 WHERE workstation_code <> pg_temp.canonical_ws_code(workstation_code);

UPDATE employee_workstation_assignment_history
   SET workstation_code = pg_temp.canonical_ws_code(workstation_code)
 WHERE workstation_code <> pg_temp.canonical_ws_code(workstation_code);

UPDATE workstation_changeover_events
   SET workstation_code = pg_temp.canonical_ws_code(workstation_code)
 WHERE workstation_code <> pg_temp.canonical_ws_code(workstation_code);

UPDATE line_ot_workstations
   SET workstation_code = pg_temp.canonical_ws_code(workstation_code)
 WHERE workstation_code <> pg_temp.canonical_ws_code(workstation_code);

UPDATE worker_departures
   SET workstation_code = pg_temp.canonical_ws_code(workstation_code)
 WHERE workstation_code <> pg_temp.canonical_ws_code(workstation_code);

UPDATE material_feed_events
   SET workstation_code = pg_temp.canonical_ws_code(workstation_code)
 WHERE workstation_code <> pg_temp.canonical_ws_code(workstation_code);

UPDATE worker_adjustments
   SET from_workstation_code = pg_temp.canonical_ws_code(from_workstation_code)
 WHERE from_workstation_code IS NOT NULL
   AND from_workstation_code <> pg_temp.canonical_ws_code(from_workstation_code);

UPDATE worker_adjustments
   SET vacant_workstation_code = pg_temp.canonical_ws_code(vacant_workstation_code)
 WHERE vacant_workstation_code IS NOT NULL
   AND vacant_workstation_code <> pg_temp.canonical_ws_code(vacant_workstation_code);

-- NOTE: line_workstations is intentionally excluded. It is the static per-line QR
-- table and uses its own "W01 … W99" prefix by design; code that crosses between it
-- and the plan tables already goes through normalizeWsCode().

COMMIT;
