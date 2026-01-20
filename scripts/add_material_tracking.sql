-- Material Tracking Tables for WorkSync
-- Run this script to add material tracking functionality

-- Material transactions table - tracks all material movements
CREATE TABLE IF NOT EXISTS material_transactions (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    transaction_type VARCHAR(50) NOT NULL, -- 'issued', 'used', 'returned', 'forwarded', 'received'
    quantity INTEGER NOT NULL,
    from_process_id INTEGER REFERENCES product_processes(id) ON DELETE SET NULL,
    to_process_id INTEGER REFERENCES product_processes(id) ON DELETE SET NULL,
    notes TEXT,
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for material_transactions
CREATE INDEX IF NOT EXISTS idx_material_transactions_line ON material_transactions(line_id);
CREATE INDEX IF NOT EXISTS idx_material_transactions_date ON material_transactions(work_date);
CREATE INDEX IF NOT EXISTS idx_material_transactions_type ON material_transactions(transaction_type);

-- Material stock per line per day (running balance)
CREATE TABLE IF NOT EXISTS line_material_stock (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    opening_stock INTEGER NOT NULL DEFAULT 0,
    total_issued INTEGER NOT NULL DEFAULT 0,
    total_used INTEGER NOT NULL DEFAULT 0,
    total_returned INTEGER NOT NULL DEFAULT 0,
    closing_stock INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_line_material_stock UNIQUE (line_id, work_date)
);

-- Indexes for line_material_stock
CREATE INDEX IF NOT EXISTS idx_line_material_stock_date ON line_material_stock(work_date);

-- Process-level material tracking (WIP at each stage)
CREATE TABLE IF NOT EXISTS process_material_wip (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    process_id INTEGER NOT NULL REFERENCES product_processes(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    materials_in INTEGER NOT NULL DEFAULT 0,
    materials_out INTEGER NOT NULL DEFAULT 0,
    wip_quantity INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_process_material_wip UNIQUE (line_id, process_id, work_date)
);

-- Indexes for process_material_wip
CREATE INDEX IF NOT EXISTS idx_process_material_wip_line ON process_material_wip(line_id);
CREATE INDEX IF NOT EXISTS idx_process_material_wip_date ON process_material_wip(work_date);

-- Add audit trigger for material transactions
CREATE OR REPLACE FUNCTION log_material_transaction()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('worksync_changes', json_build_object(
        'table', TG_TABLE_NAME,
        'action', TG_OP,
        'id', NEW.id,
        'line_id', NEW.line_id,
        'work_date', NEW.work_date
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS material_transaction_notify ON material_transactions;
CREATE TRIGGER material_transaction_notify
AFTER INSERT OR UPDATE ON material_transactions
FOR EACH ROW EXECUTE FUNCTION log_material_transaction();

-- View for daily material summary by line
CREATE OR REPLACE VIEW v_daily_material_summary AS
SELECT
    line_id,
    work_date,
    COALESCE(SUM(CASE WHEN transaction_type = 'issued' THEN quantity ELSE 0 END), 0) as total_issued,
    COALESCE(SUM(CASE WHEN transaction_type = 'used' THEN quantity ELSE 0 END), 0) as total_used,
    COALESCE(SUM(CASE WHEN transaction_type = 'returned' THEN quantity ELSE 0 END), 0) as total_returned,
    COALESCE(SUM(CASE WHEN transaction_type = 'forwarded' THEN quantity ELSE 0 END), 0) as total_forwarded,
    COALESCE(SUM(CASE WHEN transaction_type = 'received' THEN quantity ELSE 0 END), 0) as total_received
FROM material_transactions
GROUP BY line_id, work_date;

COMMENT ON TABLE material_transactions IS 'Tracks all material movements in the production line';
COMMENT ON TABLE line_material_stock IS 'Daily material stock balance per line';
COMMENT ON TABLE process_material_wip IS 'Work-in-progress materials at each process step';
