-- Migration 024: OSM observation point checkbox per workstation process
-- Allows IE/Admin to mark specific processes as OSM measurement points.
-- Checked processes appear in the OSM report in their sequence order:
-- first checked process = OSM1, second = OSM2, etc.
-- Only checked processes are shown in the OSM report.

ALTER TABLE line_plan_workstation_processes
    ADD COLUMN IF NOT EXISTS osm_checked BOOLEAN NOT NULL DEFAULT FALSE;
