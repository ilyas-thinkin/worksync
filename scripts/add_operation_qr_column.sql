-- Add QR code path column for operations
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/add_operation_qr_column.sql

ALTER TABLE operations
ADD COLUMN IF NOT EXISTS qr_code_path VARCHAR(255);
