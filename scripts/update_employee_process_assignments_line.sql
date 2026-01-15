-- Add line_id to employee_process_assignments and relax process uniqueness
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/update_employee_process_assignments_line.sql

ALTER TABLE employee_process_assignments
ADD COLUMN IF NOT EXISTS line_id INTEGER;

UPDATE employee_process_assignments a
SET line_id = e.default_line_id
FROM employees e
WHERE a.employee_id = e.id AND a.line_id IS NULL;

ALTER TABLE employee_process_assignments
DROP CONSTRAINT IF EXISTS employee_process_assignments_process_id_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'employee_process_assignments_line_process_key'
    ) THEN
        ALTER TABLE employee_process_assignments
        ADD CONSTRAINT employee_process_assignments_line_process_key UNIQUE (line_id, process_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'employee_process_assignments_line_id_fkey'
    ) THEN
        ALTER TABLE employee_process_assignments
        ADD CONSTRAINT employee_process_assignments_line_id_fkey
        FOREIGN KEY (line_id) REFERENCES production_lines(id) ON DELETE SET NULL;
    END IF;
END $$;
