-- Migration 038: Track explicit feed entries separately from carried-forward WIP
CREATE TABLE IF NOT EXISTS material_feed_events (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    group_name VARCHAR(100) NOT NULL,
    workstation_code VARCHAR(100) NOT NULL,
    feed_quantity INTEGER NOT NULL,
    exceeds_order_quantity BOOLEAN NOT NULL DEFAULT false,
    override_reason TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT material_feed_events_quantity_nonneg CHECK (feed_quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_material_feed_events_product
    ON material_feed_events(product_id, work_date);

CREATE INDEX IF NOT EXISTS idx_material_feed_events_line_date
    ON material_feed_events(line_id, work_date);
