ALTER TABLE line_daily_metrics
    ADD COLUMN IF NOT EXISTS qa_output integer NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'line_daily_metrics_qa_check'
    ) THEN
        ALTER TABLE line_daily_metrics
            ADD CONSTRAINT line_daily_metrics_qa_check CHECK (qa_output >= 0);
    END IF;
END $$;
