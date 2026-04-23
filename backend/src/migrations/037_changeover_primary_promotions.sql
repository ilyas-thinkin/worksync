-- Migration 037: Archive previous primary state when changeover is promoted to primary

CREATE TABLE IF NOT EXISTS changeover_primary_promotions (
    id SERIAL PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    previous_primary_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    new_primary_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    previous_primary_target_units INTEGER NOT NULL DEFAULT 0,
    new_primary_target_units INTEGER NOT NULL DEFAULT 0,
    promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT changeover_primary_promotions_prev_target_nonneg CHECK (previous_primary_target_units >= 0),
    CONSTRAINT changeover_primary_promotions_new_target_nonneg CHECK (new_primary_target_units >= 0),
    CONSTRAINT changeover_primary_promotions_line_date_unique UNIQUE (line_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_changeover_primary_promotions_line_date
    ON changeover_primary_promotions(line_id, work_date);
