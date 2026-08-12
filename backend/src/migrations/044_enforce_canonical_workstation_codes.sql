-- 044_enforce_canonical_workstation_codes.sql
--
-- Makes the canonical workstation-code format a database-level invariant instead of a
-- convention that ~32 separate INSERT sites each have to remember.
--
-- Background: plans, assignments, progress, changeover events and OT are joined on
-- exact workstation_code equality. A single odd spelling ("WS010" for "WS10") creates a
-- second identity for the same physical workstation, and the employee lookup on those
-- joins silently returns nothing — the supervisor sees the operator on the card but
-- saving hourly output fails with "No employee assigned to this workstation".
-- See migration 043 for the production incident and the one-time data repair.
--
-- Application code (api.routes.js canonicalWsCode) normalizes on every user-facing
-- write path, but that only covers paths that remember to call it. These triggers close
-- the gap for every current and future writer, including manual psql edits and any new
-- endpoint: the code is rewritten to canonical form on the way in, so a non-canonical
-- value cannot be stored at all.
--
-- Normalizing (rather than rejecting) is deliberate: it is self-healing and never turns
-- a plan upload into a hard failure. Codes with no trailing digits (e.g. "SPARE") are
-- passed through upper-cased, and NULL / empty values are left alone.

BEGIN;

-- Canonical form: "WS" + trailing number, zero-padded to at least 2 digits.
-- Mirrors canonicalWsCode() in api.routes.js exactly.
--
-- NOTE: this deliberately does not use lpad(x, 2, '0') alone. Unlike JavaScript's
-- padStart, PostgreSQL's lpad TRUNCATES when the input is longer than the target
-- width, so lpad('100', 2, '0') = '10' — which would silently collapse WS100 into
-- WS10 and collide the two workstations. Only pad when the number is short.
CREATE OR REPLACE FUNCTION canonical_ws_code(code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  trimmed text;
  digits  text;
BEGIN
  IF code IS NULL THEN
    RETURN NULL;
  END IF;
  trimmed := btrim(code);
  IF trimmed = '' THEN
    RETURN trimmed;
  END IF;
  digits := (regexp_match(trimmed, '(\d+)$'))[1];
  IF digits IS NULL THEN
    RETURN upper(trimmed);
  END IF;
  digits := digits::bigint::text;   -- strips leading zeros: '010' -> '10'
  IF length(digits) < 2 THEN
    digits := lpad(digits, 2, '0');
  END IF;
  RETURN 'WS' || digits;
END;
$$;

COMMENT ON FUNCTION canonical_ws_code(text) IS
  'Canonical stored form for workstation codes: WS + zero-padded number (WS01..WS98). Mirrors canonicalWsCode() in api.routes.js.';

-- Single-column normalizer, for tables whose column is named workstation_code.
CREATE OR REPLACE FUNCTION trg_canonicalize_workstation_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.workstation_code := canonical_ws_code(NEW.workstation_code);
  RETURN NEW;
END;
$$;

-- worker_adjustments carries two workstation references.
CREATE OR REPLACE FUNCTION trg_canonicalize_adjustment_ws_codes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.from_workstation_code   := canonical_ws_code(NEW.from_workstation_code);
  NEW.vacant_workstation_code := canonical_ws_code(NEW.vacant_workstation_code);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonicalize_ws_code ON line_plan_workstations;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON line_plan_workstations
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_workstation_code();

DROP TRIGGER IF EXISTS canonicalize_ws_code ON employee_workstation_assignments;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON employee_workstation_assignments
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_workstation_code();

DROP TRIGGER IF EXISTS canonicalize_ws_code ON employee_workstation_assignment_history;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON employee_workstation_assignment_history
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_workstation_code();

DROP TRIGGER IF EXISTS canonicalize_ws_code ON workstation_changeover_events;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON workstation_changeover_events
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_workstation_code();

DROP TRIGGER IF EXISTS canonicalize_ws_code ON line_ot_workstations;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON line_ot_workstations
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_workstation_code();

DROP TRIGGER IF EXISTS canonicalize_ws_code ON worker_departures;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON worker_departures
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_workstation_code();

DROP TRIGGER IF EXISTS canonicalize_ws_code ON material_feed_events;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON material_feed_events
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_workstation_code();

DROP TRIGGER IF EXISTS canonicalize_ws_code ON product_processes;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON product_processes
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_workstation_code();

DROP TRIGGER IF EXISTS canonicalize_ws_code ON worker_adjustments;
CREATE TRIGGER canonicalize_ws_code BEFORE INSERT OR UPDATE ON worker_adjustments
  FOR EACH ROW EXECUTE FUNCTION trg_canonicalize_adjustment_ws_codes();

-- NOTE: line_workstations is intentionally NOT covered. It is the static per-line QR
-- table and uses its own "W01 .. W100" prefix by design (see utils/qr.js); code that
-- crosses between it and the plan tables goes through normalizeWsCode().

COMMIT;
