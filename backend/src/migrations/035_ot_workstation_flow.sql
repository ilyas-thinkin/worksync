-- Migration 035: OT workstation flow metadata and WIP snapshots
-- Stores the shift-end source state for OT and keeps OT WIP snapshots
-- separate from regular-shift WIP while still allowing combined-flow views.

ALTER TABLE line_ot_workstations
    ADD COLUMN IF NOT EXISTS source_line_plan_workstation_id INTEGER,
    ADD COLUMN IF NOT EXISTS source_product_id INTEGER REFERENCES products(id),
    ADD COLUMN IF NOT EXISTS source_mode VARCHAR(20) NOT NULL DEFAULT 'primary',
    ADD COLUMN IF NOT EXISTS source_hourly_target NUMERIC(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS regular_shift_output_quantity INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS regular_shift_wip_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE line_ot_progress
    ADD COLUMN IF NOT EXISTS opening_wip_quantity INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ot_target_units INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS balance_quantity INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS closing_wip_quantity INTEGER NOT NULL DEFAULT 0;
