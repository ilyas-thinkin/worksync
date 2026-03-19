-- Migration 024: Group-level WIP tracking
-- WIP is tracked per workstation group (or per workstation if ungrouped).
-- materials_in  = feed input entered at the first workstation of the group
-- output_qty    = sum of hourly output for all workstations in the group
-- wip_quantity  = materials_in - output_qty

CREATE TABLE IF NOT EXISTS group_wip (
    id            SERIAL PRIMARY KEY,
    line_id       INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date     DATE NOT NULL,
    group_name    VARCHAR(100) NOT NULL,   -- group_name value, or workstation_code for ungrouped
    materials_in  INTEGER NOT NULL DEFAULT 0,
    output_qty    INTEGER NOT NULL DEFAULT 0,
    wip_quantity  INTEGER NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (line_id, work_date, group_name)
);

CREATE INDEX IF NOT EXISTS idx_group_wip_line_date ON group_wip (line_id, work_date);
