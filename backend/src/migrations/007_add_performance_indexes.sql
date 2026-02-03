-- Migration: Add Performance Indexes
-- Date: 2026-02-03
-- Purpose: Optimize query performance for common access patterns

-- =====================================================
-- HOURLY PROGRESS TABLE INDEXES
-- =====================================================
-- Index for date-based queries (daily reports, dashboards)
CREATE INDEX IF NOT EXISTS idx_hourly_progress_work_date
ON line_process_hourly_progress(work_date);

-- Index for line + date queries (common supervisor view)
CREATE INDEX IF NOT EXISTS idx_hourly_progress_line_date
ON line_process_hourly_progress(line_id, work_date);

-- Index for employee performance queries
CREATE INDEX IF NOT EXISTS idx_hourly_progress_employee
ON line_process_hourly_progress(employee_id) WHERE employee_id IS NOT NULL;

-- =====================================================
-- EMPLOYEE ATTENDANCE INDEXES
-- =====================================================
-- Index for date-based attendance queries
CREATE INDEX IF NOT EXISTS idx_attendance_date
ON employee_attendance(attendance_date);

-- Index for status filtering (present, absent, late)
CREATE INDEX IF NOT EXISTS idx_attendance_status
ON employee_attendance(status);

-- =====================================================
-- ASSIGNMENT HISTORY INDEXES
-- =====================================================
-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_assignment_history_start_time
ON process_assignment_history(start_time);

-- Index for employee-based history queries
CREATE INDEX IF NOT EXISTS idx_assignment_history_employee
ON process_assignment_history(employee_id);

-- Index for open assignments (no end_time)
CREATE INDEX IF NOT EXISTS idx_assignment_history_open
ON process_assignment_history(line_id, process_id) WHERE end_time IS NULL;

-- =====================================================
-- LINE DAILY PLANS INDEXES
-- =====================================================
-- Index for product + date queries
CREATE INDEX IF NOT EXISTS idx_line_daily_plans_product_date
ON line_daily_plans(product_id, work_date);

-- =====================================================
-- LINE DAILY METRICS INDEXES
-- =====================================================
-- Index for line + date queries
CREATE INDEX IF NOT EXISTS idx_line_daily_metrics_line_date
ON line_daily_metrics(line_id, work_date);

-- =====================================================
-- MATERIAL TRANSACTIONS INDEXES
-- =====================================================
-- Index for line + date + type (common query pattern)
CREATE INDEX IF NOT EXISTS idx_material_tx_line_date_type
ON material_transactions(line_id, work_date, transaction_type);

-- =====================================================
-- PRODUCTION DAY LOCKS INDEXES
-- =====================================================
-- Index for work_date lookups (table existence = locked)
CREATE INDEX IF NOT EXISTS idx_day_locks_date
ON production_day_locks(work_date);

-- =====================================================
-- LINE SHIFT CLOSURES INDEXES
-- =====================================================
-- Index for finding closed shifts by date
CREATE INDEX IF NOT EXISTS idx_shift_closures_date
ON line_shift_closures(work_date);

-- =====================================================
-- PROCESS MATERIAL WIP INDEXES
-- =====================================================
-- Index for line + process + date queries
CREATE INDEX IF NOT EXISTS idx_process_wip_line_process_date
ON process_material_wip(line_id, process_id, work_date);

-- =====================================================
-- AUDIT LOGS INDEXES (for reporting)
-- =====================================================
-- Index for user action tracking
CREATE INDEX IF NOT EXISTS idx_audit_logs_user
ON audit_logs(changed_by);

-- Index for table-specific queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_table
ON audit_logs(table_name);

-- =====================================================
-- ANALYZE TABLES for query planner
-- =====================================================
ANALYZE line_process_hourly_progress;
ANALYZE employee_attendance;
ANALYZE process_assignment_history;
ANALYZE line_daily_plans;
ANALYZE line_daily_metrics;
ANALYZE material_transactions;
ANALYZE production_day_locks;
ANALYZE line_shift_closures;
ANALYZE process_material_wip;
ANALYZE audit_logs;
