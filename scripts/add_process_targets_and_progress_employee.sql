ALTER TABLE product_processes
    ADD COLUMN IF NOT EXISTS target_units integer NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_target_units_nonnegative'
    ) THEN
        ALTER TABLE product_processes
            ADD CONSTRAINT chk_target_units_nonnegative CHECK (target_units >= 0);
    END IF;
END $$;

ALTER TABLE line_process_hourly_progress
    ADD COLUMN IF NOT EXISTS employee_id integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'line_process_hourly_progress_employee_id_fkey'
    ) THEN
        ALTER TABLE line_process_hourly_progress
            ADD CONSTRAINT line_process_hourly_progress_employee_id_fkey
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
    END IF;
END $$;

ALTER TABLE line_process_hourly_progress
    DROP CONSTRAINT IF EXISTS line_process_hourly_progress_hour_slot_check;

ALTER TABLE line_process_hourly_progress
    ADD CONSTRAINT line_process_hourly_progress_hour_slot_check CHECK (hour_slot >= 8 AND hour_slot <= 19);

UPDATE line_process_hourly_progress l
SET employee_id = a.employee_id
FROM employee_process_assignments a
WHERE l.employee_id IS NULL
  AND a.line_id = l.line_id
  AND a.process_id = l.process_id;
