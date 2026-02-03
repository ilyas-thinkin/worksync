-- Migration: Enhanced Audit Logging
-- Date: 2026-02-03
-- Purpose: Add additional context to audit logs

-- Add new columns to audit_logs
ALTER TABLE audit_logs
ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50),
ADD COLUMN IF NOT EXISTS user_agent TEXT,
ADD COLUMN IF NOT EXISTS session_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS request_path VARCHAR(255),
ADD COLUMN IF NOT EXISTS http_method VARCHAR(10);

-- Create index for IP-based queries (security analysis)
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip
ON audit_logs(ip_address) WHERE ip_address IS NOT NULL;

-- Create index for session tracking
CREATE INDEX IF NOT EXISTS idx_audit_logs_session
ON audit_logs(session_id) WHERE session_id IS NOT NULL;

-- Create a summary view for quick dashboard stats
CREATE OR REPLACE VIEW v_audit_summary AS
SELECT
    DATE(changed_at) as audit_date,
    table_name,
    action,
    COUNT(*) as action_count,
    COUNT(DISTINCT changed_by) as unique_users
FROM audit_logs
WHERE changed_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(changed_at), table_name, action
ORDER BY audit_date DESC, table_name, action;

-- Create a view for recent critical changes
CREATE OR REPLACE VIEW v_recent_critical_changes AS
SELECT
    al.id,
    al.table_name,
    al.record_id,
    al.action,
    al.changed_at,
    al.ip_address,
    u.username as changed_by_user,
    al.old_values,
    al.new_values,
    al.reason
FROM audit_logs al
LEFT JOIN users u ON al.changed_by = u.id
WHERE al.table_name IN ('users', 'production_lines', 'products', 'employees')
  AND al.action IN ('delete', 'update')
  AND al.changed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
ORDER BY al.changed_at DESC
LIMIT 100;

-- Analyze table for query optimization
ANALYZE audit_logs;
