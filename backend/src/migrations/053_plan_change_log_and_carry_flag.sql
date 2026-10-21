-- 053: plan change log + "copied, not confirmed" flag on daily plans.
--
-- plan_change_log: one row per plan-changing request (Excel upload, on-screen plan save, plan copy)
-- and per automatic overnight copy. Uploads were not logged anywhere before, so the 2026-10-21
-- Vimala/Rumiya story had to be pieced together from deleted plan rows. There are no per-person
-- accounts, so "who" is the signed-in role plus the device (IP, browser).
--
-- line_daily_plans.carried_forward_from: set when the system copied this plan (with employees)
-- from an earlier date because nobody had planned the day yet. Cleared as soon as the IE saves,
-- uploads or copies a plan for that line/date. While set, screens show "copied, not confirmed".
-- Existing rows stay NULL, so plans that already exist are never flagged retroactively.

CREATE TABLE IF NOT EXISTS plan_change_log (
    id                 SERIAL PRIMARY KEY,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event              VARCHAR(30) NOT NULL,          -- excel_upload | plan_save | plan_copy | carry_forward
    outcome            VARCHAR(30) NOT NULL,          -- success | needs_confirmation | blocked | error
    outcome_code       VARCHAR(60),                   -- e.g. SHARED_PROCESSES_IN_USE, LINE_EXISTS
    line_id            INTEGER,
    line_code          VARCHAR(100),
    work_date          DATE,
    product_id         INTEGER,
    product_code       VARCHAR(100),
    product_mode       VARCHAR(20),                   -- primary | changeover
    file_name          TEXT,
    file_size          INTEGER,
    file_sha256        VARCHAR(64),
    file_saved_path    TEXT,
    role               VARCHAR(30),
    ip_address         VARCHAR(100),
    user_agent         TEXT,
    workstations       INTEGER,
    processes          INTEGER,
    employees_assigned INTEGER,
    confirmations      JSONB,                         -- the confirm_* / override choices the user sent
    details            JSONB,
    error              TEXT
);

CREATE INDEX IF NOT EXISTS idx_plan_change_log_date_line ON plan_change_log (work_date, line_id);
CREATE INDEX IF NOT EXISTS idx_plan_change_log_created ON plan_change_log (created_at);

ALTER TABLE line_daily_plans ADD COLUMN IF NOT EXISTS carried_forward_from DATE;
ALTER TABLE line_daily_plans ADD COLUMN IF NOT EXISTS carried_forward_at TIMESTAMPTZ;
