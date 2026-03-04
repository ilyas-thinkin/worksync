-- Migration 022: OT progress tracking table
-- Stores actual output entered by supervisor per OT workstation per date

CREATE TABLE IF NOT EXISTS line_ot_progress (
    id                SERIAL PRIMARY KEY,
    line_id           INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    ot_workstation_id INTEGER NOT NULL REFERENCES line_ot_workstations(id) ON DELETE CASCADE,
    work_date         DATE NOT NULL,
    quantity          INTEGER NOT NULL DEFAULT 0,
    qa_rejection      INTEGER NOT NULL DEFAULT 0,
    remarks           TEXT,
    employee_id       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ot_workstation_id, work_date)
);
