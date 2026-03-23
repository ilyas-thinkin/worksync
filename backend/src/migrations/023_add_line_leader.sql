-- Migration 023: Add line_leader column to production_lines
ALTER TABLE production_lines ADD COLUMN IF NOT EXISTS line_leader VARCHAR(100);
