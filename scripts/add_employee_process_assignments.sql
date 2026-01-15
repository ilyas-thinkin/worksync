-- Map employees to a single process/work step
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/add_employee_process_assignments.sql

CREATE TABLE IF NOT EXISTS employee_process_assignments (
    id SERIAL PRIMARY KEY,
    process_id INTEGER NOT NULL UNIQUE REFERENCES product_processes(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
