-- Migration 036: Preserve explicit daily-plan deletions from carry-forward recreation

CREATE TABLE IF NOT EXISTS line_daily_plan_delete_markers (
    line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deleted_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (line_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_line_daily_plan_delete_markers_work_date
    ON line_daily_plan_delete_markers(work_date);
