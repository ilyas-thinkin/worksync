-- Sync production_lines.current_product_id from products.line_id (one-time migration)
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/sync_lines_from_product_assignments.sql

UPDATE production_lines pl
SET current_product_id = p.id
FROM products p
WHERE p.line_id = pl.id;
