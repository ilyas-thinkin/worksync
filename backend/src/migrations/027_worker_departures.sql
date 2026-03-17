-- Migration 027: Worker departure tracking
CREATE TABLE IF NOT EXISTS worker_departures (
    id               SERIAL PRIMARY KEY,
    line_id          INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date        DATE NOT NULL,
    employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    workstation_code VARCHAR(100) NOT NULL,
    departure_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    departure_reason VARCHAR(20) NOT NULL
                     CHECK (departure_reason IN ('sick','personal','operational','other')),
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wd_line_date ON worker_departures(line_id, work_date);
CREATE INDEX IF NOT EXISTS idx_wd_employee_date ON worker_departures(employee_id, work_date);

-- Prevent duplicate departure for same employee+workstation+date on same line
CREATE UNIQUE INDEX IF NOT EXISTS idx_wd_line_date_ws_emp
    ON worker_departures(line_id, work_date, workstation_code, employee_id);
