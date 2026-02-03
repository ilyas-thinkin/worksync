/**
 * WorkSync Enhanced Audit Logging Middleware
 * Provides comprehensive audit trail for all data changes
 */

const pool = require('../config/db.config');

/**
 * Get client IP address from request
 * Handles proxied requests (X-Forwarded-For)
 */
function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip ||
           'unknown';
}

/**
 * Get user agent from request
 */
function getUserAgent(req) {
    return req.headers['user-agent'] || 'unknown';
}

/**
 * Get session ID from request
 */
function getSessionId(req) {
    return req.cookies?.sessionId ||
           req.headers['x-session-id'] ||
           null;
}

/**
 * Enhanced audit logging function
 * @param {Object} params - Audit parameters
 */
async function logAudit({
    tableName,
    recordId,
    action,
    newValues = null,
    oldValues = null,
    changedBy = null,
    reason = null,
    req = null
}) {
    try {
        const ipAddress = req ? getClientIP(req) : null;
        const userAgent = req ? getUserAgent(req) : null;
        const sessionId = req ? getSessionId(req) : null;
        const requestPath = req ? req.originalUrl : null;
        const httpMethod = req ? req.method : null;

        await pool.query(
            `INSERT INTO audit_logs
             (table_name, record_id, action, old_values, new_values, changed_by, reason,
              ip_address, user_agent, session_id, request_path, http_method)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                tableName,
                recordId,
                action,
                oldValues ? JSON.stringify(oldValues) : null,
                newValues ? JSON.stringify(newValues) : null,
                changedBy,
                reason,
                ipAddress,
                userAgent ? userAgent.substring(0, 500) : null, // Limit length
                sessionId,
                requestPath,
                httpMethod
            ]
        );
    } catch (err) {
        // Log to console but don't block main operation
        console.error('Audit log error:', err.message);
    }
}

/**
 * Audit action types
 */
const AuditAction = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LOGIN: 'login',
    LOGOUT: 'logout',
    VIEW: 'view',
    EXPORT: 'export',
    LOCK: 'lock',
    UNLOCK: 'unlock',
    ASSIGN: 'assign',
    UNASSIGN: 'unassign'
};

/**
 * Create audit middleware for specific route
 * @param {string} tableName - Table being modified
 * @param {string} action - Action type
 * @param {Function} getRecordId - Function to extract record ID from req
 * @param {Function} getBeforeData - Function to get data before change (optional)
 */
function auditMiddleware(tableName, action, getRecordId, getBeforeData = null) {
    return async (req, res, next) => {
        // Store original json method
        const originalJson = res.json.bind(res);

        // Get data before change if needed
        let beforeData = null;
        if (getBeforeData && (action === AuditAction.UPDATE || action === AuditAction.DELETE)) {
            try {
                beforeData = await getBeforeData(req);
            } catch (err) {
                console.error('Error getting before data for audit:', err.message);
            }
        }

        // Override json method to capture response
        res.json = async function(data) {
            // Only log successful operations
            if (res.statusCode < 400 && data?.success !== false) {
                try {
                    const recordId = getRecordId(req, data);
                    const newValues = action !== AuditAction.DELETE ? (data?.data || req.body) : null;
                    const userId = req.user?.id || null;

                    await logAudit({
                        tableName,
                        recordId: recordId || 0,
                        action,
                        newValues,
                        oldValues: beforeData,
                        changedBy: userId,
                        req
                    });
                } catch (err) {
                    console.error('Audit middleware error:', err.message);
                }
            }

            // Call original json method
            return originalJson(data);
        };

        next();
    };
}

/**
 * Get recent audit logs for a specific table/record
 */
async function getAuditHistory(tableName, recordId, limit = 50) {
    const result = await pool.query(
        `SELECT
            al.*,
            u.username as changed_by_name
         FROM audit_logs al
         LEFT JOIN users u ON al.changed_by = u.id
         WHERE al.table_name = $1 AND al.record_id = $2
         ORDER BY al.changed_at DESC
         LIMIT $3`,
        [tableName, recordId, limit]
    );
    return result.rows;
}

/**
 * Get audit summary for dashboard
 */
async function getAuditSummary(days = 7) {
    const result = await pool.query(
        `SELECT * FROM v_audit_summary
         WHERE audit_date >= CURRENT_DATE - $1::int
         ORDER BY audit_date DESC, action_count DESC`,
        [days]
    );
    return result.rows;
}

/**
 * Get recent critical changes
 */
async function getRecentCriticalChanges() {
    const result = await pool.query('SELECT * FROM v_recent_critical_changes');
    return result.rows;
}

/**
 * Search audit logs
 */
async function searchAuditLogs({
    tableName = null,
    action = null,
    userId = null,
    startDate = null,
    endDate = null,
    ipAddress = null,
    limit = 100,
    offset = 0
}) {
    let query = `
        SELECT
            al.*,
            u.username as changed_by_name
        FROM audit_logs al
        LEFT JOIN users u ON al.changed_by = u.id
        WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (tableName) {
        query += ` AND al.table_name = $${paramIndex++}`;
        params.push(tableName);
    }
    if (action) {
        query += ` AND al.action = $${paramIndex++}`;
        params.push(action);
    }
    if (userId) {
        query += ` AND al.changed_by = $${paramIndex++}`;
        params.push(userId);
    }
    if (startDate) {
        query += ` AND al.changed_at >= $${paramIndex++}`;
        params.push(startDate);
    }
    if (endDate) {
        query += ` AND al.changed_at <= $${paramIndex++}`;
        params.push(endDate);
    }
    if (ipAddress) {
        query += ` AND al.ip_address = $${paramIndex++}`;
        params.push(ipAddress);
    }

    query += ` ORDER BY al.changed_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
}

module.exports = {
    logAudit,
    AuditAction,
    auditMiddleware,
    getAuditHistory,
    getAuditSummary,
    getRecentCriticalChanges,
    searchAuditLogs,
    getClientIP,
    getUserAgent,
    getSessionId
};
