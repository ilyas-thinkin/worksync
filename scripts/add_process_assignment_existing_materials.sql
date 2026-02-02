ALTER TABLE process_assignment_history
    ADD COLUMN IF NOT EXISTS existing_materials integer NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'process_assignment_history_existing_materials_check'
    ) THEN
        ALTER TABLE process_assignment_history
            ADD CONSTRAINT process_assignment_history_existing_materials_check CHECK (existing_materials >= 0);
    END IF;
END $$;
