-- Migration 033: Preserve intra-day workstation assignment history for efficiency reporting
CREATE TABLE IF NOT EXISTS employee_workstation_assignment_history (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    workstation_code VARCHAR(100) NOT NULL,
    is_overtime BOOLEAN NOT NULL DEFAULT false,
    effective_from_hour INTEGER NOT NULL,
    effective_to_hour INTEGER,
    linked_at TIMESTAMPTZ,
    attendance_start TIMESTAMPTZ,
    late_reason VARCHAR(30),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (effective_to_hour IS NULL OR effective_to_hour >= effective_from_hour)
);

CREATE INDEX IF NOT EXISTS idx_ewah_emp_date
    ON employee_workstation_assignment_history(employee_id, work_date, is_overtime, effective_from_hour);

CREATE INDEX IF NOT EXISTS idx_ewah_line_date
    ON employee_workstation_assignment_history(line_id, work_date, is_overtime, workstation_code, effective_from_hour);

CREATE INDEX IF NOT EXISTS idx_ewah_active
    ON employee_workstation_assignment_history(work_date, is_overtime, effective_to_hour);

INSERT INTO employee_workstation_assignment_history (
    line_id,
    work_date,
    employee_id,
    workstation_code,
    is_overtime,
    effective_from_hour,
    effective_to_hour,
    linked_at,
    attendance_start,
    late_reason
)
SELECT
    ewa.line_id,
    ewa.work_date,
    ewa.employee_id,
    ewa.workstation_code,
    ewa.is_overtime,
    COALESCE(EXTRACT(HOUR FROM ewa.attendance_start)::int, EXTRACT(HOUR FROM ewa.linked_at)::int, 8),
    NULL,
    ewa.linked_at,
    ewa.attendance_start,
    ewa.late_reason
FROM employee_workstation_assignments ewa
WHERE ewa.employee_id IS NOT NULL
  AND ewa.is_linked = true
  AND NOT EXISTS (
      SELECT 1
      FROM employee_workstation_assignment_history hist
      WHERE hist.employee_id = ewa.employee_id
        AND hist.work_date = ewa.work_date
        AND hist.is_overtime = ewa.is_overtime
  );
