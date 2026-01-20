ALTER TABLE line_process_hourly_progress
    ADD COLUMN IF NOT EXISTS forwarded_quantity integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remaining_quantity integer NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'line_process_hourly_progress_forwarded_check'
    ) THEN
        ALTER TABLE line_process_hourly_progress
            ADD CONSTRAINT line_process_hourly_progress_forwarded_check CHECK (forwarded_quantity >= 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'line_process_hourly_progress_remaining_check'
    ) THEN
        ALTER TABLE line_process_hourly_progress
            ADD CONSTRAINT line_process_hourly_progress_remaining_check CHECK (remaining_quantity >= 0);
    END IF;
END $$;

ALTER TABLE line_daily_plans
    ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS line_shift_closures (
    id serial PRIMARY KEY,
    line_id integer NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date date NOT NULL,
    closed_by integer REFERENCES users(id) ON DELETE SET NULL,
    closed_at timestamp DEFAULT CURRENT_TIMESTAMP,
    notes text,
    UNIQUE (line_id, work_date)
);
