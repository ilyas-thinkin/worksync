-- Migration 029: Persist OSM checked state at product_processes level
-- OSM selections should be fixed per product, not per day/plan

ALTER TABLE product_processes
    ADD COLUMN IF NOT EXISTS osm_checked BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: mark a product_process as osm_checked if any existing lpwp has it checked
UPDATE product_processes pp
SET osm_checked = true
WHERE EXISTS (
    SELECT 1 FROM line_plan_workstation_processes lpwp
    WHERE lpwp.product_process_id = pp.id AND lpwp.osm_checked = true
);
