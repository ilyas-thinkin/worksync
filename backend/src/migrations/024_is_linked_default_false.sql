-- Change is_linked default to false so assignments never auto-link employees.
-- Linking is done exclusively by the supervisor each morning.
ALTER TABLE employee_workstation_assignments ALTER COLUMN is_linked SET DEFAULT false;

-- Reset any current-day links so supervisor re-links today
UPDATE employee_workstation_assignments SET is_linked = false WHERE work_date = CURRENT_DATE;
