-- Add QR code path columns for lines and process steps
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/add_qr_columns.sql

ALTER TABLE production_lines
ADD COLUMN IF NOT EXISTS qr_code_path VARCHAR(255);

ALTER TABLE product_processes
ADD COLUMN IF NOT EXISTS qr_code_path VARCHAR(255);
