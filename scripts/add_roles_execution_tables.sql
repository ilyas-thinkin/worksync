CREATE TABLE IF NOT EXISTS users (
    id serial PRIMARY KEY,
    username varchar(50) UNIQUE NOT NULL,
    full_name varchar(100) NOT NULL,
    role varchar(20) NOT NULL CHECK (role IN ('admin', 'ie', 'supervisor')),
    is_active boolean DEFAULT true,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_day_locks (
    work_date date PRIMARY KEY,
    locked_by integer REFERENCES users(id) ON DELETE SET NULL,
    locked_at timestamp DEFAULT CURRENT_TIMESTAMP,
    notes text
);

CREATE TABLE IF NOT EXISTS line_daily_plans (
    id serial PRIMARY KEY,
    line_id integer NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    product_id integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    work_date date NOT NULL,
    target_units integer NOT NULL DEFAULT 0,
    created_by integer REFERENCES users(id) ON DELETE SET NULL,
    updated_by integer REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (line_id, work_date)
);

CREATE TABLE IF NOT EXISTS line_daily_metrics (
    id serial PRIMARY KEY,
    line_id integer NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date date NOT NULL,
    forwarded_quantity integer NOT NULL DEFAULT 0,
    remaining_wip integer NOT NULL DEFAULT 0,
    materials_issued integer NOT NULL DEFAULT 0,
    updated_by integer REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (line_id, work_date)
);

CREATE TABLE IF NOT EXISTS process_assignment_history (
    id serial PRIMARY KEY,
    line_id integer NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    process_id integer NOT NULL REFERENCES product_processes(id) ON DELETE CASCADE,
    employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_time timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time timestamp,
    quantity_completed integer NOT NULL DEFAULT 0,
    changed_by integer REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_line_daily_plans_date ON line_daily_plans(work_date);
CREATE INDEX IF NOT EXISTS idx_line_daily_plans_line ON line_daily_plans(line_id);
CREATE INDEX IF NOT EXISTS idx_line_daily_metrics_date ON line_daily_metrics(work_date);
CREATE INDEX IF NOT EXISTS idx_assignment_history_line_process ON process_assignment_history(line_id, process_id);
