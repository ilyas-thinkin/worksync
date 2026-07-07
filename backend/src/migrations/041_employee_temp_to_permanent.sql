-- Employee lifecycle: temporary -> permanent
-- See docs/employee-temp-to-permanent-spec.md
-- Default 'permanent' so all existing employees are unaffected and require no backfill.

ALTER TABLE employees
  ADD COLUMN employment_status VARCHAR(20) NOT NULL DEFAULT 'permanent'
    CHECK (employment_status IN ('temporary','permanent')),
  ADD COLUMN permanent_from DATE;

CREATE TABLE employee_code_history (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  old_emp_code  VARCHAR(50) NOT NULL,
  new_emp_code  VARCHAR(50) NOT NULL,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by    INTEGER
);

CREATE INDEX idx_employee_code_history_employee ON employee_code_history(employee_id);
