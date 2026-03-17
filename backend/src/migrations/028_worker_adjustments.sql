-- Migration 028: Worker adjustment tracking (response to departures)
CREATE TABLE IF NOT EXISTS worker_adjustments (
    id                      SERIAL PRIMARY KEY,
    line_id                 INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date               DATE NOT NULL,
    departure_id            INTEGER NOT NULL REFERENCES worker_departures(id) ON DELETE CASCADE,
    vacant_workstation_code VARCHAR(100) NOT NULL,
    from_employee_id        INTEGER NOT NULL REFERENCES employees(id),  -- receiving worker
    from_workstation_code   VARCHAR(100) NOT NULL,                      -- receiver's original WS
    adjustment_type         VARCHAR(10) NOT NULL CHECK (adjustment_type IN ('assign','combine')),
    reassignment_time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_line_date ON worker_adjustments(line_id, work_date);
CREATE INDEX IF NOT EXISTS idx_wa_departure  ON worker_adjustments(departure_id);

-- One adjustment per departure
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_departure_unique ON worker_adjustments(departure_id);
