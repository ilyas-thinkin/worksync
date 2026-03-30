-- Migration 023: Fix uq_product_sequence to only enforce uniqueness on ACTIVE rows.
-- Problem: When re-uploading a product plan, old deactivated rows (is_active=false)
--          collide with newly inserted rows that occupy the same sequence numbers.
-- Fix: Drop the full unique constraint; replace with a partial unique index
--      scoped to is_active = true rows only.
--      Deactivated rows can hold any sequence number without violating uniqueness.

-- Drop the existing full unique constraint
ALTER TABLE product_processes DROP CONSTRAINT IF EXISTS uq_product_sequence;

-- Re-create as a partial unique index (active rows only)
CREATE UNIQUE INDEX uq_product_sequence
    ON product_processes (product_id, sequence_number)
    WHERE is_active = true;
