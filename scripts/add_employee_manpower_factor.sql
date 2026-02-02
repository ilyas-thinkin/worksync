ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS manpower_factor numeric NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'employees_manpower_factor_check'
    ) THEN
        ALTER TABLE employees
            ADD CONSTRAINT employees_manpower_factor_check CHECK (manpower_factor > 0);
    END IF;
END $$;
