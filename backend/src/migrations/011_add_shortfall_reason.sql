-- Add shortfall reason to hourly progress for Line Leader workflow
-- When hourly output is below target, line leader must provide a reason
ALTER TABLE line_process_hourly_progress ADD COLUMN IF NOT EXISTS shortfall_reason VARCHAR(100);
