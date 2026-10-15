-- 052: overtime output per OT hour.
-- line_ot_progress holds one quantity per OT workstation per date, so OT could not be read hour by
-- hour. Each OT hour now gets its own row here; hour_slot is the clock hour the OT hour starts at
-- (17 = 17:00-18:00 with the usual 17:00 out time). line_ot_progress stays as the day total
-- (quantity = SUM of these rows) so readers of the day figure keep working. A workstation with a
-- line_ot_progress row and no rows here is an older whole-day entry that cannot be split by hour.
CREATE TABLE IF NOT EXISTS line_ot_hourly_progress (
    id                SERIAL PRIMARY KEY,
    line_id           INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    ot_workstation_id INTEGER NOT NULL REFERENCES line_ot_workstations(id) ON DELETE CASCADE,
    work_date         DATE NOT NULL,
    hour_slot         INTEGER NOT NULL CHECK (hour_slot BETWEEN 0 AND 23),
    quantity          INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    qa_rejection      INTEGER NOT NULL DEFAULT 0,
    remarks           TEXT,
    employee_id       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (ot_workstation_id, work_date, hour_slot)
);

CREATE INDEX IF NOT EXISTS idx_line_ot_hourly_progress_line_date
    ON line_ot_hourly_progress (line_id, work_date);
