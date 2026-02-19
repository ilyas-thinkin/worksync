-- Migration 017: Allow separate workstation plans per product on the same line+date.
-- Previously the unique constraint was (line_id, work_date, workstation_number), which
-- prevented having both a primary product plan and a changeover product plan on the same
-- line and date. This migration adds product_id to the constraint so each product can
-- have its own independent workstation layout on any line+date.

ALTER TABLE line_plan_workstations
    DROP CONSTRAINT IF EXISTS line_plan_workstations_line_id_work_date_workstation_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lpw_line_date_product_ws
    ON line_plan_workstations(line_id, work_date, product_id, workstation_number);
