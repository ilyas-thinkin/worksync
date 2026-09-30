-- 051: a second supervisor photo per line.
-- A line run by two supervisors keeps both names in line_leader ("RUMIYA / HASEENA", read as-is by
-- reports, the Excel upload and every badge); this holds the second person's portrait, in the same
-- /uploads/line-leaders directory as line_leader_photo. NULL for the usual single-supervisor line.
ALTER TABLE production_lines ADD COLUMN IF NOT EXISTS line_leader_photo_2 TEXT;
