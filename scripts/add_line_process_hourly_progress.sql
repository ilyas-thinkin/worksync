-- Hourly progress per line/process
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/add_line_process_hourly_progress.sql

CREATE TABLE IF NOT EXISTS line_process_hourly_progress (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    process_id INTEGER NOT NULL REFERENCES product_processes(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    hour_slot INTEGER NOT NULL CHECK (hour_slot >= 0 AND hour_slot <= 23),
    quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_line_process_hour UNIQUE (line_id, process_id, work_date, hour_slot)
);
