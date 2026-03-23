-- Migration 024: Add plan_month to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS plan_month VARCHAR(7);
COMMENT ON COLUMN products.plan_month IS 'Planned production month, format YYYY-MM e.g. 2026-03';
