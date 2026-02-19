-- Migration 015: Static line workstations with QR codes (W01–W100 per line)
CREATE TABLE IF NOT EXISTS line_workstations (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    workstation_number INTEGER NOT NULL CHECK (workstation_number BETWEEN 1 AND 100),
    workstation_code VARCHAR(10) NOT NULL,
    qr_code_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(line_id, workstation_code)
);

CREATE INDEX IF NOT EXISTS idx_line_workstations_line ON line_workstations(line_id);
