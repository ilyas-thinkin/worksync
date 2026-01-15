-- Add line/product linking and line metrics
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/add_line_product_fields.sql

ALTER TABLE products
ADD COLUMN IF NOT EXISTS line_id INTEGER;

ALTER TABLE production_lines
ADD COLUMN IF NOT EXISTS current_product_id INTEGER,
ADD COLUMN IF NOT EXISTS target_units INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS efficiency NUMERIC(5,2) NOT NULL DEFAULT 0;

UPDATE production_lines
SET target_units = 0
WHERE target_units IS NULL;

UPDATE production_lines
SET efficiency = 0
WHERE efficiency IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_line'
    ) THEN
        ALTER TABLE products
        ADD CONSTRAINT fk_products_line
        FOREIGN KEY (line_id) REFERENCES production_lines(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_lines_current_product'
    ) THEN
        ALTER TABLE production_lines
        ADD CONSTRAINT fk_lines_current_product
        FOREIGN KEY (current_product_id) REFERENCES products(id);
    END IF;
END $$;
