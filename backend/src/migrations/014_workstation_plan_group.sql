-- Add optional group name to line plan workstations
-- Groups allow organizing workstations visually on the shop floor (e.g., Group 1, Group 2)
ALTER TABLE line_plan_workstations
    ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_lpw_group ON line_plan_workstations(line_id, work_date, group_name);
