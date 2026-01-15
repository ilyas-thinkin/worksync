-- Add efficiency column for employees (default 0)
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS efficiency NUMERIC(5,2) NOT NULL DEFAULT 0;

UPDATE employees
SET efficiency = 0
WHERE efficiency IS NULL;
