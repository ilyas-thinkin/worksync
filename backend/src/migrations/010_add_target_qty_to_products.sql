-- Add product-level manufacturing target (total qty to manufacture for this product)
-- This is different from line_daily_plans.target_units which is daily line target
ALTER TABLE products ADD COLUMN IF NOT EXISTS target_qty INTEGER NOT NULL DEFAULT 0;

-- Add index for quick lookup
CREATE INDEX IF NOT EXISTS idx_products_target_qty ON products(target_qty);
