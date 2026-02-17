-- Employee-to-Workstation assignments (replaces per-process assignments)
-- One employee per workstation per line, handling all processes at that workstation
CREATE TABLE IF NOT EXISTS employee_workstation_assignments (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    workstation_code VARCHAR(100) NOT NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(line_id, workstation_code)
);

CREATE INDEX IF NOT EXISTS idx_ewa_line ON employee_workstation_assignments(line_id);
CREATE INDEX IF NOT EXISTS idx_ewa_employee ON employee_workstation_assignments(employee_id);
