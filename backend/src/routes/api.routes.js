const express = require('express');
const router = express.Router();
const pool = require('../config/db.config');
const realtime = require('../realtime');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { validateBody, validateQuery, sanitizeInputs, schemas } = require('../middleware/validation');
const { logAudit: enhancedLogAudit, AuditAction, getAuditSummary, searchAuditLogs } = require('../middleware/audit');
const { withTransaction, withRetry, lockForUpdate } = require('../middleware/transaction');
const qrUtils = require('../utils/qr');

// Multer setup for Excel file uploads (memory storage)
const excelUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
        ];
        if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
        }
    }
});

// Apply sanitization to all routes
router.use(sanitizeInputs);

const CHANGEOVER_ENABLED = process.env.CHANGEOVER_ENABLED !== 'false';

const getSettingValue = async (key, fallback) => {
    const result = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    return result.rows[0]?.value || fallback;
};

const isDayLocked = async (workDate) => {
    if (!workDate) return false;
    const result = await pool.query(
        'SELECT 1 FROM production_day_locks WHERE work_date = $1',
        [workDate]
    );
    return result.rowCount > 0;
};

const isLineClosed = async (lineId, workDate) => {
    if (!lineId || !workDate) return false;
    const result = await pool.query(
        'SELECT 1 FROM line_shift_closures WHERE line_id = $1 AND work_date = $2',
        [lineId, workDate]
    );
    return result.rowCount > 0;
};

const isProductLocked = async (productId, workDate) => {
    if (!productId || !workDate) return false;
    const result = await pool.query(
        `SELECT 1 FROM line_daily_plans
         WHERE product_id = $1 AND work_date = $2 AND is_locked = true`,
        [productId, workDate]
    );
    return result.rowCount > 0;
};

// Enhanced audit logging wrapper for backward compatibility
const logAudit = async (tableName, recordId, action, newValues = null, oldValues = null, req = null) => {
    await enhancedLogAudit({
        tableName,
        recordId,
        action,
        newValues,
        oldValues,
        req
    });
};

const clientErrorLogPath = path.join(__dirname, '..', '..', 'logs', 'client-errors.log');
const logClientError = (payload, req) => {
    try {
        fs.mkdirSync(path.dirname(clientErrorLogPath), { recursive: true });
        const entry = {
            ts: new Date().toISOString(),
            ip: req.ip,
            ua: req.headers['user-agent'] || null,
            ...payload
        };
        fs.appendFile(clientErrorLogPath, `${JSON.stringify(entry)}\n`, () => {});
    } catch (err) {
        // ignore logging failures
    }
};

router.post('/client-error', (req, res) => {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : null;
    if (!message) {
        return res.status(400).json({ success: false, error: 'message is required' });
    }
    const payload = {
        errorType: typeof body.errorType === 'string' ? body.errorType.slice(0, 100) : 'error',
        message,
        stack: typeof body.stack === 'string' ? body.stack.slice(0, 4000) : null,
        source: typeof body.source === 'string' ? body.source.slice(0, 500) : null,
        line: Number.isFinite(body.line) ? body.line : null,
        column: Number.isFinite(body.column) ? body.column : null,
        url: typeof body.url === 'string' ? body.url.slice(0, 1000) : null
    };
    logClientError(payload, req);
    res.json({ success: true });
});

// ============================================================================
// DASHBOARD STATS
// ============================================================================
router.get('/dashboard/stats', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM production_lines WHERE is_active = true) as lines_count,
                (SELECT COUNT(*) FROM employees WHERE is_active = true) as employees_count,
                (SELECT COUNT(*) FROM products WHERE is_active = true) as products_count,
                (SELECT COUNT(*) FROM operations WHERE is_active = true) as operations_count
        `);
        res.json({ success: true, data: stats.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// SETTINGS
// ============================================================================
router.get('/settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT key, value FROM app_settings');
        const settings = result.rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
        res.json({ success: true, data: settings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/settings', async (req, res) => {
    const { default_in_time, default_out_time } = req.body;
    try {
        await pool.query(
            `INSERT INTO app_settings (key, value)
             VALUES ('default_in_time', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [default_in_time]
        );
        await pool.query(
            `INSERT INTO app_settings (key, value)
             VALUES ('default_out_time', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [default_out_time]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// USERS (Admin)
// ============================================================================
router.get('/users', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, full_name, role, is_active, created_at
             FROM users
             ORDER BY created_at DESC`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/users', async (req, res) => {
    const { username, full_name, role } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO users (username, full_name, role, is_active)
             VALUES ($1, $2, $3, true) RETURNING *`,
            [username, full_name, role]
        );
        await logAudit('users', result.rows[0].id, 'create', result.rows[0], null);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, full_name, role, is_active } = req.body;
    try {
        const before = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        const result = await pool.query(
            `UPDATE users
             SET username = $1,
                 full_name = $2,
                 role = $3,
                 is_active = $4,
                 updated_at = NOW()
             WHERE id = $5
             RETURNING *`,
            [username, full_name, role, is_active, id]
        );
        await logAudit('users', id, 'update', result.rows[0], before.rows[0] || null);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const before = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        const result = await pool.query(
            `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        await logAudit('users', id, 'deactivate', result.rows[0], before.rows[0] || null);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PRODUCTION DAY LOCKS
// ============================================================================
router.get('/production-days/status', async (req, res) => {
    const { date } = req.query;
    try {
        const result = await pool.query(
            `SELECT work_date, locked_by, locked_at, notes
             FROM production_day_locks
             WHERE work_date = $1`,
            [date]
        );
        res.json({ success: true, data: result.rows[0] || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/production-days/lock', async (req, res) => {
    const { work_date, locked_by, notes } = req.body;
    try {
        await pool.query(
            `INSERT INTO production_day_locks (work_date, locked_by, notes)
             VALUES ($1, $2, $3)
             ON CONFLICT (work_date)
             DO UPDATE SET locked_by = EXCLUDED.locked_by, locked_at = NOW(), notes = EXCLUDED.notes`,
            [work_date, locked_by || null, notes || null]
        );
        await logAudit('production_day_locks', 0, 'lock', { work_date, locked_by, notes }, null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/production-days/unlock', async (req, res) => {
    const { work_date } = req.body;
    try {
        const before = await pool.query(
            `SELECT * FROM production_day_locks WHERE work_date = $1`,
            [work_date]
        );
        await pool.query('DELETE FROM production_day_locks WHERE work_date = $1', [work_date]);
        await logAudit('production_day_locks', 0, 'unlock', null, before.rows[0] || null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// DAILY LINE PLANS (IE)
// ============================================================================
router.get('/daily-plans', async (req, res) => {
    const { date } = req.query;
    try {
        const plansResult = await pool.query(
            `SELECT lp.id, lp.line_id, lp.product_id, lp.work_date, lp.target_units, lp.is_locked,
                    lp.incoming_product_id, lp.incoming_target_units, lp.changeover_sequence,
                    lp.overtime_minutes, lp.overtime_target,
                    lp.changeover_started_at,
                    pl.line_code, pl.line_name,
                    p.product_code, p.product_name,
                    ip.product_code as incoming_product_code, ip.product_name as incoming_product_name
             FROM line_daily_plans lp
             JOIN production_lines pl ON lp.line_id = pl.id
             JOIN products p ON lp.product_id = p.id
             LEFT JOIN products ip ON lp.incoming_product_id = ip.id
             WHERE lp.work_date = $1
             ORDER BY pl.line_name`,
            [date]
        );
        const linesResult = await pool.query(
            `SELECT pl.id,
                    pl.line_code,
                    pl.line_name,
                    pl.current_product_id,
                    pl.target_units,
                    p.product_code as current_product_code,
                    p.product_name as current_product_name
             FROM production_lines pl
             LEFT JOIN products p ON pl.current_product_id = p.id
             WHERE pl.is_active = true
             ORDER BY pl.line_name`
        );
        const productsResult = await pool.query(
            `SELECT id, product_code, product_name FROM products WHERE is_active = true ORDER BY product_code`
        );
        res.json({
            success: true,
            data: {
                plans: plansResult.rows,
                lines: linesResult.rows,
                products: productsResult.rows,
                changeover_enabled: CHANGEOVER_ENABLED
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/daily-plans', async (req, res) => {
    const { line_id, product_id, work_date, target_units, incoming_product_id, incoming_target_units, changeover_sequence, user_id } = req.body;
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    if (incoming_product_id && parseInt(incoming_product_id, 10) === parseInt(product_id, 10)) {
        return res.status(400).json({ success: false, error: 'Incoming product must be different from primary product' });
    }
    try {
        const lockCheck = await pool.query(
            `SELECT is_locked FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        if (lockCheck.rows[0]?.is_locked) {
            return res.status(403).json({ success: false, error: 'Daily plan is locked' });
        }
        const before = await pool.query(
            `SELECT * FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const prev = before.rows[0];
        const prevIncoming = prev?.incoming_product_id ? parseInt(prev.incoming_product_id, 10) : null;
        const nextIncoming = incoming_product_id ? parseInt(incoming_product_id, 10) : null;
        const incomingChanged = prevIncoming !== nextIncoming;
        let normalizedChangeover = 0;
        if (!CHANGEOVER_ENABLED || !incoming_product_id) {
            normalizedChangeover = 0;
        } else if (changeover_sequence === undefined || changeover_sequence === null || changeover_sequence === '') {
            normalizedChangeover = incomingChanged
                ? 0
                : Math.max(0, parseInt(prev?.changeover_sequence || 0, 10));
        } else {
            normalizedChangeover = Math.max(0, parseInt(changeover_sequence || 0, 10));
        }
        if (CHANGEOVER_ENABLED && incoming_product_id) {
            const maxSeq = await getIncomingMaxSequence(incoming_product_id);
            normalizedChangeover = Math.min(normalizedChangeover, maxSeq);
        }
        const result = await pool.query(
            `INSERT INTO line_daily_plans (line_id, product_id, work_date, target_units, incoming_product_id, incoming_target_units, changeover_sequence, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
             ON CONFLICT (line_id, work_date)
             DO UPDATE SET product_id = EXCLUDED.product_id,
                           target_units = EXCLUDED.target_units,
                           incoming_product_id = EXCLUDED.incoming_product_id,
                           incoming_target_units = EXCLUDED.incoming_target_units,
                           changeover_sequence = EXCLUDED.changeover_sequence,
                           updated_by = EXCLUDED.updated_by,
                           updated_at = NOW()
             RETURNING *`,
            [line_id, product_id, work_date, target_units || 0, incoming_product_id || null, incoming_target_units || 0, normalizedChangeover, user_id || null]
        );
        const prevProduct = before.rows[0]?.product_id;
        if (prevProduct && parseInt(prevProduct, 10) !== parseInt(product_id, 10)) {
            // Only clear assignments for the OLD primary product's processes, not incoming
            const oldProductProcesses = await pool.query(
                `SELECT id FROM product_processes WHERE product_id = $1`, [prevProduct]
            );
            const oldIds = oldProductProcesses.rows.map(r => r.id);
            if (oldIds.length > 0) {
                await pool.query(
                    `DELETE FROM employee_process_assignments WHERE line_id = $1 AND process_id = ANY($2::int[])`,
                    [line_id, oldIds]
                );
            }
        }

        if (work_date === new Date().toISOString().slice(0, 10)) {
            await pool.query(
                `UPDATE production_lines
                 SET current_product_id = $1, target_units = $2, updated_at = NOW()
                 WHERE id = $3`,
                [product_id, target_units || 0, line_id]
            );
            realtime.broadcast('data_change', { entity: 'lines', action: 'update', id: line_id });
        }
        await logAudit('line_daily_plans', result.rows[0].id, before.rowCount ? 'update' : 'create', result.rows[0], before.rows[0] || null);
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/daily-plans/lock', async (req, res) => {
    const { line_id, work_date } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    try {
        const result = await pool.query(
            `UPDATE line_daily_plans
             SET is_locked = true, updated_at = NOW()
             WHERE line_id = $1 AND work_date = $2
             RETURNING *`,
            [line_id, work_date]
        );
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Daily plan not found' });
        }
        await logAudit('line_daily_plans', result.rows[0].id, 'lock', result.rows[0], null);
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'lock', line_id, work_date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/daily-plans/unlock', async (req, res) => {
    const { line_id, work_date } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    try {
        const result = await pool.query(
            `UPDATE line_daily_plans
             SET is_locked = false, updated_at = NOW()
             WHERE line_id = $1 AND work_date = $2
             RETURNING *`,
            [line_id, work_date]
        );
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Daily plan not found' });
        }
        await logAudit('line_daily_plans', result.rows[0].id, 'unlock', result.rows[0], null);
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'unlock', line_id, work_date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.patch('/daily-plans/overtime', async (req, res) => {
    const { line_id, work_date, overtime_minutes, overtime_target } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    if (overtime_minutes == null || overtime_target == null) {
        return res.status(400).json({ success: false, error: 'overtime_minutes and overtime_target are required' });
    }
    const otMins = parseInt(overtime_minutes, 10);
    const otTarget = parseInt(overtime_target, 10);
    if (isNaN(otMins) || otMins < 0 || isNaN(otTarget) || otTarget < 0) {
        return res.status(400).json({ success: false, error: 'overtime_minutes and overtime_target must be non-negative integers' });
    }
    try {
        const result = await pool.query(
            `UPDATE line_daily_plans
             SET overtime_minutes = $3, overtime_target = $4, updated_at = NOW()
             WHERE line_id = $1 AND work_date = $2
             RETURNING *`,
            [line_id, work_date, otMins, otTarget]
        );
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Daily plan not found for this line and date' });
        }
        await logAudit('line_daily_plans', result.rows[0].id, 'set_overtime', null, result.rows[0]);
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'overtime', line_id, work_date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// DAILY PLAN EXCEL EXPORT
// ============================================================================
router.post('/daily-plans/export-excel', async (req, res) => {
    const { date, lineConfigs = {} } = req.body;
    if (!date) return res.status(400).json({ success: false, error: 'date is required' });

    // Helper: get per-line config or defaults
    const getLineCfg = (lineId) => {
        const c = lineConfigs[lineId] || lineConfigs[String(lineId)] || {};
        return {
            start:     c.start     || '08:00',
            end:       c.end       || '17:00',
            lunchMins: parseInt(c.lunchMins ?? 60, 10),
            otMins:    parseInt(c.otMins    ?? 0,  10),
            otTarget:  parseInt(c.otTarget  ?? 0,  10),
            wsOt:      c.wsOt || {},
        };
    };

    const effArgb = e => e == null ? 'FF9CA3AF' : e >= 95 ? 'FF16A34A' : e >= 60 ? 'FFD97706' : 'FFDC2626';
    const fmtTakt = s => s > 0 ? `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s` : '\u2014';

    try {
        const plansResult = await pool.query(
            `SELECT ldp.id, ldp.line_id, ldp.product_id, ldp.target_units,
                    ldp.overtime_minutes, ldp.overtime_target,
                    pl.line_code, pl.line_name,
                    p.product_code, p.product_name
             FROM line_daily_plans ldp
             JOIN production_lines pl ON ldp.line_id = pl.id
             JOIN products p ON ldp.product_id = p.id
             WHERE ldp.work_date = $1
             ORDER BY pl.line_name`,
            [date]
        );

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'WorkSync';
        workbook.created = new Date();

        const borderAll = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' }
        };
        const WS_ARGB = [
            'FFEFF6FF','FFFFF7ED','FFF0FDF4','FFFDF4FF','FFFFFBEB',
            'FFF0F9FF','FFFFF1F2','FFF5F3FF','FFECFDF5','FFFEF9C3'
        ];

        for (const plan of plansResult.rows) {
            const cfg = getLineCfg(plan.line_id);

            // Compute regular working seconds from per-line config
            const [sh, sm] = cfg.start.split(':').map(Number);
            const [eh, em] = cfg.end.split(':').map(Number);
            const workingSecs = ((eh * 60 + em) - (sh * 60 + sm) - cfg.lunchMins) * 60;
            const regTakt     = plan.target_units > 0 ? workingSecs / plan.target_units : 0;

            // OT from config (user may have overridden from plan defaults)
            const otMins   = cfg.otMins;
            const otTarget = cfg.otTarget || parseInt(plan.overtime_target || 0, 10);
            const hasOT    = otMins > 0 && otTarget > 0;

            const processResult = await pool.query(
                `SELECT pp.id, pp.sequence_number, pp.operation_sah,
                        o.operation_code, o.operation_name,
                        ws_info.group_name, ws_info.workstation_code,
                        e.emp_code, e.emp_name
                 FROM product_processes pp
                 JOIN operations o ON pp.operation_id = o.id
                 LEFT JOIN (
                     SELECT DISTINCT ON (lpwp.product_process_id)
                            lpwp.product_process_id,
                            lpw.id AS lpw_id, lpw.group_name, lpw.workstation_code
                     FROM line_plan_workstations lpw
                     JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
                     WHERE lpw.line_id = $1 AND lpw.work_date = $2 AND lpw.product_id = $3
                     ORDER BY lpwp.product_process_id, lpw.id
                 ) ws_info ON ws_info.product_process_id = pp.id
                 LEFT JOIN employee_workstation_assignments ewa
                     ON ewa.line_plan_workstation_id = ws_info.lpw_id
                     AND ewa.line_id = $1 AND ewa.work_date = $2 AND ewa.is_overtime = false
                 LEFT JOIN employees e ON ewa.employee_id = e.id
                 WHERE pp.product_id = $3 AND pp.is_active = true
                 ORDER BY pp.sequence_number`,
                [plan.line_id, date, plan.product_id]
            );
            if (processResult.rows.length === 0) continue;

            // Group by workstation + compute efficiency
            const groups  = [];
            const wsIndex = new Map();
            processResult.rows.forEach(p => {
                const ws  = (p.workstation_code || '').trim();
                const key = ws || `__u_${p.id}`;
                if (!wsIndex.has(key)) {
                    wsIndex.set(key, groups.length);
                    groups.push({ ws, group_name: '', processes: [], sam: 0, emp_name: '', emp_code: '' });
                }
                const g = groups[wsIndex.get(key)];
                g.processes.push(p);
                g.sam += parseFloat(p.operation_sah || 0) * 3600;
                if (!g.group_name && p.group_name) g.group_name = p.group_name;
                if (!g.emp_name && p.emp_name) { g.emp_name = p.emp_name; g.emp_code = p.emp_code || ''; }
            });
            groups.forEach(g => {
                g.reg_eff = regTakt > 0 ? (g.sam / regTakt) * 100 : null;
                const wsOtMins = hasOT ? ((g.ws && cfg.wsOt[g.ws] != null) ? cfg.wsOt[g.ws] : otMins) : 0;
                const otSecs   = wsOtMins * 60;
                const otTakt   = (otSecs > 0 && otTarget > 0) ? otSecs / otTarget : 0;
                g.ot_eff    = (hasOT && wsOtMins > 0 && otTakt > 0) ? (g.sam / otTakt) * 100 : null;
                g.total_eff = (g.reg_eff != null && g.ot_eff != null)
                    ? (g.sam * (plan.target_units + otTarget)) / (workingSecs + wsOtMins * 60) * 100
                    : null;
            });

            // 9 columns: WS, Group, Seq, Op Code, Op Name, SAH, Cycle, Workload%, Employee
            const TOTAL_COLS = 9;
            const sheetName = (plan.line_code || plan.line_name || 'Line').substring(0, 31);
            const ws = workbook.addWorksheet(sheetName);
            ws.columns = [
                { width: 8  }, // A WS
                { width: 12 }, // B Group
                { width: 6  }, // C Seq
                { width: 13 }, // D Op Code
                { width: 36 }, // E Op Name
                { width: 8  }, // F SAH
                { width: 10 }, // G Cycle(s)
                { width: 9  }, // H Workload%
                { width: 22 }, // I Employee
            ];

            // Row 1: Title (A1:I1)
            ws.mergeCells(`A1:I1`);
            const titleCell = ws.getCell('A1');
            titleCell.value = 'LINE DAILY PLAN';
            titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
            titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
            ws.getRow(1).height = 28;

            // Rows 2-8: Meta
            const otInfo = hasOT ? ` | OT: ${otMins}min / +${otTarget} units` : '';
            const metaRows = [
                ['Line',          `${plan.line_code}${plan.line_name ? ' \u2014 ' + plan.line_name : ''}`],
                ['Date',          date],
                ['Product',       `${plan.product_code} \u2014 ${plan.product_name}`],
                ['Target',        `${plan.target_units} units`],
                ['Working Hours', `${cfg.start} \u2013 ${cfg.end} (lunch ${cfg.lunchMins}min)`],
                ['Takt Time',     fmtTakt(regTakt) + otInfo],
            ];
            metaRows.forEach(([label, value], i) => {
                const rn = i + 2;
                ws.mergeCells(`C${rn}:I${rn}`);
                const lc = ws.getCell(`A${rn}`);
                lc.value = label; lc.font = { bold: true, size: 10 };
                lc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
                ws.getCell(`B${rn}`).value = ':';
                ws.getCell(`B${rn}`).alignment = { horizontal: 'center' };
                const vc = ws.getCell(`C${rn}`);
                vc.value = value; vc.font = { size: 10 };
                ws.getRow(rn).height = 16;
            });
            ws.getRow(8).height = 6;

            // Row 9: Headers
            const hdrs = ['WS', 'Group', 'Seq', 'Op. Code', 'Operation Name', 'SAH', 'Cycle (s)', 'Workload%', 'Employee'];
            const hRow = ws.getRow(9);
            hRow.height = 18;
            hdrs.forEach((h, i) => {
                const c = hRow.getCell(i + 1);
                c.value = h;
                c.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
                c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
                c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                c.border = borderAll;
            });

            // Data rows from row 10
            let curRow = 10;
            groups.forEach((g, gi) => {
                const bg       = { type: 'pattern', pattern: 'solid', fgColor: { argb: WS_ARGB[gi % WS_ARGB.length] } };
                const startRn  = curRow;
                const rowCount = g.processes.length;

                g.processes.forEach(p => {
                    const row = ws.getRow(curRow);
                    row.height = 15;
                    [[3, p.sequence_number, { horizontal: 'center' }],
                     [4, p.operation_code  || '', { horizontal: 'left'  }],
                     [5, p.operation_name  || '', {}],
                     [6, parseFloat(p.operation_sah || 0), { horizontal: 'right' }],
                    ].forEach(([col, val, align]) => {
                        const cell = row.getCell(col);
                        cell.value = val; cell.border = borderAll; cell.fill = bg;
                        if (align) cell.alignment = align;
                    });
                    ws.getCell(curRow, 6).numFmt = '0.0000';
                    curRow++;
                });

                const endRn = curRow - 1;

                // WS (1) and Group (2) — merged rowspan
                [[1, g.ws || '\u2014'], [2, g.group_name || '\u2014']].forEach(([col, val]) => {
                    if (rowCount > 1) ws.mergeCells(startRn, col, endRn, col);
                    const cell = ws.getCell(startRn, col);
                    cell.value = val; cell.font = { bold: true, size: 10 };
                    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                    cell.border = borderAll; cell.fill = bg;
                });

                // Cycle (7)
                if (rowCount > 1) ws.mergeCells(startRn, 7, endRn, 7);
                const cycleCell = ws.getCell(startRn, 7);
                cycleCell.value = Math.round(g.sam * 10) / 10;
                cycleCell.numFmt = '0.0"s"';
                cycleCell.font  = { bold: true, size: 10 };
                cycleCell.alignment = { horizontal: 'right', vertical: 'middle' };
                cycleCell.border = borderAll; cycleCell.fill = bg;

                // Workload% (8)
                if (rowCount > 1) ws.mergeCells(startRn, 8, endRn, 8);
                const wlCell = ws.getCell(startRn, 8);
                if (g.reg_eff != null) {
                    wlCell.value  = Math.round(g.reg_eff * 10) / 10;
                    wlCell.numFmt = '0.0"%"';
                } else {
                    wlCell.value = 'N/A';
                }
                wlCell.font      = { bold: true, size: 10, color: { argb: effArgb(g.reg_eff) } };
                wlCell.alignment = { horizontal: 'center', vertical: 'middle' };
                wlCell.border    = borderAll; wlCell.fill = bg;

                // Employee (9)
                if (rowCount > 1) ws.mergeCells(startRn, 9, endRn, 9);
                const empCell = ws.getCell(startRn, 9);
                empCell.value = g.emp_name ? `${g.emp_name}${g.emp_code ? '\n(' + g.emp_code + ')' : ''}` : '\u2014';
                empCell.font  = { size: 9 };
                empCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                empCell.border = borderAll; empCell.fill = bg;
            });
        }

        if (workbook.worksheets.length === 0) {
            return res.status(404).json({ success: false, error: 'No line plans with processes found for this date.' });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="daily_plan_${date}.xlsx"`);
        res.setHeader('Cache-Control', 'no-cache');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// LINE DAILY METRICS (Supervisor)
// ============================================================================
router.get('/line-metrics', async (req, res) => {
    const { line_id, date } = req.query;
    try {
        const result = await pool.query(
            `SELECT * FROM line_daily_metrics WHERE line_id = $1 AND work_date = $2`,
            [line_id, date]
        );
        res.json({ success: true, data: result.rows[0] || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/line-metrics', async (req, res) => {
    const { line_id, work_date, forwarded_quantity, remaining_wip, materials_issued, qa_output, user_id } = req.body;
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    if (await isLineClosed(line_id, work_date)) {
        return res.status(403).json({ success: false, error: 'Shift is closed for this line' });
    }
    try {
        const before = await pool.query(
            `SELECT * FROM line_daily_metrics WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const result = await pool.query(
            `INSERT INTO line_daily_metrics (line_id, work_date, forwarded_quantity, remaining_wip, materials_issued, qa_output, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (line_id, work_date)
             DO UPDATE SET forwarded_quantity = EXCLUDED.forwarded_quantity,
                           remaining_wip = EXCLUDED.remaining_wip,
                           materials_issued = EXCLUDED.materials_issued,
                           qa_output = EXCLUDED.qa_output,
                           updated_by = EXCLUDED.updated_by,
                           updated_at = NOW()
             RETURNING *`,
            [line_id, work_date, forwarded_quantity || 0, remaining_wip || 0, materials_issued || 0, qa_output || 0, user_id || null]
        );
        await logAudit('line_daily_metrics', result.rows[0].id, before.rowCount ? 'update' : 'create', result.rows[0], before.rows[0] || null);
        realtime.broadcast('data_change', { entity: 'line_metrics', action: 'update', line_id, work_date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// AUDIT LOGS
// ============================================================================
router.get('/audit-logs', async (req, res) => {
    const { limit = 100 } = req.query;
    try {
        const result = await pool.query(
            `SELECT * FROM audit_logs ORDER BY changed_at DESC LIMIT $1`,
            [limit]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/audit-logs/summary', async (req, res) => {
    const { days = 7 } = req.query;
    try {
        const result = await getAuditSummary(parseInt(days));
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/audit-logs/search', async (req, res) => {
    const { table_name, action, user_id, start_date, end_date, ip_address, limit = 100, offset = 0 } = req.query;
    try {
        const result = await searchAuditLogs({
            tableName: table_name,
            action,
            userId: user_id ? parseInt(user_id) : null,
            startDate: start_date,
            endDate: end_date,
            ipAddress: ip_address,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// Reports (Excel)
// ============================================================================
router.get('/reports/daily', async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
    }
    try {
        const [materialsResult, processOutputResult, linesResult, metricsResponse] = await Promise.all([
            pool.query(
                `SELECT * FROM v_daily_material_summary WHERE work_date = $1`,
                [date]
            ),
            pool.query(
                `SELECT pl.line_name,
                        o.operation_code,
                        o.operation_name,
                        SUM(lph.quantity) as total_output
                 FROM line_process_hourly_progress lph
                 JOIN production_lines pl ON pl.id = lph.line_id
                 JOIN product_processes pp ON pp.id = lph.process_id
                 JOIN operations o ON o.id = pp.operation_id
                 WHERE lph.work_date = $1
                 GROUP BY pl.line_name, o.operation_code, o.operation_name
                 ORDER BY pl.line_name, o.operation_code`,
                [date]
            ),
            pool.query(
                `SELECT id, line_name FROM production_lines WHERE is_active = true ORDER BY id`
            ),
            pool.query(
            `SELECT
                pl.id as line_id,
                pl.line_name,
                pl.line_code,
                COALESCE(ldp.target_units, pl.target_units, 0) as target,
                COALESCE(p.product_code, '') as product_code,
                COALESCE(p.product_name, '') as product_name,
                COALESCE(
                    (SELECT SUM(pp.operation_sah)
                     FROM product_processes pp
                     WHERE pp.product_id = COALESCE(ldp.product_id, pl.current_product_id)
                     AND pp.is_active = true), 0
                ) as total_sah,
                COALESCE(
                    (SELECT COUNT(DISTINCT a.employee_id)
                     FROM employee_process_assignments a
                     WHERE a.line_id = pl.id), 0
                ) as manpower,
                COALESCE(ldm.qa_output, 0) as qa_output,
                COALESCE(
                    (SELECT SUM(h.quantity)
                     FROM line_process_hourly_progress h
                     WHERE h.line_id = pl.id AND h.work_date = $1),
                    0
                ) as hourly_output,
                COALESCE(
                    NULLIF(ldm.qa_output, 0),
                    (SELECT SUM(h.quantity)
                     FROM line_process_hourly_progress h
                     WHERE h.line_id = pl.id AND h.work_date = $1),
                    0
                ) as actual_output
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $1
            LEFT JOIN products p ON COALESCE(ldp.product_id, pl.current_product_id) = p.id
            LEFT JOIN line_daily_metrics ldm ON ldm.line_id = pl.id AND ldm.work_date = $1
            WHERE pl.is_active = true
            ORDER BY pl.id`,
            [date]
        )
        ]);

        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60);
        const workingSeconds = workingHours * 3600;

        const lineMetrics = metricsResponse.rows.map(row => {
            const target = parseInt(row.target) || 0;
            const manpower = parseInt(row.manpower) || 0;
            const totalSAH = parseFloat(row.total_sah) || 0;
            const actualOutput = parseInt(row.actual_output) || 0;
            const qaOutput = parseInt(row.qa_output) || 0;
            const hourlyOutput = parseInt(row.hourly_output) || 0;
            const taktTime = target > 0 ? Math.round(workingSeconds / target) : 0;
            let efficiency = 0;
            if (manpower > 0 && workingHours > 0 && totalSAH > 0) {
                const earnedHours = actualOutput * totalSAH;
                const availableHours = manpower * workingHours;
                efficiency = Math.round((earnedHours / availableHours) * 100 * 100) / 100;
            }
            return {
                line_id: row.line_id,
                line_name: row.line_name,
                line_code: row.line_code,
                product_code: row.product_code,
                product_name: row.product_name,
                target,
                manpower,
                total_sah: totalSAH,
                actual_output: actualOutput,
                qa_output: qaOutput,
                hourly_output: hourlyOutput,
                takt_time_seconds: taktTime,
                efficiency_percent: efficiency,
                completion_percent: target > 0 ? Math.round((actualOutput / target) * 100) : 0
            };
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'WorkSync';
        workbook.created = new Date();

        const lineSheet = workbook.addWorksheet('Line Summary');
        lineSheet.columns = [
            { header: 'Line', key: 'line', width: 24 },
            { header: 'Product', key: 'product', width: 26 },
            { header: 'Target', key: 'target', width: 12 },
            { header: 'QA Output', key: 'qa_output', width: 12 },
            { header: 'Hourly Output', key: 'hourly_output', width: 14 },
            { header: 'Efficiency %', key: 'efficiency', width: 14 },
            { header: 'Completion %', key: 'completion', width: 14 }
        ];
        lineMetrics.forEach(row => {
            lineSheet.addRow({
                line: `${row.line_name} (${row.line_code})`,
                product: `${row.product_code} ${row.product_name}`.trim(),
                target: row.target,
                qa_output: row.qa_output,
                hourly_output: row.hourly_output,
                efficiency: row.efficiency_percent,
                completion: row.completion_percent
            });
        });

        const materialsSheet = workbook.addWorksheet('Materials');
        materialsSheet.columns = [
            { header: 'Line ID', key: 'line_id', width: 10 },
            { header: 'Work Date', key: 'work_date', width: 12 },
            { header: 'Issued', key: 'total_issued', width: 12 },
            { header: 'Used', key: 'total_used', width: 12 },
            { header: 'Returned', key: 'total_returned', width: 12 },
            { header: 'Forwarded', key: 'total_forwarded', width: 12 }
        ];
        (materialsResult.rows || []).forEach(row => materialsSheet.addRow(row));

        const processSheet = workbook.addWorksheet('Process Output');
        processSheet.columns = [
            { header: 'Line', key: 'line_name', width: 24 },
            { header: 'Operation Code', key: 'operation_code', width: 16 },
            { header: 'Operation Name', key: 'operation_name', width: 28 },
            { header: 'Output', key: 'total_output', width: 12 }
        ];
        (processOutputResult.rows || []).forEach(row => processSheet.addRow(row));

        const employeeSheet = workbook.addWorksheet('Employee Efficiency');
        employeeSheet.columns = [
            { header: 'Line', key: 'line_name', width: 24 },
            { header: 'Product', key: 'product_code', width: 18 },
            { header: 'Employee Code', key: 'emp_code', width: 14 },
            { header: 'Employee Name', key: 'emp_name', width: 22 },
            { header: 'Operation', key: 'operation', width: 28 },
            { header: 'Output', key: 'output', width: 12 },
            { header: 'Efficiency %', key: 'efficiency', width: 14 }
        ];
        for (const line of linesResult.rows) {
            const shift = await pool.query(
                `SELECT e.emp_code, e.emp_name,
                        e.manpower_factor,
                        p.product_code,
                        o.operation_code, o.operation_name,
                        COALESCE(SUM(lph.quantity), 0) as total_output,
                        pp.operation_sah,
                        att.in_time, att.out_time
                 FROM employees e
                 JOIN employee_process_assignments epa ON e.id = epa.employee_id AND epa.line_id = $1
                 JOIN product_processes pp ON epa.process_id = pp.id
                 JOIN products p ON pp.product_id = p.id
                 JOIN operations o ON pp.operation_id = o.id
                 LEFT JOIN employee_attendance att ON e.id = att.employee_id AND att.attendance_date = $2
                 LEFT JOIN line_process_hourly_progress lph
                    ON lph.employee_id = e.id AND lph.line_id = $1 AND lph.work_date = $2
                 WHERE e.is_active = true
                 GROUP BY e.emp_code, e.emp_name, e.manpower_factor, p.product_code, o.operation_code, o.operation_name, pp.operation_sah, att.in_time, att.out_time
                 ORDER BY p.product_code, e.emp_code`,
                [line.id, date]
            );
            shift.rows.forEach(row => {
                let hours = workingHours;
                if (row.in_time && row.out_time) {
                    const [inH, inM] = row.in_time.split(':').map(Number);
                    const [outH, outM] = row.out_time.split(':').map(Number);
                    const diff = (outH + outM / 60) - (inH + inM / 60);
                    if (diff > 0) hours = diff;
                }
                const output = parseInt(row.total_output || 0);
                const sah = parseFloat(row.operation_sah || 0);
                const mp = parseFloat(row.manpower_factor || 1);
                const efficiency = hours > 0 && sah > 0 && mp > 0
                    ? Math.round(((output * sah) / (hours * mp)) * 100 * 100) / 100
                    : 0;
                employeeSheet.addRow({
                    line_name: line.line_name,
                    product_code: row.product_code,
                    emp_code: row.emp_code,
                    emp_name: row.emp_name,
                    operation: `${row.operation_code} - ${row.operation_name}`,
                    output: output,
                    efficiency: efficiency
                });
            });
        }

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=\"daily_report_${date}.xlsx\"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/reports/range', async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) {
        return res.status(400).json({ success: false, error: 'start and end are required (YYYY-MM-DD)' });
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return res.status(400).json({ success: false, error: 'invalid start or end date' });
    }
    if (endDate < startDate) {
        return res.status(400).json({ success: false, error: 'end date must be on or after start date' });
    }

    try {
        const linesResult = await pool.query(
            `SELECT id, line_name FROM production_lines WHERE is_active = true ORDER BY id`
        );
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60);
        const workingSeconds = workingHours * 3600;

        const dates = [];
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            dates.push(d.toISOString().slice(0, 10));
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'WorkSync';
        workbook.created = new Date();

        const lineSheet = workbook.addWorksheet('Line Summary');
        lineSheet.columns = [
            { header: 'Date', key: 'work_date', width: 12 },
            { header: 'Line', key: 'line', width: 24 },
            { header: 'Product', key: 'product', width: 26 },
            { header: 'Target', key: 'target', width: 12 },
            { header: 'QA Output', key: 'qa_output', width: 12 },
            { header: 'Hourly Output', key: 'hourly_output', width: 14 },
            { header: 'Efficiency %', key: 'efficiency', width: 14 },
            { header: 'Completion %', key: 'completion', width: 14 }
        ];

        const materialsSheet = workbook.addWorksheet('Materials');
        materialsSheet.columns = [
            { header: 'Date', key: 'work_date', width: 12 },
            { header: 'Line ID', key: 'line_id', width: 10 },
            { header: 'Issued', key: 'total_issued', width: 12 },
            { header: 'Used', key: 'total_used', width: 12 },
            { header: 'Returned', key: 'total_returned', width: 12 },
            { header: 'Forwarded', key: 'total_forwarded', width: 12 }
        ];

        const processSheet = workbook.addWorksheet('Process Output');
        processSheet.columns = [
            { header: 'Date', key: 'work_date', width: 12 },
            { header: 'Line', key: 'line_name', width: 24 },
            { header: 'Operation Code', key: 'operation_code', width: 16 },
            { header: 'Operation Name', key: 'operation_name', width: 28 },
            { header: 'Output', key: 'total_output', width: 12 }
        ];

        const employeeSheet = workbook.addWorksheet('Employee Efficiency');
        employeeSheet.columns = [
            { header: 'Date', key: 'work_date', width: 12 },
            { header: 'Line', key: 'line_name', width: 24 },
            { header: 'Product', key: 'product_code', width: 18 },
            { header: 'Employee Code', key: 'emp_code', width: 14 },
            { header: 'Employee Name', key: 'emp_name', width: 22 },
            { header: 'Operation', key: 'operation', width: 28 },
            { header: 'Output', key: 'output', width: 12 },
            { header: 'Efficiency %', key: 'efficiency', width: 14 }
        ];

        for (const date of dates) {
            const [materialsResult, processOutputResult, metricsResponse] = await Promise.all([
                pool.query(
                    `SELECT * FROM v_daily_material_summary WHERE work_date = $1`,
                    [date]
                ),
                pool.query(
                    `SELECT pl.line_name,
                            o.operation_code,
                            o.operation_name,
                            SUM(lph.quantity) as total_output
                     FROM line_process_hourly_progress lph
                     JOIN production_lines pl ON pl.id = lph.line_id
                     JOIN product_processes pp ON pp.id = lph.process_id
                     JOIN operations o ON o.id = pp.operation_id
                     WHERE lph.work_date = $1
                     GROUP BY pl.line_name, o.operation_code, o.operation_name
                     ORDER BY pl.line_name, o.operation_code`,
                    [date]
                ),
                pool.query(
                    `SELECT
                        pl.id as line_id,
                        pl.line_name,
                        pl.line_code,
                        COALESCE(ldp.target_units, pl.target_units, 0) as target,
                        COALESCE(p.product_code, '') as product_code,
                        COALESCE(p.product_name, '') as product_name,
                        COALESCE(
                            (SELECT SUM(pp.operation_sah)
                             FROM product_processes pp
                             WHERE pp.product_id = COALESCE(ldp.product_id, pl.current_product_id)
                             AND pp.is_active = true), 0
                        ) as total_sah,
                        COALESCE(
                            (SELECT COUNT(DISTINCT a.employee_id)
                             FROM employee_process_assignments a
                             WHERE a.line_id = pl.id), 0
                        ) as manpower,
                        COALESCE(ldm.qa_output, 0) as qa_output,
                        COALESCE(
                            (SELECT SUM(h.quantity)
                             FROM line_process_hourly_progress h
                             WHERE h.line_id = pl.id AND h.work_date = $1),
                            0
                        ) as hourly_output,
                        COALESCE(
                            NULLIF(ldm.qa_output, 0),
                            (SELECT SUM(h.quantity)
                             FROM line_process_hourly_progress h
                             WHERE h.line_id = pl.id AND h.work_date = $1),
                            0
                        ) as actual_output
                    FROM production_lines pl
                    LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $1
                    LEFT JOIN products p ON COALESCE(ldp.product_id, pl.current_product_id) = p.id
                    LEFT JOIN line_daily_metrics ldm ON ldm.line_id = pl.id AND ldm.work_date = $1
                    WHERE pl.is_active = true
                    ORDER BY pl.id`,
                    [date]
                )
            ]);

            const lineMetrics = metricsResponse.rows.map(row => {
                const target = parseInt(row.target) || 0;
                const manpower = parseInt(row.manpower) || 0;
                const totalSAH = parseFloat(row.total_sah) || 0;
                const actualOutput = parseInt(row.actual_output) || 0;
                const qaOutput = parseInt(row.qa_output) || 0;
                const hourlyOutput = parseInt(row.hourly_output) || 0;
                const taktTime = target > 0 ? Math.round(workingSeconds / target) : 0;
                let efficiency = 0;
                if (manpower > 0 && workingHours > 0 && totalSAH > 0) {
                    const earnedHours = actualOutput * totalSAH;
                    const availableHours = manpower * workingHours;
                    efficiency = Math.round((earnedHours / availableHours) * 100 * 100) / 100;
                }
                return {
                    line_id: row.line_id,
                    line_name: row.line_name,
                    line_code: row.line_code,
                    product_code: row.product_code,
                    product_name: row.product_name,
                    target,
                    manpower,
                    total_sah: totalSAH,
                    actual_output: actualOutput,
                    qa_output: qaOutput,
                    hourly_output: hourlyOutput,
                    takt_time_seconds: taktTime,
                    efficiency_percent: efficiency,
                    completion_percent: target > 0 ? Math.round((actualOutput / target) * 100) : 0
                };
            });

            lineMetrics.forEach(row => {
                lineSheet.addRow({
                    work_date: date,
                    line: `${row.line_name} (${row.line_code})`,
                    product: `${row.product_code} ${row.product_name}`.trim(),
                    target: row.target,
                    qa_output: row.qa_output,
                    hourly_output: row.hourly_output,
                    efficiency: row.efficiency_percent,
                    completion: row.completion_percent
                });
            });

            (materialsResult.rows || []).forEach(row => {
                materialsSheet.addRow({
                    work_date: date,
                    line_id: row.line_id,
                    total_issued: row.total_issued,
                    total_used: row.total_used,
                    total_returned: row.total_returned,
                    total_forwarded: row.total_forwarded
                });
            });

            (processOutputResult.rows || []).forEach(row => {
                processSheet.addRow({
                    work_date: date,
                    line_name: row.line_name,
                    operation_code: row.operation_code,
                    operation_name: row.operation_name,
                    total_output: row.total_output
                });
            });

            for (const line of linesResult.rows) {
                const shift = await pool.query(
                    `SELECT e.emp_code, e.emp_name,
                            e.manpower_factor,
                            p.product_code,
                            o.operation_code, o.operation_name,
                            COALESCE(SUM(lph.quantity), 0) as total_output,
                            pp.operation_sah,
                            att.in_time, att.out_time
                     FROM employees e
                     JOIN employee_process_assignments epa ON e.id = epa.employee_id AND epa.line_id = $1
                     JOIN product_processes pp ON epa.process_id = pp.id
                     JOIN products p ON pp.product_id = p.id
                     JOIN operations o ON pp.operation_id = o.id
                     LEFT JOIN employee_attendance att ON e.id = att.employee_id AND att.attendance_date = $2
                     LEFT JOIN line_process_hourly_progress lph
                        ON lph.employee_id = e.id AND lph.line_id = $1 AND lph.work_date = $2
                     WHERE e.is_active = true
                     GROUP BY e.emp_code, e.emp_name, e.manpower_factor, p.product_code, o.operation_code, o.operation_name, pp.operation_sah, att.in_time, att.out_time
                     ORDER BY p.product_code, e.emp_code`,
                    [line.id, date]
                );
                shift.rows.forEach(row => {
                    let hours = workingHours;
                    if (row.in_time && row.out_time) {
                        const [inH, inM] = row.in_time.split(':').map(Number);
                        const [outH, outM] = row.out_time.split(':').map(Number);
                        const diff = (outH + outM / 60) - (inH + inM / 60);
                        if (diff > 0) hours = diff;
                    }
                    const output = parseInt(row.total_output || 0);
                    const sah = parseFloat(row.operation_sah || 0);
                    const mp = parseFloat(row.manpower_factor || 1);
                    const efficiency = hours > 0 && sah > 0 && mp > 0
                        ? Math.round(((output * sah) / (hours * mp)) * 100 * 100) / 100
                        : 0;
                    employeeSheet.addRow({
                        work_date: date,
                        line_name: line.line_name,
                        product_code: row.product_code,
                        emp_code: row.emp_code,
                        emp_name: row.emp_name,
                        operation: `${row.operation_code} - ${row.operation_name}`,
                        output: output,
                        efficiency: efficiency
                    });
                });
            }
        }

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=\"daily_report_${start}_to_${end}.xlsx\"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PRODUCTION LINES
// ============================================================================
router.get('/lines', async (req, res) => {
    const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';
    try {
        const result = await pool.query(`
            SELECT pl.*,
                   COALESCE(p_plan.product_code, p_current.product_code) as current_product_code,
                   COALESCE(p_plan.product_name, p_current.product_name) as current_product_name,
                   ldp.target_units as daily_target_units,
                   (SELECT COUNT(DISTINCT a.employee_id)
                    FROM employee_process_assignments a
                    WHERE a.line_id = pl.id) as employee_count
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = CURRENT_DATE
            LEFT JOIN products p_plan ON ldp.product_id = p_plan.id
            LEFT JOIN products p_current ON pl.current_product_id = p_current.id
            ${includeInactive ? '' : 'WHERE pl.is_active = true'}
            ORDER BY pl.id
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/lines', validateBody(schemas.line.partial()), async (req, res) => {
    const { line_code, line_name, hall_location, current_product_id, target_units, efficiency } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO production_lines (line_code, line_name, hall_location, current_product_id, target_units, efficiency, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
            [line_code, line_name, hall_location, current_product_id, target_units || 0, efficiency || 0]
        );
        const newLine = result.rows[0];
        // Auto-generate 100 workstation QR codes for the new line (non-blocking)
        qrUtils.generateWorkstationQrForLine(newLine.id).catch(err =>
            console.error(`[QR] Failed to generate workstation QRs for line ${newLine.id}:`, err.message)
        );
        realtime.broadcast('data_change', { entity: 'lines', action: 'create', id: newLine.id });
        res.json({ success: true, data: newLine });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/lines/:id', async (req, res) => {
    const { id } = req.params;
    const { line_code, line_name, hall_location, current_product_id, target_units, efficiency, is_active } = req.body;
    try {
        const today = new Date().toISOString().slice(0, 10);
        const lockCheck = await pool.query(
            `SELECT is_locked FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [id, today]
        );
        if (lockCheck.rows[0]?.is_locked) {
            const currentLine = await pool.query(`SELECT current_product_id, target_units FROM production_lines WHERE id = $1`, [id]);
            const existing = currentLine.rows[0] || {};
            const productChanged = current_product_id !== undefined && Number(current_product_id) !== Number(existing.current_product_id);
            const targetChanged = target_units !== undefined && Number(target_units) !== Number(existing.target_units);
            if (productChanged || targetChanged) {
                return res.status(403).json({ success: false, error: 'Daily plan is locked for today' });
            }
        }
        const result = await pool.query(
            `UPDATE production_lines
             SET line_code = $1, line_name = $2, hall_location = $3, current_product_id = $4, target_units = $5, efficiency = $6, is_active = $7, updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [line_code, line_name, hall_location, current_product_id, target_units || 0, efficiency || 0, is_active, id]
        );
        if (current_product_id) {
            await pool.query(
                `INSERT INTO line_daily_plans (line_id, product_id, work_date, target_units, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $5)
                 ON CONFLICT (line_id, work_date)
                 DO UPDATE SET product_id = EXCLUDED.product_id,
                               target_units = EXCLUDED.target_units,
                               updated_by = EXCLUDED.updated_by,
                               updated_at = NOW()`,
                [id, current_product_id, today, target_units || 0, null]
            );
            realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id: id, work_date: today });
        } else if (target_units !== undefined) {
            await pool.query(
                `UPDATE line_daily_plans
                 SET target_units = $1, updated_at = NOW()
                 WHERE line_id = $2 AND work_date = $3`,
                [target_units || 0, id, today]
            );
            realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id: id, work_date: today });
        }
        realtime.broadcast('data_change', { entity: 'lines', action: 'update', id: result.rows[0]?.id || id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/lines/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query(`UPDATE production_lines SET is_active = false WHERE id = $1`, [id]);
        realtime.broadcast('data_change', { entity: 'lines', action: 'delete', id });
        res.json({ success: true, message: 'Line deactivated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/lines/:id/hard-delete', async (req, res) => {
    const { id } = req.params;
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    try {
        // Fetch line_code before deletion (for QR folder cleanup)
        const lineResult = await pool.query('SELECT line_code FROM production_lines WHERE id = $1', [id]);
        const lineCode = lineResult.rows[0]?.line_code;

        const deps = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM line_daily_plans WHERE line_id = $1) as daily_plans,
                (SELECT COUNT(*) FROM employee_process_assignments WHERE line_id = $1) as assignments,
                (SELECT COUNT(*) FROM line_process_hourly_progress WHERE line_id = $1) as hourly_progress,
                (SELECT COUNT(*) FROM material_transactions WHERE line_id = $1) as materials,
                (SELECT COUNT(*) FROM process_material_wip WHERE line_id = $1) as wip,
                (SELECT COUNT(*) FROM line_shift_closures WHERE line_id = $1) as shift_closures,
                (SELECT COUNT(*) FROM line_daily_metrics WHERE line_id = $1) as metrics`,
            [id]
        );
        const row = deps.rows[0] || {};
        const hasData = Object.values(row).some(v => parseInt(v || 0, 10) > 0);
        if (hasData) {
            return res.status(400).json({
                success: false,
                error: 'Line has related data; deactivate instead of deleting.',
                details: row
            });
        }
        await pool.query(`DELETE FROM production_lines WHERE id = $1`, [id]);

        // Delete QR code folder for this line's workstations
        if (lineCode) {
            const qrDir = path.join(process.env.QRCODES_DIR || path.join(__dirname, '..', '..', 'qrcodes'), 'workstations', lineCode);
            fs.promises.rm(qrDir, { recursive: true, force: true }).catch(() => {});
        }

        realtime.broadcast('data_change', { entity: 'lines', action: 'delete', id });
        res.json({ success: true, message: 'Line deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// LINE WORKSTATION QR CODES
// ============================================================================

// GET /lines/:lineId/workstations — list 100 physical workstations with QR paths
router.get('/lines/:lineId/workstations', async (req, res) => {
    const { lineId } = req.params;
    try {
        const result = await pool.query(
            `SELECT lw.*, pl.line_code, pl.line_name
             FROM line_workstations lw
             JOIN production_lines pl ON lw.line_id = pl.id
             WHERE lw.line_id = $1
             ORDER BY lw.workstation_number`,
            [lineId]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /lines/:lineId/workstations/generate-qr — generate (or regenerate) 100 workstation QR codes
router.post('/lines/:lineId/workstations/generate-qr', async (req, res) => {
    const { lineId } = req.params;
    try {
        const lineCheck = await pool.query('SELECT id FROM production_lines WHERE id = $1', [lineId]);
        if (!lineCheck.rows[0]) return res.status(404).json({ success: false, error: 'Line not found' });
        const workstations = await qrUtils.generateWorkstationQrForLine(parseInt(lineId, 10));
        res.json({ success: true, data: { count: workstations.length, workstations } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /lines/generate-all-workstation-qr — generate QR codes for ALL lines (bulk)
router.post('/lines/generate-all-workstation-qr', async (req, res) => {
    try {
        const linesResult = await pool.query('SELECT id FROM production_lines WHERE is_active = true ORDER BY id');
        const lines = linesResult.rows;
        // Fire all in parallel but cap concurrency to avoid OOM
        let total = 0;
        for (const line of lines) {
            const ws = await qrUtils.generateWorkstationQrForLine(line.id);
            total += ws.length;
        }
        res.json({ success: true, data: { lines: lines.length, workstations_generated: total } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// LINE PRODUCTION METRICS (Takt Time & Efficiency)
// ============================================================================
router.get('/lines/:id/metrics', async (req, res) => {
    const { id } = req.params;
    const { date } = req.query;
    const workDate = date || new Date().toISOString().split('T')[0];

    try {
        // Get line info with daily plan
        const lineResult = await pool.query(`
            SELECT pl.*,
                   COALESCE(ldp.target_units, pl.target_units, 0) as target,
                   COALESCE(ldp.product_id, pl.current_product_id) as product_id,
                   COALESCE(p.product_code, '') as product_code,
                   COALESCE(p.product_name, '') as product_name
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $2
            LEFT JOIN products p ON COALESCE(ldp.product_id, pl.current_product_id) = p.id
            WHERE pl.id = $1
        `, [id, workDate]);

        if (lineResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Line not found' });
        }

        const line = lineResult.rows[0];
        const productId = line.product_id;
        const target = parseInt(line.target) || 0;

        // Get SAH for the product (sum of all process steps)
        let totalSAH = 0;
        if (productId) {
            const sahResult = await pool.query(`
                SELECT COALESCE(SUM(operation_sah), 0) as total_sah
                FROM product_processes
                WHERE product_id = $1 AND is_active = true
            `, [productId]);
            totalSAH = parseFloat(sahResult.rows[0].total_sah) || 0;
        }

        // Get manpower (assigned employees count for this line)
        const mpResult = await pool.query(`
            SELECT COUNT(DISTINCT employee_id) as manpower
            FROM employee_process_assignments
            WHERE line_id = $1
        `, [id]);
        const manpower = parseInt(mpResult.rows[0].manpower) || 0;

        // Get working hours from settings
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');

        // Calculate working hours in decimal
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60);
        const workingSeconds = workingHours * 3600;

        // Get actual output for the day (prefer QA output if provided)
        const outputResult = await pool.query(`
            SELECT COALESCE(SUM(quantity), 0) as hourly_output
            FROM line_process_hourly_progress
            WHERE line_id = $1 AND work_date = $2
        `, [id, workDate]);
        const qaResult = await pool.query(
            `SELECT qa_output FROM line_daily_metrics WHERE line_id = $1 AND work_date = $2`,
            [id, workDate]
        );
        const hourlyOutput = parseInt(outputResult.rows[0].hourly_output) || 0;
        const qaOutput = parseInt(qaResult.rows[0]?.qa_output) || 0;
        const actualOutput = qaOutput > 0 ? qaOutput : hourlyOutput;

        // Calculate Takt Time (seconds per unit)
        // Takt Time = Available Working Time / Target
        const taktTime = target > 0 ? Math.round(workingSeconds / target) : 0;

        // Calculate Efficiency
        // Efficiency (%) = (Actual Output × SAH) / (Manpower × Working Hours) × 100
        let efficiency = 0;
        if (manpower > 0 && workingHours > 0 && totalSAH > 0) {
            const earnedHours = actualOutput * totalSAH;
            const availableHours = manpower * workingHours;
            efficiency = Math.round((earnedHours / availableHours) * 100 * 100) / 100; // 2 decimal places
        }

        // Calculate target efficiency (if target was met)
        let targetEfficiency = 0;
        if (manpower > 0 && workingHours > 0 && totalSAH > 0 && target > 0) {
            const targetEarnedHours = target * totalSAH;
            const availableHours = manpower * workingHours;
            targetEfficiency = Math.round((targetEarnedHours / availableHours) * 100 * 100) / 100;
        }

        res.json({
            success: true,
            data: {
                line_id: parseInt(id),
                line_name: line.line_name,
                work_date: workDate,
                product_code: line.product_code,
                product_name: line.product_name,

                // Inputs
                target: target,
                manpower: manpower,
                working_hours: workingHours,
                working_seconds: workingSeconds,
                total_sah: totalSAH,

                // Outputs
                actual_output: actualOutput,
                qa_output: qaOutput,

                // Calculated Metrics
                takt_time_seconds: taktTime,
                takt_time_display: taktTime > 0 ? `${taktTime}s` : '-',
                efficiency_percent: efficiency,
                target_efficiency_percent: targetEfficiency,

                // Progress
                completion_percent: target > 0 ? Math.round((actualOutput / target) * 100) : 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get metrics for all lines
router.get('/lines-metrics', async (req, res) => {
    const { date } = req.query;
    const workDate = date || new Date().toISOString().split('T')[0];

    try {
        // Get working hours from settings
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60);
        const workingSeconds = workingHours * 3600;

        const result = await pool.query(`
            SELECT
                pl.id as line_id,
                pl.line_name,
                pl.line_code,
                COALESCE(ldp.target_units, pl.target_units, 0) as target,
                COALESCE(p.product_code, '') as product_code,
                COALESCE(p.product_name, '') as product_name,
                ldp.incoming_product_id,
                COALESCE(ip.product_code, '') as incoming_product_code,
                COALESCE(ip.product_name, '') as incoming_product_name,
                COALESCE(ldp.incoming_target_units, 0) as incoming_target,
                COALESCE(
                    (SELECT SUM(pp.operation_sah)
                     FROM product_processes pp
                     WHERE pp.product_id = COALESCE(ldp.product_id, pl.current_product_id)
                     AND pp.is_active = true), 0
                ) as total_sah,
                COALESCE(
                    (SELECT COUNT(DISTINCT a.employee_id)
                     FROM employee_process_assignments a
                     WHERE a.line_id = pl.id), 0
                ) as manpower,
                COALESCE(ldm.qa_output, 0) as qa_output,
                COALESCE(
                    NULLIF(ldm.qa_output, 0),
                    (SELECT SUM(h.quantity)
                     FROM line_process_hourly_progress h
                     WHERE h.line_id = pl.id AND h.work_date = $1),
                    0
                ) as actual_output
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $1
            LEFT JOIN products p ON COALESCE(ldp.product_id, pl.current_product_id) = p.id
            LEFT JOIN products ip ON ldp.incoming_product_id = ip.id
            LEFT JOIN line_daily_metrics ldm ON ldm.line_id = pl.id AND ldm.work_date = $1
            WHERE pl.is_active = true
            ORDER BY pl.id
        `, [workDate]);

        const metrics = result.rows.map(row => {
            const target = parseInt(row.target) || 0;
            const manpower = parseInt(row.manpower) || 0;
            const totalSAH = parseFloat(row.total_sah) || 0;
            const actualOutput = parseInt(row.actual_output) || 0;
            const qaOutput = parseInt(row.qa_output) || 0;

            // Takt Time
            const taktTime = target > 0 ? Math.round(workingSeconds / target) : 0;

            // Efficiency
            let efficiency = 0;
            if (manpower > 0 && workingHours > 0 && totalSAH > 0) {
                const earnedHours = actualOutput * totalSAH;
                const availableHours = manpower * workingHours;
                efficiency = Math.round((earnedHours / availableHours) * 100 * 100) / 100;
            }

            return {
                line_id: row.line_id,
                line_name: row.line_name,
                line_code: row.line_code,
                product_code: row.product_code,
                product_name: row.product_name,
                incoming_product_code: row.incoming_product_code || null,
                incoming_product_name: row.incoming_product_name || null,
                changeover: !!row.incoming_product_id,
                target: target,
                incoming_target: parseInt(row.incoming_target) || 0,
                manpower: manpower,
                total_sah: totalSAH,
                actual_output: actualOutput,
                qa_output: qaOutput,
                takt_time_seconds: taktTime,
                efficiency_percent: efficiency,
                completion_percent: target > 0 ? Math.round((actualOutput / target) * 100) : 0
            };
        });

        res.json({ success: true, data: metrics, work_date: workDate, working_hours: workingHours });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// EMPLOYEES
// ============================================================================
router.get('/employees', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.*,
                   pl.line_name,
                   a.process_id,
                   o.operation_code,
                   o.operation_name,
                   p.product_code
            FROM employees e
            LEFT JOIN production_lines pl ON e.default_line_id = pl.id
            LEFT JOIN employee_process_assignments a ON e.id = a.employee_id
            LEFT JOIN product_processes pp ON a.process_id = pp.id
            LEFT JOIN operations o ON pp.operation_id = o.id
            LEFT JOIN products p ON pp.product_id = p.id
            ORDER BY e.emp_code
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/employees/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT e.*,
                   pl.line_name,
                   a.process_id,
                   o.operation_code,
                   o.operation_name,
                   p.product_code
            FROM employees e
            LEFT JOIN production_lines pl ON e.default_line_id = pl.id
            LEFT JOIN employee_process_assignments a ON e.id = a.employee_id
            LEFT JOIN product_processes pp ON a.process_id = pp.id
            LEFT JOIN operations o ON pp.operation_id = o.id
            LEFT JOIN products p ON pp.product_id = p.id
            WHERE e.id = $1
        `, [id]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/employees/:id/work-options', async (req, res) => {
    const { id } = req.params;
    try {
        const employeeResult = await pool.query(`
            SELECT e.id, e.default_line_id, pl.current_product_id
            FROM employees e
            LEFT JOIN production_lines pl ON e.default_line_id = pl.id
            WHERE e.id = $1
        `, [id]);
        const employee = employeeResult.rows[0];
        if (!employee) {
            return res.status(404).json({ success: false, error: 'Employee not found' });
        }

        let processes = [];
        if (employee.current_product_id) {
            const processesResult = await pool.query(`
                SELECT pp.id, pp.sequence_number, o.operation_code, o.operation_name
                FROM product_processes pp
                JOIN operations o ON pp.operation_id = o.id
                WHERE pp.product_id = $1
                ORDER BY pp.sequence_number
            `, [employee.current_product_id]);
            processes = processesResult.rows;
        }

        const assignmentResult = await pool.query(`
            SELECT process_id
            FROM employee_process_assignments
            WHERE employee_id = $1
        `, [id]);

        res.json({
            success: true,
            data: {
                processes,
                current_process_id: assignmentResult.rows[0]?.process_id || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/employees', validateBody(schemas.employee.partial()), async (req, res) => {
    const { emp_code, emp_name, designation, default_line_id, manpower_factor } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO employees (emp_code, emp_name, designation, default_line_id, manpower_factor, is_active)
             VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
            [emp_code, emp_name, designation, default_line_id, manpower_factor || 1]
        );
        realtime.broadcast('data_change', { entity: 'employees', action: 'create', id: result.rows[0].id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/employees/:id', async (req, res) => {
    const { id } = req.params;
    const { emp_code, emp_name, designation, default_line_id, manpower_factor, is_active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE employees
             SET emp_code = $1, emp_name = $2, designation = $3, default_line_id = $4, manpower_factor = $5, is_active = $6, updated_at = NOW()
             WHERE id = $7 RETURNING *`,
            [emp_code, emp_name, designation, default_line_id, manpower_factor || 1, is_active, id]
        );
        realtime.broadcast('data_change', { entity: 'employees', action: 'update', id: result.rows[0]?.id || id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/employees/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query(`UPDATE employees SET is_active = false WHERE id = $1`, [id]);
        realtime.broadcast('data_change', { entity: 'employees', action: 'delete', id });
        res.json({ success: true, message: 'Employee deactivated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PRODUCTS
// ============================================================================
router.get('/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*,
                   line_info.line_names,
                   line_info.line_ids,
                   today_primary.line_names as today_primary_lines,
                   today_primary.line_ids as today_primary_line_ids,
                   today_incoming.line_names as today_incoming_lines,
                   today_incoming.line_ids as today_incoming_line_ids,
                   (SELECT COUNT(*) FROM product_processes pp WHERE pp.product_id = p.id AND pp.is_active = true) as operations_count,
                   (SELECT COALESCE(SUM(pp.operation_sah), 0) FROM product_processes pp WHERE pp.product_id = p.id AND pp.is_active = true) as total_sah
            FROM products p
            LEFT JOIN LATERAL (
                SELECT
                    string_agg(pl.line_name, ', ' ORDER BY pl.line_name) as line_names,
                    array_agg(pl.id ORDER BY pl.id) as line_ids
                FROM production_lines pl
                WHERE pl.current_product_id = p.id
            ) line_info ON true
            LEFT JOIN LATERAL (
                SELECT
                    string_agg(pl.line_name, ', ' ORDER BY pl.line_name) as line_names,
                    array_agg(pl.id ORDER BY pl.id) as line_ids
                FROM line_daily_plans ldp
                JOIN production_lines pl ON ldp.line_id = pl.id
                WHERE ldp.work_date = CURRENT_DATE AND ldp.product_id = p.id
            ) today_primary ON true
            LEFT JOIN LATERAL (
                SELECT
                    string_agg(pl.line_name, ', ' ORDER BY pl.line_name) as line_names,
                    array_agg(pl.id ORDER BY pl.id) as line_ids
                FROM line_daily_plans ldp
                JOIN production_lines pl ON ldp.line_id = pl.id
                WHERE ldp.work_date = CURRENT_DATE AND ldp.incoming_product_id = p.id
            ) today_incoming ON true
            ORDER BY p.product_code
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Download reference Excel template for product process upload
// Export product with processes as Excel (same format as upload template)
router.get('/products/export/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const productRes = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (productRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        const product = productRes.rows[0];

        const processRes = await pool.query(`
            SELECT pp.*, o.operation_name
            FROM product_processes pp
            JOIN operations o ON pp.operation_id = o.id
            WHERE pp.product_id = $1 AND pp.is_active = true
            ORDER BY pp.sequence_number
        `, [id]);
        const processes = processRes.rows;

        const target = parseInt(product.target_qty || 0);
        const taktTime = target > 0 ? Math.round(28800 / target) : 0;

        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Product Process Setup');

        ws.columns = [
            { width: 15 }, { width: 15 }, { width: 22 }, { width: 35 },
            { width: 20 }, { width: 18 }, { width: 15 }
        ];

        const boldFont = { bold: true, size: 11 };
        const titleFont = { bold: true, size: 14 };
        const borderAll = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' }
        };

        // Title
        ws.mergeCells('A1:G1');
        const titleCell = ws.getCell('A1');
        titleCell.value = 'WORKERS - PROCESSWISE DETAILS';
        titleCell.font = { ...titleFont, color: { argb: 'FFFFFFFF' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        ws.getRow(1).height = 30;

        // Header fields
        const headerFields = [
            ['PRODUCT', product.category || '-'],
            ['BUYER', product.buyer_name || '-'],
            ['STYLE NO', product.product_code],
            ['DESCRIPTION', product.product_name],
            ['TARGET', target],
            ['TAKT TIME', taktTime]
        ];
        headerFields.forEach(([label, value], idx) => {
            const row = idx + 2;
            ws.mergeCells(`A${row}:D${row}`);
            ws.mergeCells(`E${row}:G${row}`);
            const lc = ws.getCell(`A${row}`);
            lc.value = label; lc.font = boldFont; lc.alignment = { horizontal: 'center' }; lc.border = borderAll;
            const vc = ws.getCell(`E${row}`);
            vc.value = value; vc.font = boldFont; vc.alignment = { horizontal: 'center' }; vc.border = borderAll;
        });

        // Table header (row 8)
        const tableHeaders = ['GROUP', 'WORK STATION', 'WORKER INPUT MAPPING', 'PROCESS DETAILS', 'PROCESS TIME (SEC)', 'CYCLE TIME (SEC)', 'WORK LOAD %'];
        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        const headerRow = ws.getRow(8);
        tableHeaders.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h; cell.font = boldFont; cell.fill = headerFill;
            cell.border = borderAll; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });
        headerRow.height = 30;

        // Calculate cycle times per workstation (only for processes WITH a workstation)
        const wsCycleTimes = {};
        processes.forEach(p => {
            const wsCode = (p.workstation_code || '').trim();
            if (wsCode) {
                const procTime = Math.round(parseFloat(p.operation_sah || 0) * 3600);
                wsCycleTimes[wsCode] = (wsCycleTimes[wsCode] || 0) + procTime;
            }
        });

        // Data rows
        const dataStartRow = 9;
        let totalProcessTime = 0;
        processes.forEach((proc, idx) => {
            const rowNum = dataStartRow + idx;
            const row = ws.getRow(rowNum);
            const procTime = Math.round(parseFloat(proc.operation_sah || 0) * 3600);
            const wsCode = (proc.workstation_code || '').trim();
            // If workstation assigned, cycle time = sum of all process times in that workstation
            // If no workstation, cycle time = this process's own time
            const cycleTime = wsCode ? (wsCycleTimes[wsCode] || procTime) : procTime;
            const workLoad = taktTime > 0 ? cycleTime / taktTime : 0;
            totalProcessTime += procTime;

            const values = [
                proc.group_name || '', proc.workstation_code || '', proc.worker_input_mapping || '',
                proc.operation_name, procTime, cycleTime
            ];
            values.forEach((val, colIdx) => {
                const cell = row.getCell(colIdx + 1);
                cell.value = val; cell.border = borderAll; cell.alignment = { horizontal: 'center' };
            });
            const loadCell = row.getCell(7);
            loadCell.value = workLoad; loadCell.numFmt = '0%';
            loadCell.border = borderAll; loadCell.alignment = { horizontal: 'center' };
        });

        // Total row
        const totalRowNum = dataStartRow + processes.length;
        const totalRow = ws.getRow(totalRowNum);
        ws.mergeCells(`A${totalRowNum}:D${totalRowNum}`);
        const tlc = totalRow.getCell(1);
        tlc.value = 'TOTAL TIME IN SECS'; tlc.font = boldFont; tlc.alignment = { horizontal: 'center' }; tlc.border = borderAll;
        const tpc = totalRow.getCell(5);
        tpc.value = totalProcessTime; tpc.font = boldFont; tpc.border = borderAll; tpc.alignment = { horizontal: 'center' };
        const tcc = totalRow.getCell(6);
        tcc.value = totalProcessTime; tcc.font = boldFont; tcc.border = borderAll; tcc.alignment = { horizontal: 'center' };
        totalRow.getCell(7).border = borderAll;

        const filename = `${product.product_code}_${product.product_name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
        await workbook.xlsx.write(res);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/products/upload-template', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Product Process Setup');

        // Columns: SEQ | PROCESS DETAILS | SAM (seconds)
        ws.columns = [
            { width: 12 }, { width: 45 }, { width: 18 }
        ];

        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        const boldFont = { bold: true, size: 11 };
        const titleFont = { bold: true, size: 14 };
        const borderAll = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' }
        };

        // Title row (merged A1:C1)
        ws.mergeCells('A1:C1');
        const titleCell = ws.getCell('A1');
        titleCell.value = 'PRODUCT PROCESS SETUP';
        titleCell.font = { ...titleFont, color: { argb: 'FFFFFFFF' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        ws.getRow(1).height = 30;

        // Header fields (rows 2-5): PRODUCT, BUYER, STYLE NO, DESCRIPTION
        const headerFields = [
            ['PRODUCT', 'SLG'],
            ['BUYER', 'COACH'],
            ['STYLE NO', '1234'],
            ['DESCRIPTION', 'BILLFOLD WALLET'],
        ];

        headerFields.forEach(([label, value], idx) => {
            const row = idx + 2;
            ws.mergeCells(`A${row}:B${row}`);  // A-B = label (no C needed — use just A label, B-C value)
            const labelCell = ws.getCell(`A${row}`);
            labelCell.value = label;
            labelCell.font = boldFont;
            labelCell.alignment = { horizontal: 'left' };
            labelCell.border = borderAll;
            const valCell = ws.getCell(`C${row}`);
            valCell.value = value;
            valCell.font = { size: 11 };
            valCell.alignment = { horizontal: 'left' };
            valCell.border = borderAll;
        });

        // Table header (row 6)
        const tableHeaders = ['SEQ', 'PROCESS DETAILS', 'SAM (seconds)'];
        const headerRow = ws.getRow(6);
        tableHeaders.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h;
            cell.font = boldFont;
            cell.fill = headerFill;
            cell.border = borderAll;
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });
        headerRow.height = 28;

        // Example data rows (rows 7+): [SEQ, PROCESS NAME, SAM_seconds]
        const exampleData = [
            [1, 'TOP PASTING', 28],
            [2, 'KIMLON PASTING', 22],
            [3, 'ATTACHING TOP & KIMLON', 35],
            [4, 'GUSSET STITCHING -2NOS', 45],
            [5, 'GUSSET LAMPING -2NOS', 40],
            [6, 'GUSSET SHAPING', 30],
            [7, 'PATTI PROMOTOR', 25],
            [8, 'PATTI PRIMER 1', 20],
            [9, 'PATTI PRIMER 2', 20],
            [10, 'PATTI DYE', 38],
            [11, 'CLEANING', 15],
        ];

        exampleData.forEach((rowData, idx) => {
            const rowNum = 7 + idx;
            const row = ws.getRow(rowNum);
            rowData.forEach((val, colIdx) => {
                const cell = row.getCell(colIdx + 1);
                cell.value = val;
                cell.border = borderAll;
                cell.alignment = { horizontal: colIdx === 1 ? 'left' : 'center' };
            });
        });

        // Instructions sheet
        const instrSheet = workbook.addWorksheet('Instructions');
        instrSheet.columns = [{ width: 80 }];
        const instructions = [
            'HOW TO USE THIS TEMPLATE',
            '',
            'This template is for creating/updating a PRODUCT with its process sequence.',
            'Workstation grouping and employee assignment are done separately by the IE team.',
            '',
            '1. Fill in the HEADER section (rows 2-5):',
            '   - PRODUCT: Product category (e.g., SLG, BAG)',
            '   - BUYER: Buyer/brand name (e.g., COACH)',
            '   - STYLE NO: Unique style number - this becomes the product code (REQUIRED)',
            '   - DESCRIPTION: Product description (REQUIRED)',
            '',
            '2. Fill in the PROCESS TABLE (row 7 onwards):',
            '   - SEQ: Sequence number (1, 2, 3...). Optional - will be auto-numbered if blank.',
            '   - PROCESS DETAILS: Name of the process/operation (REQUIRED)',
            '     * If this process does not exist in the system, it will be auto-created.',
            '     * Matched case-insensitively.',
            '   - SAM (seconds): Standard Allowed Minutes in seconds for this process.',
            '     * Example: 45 means 45 seconds per unit.',
            '     * Leave blank if unknown (can be updated later).',
            '',
            '3. IMPORTANT NOTES:',
            '   - STYLE NO must be unique. If it already exists, the product will be',
            '     updated and its existing processes will be replaced.',
            '   - Do NOT include workstation, group, or employee data here.',
            '     That is managed separately using the Workstation Plan Excel.',
        ];
        instructions.forEach((line, i) => {
            const cell = instrSheet.getCell(`A${i + 1}`);
            cell.value = line;
            if (i === 0) cell.font = { bold: true, size: 14 };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=product-process-template.xlsx');
        await workbook.xlsx.write(res);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Upload Excel to create/update product with processes (no line/workstation/employee assignment)
router.post('/products/upload-excel', excelUpload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded. Please upload an Excel file (.xlsx).' });
    }

    const client = await pool.connect();
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.getWorksheet(1);
        if (!sheet) {
            return res.status(400).json({ success: false, error: 'No worksheet found in the uploaded file.' });
        }

        // Parse header section (rows 2-5): label in col A-B, value in col C
        const getHeaderValue = (rowNum) => {
            const row = sheet.getRow(rowNum);
            return row.getCell(3).value || row.getCell(2).value || '';
        };

        const productCategory = String(getHeaderValue(2) || '').trim();
        const buyerName = String(getHeaderValue(3) || '').trim();
        const styleNo = String(getHeaderValue(4) || '').trim();
        const description = String(getHeaderValue(5) || '').trim();

        if (!styleNo) {
            return res.status(400).json({ success: false, error: 'STYLE NO (row 4) is required.' });
        }
        if (!description) {
            return res.status(400).json({ success: false, error: 'DESCRIPTION (row 5) is required.' });
        }

        // Parse process rows (row 7 onwards, row 6 is the table header)
        // Columns: A=SEQ, B=PROCESS DETAILS, C=SAM (seconds)
        const processRows = [];
        for (let rowNum = 7; rowNum <= sheet.rowCount; rowNum++) {
            const row = sheet.getRow(rowNum);
            const processName = String(row.getCell(2).value || '').trim();
            if (!processName) continue;
            const seqVal = row.getCell(1).value;
            const samVal = row.getCell(3).value;
            processRows.push({
                sequence_override: seqVal ? parseInt(seqVal) : null,
                process_name: processName,
                sam_seconds: samVal ? parseFloat(samVal) : 0
            });
        }

        if (processRows.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid process rows found. Fill PROCESS DETAILS from row 7 onwards.' });
        }

        await client.query('BEGIN');

        // 1. Find or create product by style no (product_code)
        let productResult = await client.query(
            'SELECT id FROM products WHERE UPPER(product_code) = UPPER($1)',
            [styleNo]
        );
        let productId;
        let productAction;

        if (productResult.rows.length > 0) {
            productId = productResult.rows[0].id;
            productAction = 'updated';
            await client.query(
                `UPDATE products SET product_name = $1, buyer_name = $2, category = $3,
                 updated_at = NOW(), updated_by = $4 WHERE id = $5`,
                [description, buyerName || null, productCategory || null, req.user?.id || null, productId]
            );
            await client.query(
                'UPDATE product_processes SET is_active = false, updated_at = NOW() WHERE product_id = $1',
                [productId]
            );
        } else {
            productAction = 'created';
            const insertResult = await client.query(
                `INSERT INTO products (product_code, product_name, product_description, category, buyer_name, is_active, created_by)
                 VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
                [styleNo, description, description, productCategory || null, buyerName || null, req.user?.id || null]
            );
            productId = insertResult.rows[0].id;
        }

        // 2. Get next available operation code
        const maxCodeResult = await client.query(
            `SELECT operation_code FROM operations WHERE operation_code ~ '^OP-[0-9]+$' ORDER BY operation_code DESC LIMIT 1`
        );
        let nextOpNum = 1;
        if (maxCodeResult.rows.length > 0) {
            const match = maxCodeResult.rows[0].operation_code.match(/^OP-(\d+)$/);
            if (match) nextOpNum = parseInt(match[1]) + 1;
        }

        // 3. Process each row - create operations and product_processes
        const newOperations = [];
        const operationCache = {};
        let autoSeq = 1;

        for (const row of processRows) {
            const processNameUpper = row.process_name.toUpperCase();
            const sequenceNumber = row.sequence_override || autoSeq;
            const operationSah = row.sam_seconds > 0 ? row.sam_seconds / 3600 : 0;

            let operationId;
            if (operationCache[processNameUpper]) {
                operationId = operationCache[processNameUpper];
            } else {
                const opResult = await client.query(
                    'SELECT id FROM operations WHERE UPPER(operation_name) = $1 AND is_active = true',
                    [processNameUpper]
                );
                if (opResult.rows.length > 0) {
                    operationId = opResult.rows[0].id;
                } else {
                    const opCode = `OP-${String(nextOpNum).padStart(4, '0')}`;
                    nextOpNum++;
                    const newOp = await client.query(
                        `INSERT INTO operations (operation_code, operation_name, is_active, created_by)
                         VALUES ($1, $2, true, $3) RETURNING id, operation_code`,
                        [opCode, row.process_name, req.user?.id || null]
                    );
                    operationId = newOp.rows[0].id;
                    newOperations.push({ code: opCode, name: row.process_name });
                }
                operationCache[processNameUpper] = operationId;
            }

            await client.query(
                `INSERT INTO product_processes
                 (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds,
                  manpower_required, is_active, created_by)
                 VALUES ($1, $2, $3, $4, $5, 1, true, $6)`,
                [productId, operationId, sequenceNumber, operationSah, Math.round(row.sam_seconds), req.user?.id || null]
            );
            autoSeq++;
        }

        await client.query('COMMIT');

        realtime.broadcast('data_change', { entity: 'products', action: productAction, id: productId });
        realtime.broadcast('data_change', { entity: 'product_processes', action: 'bulk_upload', product_id: productId });

        let message = `Product ${productAction} successfully with ${processRows.length} processes.`;
        if (newOperations.length) message += ` ${newOperations.length} new operations created.`;

        res.json({
            success: true,
            message,
            data: {
                product_id: productId,
                product_action: productAction,
                style_no: styleNo,
                description: description,
                buyer: buyerName,
                total_processes: processRows.length,
                new_operations_created: newOperations.length,
                new_operations: newOperations
            }
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: `Duplicate entry: ${err.detail || err.message}` });
        }
        res.status(500).json({ success: false, error: `Upload failed: ${err.message}` });
    } finally {
        client.release();
    }
});

router.get('/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const product = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
        const processes = await pool.query(`
            SELECT pp.*, o.operation_code, o.operation_name, o.operation_category, o.qr_code_path
            FROM product_processes pp
            JOIN operations o ON pp.operation_id = o.id
            WHERE pp.product_id = $1
            ORDER BY pp.sequence_number
        `, [id]);
        const workstations = await pool.query(`
            SELECT id, workspace_code, workspace_name, workspace_type, line_id, group_name, worker_input_mapping
            FROM workspaces WHERE is_active = true ORDER BY workspace_code
        `);
        res.json({ success: true, data: { product: product.rows[0], processes: processes.rows, workstations: workstations.rows } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/products', validateBody(schemas.product.partial()), async (req, res) => {
    const { product_code, product_name, product_description, category, buyer_name, target_qty, line_ids } = req.body;
    const normalizedLineIds = Array.isArray(line_ids)
        ? line_ids.map((id) => parseInt(id, 10)).filter(Boolean)
        : [];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO products (product_code, product_name, product_description, category, buyer_name, target_qty, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
            [product_code, product_name, product_description, category, buyer_name || null, parseInt(target_qty) || 0]
        );
        const productId = result.rows[0].id;

        if (normalizedLineIds.length) {
            await client.query(
                `UPDATE production_lines SET current_product_id = $1 WHERE id = ANY($2::int[])`,
                [productId, normalizedLineIds]
            );
        }

        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'products', action: 'create', id: productId });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

router.put('/products/:id', async (req, res) => {
    const { id } = req.params;
    const { product_code, product_name, product_description, category, buyer_name, target_qty, line_ids, is_active } = req.body;
    const hasLineIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'line_ids');
    const normalizedLineIds = Array.isArray(line_ids)
        ? line_ids.map((lineId) => parseInt(lineId, 10)).filter(Boolean)
        : [];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE products
             SET product_code = $1, product_name = $2, product_description = $3, category = $4, buyer_name = $5, target_qty = $6, is_active = $7, updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [product_code, product_name, product_description, category, buyer_name || null, parseInt(target_qty) || 0, is_active, id]
        );

        if (hasLineIds) {
            if (normalizedLineIds.length) {
                await client.query(
                    `UPDATE production_lines
                     SET current_product_id = NULL
                     WHERE current_product_id = $1 AND id <> ALL($2::int[])`,
                    [id, normalizedLineIds]
                );
                await client.query(
                    `UPDATE production_lines SET current_product_id = $1 WHERE id = ANY($2::int[])`,
                    [id, normalizedLineIds]
                );
            } else {
                await client.query(
                    `UPDATE production_lines SET current_product_id = NULL WHERE current_product_id = $1`,
                    [id]
                );
            }
        }

        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'products', action: 'update', id: result.rows[0]?.id || id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

router.delete('/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query(`UPDATE products SET is_active = false WHERE id = $1`, [id]);
        await pool.query(`UPDATE production_lines SET current_product_id = NULL WHERE current_product_id = $1`, [id]);
        realtime.broadcast('data_change', { entity: 'products', action: 'delete', id });
        res.json({ success: true, message: 'Product deactivated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// OPERATIONS (Master Library)
// ============================================================================
router.get('/operations', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*,
                   (SELECT COUNT(*) FROM product_processes pp WHERE pp.operation_id = o.id AND pp.is_active = true) as used_in_products
            FROM operations o
            ORDER BY o.operation_code
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/operations/categories', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT operation_category, COUNT(*) as count
            FROM operations WHERE is_active = true
            GROUP BY operation_category
            ORDER BY count DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/operations', validateBody(schemas.operation.partial()), async (req, res) => {
    const { operation_code, operation_name, operation_description, operation_category } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO operations (operation_code, operation_name, operation_description, operation_category, is_active)
             VALUES ($1, $2, $3, $4, true) RETURNING *`,
            [operation_code, operation_name, operation_description, operation_category]
        );
        realtime.broadcast('data_change', { entity: 'operations', action: 'create', id: result.rows[0].id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/operations/:id', async (req, res) => {
    const { id } = req.params;
    const { operation_code, operation_name, operation_description, operation_category, is_active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE operations
             SET operation_code = $1, operation_name = $2, operation_description = $3, operation_category = $4, is_active = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [operation_code, operation_name, operation_description, operation_category, is_active, id]
        );
        realtime.broadcast('data_change', { entity: 'operations', action: 'update', id: result.rows[0]?.id || id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/operations/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query(`UPDATE operations SET is_active = false WHERE id = $1`, [id]);
        realtime.broadcast('data_change', { entity: 'operations', action: 'delete', id });
        res.json({ success: true, message: 'Operation deactivated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PRODUCT PROCESSES (Link products to operations)
// ============================================================================
router.get('/product-processes/:productId', async (req, res) => {
    const { productId } = req.params;
    try {
        const result = await pool.query(`
            SELECT pp.*, o.operation_code, o.operation_name, o.operation_category, o.qr_code_path
            FROM product_processes pp
            JOIN operations o ON pp.operation_id = o.id
            WHERE pp.product_id = $1
            ORDER BY pp.sequence_number
        `, [productId]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/product-processes', async (req, res) => {
    const { product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds } = req.body;
    try {
        const today = new Date().toISOString().slice(0, 10);
        if (await isProductLocked(product_id, today)) {
            return res.status(403).json({ success: false, error: 'Process flow is locked for today' });
        }
        const samSeconds = cycle_time_seconds || (operation_sah ? Math.round(parseFloat(operation_sah) * 3600) : 0);
        const samHours = operation_sah || (cycle_time_seconds ? cycle_time_seconds / 3600 : 0);
        const result = await pool.query(
            `INSERT INTO product_processes
             (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds, manpower_required, is_active)
             VALUES ($1, $2, $3, $4, $5, 1, true) RETURNING *`,
            [product_id, operation_id, sequence_number, samHours, samSeconds]
        );
        realtime.broadcast('data_change', { entity: 'product_processes', action: 'create', product_id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/product-processes/:id', async (req, res) => {
    const { id } = req.params;
    const { sequence_number, operation_sah, cycle_time_seconds } = req.body;
    try {
        const productResult = await pool.query(
            `SELECT product_id FROM product_processes WHERE id = $1`, [id]
        );
        const productId = productResult.rows[0]?.product_id;
        const today = new Date().toISOString().slice(0, 10);
        if (productId && await isProductLocked(productId, today)) {
            return res.status(403).json({ success: false, error: 'Process flow is locked for today' });
        }
        const samSeconds = cycle_time_seconds || (operation_sah ? Math.round(parseFloat(operation_sah) * 3600) : 0);
        const samHours = operation_sah || (cycle_time_seconds ? cycle_time_seconds / 3600 : 0);
        const result = await pool.query(
            `UPDATE product_processes
             SET sequence_number = $1, operation_sah = $2, cycle_time_seconds = $3, updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [sequence_number, samHours, samSeconds, id]
        );
        realtime.broadcast('data_change', { entity: 'product_processes', action: 'update', id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/product-processes/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const productResult = await pool.query(
            `SELECT product_id FROM product_processes WHERE id = $1`,
            [id]
        );
        const productId = productResult.rows[0]?.product_id;
        const today = new Date().toISOString().slice(0, 10);
        if (productId && await isProductLocked(productId, today)) {
            return res.status(403).json({ success: false, error: 'Process flow is locked for today' });
        }
        await pool.query(`DELETE FROM product_processes WHERE id = $1`, [id]);
        realtime.broadcast('data_change', { entity: 'product_processes', action: 'delete', id });
        res.json({ success: true, message: 'Process removed successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PROCESS ASSIGNMENTS (Process -> Employee)
// ============================================================================
router.post('/process-assignments', async (req, res) => {
    const { process_id, employee_id, line_id } = req.body;
    if (!process_id || !line_id) {
        return res.status(400).json({ success: false, error: 'process_id and line_id are required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `DELETE FROM employee_process_assignments WHERE process_id = $1 AND line_id = $2`,
            [process_id, line_id]
        );

        if (employee_id) {
            await client.query(
                `DELETE FROM employee_process_assignments WHERE employee_id = $1`,
                [employee_id]
            );
            await client.query(
                `INSERT INTO employee_process_assignments (process_id, employee_id, line_id)
                 VALUES ($1, $2, $3)`,
                [process_id, employee_id, line_id]
            );
        }

        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'process_assignments', action: 'update', process_id, employee_id: employee_id || null, line_id });
        res.json({ success: true, data: { process_id, employee_id: employee_id || null, line_id } });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

router.get('/process-assignments', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT process_id, employee_id, line_id
            FROM employee_process_assignments
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Assign/unassign a process to/from a workstation
router.put('/process-assignments/workspace', async (req, res) => {
    const { process_id, workspace_id } = req.body;
    if (!process_id) {
        return res.status(400).json({ success: false, error: 'process_id is required' });
    }
    try {
        await pool.query(
            `UPDATE product_processes SET workspace_id = $1, updated_at = NOW() WHERE id = $2`,
            [workspace_id || null, process_id]
        );
        realtime.broadcast('data_change', { entity: 'workstations', action: 'process_workspace_updated' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// WORKSTATION ASSIGNMENTS (Workstation -> Employee) — date-aware
// ============================================================================
router.post('/workstation-assignments', async (req, res) => {
    const { line_id, workstation_code, employee_id, work_date, line_plan_workstation_id } = req.body;
    if (!line_id || !workstation_code) {
        return res.status(400).json({ success: false, error: 'line_id and workstation_code are required' });
    }
    const date = work_date || new Date().toISOString().slice(0, 10);
    try {
        if (employee_id) {
            await pool.query(
                `INSERT INTO employee_workstation_assignments (line_id, workstation_code, employee_id, work_date, line_plan_workstation_id)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (line_id, work_date, workstation_code)
                 DO UPDATE SET employee_id = EXCLUDED.employee_id,
                               line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                               assigned_at = NOW()`,
                [line_id, workstation_code, employee_id, date, line_plan_workstation_id || null]
            );
        } else {
            await pool.query(
                `DELETE FROM employee_workstation_assignments WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3`,
                [line_id, date, workstation_code]
            );
        }
        realtime.broadcast('data_change', { entity: 'workstation_assignments', action: 'update', line_id, workstation_code, work_date: date });
        res.json({ success: true, data: { line_id, workstation_code, employee_id: employee_id || null, work_date: date } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/workstation-assignments', async (req, res) => {
    const { line_id, work_date } = req.query;
    if (!line_id) {
        return res.status(400).json({ success: false, error: 'line_id is required' });
    }
    const date = work_date || new Date().toISOString().slice(0, 10);
    try {
        const result = await pool.query(`
            SELECT ewa.id, ewa.workstation_code, ewa.employee_id, ewa.work_date, ewa.line_plan_workstation_id,
                   e.emp_code, e.emp_name
            FROM employee_workstation_assignments ewa
            LEFT JOIN employees e ON ewa.employee_id = e.id
            WHERE ewa.line_id = $1 AND ewa.work_date = $2
            ORDER BY ewa.workstation_code
        `, [line_id, date]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/workstation-assignments/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM employee_workstation_assignments WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// LINE WORKSTATION PLAN (Line Balancing — per line, per date)
// ============================================================================

// Helper: line balancing algorithm
function runLineBalancing(processes, taktTimeSeconds) {
    const workstations = [];
    let current = { processes: [], sam: 0 };
    for (const p of processes) {
        const pSam = parseFloat(p.operation_sah || 0) * 3600;
        if (current.processes.length > 0 && taktTimeSeconds > 0 && current.sam + pSam > taktTimeSeconds) {
            workstations.push(current);
            current = { processes: [p], sam: pSam };
        } else {
            current.processes.push(p);
            current.sam += pSam;
        }
    }
    if (current.processes.length > 0) workstations.push(current);
    // Hard cap at 100
    if (workstations.length > 100) {
        const overflow = workstations.splice(100);
        overflow.forEach(ow => {
            ow.processes.forEach(p => workstations[99].processes.push(p));
            workstations[99].sam += ow.sam;
        });
    }
    return workstations.map((ws, i) => ({
        workstation_number: i + 1,
        workstation_code: 'WS' + String(i + 1).padStart(2, '0'),
        actual_sam_seconds: Math.round(ws.sam * 100) / 100,
        workload_pct: taktTimeSeconds > 0 ? Math.round((ws.sam / taktTimeSeconds) * 10000) / 100 : 0,
        processes: ws.processes
    }));
}

// POST /lines/:lineId/workstation-plan/generate — auto-generate plan from daily plan target
router.post('/lines/:lineId/workstation-plan/generate', async (req, res) => {
    const { lineId } = req.params;
    const { work_date } = req.body;
    const date = work_date || new Date().toISOString().slice(0, 10);
    try {
        // Get daily plan
        const planResult = await pool.query(
            `SELECT ldp.product_id, ldp.target_units
             FROM line_daily_plans ldp
             WHERE ldp.line_id = $1 AND ldp.work_date = $2`,
            [lineId, date]
        );
        const plan = planResult.rows[0];
        if (!plan) {
            return res.status(400).json({ success: false, error: 'No daily plan set for this line and date. Set a product and target first.' });
        }
        if (!plan.target_units || plan.target_units <= 0) {
            return res.status(400).json({ success: false, error: 'Target units must be greater than 0 to generate workstations.' });
        }

        // Get working seconds from settings
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingSeconds = ((outH * 60 + outM) - (inH * 60 + inM)) * 60;
        const taktTime = workingSeconds / plan.target_units;

        // Get product processes ordered by sequence
        const procResult = await pool.query(
            `SELECT pp.id, pp.sequence_number, pp.operation_sah, pp.operation_id,
                    o.operation_code, o.operation_name
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             WHERE pp.product_id = $1 AND pp.is_active = true
             ORDER BY pp.sequence_number ASC`,
            [plan.product_id]
        );
        const processes = procResult.rows;
        if (!processes.length) {
            return res.status(400).json({ success: false, error: 'No active processes defined for this product. Add processes with SAH values first.' });
        }

        // Run balancing
        const balanced = runLineBalancing(processes, taktTime);

        // Delete existing plan for this line+date+product
        await pool.query(
            `DELETE FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2 AND product_id = $3`,
            [lineId, date, plan.product_id]
        );

        // Insert new workstations
        const inserted = [];
        for (const ws of balanced) {
            const wsResult = await pool.query(
                `INSERT INTO line_plan_workstations
                 (line_id, work_date, product_id, workstation_number, workstation_code, takt_time_seconds, actual_sam_seconds, workload_pct)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING *`,
                [lineId, date, plan.product_id, ws.workstation_number, ws.workstation_code,
                 Math.round(taktTime * 100) / 100, ws.actual_sam_seconds, ws.workload_pct]
            );
            const wsRow = wsResult.rows[0];
            for (let i = 0; i < ws.processes.length; i++) {
                await pool.query(
                    `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation)
                     VALUES ($1, $2, $3)`,
                    [wsRow.id, ws.processes[i].id, i + 1]
                );
            }
            inserted.push({
                ...wsRow,
                processes: ws.processes
            });
        }

        realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'generated', line_id: lineId, work_date: date });
        res.json({
            success: true,
            data: {
                workstations: inserted,
                takt_time_seconds: Math.round(taktTime * 100) / 100,
                working_seconds: workingSeconds,
                target_units: plan.target_units,
                total_workstations: inserted.length
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /lines/:lineId/workstation-plan — get plan with employee assignments
router.get('/lines/:lineId/workstation-plan', async (req, res) => {
    const { lineId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
        const wsResult = await pool.query(
            `SELECT lpw.*, p.product_code, p.product_name
             FROM line_plan_workstations lpw
             JOIN products p ON lpw.product_id = p.id
             WHERE lpw.line_id = $1 AND lpw.work_date = $2
             ORDER BY lpw.workstation_number`,
            [lineId, date]
        );
        const workstations = wsResult.rows;
        if (!workstations.length) {
            return res.json({ success: true, data: { workstations: [], takt_time_seconds: 0, work_date: date } });
        }
        const taktTime = parseFloat(workstations[0].takt_time_seconds || 0);

        // Get processes for each workstation
        for (const ws of workstations) {
            const procResult = await pool.query(
                `SELECT lpwp.id as mapping_id, lpwp.sequence_in_workstation,
                        pp.id as process_id, pp.sequence_number, pp.operation_sah,
                        o.operation_code, o.operation_name
                 FROM line_plan_workstation_processes lpwp
                 JOIN product_processes pp ON lpwp.product_process_id = pp.id
                 JOIN operations o ON pp.operation_id = o.id
                 WHERE lpwp.workstation_id = $1
                 ORDER BY lpwp.sequence_in_workstation, pp.sequence_number`,
                [ws.id]
            );
            ws.processes = procResult.rows;
            // Get assigned employee
            const empResult = await pool.query(
                `SELECT ewa.id, ewa.employee_id, e.emp_code, e.emp_name
                 FROM employee_workstation_assignments ewa
                 LEFT JOIN employees e ON ewa.employee_id = e.id
                 WHERE ewa.line_plan_workstation_id = $1 OR (ewa.line_id = $2 AND ewa.work_date = $3 AND ewa.workstation_code = $4)
                 LIMIT 1`,
                [ws.id, lineId, date, ws.workstation_code]
            );
            ws.assigned_employee = empResult.rows[0] || null;
        }

        res.json({
            success: true,
            data: {
                workstations,
                takt_time_seconds: taktTime,
                work_date: date,
                target_units: workstations[0] ? null : 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /workstation-plan/workstations/:wsId/processes — update processes in a workstation (manual adjustment)
router.put('/workstation-plan/workstations/:wsId/processes', async (req, res) => {
    const { wsId } = req.params;
    const { process_ids } = req.body; // array of product_process ids in order
    if (!Array.isArray(process_ids)) {
        return res.status(400).json({ success: false, error: 'process_ids must be an array' });
    }
    try {
        const wsResult = await pool.query('SELECT * FROM line_plan_workstations WHERE id = $1', [wsId]);
        const ws = wsResult.rows[0];
        if (!ws) return res.status(404).json({ success: false, error: 'Workstation not found' });

        // Delete existing mappings
        await pool.query('DELETE FROM line_plan_workstation_processes WHERE workstation_id = $1', [wsId]);

        // Re-insert in given order
        let totalSam = 0;
        for (let i = 0; i < process_ids.length; i++) {
            const pidResult = await pool.query('SELECT operation_sah FROM product_processes WHERE id = $1', [process_ids[i]]);
            if (pidResult.rows[0]) totalSam += parseFloat(pidResult.rows[0].operation_sah || 0) * 3600;
            await pool.query(
                `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation)
                 VALUES ($1, $2, $3)`,
                [wsId, process_ids[i], i + 1]
            );
        }

        // Recalculate workload
        const takt = parseFloat(ws.takt_time_seconds || 0);
        const workload = takt > 0 ? Math.round((totalSam / takt) * 10000) / 100 : 0;
        await pool.query(
            `UPDATE line_plan_workstations SET actual_sam_seconds = $1, workload_pct = $2, updated_at = NOW() WHERE id = $3`,
            [Math.round(totalSam * 100) / 100, workload, wsId]
        );

        realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'update', line_id: ws.line_id, work_date: ws.work_date });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /workstation-plan/workstations — add an empty workstation to an existing plan
router.post('/workstation-plan/workstations', async (req, res) => {
    const { line_id, work_date } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    try {
        const planResult = await pool.query(
            `SELECT ldp.product_id, ldp.target_units
             FROM line_daily_plans ldp WHERE ldp.line_id = $1 AND ldp.work_date = $2`,
            [line_id, work_date]
        );
        if (!planResult.rows[0]) return res.status(400).json({ success: false, error: 'No daily plan for this line/date' });
        const product_id = planResult.rows[0].product_id;

        const maxResult = await pool.query(
            `SELECT COALESCE(MAX(workstation_number), 0) as max_num, MIN(takt_time_seconds) as takt
             FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const nextNum = parseInt(maxResult.rows[0].max_num || 0, 10) + 1;
        if (nextNum > 100) return res.status(400).json({ success: false, error: 'Maximum of 100 workstations reached' });
        const takt = parseFloat(maxResult.rows[0].takt || 0);
        const wsCode = 'WS' + String(nextNum).padStart(2, '0');

        const result = await pool.query(
            `INSERT INTO line_plan_workstations (line_id, work_date, product_id, workstation_number, workstation_code, takt_time_seconds, actual_sam_seconds, workload_pct)
             VALUES ($1, $2, $3, $4, $5, $6, 0, 0) RETURNING *`,
            [line_id, work_date, product_id, nextNum, wsCode, takt]
        );
        realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'update', line_id, work_date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /workstation-plan/workstations/:wsId — remove a workstation (only if empty)
router.delete('/workstation-plan/workstations/:wsId', async (req, res) => {
    try {
        const check = await pool.query('SELECT COUNT(*) FROM line_plan_workstation_processes WHERE workstation_id = $1', [req.params.wsId]);
        if (parseInt(check.rows[0].count, 10) > 0) {
            return res.status(400).json({ success: false, error: 'Move all processes out of this workstation before deleting it' });
        }
        const ws = await pool.query('SELECT line_id, work_date FROM line_plan_workstations WHERE id = $1', [req.params.wsId]);
        await pool.query('DELETE FROM line_plan_workstations WHERE id = $1', [req.params.wsId]);
        if (ws.rows[0]) {
            realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'update', ...ws.rows[0] });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /workstation-plan/workstations/:wsId/group — set group name
router.put('/workstation-plan/workstations/:wsId/group', async (req, res) => {
    const { group_name } = req.body;
    try {
        const ws = await pool.query('SELECT line_id, work_date FROM line_plan_workstations WHERE id = $1', [req.params.wsId]);
        if (!ws.rows[0]) return res.status(404).json({ success: false, error: 'Workstation not found' });
        await pool.query('UPDATE line_plan_workstations SET group_name = $1, updated_at = NOW() WHERE id = $2', [group_name || null, req.params.wsId]);
        realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'update', ...ws.rows[0] });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /lines/:lineId/line-process-details — flat process list with current WS/group assignments
router.get('/lines/:lineId/line-process-details', async (req, res) => {
    const { lineId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const overrideProductId = req.query.product_id ? parseInt(req.query.product_id, 10) : null;
    const overrideTarget = req.query.target ? parseInt(req.query.target, 10) : 0;
    try {
        let product_id, target_units, product_code, product_name;

        const planResult = await pool.query(
            `SELECT ldp.id AS plan_id, ldp.product_id, ldp.target_units,
                    ldp.overtime_minutes, ldp.overtime_target,
                    ldp.incoming_product_id, ldp.incoming_target_units, ldp.changeover_sequence,
                    ldp.is_locked,
                    p.product_code, p.product_name
             FROM line_daily_plans ldp
             JOIN products p ON ldp.product_id = p.id
             WHERE ldp.line_id = $1 AND ldp.work_date = $2`,
            [lineId, date]
        );

        let overtime_minutes = 0, overtime_target = 0;
        let plan_id = null, incoming_product_id = null, incoming_target_units = 0;
        let changeover_sequence = 0, is_locked = false;
        if (planResult.rows[0]) {
            ({ product_id, target_units, product_code, product_name,
               overtime_minutes, overtime_target, plan_id,
               incoming_product_id, incoming_target_units, changeover_sequence,
               is_locked } = planResult.rows[0]);
            overtime_minutes = overtime_minutes || 0;
            overtime_target = overtime_target || 0;
            incoming_product_id = incoming_product_id || null;
            incoming_target_units = incoming_target_units || 0;
            changeover_sequence = changeover_sequence || 0;
        } else if (overrideProductId) {
            // Plan not saved yet — use the product currently selected in the UI dropdown
            const prodResult = await pool.query(
                `SELECT id, product_code, product_name FROM products WHERE id = $1`,
                [overrideProductId]
            );
            if (prodResult.rows[0]) {
                product_id = overrideProductId;
                target_units = overrideTarget || 0;
                product_code = prodResult.rows[0].product_code;
                product_name = prodResult.rows[0].product_name;
            }
        }

        const lineInfoResult = await pool.query(
            'SELECT line_code, line_name FROM production_lines WHERE id = $1', [lineId]
        );
        const lineInfo = lineInfoResult.rows[0] || {};

        if (!product_id) {
            return res.json({ success: true, data: { line: lineInfo, processes: [], employees: [], takt_time_seconds: 0, target_units: 0, product: null } });
        }

        // When an overrideProductId is supplied (e.g. for changeover product view),
        // use it for the process/workstation query even if a primary plan already exists.
        // The plan-level fields (OT, incoming, locked) always come from the primary plan.
        const queryProductId = overrideProductId || product_id;
        const queryTarget    = (overrideProductId && overrideTarget > 0) ? overrideTarget : target_units;

        // Resolve product name for the queried product if different from plan product
        let queryProductCode = product_code, queryProductName = product_name;
        if (overrideProductId && overrideProductId !== product_id) {
            const qpRes = await pool.query(
                `SELECT product_code, product_name FROM products WHERE id = $1`, [overrideProductId]
            );
            if (qpRes.rows[0]) { queryProductCode = qpRes.rows[0].product_code; queryProductName = qpRes.rows[0].product_name; }
        }

        // Working seconds = (out_time - in_time) - lunch_break_minutes
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const lunchMins = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10);
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingSecs = ((outH * 60 + outM) - (inH * 60 + inM) - lunchMins) * 60;
        const taktSecs = queryTarget > 0 ? workingSecs / queryTarget : 0;

        // Subquery restricts to THIS line/date only — prevents duplicate rows when the
        // same product's processes are assigned on other lines or dates.
        const processResult = await pool.query(
            `SELECT pp.id, pp.sequence_number, pp.operation_sah, pp.cycle_time_seconds,
                    o.operation_code, o.operation_name, o.qr_code_path,
                    ws_info.lpw_id, ws_info.group_name, ws_info.workstation_code,
                    ws_info.workload_pct, ws_info.actual_sam_seconds,
                    ws_info.is_ot_skipped,
                    ewa.employee_id,    e.emp_code,    e.emp_name,    e.qr_code_path    AS emp_qr_code_path,
                    ewa_ot.employee_id AS ot_employee_id,
                    e_ot.emp_code      AS ot_emp_code,
                    e_ot.emp_name      AS ot_emp_name,
                    e_ot.qr_code_path  AS ot_emp_qr_code_path
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             LEFT JOIN (
                 SELECT DISTINCT ON (lpwp.product_process_id)
                        lpwp.product_process_id,
                        lpw.id AS lpw_id, lpw.group_name, lpw.workstation_code,
                        lpw.workload_pct, lpw.actual_sam_seconds,
                        lpw.is_ot_skipped
                 FROM line_plan_workstations lpw
                 JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
                 WHERE lpw.line_id = $1 AND lpw.work_date = $2 AND lpw.product_id = $3
                 ORDER BY lpwp.product_process_id, lpw.id
             ) ws_info ON ws_info.product_process_id = pp.id
             LEFT JOIN employee_workstation_assignments ewa ON ewa.line_plan_workstation_id = ws_info.lpw_id
                 AND ewa.line_id = $1 AND ewa.work_date = $2 AND ewa.is_overtime = false
             LEFT JOIN employees e ON ewa.employee_id = e.id
             LEFT JOIN employee_workstation_assignments ewa_ot ON ewa_ot.line_plan_workstation_id = ws_info.lpw_id
                 AND ewa_ot.line_id = $1 AND ewa_ot.work_date = $2 AND ewa_ot.is_overtime = true
             LEFT JOIN employees e_ot ON ewa_ot.employee_id = e_ot.id
             WHERE pp.product_id = $3 AND pp.is_active = true
             ORDER BY pp.sequence_number`,
            [lineId, date, queryProductId]
        );

        const empResult = await pool.query(
            `SELECT id, emp_code, emp_name, qr_code_path FROM employees WHERE is_active = true ORDER BY emp_code`
        );

        const productsResult = await pool.query(
            `SELECT id, product_code, product_name FROM products WHERE is_active = true ORDER BY product_code`
        );

        // All employee–workstation assignments for this date (factory-wide, for exclusivity enforcement).
        // is_overtime included so the frontend can filter by current mode.
        const allAssignmentsResult = await pool.query(
            `SELECT employee_id, line_id, workstation_code, is_overtime
             FROM employee_workstation_assignments
             WHERE work_date = $1 AND employee_id IS NOT NULL`,
            [date]
        );

        res.json({
            success: true,
            data: {
                line: lineInfo,
                processes: processResult.rows,
                employees: empResult.rows,
                all_assignments: allAssignmentsResult.rows,
                products: productsResult.rows,
                takt_time_seconds: taktSecs,
                target_units: queryTarget,
                overtime_minutes,
                overtime_target,
                plan_id,
                is_locked,
                incoming_product_id,
                incoming_target_units,
                changeover_sequence,
                product: { id: queryProductId, product_code: queryProductCode, product_name: queryProductName }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /lines/:lineId/workstation-plan/save — save from flat table (group/WS per process + employee)
router.post('/lines/:lineId/workstation-plan/save', async (req, res) => {
    const { lineId } = req.params;
    const { work_date, rows, product_id: bodyProductId, target_units: bodyTarget } = req.body;
    if (!work_date || !Array.isArray(rows)) {
        return res.status(400).json({ success: false, error: 'work_date and rows are required' });
    }
    try {
        const planResult = await pool.query(
            `SELECT target_units, product_id FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [lineId, work_date]
        );
        // Fall back to values passed from the UI if no saved plan exists yet
        const target_units = planResult.rows[0]?.target_units ?? (bodyTarget ? parseInt(bodyTarget, 10) : 0);
        const product_id = planResult.rows[0]?.product_id ?? (bodyProductId ? parseInt(bodyProductId, 10) : null);
        if (!product_id) {
            return res.status(400).json({ success: false, error: 'No product selected for this line and date' });
        }

        // Working seconds = (out_time - in_time) - lunch_break_minutes
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const lunchMins = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10);
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingSecs = ((outH * 60 + outM) - (inH * 60 + inM) - lunchMins) * 60;
        const taktSecs = target_units > 0 ? workingSecs / target_units : 0;

        const processIds = rows.map(r => parseInt(r.process_id, 10)).filter(Boolean);
        const samResult = await pool.query(
            `SELECT pp.id, pp.sequence_number, pp.operation_sah, o.operation_code
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             WHERE pp.id = ANY($1::int[])`,
            [processIds]
        );
        const samMap = new Map(samResult.rows.map(r => [parseInt(r.id), parseFloat(r.operation_sah || 0)]));
        const seqMap = new Map(samResult.rows.map(r => [parseInt(r.id), { seq: r.sequence_number, code: r.operation_code }]));

        // Validate workstation sequence: WS numeric codes must be monotonically non-decreasing
        // as process sequence_number increases. This ensures the line layout is in order.
        {
            const ordered = rows
                .map(r => ({ pid: parseInt(r.process_id, 10), ws: (r.workstation_code || '').trim() }))
                .filter(r => r.ws)
                .sort((a, b) => (seqMap.get(a.pid)?.seq || 0) - (seqMap.get(b.pid)?.seq || 0));
            let maxWsNum = 0;
            let maxWsCode = '';
            for (const r of ordered) {
                const wsNum = parseInt(r.ws.replace(/\D/g, '') || '0', 10);
                if (wsNum < maxWsNum) {
                    const info = seqMap.get(r.pid) || {};
                    return res.status(400).json({
                        success: false,
                        error: `Workstation Assignment Conflict: Process (Seq ${info.seq} — ${info.code || 'Process #' + r.pid}) ` +
                               `cannot be assigned to Workstation "${r.ws}" as it breaks the sequential order. ` +
                               `A preceding process is already assigned to Workstation "${maxWsCode}", which is further along the line. ` +
                               `Workstation assignments must follow the process sequence — please revise the layout to maintain sequential flow.`
                    });
                }
                if (wsNum > maxWsNum) { maxWsNum = wsNum; maxWsCode = r.ws; }
            }
        }

        // Group rows by workstation_code — preserve insertion order
        const wsMap = new Map();
        rows.forEach(row => {
            const wsCode = (row.workstation_code || '').trim();
            if (!wsCode) return;
            if (!wsMap.has(wsCode)) {
                wsMap.set(wsCode, {
                    group_name: (row.group_name || '').trim() || null,
                    workstation_code: wsCode,
                    employee_id: row.employee_id ? parseInt(row.employee_id, 10) : null,
                    processes: []
                });
            }
            const ws = wsMap.get(wsCode);
            ws.processes.push(parseInt(row.process_id, 10));
            if (!ws.employee_id && row.employee_id) ws.employee_id = parseInt(row.employee_id, 10);
            if (!ws.group_name && row.group_name) ws.group_name = (row.group_name || '').trim() || null;
        });

        // Delete existing plan for this line+date+product only
        await pool.query(`DELETE FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2 AND product_id = $3`, [lineId, work_date, product_id]);

        const wsEntries = Array.from(wsMap.values());
        let wsNumber = 1;
        for (const ws of wsEntries) {
            // De-duplicate process IDs (guard against frontend sending duplicates)
            ws.processes = [...new Set(ws.processes)];
            const actualSam = ws.processes.reduce((sum, pid) => sum + (samMap.get(pid) || 0) * 3600, 0);
            const workloadPct = taktSecs > 0 ? (actualSam / taktSecs) * 100 : 0;
            const wsResult = await pool.query(
                `INSERT INTO line_plan_workstations
                 (line_id, work_date, product_id, workstation_number, workstation_code, group_name,
                  takt_time_seconds, actual_sam_seconds, workload_pct)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                [lineId, work_date, product_id, wsNumber++, ws.workstation_code, ws.group_name,
                 Math.round(taktSecs * 100) / 100,
                 Math.round(actualSam * 100) / 100,
                 Math.round(workloadPct * 100) / 100]
            );
            const wsId = wsResult.rows[0].id;
            for (let i = 0; i < ws.processes.length; i++) {
                await pool.query(
                    `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation)
                     VALUES ($1, $2, $3)`,
                    [wsId, ws.processes[i], i + 1]
                );
            }
            if (ws.employee_id) {
                await pool.query(
                    `INSERT INTO employee_workstation_assignments
                     (line_id, work_date, workstation_code, employee_id, line_plan_workstation_id, is_overtime)
                     VALUES ($1, $2, $3, $4, $5, false)
                     ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                     DO UPDATE SET employee_id = EXCLUDED.employee_id,
                                   line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                   assigned_at = NOW()`,
                    [lineId, work_date, ws.workstation_code, ws.employee_id, wsId]
                );
            }
        }

        realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'saved', line_id: lineId, work_date });
        res.json({ success: true, message: `Saved ${wsEntries.length} workstation(s)` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /lines/:lineId/workstation-plan/employees — save only employee assignments (regular or OT)
// Does NOT touch the workstation plan structure. Used for OT shift employee assignments.
router.patch('/lines/:lineId/workstation-plan/employees', async (req, res) => {
    const { lineId } = req.params;
    const { work_date, is_overtime, assignments } = req.body;
    if (!work_date || !Array.isArray(assignments)) {
        return res.status(400).json({ success: false, error: 'work_date and assignments are required' });
    }
    const isOT = !!is_overtime;
    try {
        for (const a of assignments) {
            const wsCode = (a.workstation_code || '').trim();
            if (!wsCode) continue;
            const empId = a.employee_id ? parseInt(a.employee_id, 10) : null;
            const isSkipped = isOT && !!a.is_skipped; // only relevant for OT

            // Update is_ot_skipped on the workstation plan row (OT only)
            if (isOT) {
                await pool.query(
                    `UPDATE line_plan_workstations SET is_ot_skipped = $1
                     WHERE line_id = $2 AND work_date = $3 AND workstation_code = $4`,
                    [isSkipped, lineId, work_date, wsCode]
                );
            }

            if (empId && !isSkipped) {
                // Resolve the line_plan_workstation_id for this workstation
                const lpwResult = await pool.query(
                    `SELECT id FROM line_plan_workstations
                     WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3
                     ORDER BY id LIMIT 1`,
                    [lineId, work_date, wsCode]
                );
                const lpwId = lpwResult.rows[0]?.id || null;
                await pool.query(
                    `INSERT INTO employee_workstation_assignments
                     (line_id, work_date, workstation_code, employee_id, line_plan_workstation_id, is_overtime)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                     DO UPDATE SET employee_id = EXCLUDED.employee_id,
                                   line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                   assigned_at = NOW()`,
                    [lineId, work_date, wsCode, empId, lpwId, isOT]
                );
            } else {
                // Clear assignment (skipped or no employee)
                await pool.query(
                    `DELETE FROM employee_workstation_assignments
                     WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = $4`,
                    [lineId, work_date, wsCode, isOT]
                );
            }
        }
        realtime.broadcast('data_change', { entity: 'employee_assignments', action: 'saved', line_id: lineId, work_date, is_overtime: isOT });
        res.json({ success: true, message: `${isOT ? 'OT' : 'Regular'} employee assignments saved` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// WORKSTATION PLAN EXCEL (upload / template)
// ============================================================================

// GET /workstation-plan/template — download workstation plan Excel template
router.get('/workstation-plan/template', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Workstation Plan');

        ws.columns = [{ width: 14 }, { width: 14 }, { width: 45 }, { width: 16 }, { width: 18 }];

        const boldFont = { bold: true, size: 11 };
        const titleFont = { bold: true, size: 14 };
        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        const borderAll = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

        ws.mergeCells('A1:E1');
        const titleCell = ws.getCell('A1');
        titleCell.value = 'WORKSTATION PLAN';
        titleCell.font = { ...titleFont, color: { argb: 'FFFFFFFF' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        ws.getRow(1).height = 30;

        // Header fields rows 2-4
        const headerFields = [
            ['LINE CODE', 'L01'],
            ['DATE', new Date().toISOString().slice(0, 10)],
            ['PRODUCT CODE', '1234'],
        ];
        headerFields.forEach(([label, value], idx) => {
            const rowNum = idx + 2;
            ws.mergeCells(`A${rowNum}:B${rowNum}`);
            ws.mergeCells(`C${rowNum}:E${rowNum}`);
            const lc = ws.getCell(`A${rowNum}`);
            lc.value = label; lc.font = boldFont; lc.border = borderAll; lc.alignment = { horizontal: 'left' };
            const vc = ws.getCell(`C${rowNum}`);
            vc.value = value; vc.font = { size: 11 }; vc.border = borderAll; vc.alignment = { horizontal: 'left' };
        });

        // Table header row 5
        const tableHeaders = ['GROUP', 'WORKSTATION', 'OPERATION NAME', 'SAM (seconds)', 'EMPLOYEE CODE'];
        const headerRow = ws.getRow(5);
        tableHeaders.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h; cell.font = boldFont; cell.fill = headerFill; cell.border = borderAll;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        headerRow.height = 28;

        // Example data rows 6+
        const exampleData = [
            ['Group 1', 'WS01', 'TOP PASTING', 28, 'EMP001'],
            ['Group 1', 'WS01', 'KIMLON PASTING', 22, 'EMP001'],
            ['Group 1', 'WS02', 'ATTACHING TOP & KIMLON', 35, 'EMP002'],
            ['Group 1', 'WS03', 'GUSSET STITCHING -2NOS', 45, 'EMP003'],
            ['Group 1', 'WS03', 'GUSSET LAMPING -2NOS', 40, 'EMP003'],
            ['Group 2', 'WS04', 'GUSSET SHAPING', 30, 'EMP004'],
            ['Group 2', 'WS05', 'PATTI PROMOTOR', 25, 'EMP005'],
            ['Group 2', 'WS06', 'PATTI PRIMER 1', 20, 'EMP006'],
            ['Group 2', 'WS07', 'PATTI DYE', 38, 'EMP007'],
            ['', 'WS08', 'CLEANING', 15, ''],
        ];
        exampleData.forEach((rowData, idx) => {
            const rowNum = 6 + idx;
            const row = ws.getRow(rowNum);
            rowData.forEach((val, colIdx) => {
                const cell = row.getCell(colIdx + 1);
                cell.value = val; cell.border = borderAll;
                cell.alignment = { horizontal: colIdx === 2 ? 'left' : 'center' };
            });
        });

        // Instructions
        const instr = workbook.addWorksheet('Instructions');
        instr.columns = [{ width: 80 }];
        [
            'HOW TO USE THE WORKSTATION PLAN TEMPLATE',
            '',
            'Upload this file from the Daily Plan > Workstations panel.',
            'This file assigns processes to workstations for a specific line on a specific date.',
            '',
            '1. HEADER section (rows 2-4):',
            '   - LINE CODE: Production line code (e.g., L01) — must exist in the system.',
            '   - DATE: Date in YYYY-MM-DD format. Leave blank to use today.',
            '   - PRODUCT CODE: Must match the product (style no) already assigned to the line.',
            '',
            '2. DATA rows (row 6 onwards):',
            '   - GROUP: Optional group label (e.g., Group 1, Group 2). Groups are for visual organization.',
            '   - WORKSTATION: Workstation code (e.g., WS01, WS02). Multiple rows with same workstation = multiple processes in that workstation.',
            '   - OPERATION NAME: Must match a process in the product\'s process list (case-insensitive).',
            '   - SAM (seconds): Optional. If provided, updates the process SAM value.',
            '   - EMPLOYEE CODE: Optional. Assigns the employee to this workstation.',
            '',
            '3. IMPORTANT NOTES:',
            '   - Uploading will REPLACE the existing workstation plan for this line and date.',
            '   - All workstations in this file must have at least one operation.',
            '   - The order of rows within a workstation determines process sequence.',
        ].forEach((line, i) => {
            const cell = instr.getCell(`A${i + 1}`);
            cell.value = line;
            if (i === 0) cell.font = { bold: true, size: 13 };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=workstation-plan-template.xlsx');
        await workbook.xlsx.write(res);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /workstation-plan/upload-excel — upload workstation plan from Excel
router.post('/workstation-plan/upload-excel', excelUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
    const client = await pool.connect();
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.getWorksheet(1);
        if (!sheet) return res.status(400).json({ success: false, error: 'No worksheet found.' });

        const getCellStr = (rowNum, colNum) => String(sheet.getRow(rowNum).getCell(colNum).value || '').trim();

        const lineCode = getCellStr(2, 3) || getCellStr(2, 2);
        const dateVal = getCellStr(3, 3) || getCellStr(3, 2);
        const productCode = getCellStr(4, 3) || getCellStr(4, 2);
        const workDate = dateVal || new Date().toISOString().slice(0, 10);

        if (!lineCode) return res.status(400).json({ success: false, error: 'LINE CODE (row 2) is required.' });
        if (!productCode) return res.status(400).json({ success: false, error: 'PRODUCT CODE (row 4) is required.' });

        // Resolve line
        const lineResult = await pool.query(
            'SELECT id FROM production_lines WHERE UPPER(line_code) = UPPER($1) AND is_active = true', [lineCode]
        );
        if (!lineResult.rows[0]) return res.status(400).json({ success: false, error: `Line "${lineCode}" not found.` });
        const lineId = lineResult.rows[0].id;

        // Resolve product
        const productResult = await pool.query(
            'SELECT id FROM products WHERE UPPER(product_code) = UPPER($1)', [productCode]
        );
        if (!productResult.rows[0]) return res.status(400).json({ success: false, error: `Product "${productCode}" not found.` });
        const productId = productResult.rows[0].id;

        // Get working seconds for takt time
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingSeconds = ((outH * 60 + outM) - (inH * 60 + inM)) * 60;

        // Get daily plan target
        const planResult = await pool.query(
            'SELECT target_units FROM line_daily_plans WHERE line_id = $1 AND work_date = $2', [lineId, workDate]
        );
        const targetUnits = planResult.rows[0]?.target_units || 0;
        const taktTime = targetUnits > 0 ? workingSeconds / targetUnits : 0;

        // Get product processes (for matching by operation name)
        const ppResult = await pool.query(
            `SELECT pp.id, pp.sequence_number, pp.operation_sah, pp.cycle_time_seconds,
                    o.operation_name, o.id as operation_id
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             WHERE pp.product_id = $1 AND pp.is_active = true
             ORDER BY pp.sequence_number`, [productId]
        );
        const productProcesses = ppResult.rows;
        const ppByName = new Map(productProcesses.map(p => [p.operation_name.toUpperCase(), p]));

        // Parse data rows (row 6 onwards)
        const dataRows = [];
        for (let r = 6; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const opName = String(row.getCell(3).value || '').trim();
            if (!opName) continue;
            const wsCode = String(row.getCell(2).value || '').trim();
            if (!wsCode) continue;
            dataRows.push({
                group_name: String(row.getCell(1).value || '').trim() || null,
                workstation_code: wsCode,
                operation_name: opName,
                sam_seconds: parseFloat(row.getCell(4).value) || null,
                employee_code: String(row.getCell(5).value || '').trim() || null
            });
        }

        if (!dataRows.length) return res.status(400).json({ success: false, error: 'No data rows found. Fill operation rows from row 6 onwards.' });

        // Group rows by workstation_code (preserve insertion order)
        const wsOrder = [];
        const wsRowsMap = new Map();
        for (const row of dataRows) {
            if (!wsRowsMap.has(row.workstation_code)) {
                wsRowsMap.set(row.workstation_code, []);
                wsOrder.push(row.workstation_code);
            }
            wsRowsMap.get(row.workstation_code).push(row);
        }

        // Validate all operations exist in product
        const warnings = [];
        for (const row of dataRows) {
            if (!ppByName.has(row.operation_name.toUpperCase())) {
                warnings.push(`Operation "${row.operation_name}" not found in product "${productCode}" — skipped.`);
            }
        }

        await client.query('BEGIN');

        // Delete existing plan for this line+date+product only
        await client.query('DELETE FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2 AND product_id = $3', [lineId, workDate, productId]);

        const insertedWorkstations = [];
        let wsNumber = 1;

        for (const wsCode of wsOrder) {
            const rows = wsRowsMap.get(wsCode);
            const groupName = rows[0].group_name;

            // Calculate SAM for this workstation
            let actualSam = 0;
            const validRows = [];
            for (const row of rows) {
                const pp = ppByName.get(row.operation_name.toUpperCase());
                if (!pp) continue;
                // Update SAM if provided in Excel
                if (row.sam_seconds !== null && row.sam_seconds > 0) {
                    const newSah = row.sam_seconds / 3600;
                    await client.query(
                        'UPDATE product_processes SET operation_sah = $1, cycle_time_seconds = $2, updated_at = NOW() WHERE id = $3',
                        [newSah, Math.round(row.sam_seconds), pp.id]
                    );
                    pp.operation_sah = newSah; // update local cache
                }
                actualSam += (parseFloat(pp.operation_sah) || 0) * 3600;
                validRows.push({ pp, row });
            }
            if (!validRows.length) continue;

            const workloadPct = taktTime > 0 ? Math.round((actualSam / taktTime) * 10000) / 100 : 0;
            const wsResult = await client.query(
                `INSERT INTO line_plan_workstations
                 (line_id, work_date, product_id, workstation_number, workstation_code, group_name,
                  takt_time_seconds, actual_sam_seconds, workload_pct)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [lineId, workDate, productId, wsNumber, wsCode, groupName,
                 Math.round(taktTime * 100) / 100, Math.round(actualSam * 100) / 100, workloadPct]
            );
            const wsRow = wsResult.rows[0];

            for (let i = 0; i < validRows.length; i++) {
                await client.query(
                    'INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation) VALUES ($1, $2, $3)',
                    [wsRow.id, validRows[i].pp.id, i + 1]
                );
            }

            // Assign employee if provided
            const empCode = rows[0].employee_code;
            if (empCode) {
                const empResult = await client.query(
                    'SELECT id FROM employees WHERE UPPER(emp_code) = UPPER($1) AND is_active = true', [empCode]
                );
                if (empResult.rows[0]) {
                    await client.query(
                        `INSERT INTO employee_workstation_assignments (line_id, workstation_code, employee_id, work_date, line_plan_workstation_id)
                         VALUES ($1, $2, $3, $4, $5)
                         ON CONFLICT (line_id, work_date, workstation_code)
                         DO UPDATE SET employee_id = EXCLUDED.employee_id, line_plan_workstation_id = EXCLUDED.line_plan_workstation_id, assigned_at = NOW()`,
                        [lineId, wsCode, empResult.rows[0].id, workDate, wsRow.id]
                    );
                } else {
                    warnings.push(`Employee "${empCode}" not found — workstation ${wsCode} left unassigned.`);
                }
            }

            insertedWorkstations.push({ workstation_code: wsCode, group_name: groupName, processes: validRows.length });
            wsNumber++;
        }

        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'uploaded', line_id: lineId, work_date: workDate });

        res.json({
            success: true,
            message: `Workstation plan created with ${insertedWorkstations.length} workstations for line ${lineCode} on ${workDate}.`,
            data: { line_id: lineId, work_date: workDate, workstations: insertedWorkstations, warnings }
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ============================================================================
// Line Plan Excel Upload (template + bulk import)
// ============================================================================

// GET /lines/plan-upload-template — download the Line Plan Excel template
router.get('/lines/plan-upload-template', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Line Plan');
        ws.columns = [
            { width: 8  }, // A: Seq
            { width: 22 }, // B: Group / header value
            { width: 16 }, // C: Workstation
            { width: 16 }, // D: Operation Code
            { width: 40 }, // E: Operation Name
            { width: 12 }, // F: SAH
            { width: 20 }, // G: Employee Code
        ];

        const boldFont  = { bold: true, size: 11 };
        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        const labelFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        const greenFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D6F42' } };
        const borderAll  = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        const today = new Date().toISOString().slice(0, 10);

        // Row 1: Title
        ws.mergeCells('A1:G1');
        const titleCell = ws.getCell('A1');
        titleCell.value = 'LINE PLAN UPLOAD';
        titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = greenFill;
        ws.getRow(1).height = 30;

        // Row 2: blank spacer
        ws.getRow(2).height = 6;

        // Rows 3-10: Header fields (label in A, value in B, note in C-G)
        const headerRows = [
            { row: 3,  label: 'LINE CODE',       value: 'RUMIYA_LINE',     note: 'Production line code. Auto-created if not in system.' },
            { row: 4,  label: 'HALL NAME',        value: 'Hall B',          note: 'Hall/area name (used as line name if auto-creating the line).' },
            { row: 5,  label: 'DATE',             value: today,             note: 'Work date — YYYY-MM-DD format (e.g. 2026-02-19).' },
            { row: 6,  label: 'PRODUCT CODE',     value: '4321',            note: 'Style/product code. Auto-created if new.' },
            { row: 7,  label: 'PRODUCT NAME',     value: 'BILLFOLD WALLET', note: 'Full product name.' },
            { row: 8,  label: 'TARGET UNITS',     value: 500,               note: 'Daily target for this line. Required.' },
            { row: 9,  label: 'CO PRODUCT CODE',  value: '',                note: 'Optional — changeover product code.' },
            { row: 10, label: 'CO TARGET',        value: '',                note: 'Optional — changeover target units.' },
        ];
        headerRows.forEach(({ row, label, value, note }) => {
            const lc = ws.getCell(row, 1);
            lc.value = label; lc.font = boldFont; lc.fill = labelFill;
            lc.border = borderAll; lc.alignment = { horizontal: 'left', vertical: 'middle' };

            const vc = ws.getCell(row, 2);
            vc.value = value; vc.font = { size: 11 }; vc.border = borderAll;
            vc.alignment = { horizontal: 'left', vertical: 'middle' };

            ws.mergeCells(row, 3, row, 7);
            const nc = ws.getCell(row, 3);
            nc.value = note;
            nc.font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
            nc.alignment = { horizontal: 'left', vertical: 'middle' };
        });

        // Row 11: spacer
        ws.getRow(11).height = 8;

        // Row 12: Table header
        const tableHeaders = ['SEQ', 'GROUP', 'WORKSTATION', 'OPERATION CODE', 'OPERATION NAME', 'SAH', 'EMPLOYEE CODE'];
        const hRow = ws.getRow(12);
        hRow.height = 22;
        tableHeaders.forEach((h, i) => {
            const cell = hRow.getCell(i + 1);
            cell.value = h;
            cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
            cell.fill = greenFill;
            cell.border = borderAll;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // Rows 13+: Example data (based on the BILLFOLD WALLET line from the screenshot)
        const exampleData = [
            [1,  'G1', 'WS01', 'OP-0001', 'TOP PASTING',              0.0033, 'LPD00059'],
            [2,  'G1', 'WS01', 'OP-0002', 'KIMLON PASTING',           0.0033, ''],
            [3,  'G1', 'WS01', 'OP-0003', 'ATTACHING TOP & KIMLON',   0.0083, ''],
            [4,  'G1', 'WS01', 'OP-0004', 'GUSSET STITCHING -2NOS',   0.0083, ''],
            [5,  'G1', 'WS02', 'OP-0005', 'GUSSET LAMPING -2NOS',     0.0056, 'LPD00601'],
            [6,  'G1', 'WS02', 'OP-0006', 'GUSSET SHAPING',           0.0044, ''],
            [7,  'G2', 'WS03', 'OP-0007', 'PATTI PROMOTOR',           0.0056, 'LPD00120'],
            [8,  'G2', 'WS03', 'OP-0008', 'PATTI PRIMER 1',           0.0028, ''],
            [9,  'G2', 'WS04', 'OP-0009', 'PATTI DYE',                0.0056, 'LPD00088'],
            [10, 'G3', 'WS05', 'OP-0010', 'PATTI PRIMER 2',           0.0028, 'LPD00210'],
            [11, 'G3', 'WS06', 'OP-0011', 'CLEANING',                 0.0042, 'LPD00310'],
        ];
        exampleData.forEach((rowData, idx) => {
            const rowNum = 13 + idx;
            const row = ws.getRow(rowNum);
            rowData.forEach((val, colIdx) => {
                const cell = row.getCell(colIdx + 1);
                cell.value = val;
                cell.border = borderAll;
                cell.fill = headerFill;
                cell.alignment = { horizontal: colIdx === 4 ? 'left' : 'center', vertical: 'middle' };
                if (colIdx === 5 && typeof val === 'number') cell.numFmt = '0.0000';
            });
            row.height = 18;
        });

        // Instructions sheet
        const instr = workbook.addWorksheet('Instructions');
        instr.columns = [{ width: 90 }];
        [
            'LINE PLAN UPLOAD — HOW TO USE',
            '',
            'This template uploads a complete line plan in one step:',
            '  • Creates or updates the product and its processes',
            '  • Sets up the daily plan (line + date + target)',
            '  • Builds the workstation plan (groups processes into workstations)',
            '  • Assigns employees to workstations',
            '',
            'HEADER SECTION (Rows 3–10):',
            '  LINE CODE       Production line code. Auto-created if not in system.',
            '  HALL NAME       Used as the line name if the line is being auto-created.',
            '  DATE            Work date in YYYY-MM-DD format.',
            '  PRODUCT CODE    Style/product code. Auto-created if new.',
            '  PRODUCT NAME    Product display name.',
            '  TARGET UNITS    Daily target for this line. Required.',
            '  CO PRODUCT CODE Optional. Changeover product code (if applicable).',
            '  CO TARGET       Optional. Target units for the changeover product.',
            '',
            'DATA TABLE (Row 12 onwards):',
            '  SEQ             Process sequence number (1, 2, 3...). Auto-numbered if blank.',
            '  GROUP           Optional group label (e.g. G1, G2).',
            '  WORKSTATION     Workstation code (e.g. WS01). All rows with the same code share',
            '                  one employee assignment and are grouped together.',
            '  OPERATION CODE  System code (e.g. OP-0001). Leave blank to auto-generate.',
            '                  Operations are shared across products.',
            '  OPERATION NAME  Name of the process/operation. Required.',
            '  SAH             Standard Allowed Hours (decimal). E.g. 0.0033 = ~11.9 seconds.',
            '  EMPLOYEE CODE   Optional. Assign one employee per workstation (first filled wins).',
            '',
            'NOTES:',
            '  Process Time (s) = SAH × 3600',
            '  Takt Time is computed from Target Units and the configured working hours.',
            '  Workload % = (sum of process SAH×3600 in workstation) / Takt Time × 100',
            '  Uploading replaces the existing workstation plan for that line + date + product.',
            '  Employee codes must match exactly what is in the system.',
        ].forEach((line, i) => {
            const cell = instr.getCell(i + 1, 1);
            cell.value = line;
            cell.font = i === 0 ? { bold: true, size: 13 }
                : (line.startsWith('  ') ? { size: 11, color: { argb: 'FF374151' } }
                : { bold: line.endsWith(':'), size: 11 });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="line_plan_template.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /lines/plan-upload-excel — bulk import line plan from Excel template
router.post('/lines/plan-upload-excel', excelUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.getWorksheet('Line Plan') || workbook.worksheets[0];
        if (!sheet) throw new Error('Could not find "Line Plan" sheet in the uploaded file');

        const getCellStr = (r, c) => {
            const v = sheet.getRow(r).getCell(c).value;
            if (!v && v !== 0) return '';
            if (typeof v === 'object' && v !== null) {
                if (v.richText) return v.richText.map(t => t.text).join('').trim();
                if (v instanceof Date) return v.toISOString().slice(0, 10);
                if (v.result !== undefined) return String(v.result).trim();
            }
            return String(v).trim();
        };
        const getCellNum = (r, c) => {
            const raw = sheet.getRow(r).getCell(c).value;
            if (raw === null || raw === undefined || raw === '') return 0;
            if (typeof raw === 'object' && raw.result !== undefined) return parseFloat(raw.result) || 0;
            return parseFloat(String(raw).replace(/,/g, '')) || 0;
        };

        // Parse header (value in col B = column index 2)
        const lineCode      = getCellStr(3, 2);
        const hallName      = getCellStr(4, 2);
        const workDate      = getCellStr(5, 2) || new Date().toISOString().slice(0, 10);
        const productCode   = getCellStr(6, 2);
        const productName   = getCellStr(7, 2);
        const targetUnits   = Math.round(getCellNum(8, 2));
        const coProductCode = getCellStr(9, 2);
        const coTarget      = Math.round(getCellNum(10, 2)) || 0;

        if (!lineCode)                         throw new Error('Line Code is required (row 3)');
        if (!workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw new Error('Date must be in YYYY-MM-DD format (row 5)');
        if (!productCode)                      throw new Error('Product Code is required (row 6)');
        if (!productName)                      throw new Error('Product Name is required (row 7)');
        if (!targetUnits || targetUnits <= 0)  throw new Error('Target Units must be > 0 (row 8)');

        // Find or create line
        const lineResult = await client.query(
            `INSERT INTO production_lines (line_code, line_name, hall_location, is_active)
             VALUES ($1, $2, $3, true)
             ON CONFLICT (line_code) DO UPDATE
               SET line_name     = CASE WHEN production_lines.line_name     = '' THEN EXCLUDED.line_name     ELSE production_lines.line_name     END,
                   hall_location = CASE WHEN production_lines.hall_location IS NULL THEN EXCLUDED.hall_location ELSE production_lines.hall_location END
             RETURNING id, (xmax = 0) AS was_inserted`,
            [lineCode, hallName || lineCode, hallName || null]
        );
        const lineId      = lineResult.rows[0].id;
        const lineCreated = lineResult.rows[0].was_inserted;

        // Find or create primary product
        const prodResult = await client.query(
            `INSERT INTO products (product_code, product_name, is_active)
             VALUES ($1, $2, true)
             ON CONFLICT (product_code) DO UPDATE
               SET product_name = EXCLUDED.product_name
             RETURNING id`,
            [productCode, productName]
        );
        const productId = prodResult.rows[0].id;

        // Find or create changeover product (optional)
        let coProductId = null;
        if (coProductCode) {
            const coResult = await client.query(
                `INSERT INTO products (product_code, product_name, is_active)
                 VALUES ($1, $1, true)
                 ON CONFLICT (product_code) DO UPDATE
                   SET product_name = products.product_name
                 RETURNING id`,
                [coProductCode]
            );
            coProductId = coResult.rows[0]?.id || null;
        }

        // Get working hours → takt time
        const settingsResult = await client.query(
            `SELECT key, value FROM app_settings WHERE key IN ('default_in_time', 'default_out_time')`
        );
        const sm = {};
        settingsResult.rows.forEach(r => { sm[r.key] = r.value; });
        let workingSecs = 8 * 3600;
        if (sm.default_in_time && sm.default_out_time) {
            const [inH, inM]   = sm.default_in_time.split(':').map(Number);
            const [outH, outM] = sm.default_out_time.split(':').map(Number);
            workingSecs = Math.max(0, ((outH * 60 + outM) - (inH * 60 + inM)) * 60);
        }
        const taktTimeSecs = targetUnits > 0 ? workingSecs / targetUnits : 0;

        // Parse data rows (start at row 13; stop at first fully empty row)
        const dataRows = [];
        let autoSeq = 1;
        for (let rowNum = 13; rowNum <= 2000; rowNum++) {
            const wsCode = getCellStr(rowNum, 3);
            const opCode = getCellStr(rowNum, 4);
            const opName = getCellStr(rowNum, 5);
            if (!wsCode && !opCode && !opName) break;
            const sah    = getCellNum(rowNum, 6);
            const seqVal = Math.round(getCellNum(rowNum, 1)) || autoSeq;
            dataRows.push({
                seq:     seqVal,
                group:   getCellStr(rowNum, 2),
                wsCode:  wsCode.toUpperCase(),
                opCode:  opCode.toUpperCase(),
                opName,
                sah,
                empCode: getCellStr(rowNum, 7)
            });
            autoSeq++;
        }
        if (!dataRows.length) throw new Error('No process rows found. Data should start at row 13.');

        // Pre-fetch next auto-op number for rows with missing operation code
        let nextOpNum = 1;
        if (dataRows.some(r => !r.opCode)) {
            const maxCode = await client.query(
                `SELECT operation_code FROM operations WHERE operation_code ~ '^OP-[0-9]+$' ORDER BY operation_code DESC LIMIT 1`
            );
            if (maxCode.rows.length) {
                const m = maxCode.rows[0].operation_code.match(/^OP-(\d+)$/);
                if (m) nextOpNum = parseInt(m[1]) + 1;
            }
        }

        // Upsert operations (shared across products) + product_processes (product-specific SAH)
        for (const row of dataRows) {
            // If operation code is missing, find by name or auto-generate
            if (!row.opCode) {
                const byName = await client.query(
                    `SELECT id, operation_code FROM operations WHERE UPPER(operation_name) = UPPER($1) LIMIT 1`,
                    [row.opName]
                );
                if (byName.rows[0]) {
                    row.opId   = byName.rows[0].id;
                    row.opCode = byName.rows[0].operation_code;
                } else {
                    row.opCode = 'OP-' + String(nextOpNum).padStart(4, '0');
                    nextOpNum++;
                }
            }

            if (!row.opId) {
                // Upsert operation by code (shared)
                const opResult = await client.query(
                    `INSERT INTO operations (operation_code, operation_name, is_active)
                     VALUES ($1, $2, true)
                     ON CONFLICT (operation_code) DO UPDATE
                       SET operation_name = EXCLUDED.operation_name
                     RETURNING id`,
                    [row.opCode, row.opName]
                );
                row.opId = opResult.rows[0].id;
            }

            // Upsert product_process — (product_id, operation_id) is the natural key
            const ppCheck = await client.query(
                `SELECT id FROM product_processes WHERE product_id = $1 AND operation_id = $2 LIMIT 1`,
                [productId, row.opId]
            );
            if (ppCheck.rows[0]) {
                await client.query(
                    `UPDATE product_processes
                     SET sequence_number = $1, operation_sah = $2, cycle_time_seconds = $3
                     WHERE id = $4`,
                    [row.seq, row.sah, Math.round(row.sah * 3600), ppCheck.rows[0].id]
                );
                row.ppId = ppCheck.rows[0].id;
            } else {
                const ppInsert = await client.query(
                    `INSERT INTO product_processes
                       (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds, manpower_required, is_active)
                     VALUES ($1, $2, $3, $4, $5, 1, true) RETURNING id`,
                    [productId, row.opId, row.seq, row.sah, Math.round(row.sah * 3600)]
                );
                row.ppId = ppInsert.rows[0].id;
            }
        }

        // Upsert daily plan
        await client.query(
            `INSERT INTO line_daily_plans
               (line_id, product_id, work_date, target_units,
                incoming_product_id, incoming_target_units, changeover_sequence,
                created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7)
             ON CONFLICT (line_id, work_date) DO UPDATE
               SET product_id            = EXCLUDED.product_id,
                   target_units          = EXCLUDED.target_units,
                   incoming_product_id   = EXCLUDED.incoming_product_id,
                   incoming_target_units = EXCLUDED.incoming_target_units,
                   changeover_sequence   = EXCLUDED.changeover_sequence,
                   changeover_started_at = NULL,
                   updated_by            = EXCLUDED.updated_by,
                   updated_at            = NOW()`,
            [lineId, productId, workDate, targetUnits, coProductId, coTarget, req.user?.id || null]
        );

        // Replace workstation plan for this line + date + product
        await client.query(
            `DELETE FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2 AND product_id = $3`,
            [lineId, workDate, productId]
        );

        // Group rows by wsCode (preserve insertion order)
        const wsGroupsMap = new Map();
        for (const row of dataRows) {
            if (!wsGroupsMap.has(row.wsCode)) wsGroupsMap.set(row.wsCode, []);
            wsGroupsMap.get(row.wsCode).push(row);
        }

        let wsNumber = 1;
        let employeesAssigned = 0;
        for (const [wsCode, processes] of wsGroupsMap) {
            const actualSam  = processes.reduce((s, p) => s + (p.sah * 3600), 0);
            const workloadPct = taktTimeSecs > 0 ? (actualSam / taktTimeSecs) * 100 : 0;

            const wsInsert = await client.query(
                `INSERT INTO line_plan_workstations
                   (line_id, work_date, product_id, workstation_number, workstation_code,
                    takt_time_seconds, actual_sam_seconds, workload_pct)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id`,
                [lineId, workDate, productId, wsNumber, wsCode,
                 Math.round(taktTimeSecs * 100) / 100,
                 Math.round(actualSam * 100) / 100,
                 Math.round(workloadPct * 100) / 100]
            );
            const wsId = wsInsert.rows[0].id;

            for (let i = 0; i < processes.length; i++) {
                await client.query(
                    `INSERT INTO line_plan_workstation_processes
                       (workstation_id, product_process_id, sequence_in_workstation)
                     VALUES ($1, $2, $3)`,
                    [wsId, processes[i].ppId, i + 1]
                );
            }

            // Assign employee (first non-empty emp_code in the workstation)
            const withEmp = processes.find(p => p.empCode);
            if (withEmp) {
                const empRow = await client.query(
                    `SELECT id FROM employees WHERE UPPER(emp_code) = UPPER($1) LIMIT 1`,
                    [withEmp.empCode]
                );
                if (empRow.rows[0]) {
                    await client.query(
                        `INSERT INTO employee_workstation_assignments
                           (line_id, work_date, workstation_code, employee_id, line_plan_workstation_id, is_overtime)
                         VALUES ($1, $2, $3, $4, $5, false)
                         ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                         DO UPDATE SET employee_id             = EXCLUDED.employee_id,
                                       line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                       assigned_at             = NOW()`,
                        [lineId, workDate, wsCode, empRow.rows[0].id, wsId]
                    );
                    employeesAssigned++;
                }
            }
            wsNumber++;
        }

        await client.query('COMMIT');

        // Generate workstation QR codes for newly created lines (non-blocking)
        if (lineCreated) {
            qrUtils.generateWorkstationQrForLine(lineId).catch(err =>
                console.error(`[QR] Failed to generate workstation QRs for line ${lineId}:`, err.message)
            );
        }

        realtime.broadcast('data_change', {
            entity: 'line_plan_upload', action: 'uploaded',
            line_id: lineId, work_date: workDate, product_id: productId
        });

        res.json({
            success: true,
            message: 'Line plan uploaded successfully',
            summary: {
                line: lineCode,
                product: productCode,
                date: workDate,
                target: targetUnits,
                workstations: wsGroupsMap.size,
                processes: dataRows.length,
                employees_assigned: employeesAssigned
            }
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ============================================================================
// IE Attendance
// ============================================================================
router.get('/ie/attendance', async (req, res) => {
    const date = req.query.date;
    if (!date) {
        return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
    }
    try {
        const result = await pool.query(`
            SELECT e.id as employee_id,
                   e.emp_code,
                   e.emp_name,
                   a.line_id,
                   pl.line_name,
                   a.process_id,
                   o.operation_name,
                   p.product_code,
                   att.in_time,
                   att.out_time,
                   att.status,
                   att.notes
            FROM employees e
            LEFT JOIN employee_process_assignments a ON e.id = a.employee_id
            LEFT JOIN product_processes pp ON a.process_id = pp.id
            LEFT JOIN operations o ON pp.operation_id = o.id
            LEFT JOIN products p ON pp.product_id = p.id
            LEFT JOIN production_lines pl ON a.line_id = pl.id
            LEFT JOIN employee_attendance att
              ON att.employee_id = e.id AND att.attendance_date = $1
            WHERE e.is_active = true
            ORDER BY e.emp_code
        `, [date]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/ie/attendance', async (req, res) => {
    const { employee_id, date, in_time, out_time, status, notes } = req.body;
    if (!employee_id || !date) {
        return res.status(400).json({ success: false, error: 'employee_id and date are required' });
    }
    try {
        if (await isDayLocked(date)) {
            return res.status(403).json({ success: false, error: 'Production day is locked' });
        }
        const result = await pool.query(
            `INSERT INTO employee_attendance (employee_id, attendance_date, in_time, out_time, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (employee_id, attendance_date)
             DO UPDATE SET in_time = EXCLUDED.in_time,
                           out_time = EXCLUDED.out_time,
                           status = EXCLUDED.status,
                           notes = EXCLUDED.notes,
                           updated_at = NOW()
             RETURNING *`,
            [employee_id, date, in_time, out_time, status, notes]
        );
        realtime.broadcast('data_change', { entity: 'attendance', action: 'update', employee_id, date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// Line Supervisor
// ============================================================================
const parseSupervisorQr = (payload) => {
    if (!payload) return null;
    if (typeof payload === 'object') {
        return payload;
    }
    try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
        // ignore
    }
    const raw = String(payload).trim();
    if (!raw) return null;
    const numeric = parseInt(raw, 10);
    if (Number.isFinite(numeric)) {
        return { id: numeric };
    }
    return { raw };
};

// Helper: get both active product IDs for a line on a date
const getIncomingMaxSequence = async (productId) => {
    if (!productId) return 0;
    const maxSeqResult = await pool.query(
        `SELECT COALESCE(MAX(sequence_number), 0) as max_seq
         FROM product_processes
         WHERE product_id = $1 AND is_active = true`,
        [productId]
    );
    return parseInt(maxSeqResult.rows[0]?.max_seq || 0, 10);
};

const getLineProductIds = async (lineId, workDate = null) => {
    const dateValue = workDate || new Date().toISOString().slice(0, 10);
    const planResult = await pool.query(
        `SELECT product_id, incoming_product_id, changeover_sequence
         FROM line_daily_plans
         WHERE line_id = $1 AND work_date = $2`,
        [lineId, dateValue]
    );
    const plan = planResult.rows[0];
    let primaryId = plan?.product_id || null;
    let incomingId = plan?.incoming_product_id || null;
    const changeoverSequence = parseInt(plan?.changeover_sequence || 0, 10);

    if (!primaryId) {
        const lineResult = await pool.query(
            `SELECT current_product_id FROM production_lines WHERE id = $1`,
            [lineId]
        );
        primaryId = lineResult.rows[0]?.current_product_id || null;
    }
    if (!CHANGEOVER_ENABLED) {
        return { primaryId, incomingId: null, changeoverSequence: 0, incomingMaxSequence: 0 };
    }
    let incomingMaxSequence = 0;
    if (incomingId) {
        incomingMaxSequence = await getIncomingMaxSequence(incomingId);
    }
    const normalizedChangeover = Math.max(0, Math.min(changeoverSequence, incomingMaxSequence));
    return { primaryId, incomingId, changeoverSequence: normalizedChangeover, incomingMaxSequence };
};

const isProcessActiveForChangeover = ({ productId, sequenceNumber, primaryId, incomingId, changeoverSequence }) => {
    if (!primaryId) return false;
    if (!incomingId) {
        return productId === primaryId;
    }
    if (productId === incomingId) {
        return sequenceNumber <= changeoverSequence;
    }
    if (productId === primaryId) {
        return sequenceNumber > changeoverSequence;
    }
    return false;
};

const resolveProcessForLine = async (lineId, processPayload, workDate = null) => {
    const { primaryId, incomingId, changeoverSequence } = await getLineProductIds(lineId, workDate);

    if (!primaryId) {
        throw new Error('Line has no product assigned for this date');
    }

    if (processPayload.type === 'operation') {
        const result = await pool.query(
            `SELECT pp.id, pp.sequence_number, pp.target_units, pp.product_id,
                    o.id AS operation_id, o.operation_code, o.operation_name,
                    ws.workspace_code, ws.workspace_name
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             LEFT JOIN workspaces ws ON pp.workspace_id = ws.id AND ws.is_active = true
             WHERE pp.product_id = ANY($1::int[]) AND pp.operation_id = $2
             ORDER BY pp.sequence_number
             LIMIT 10`,
            [[primaryId, incomingId].filter(Boolean), processPayload.id]
        );
        const candidates = result.rows.filter(row => {
            const isActive = isProcessActiveForChangeover({
                productId: row.product_id,
                sequenceNumber: row.sequence_number,
                primaryId,
                incomingId,
                changeoverSequence
            });
            const isNextIncoming = incomingId
                && row.product_id === incomingId
                && row.sequence_number === changeoverSequence + 1;
            return isActive || isNextIncoming;
        });
        const chosen = candidates[0];
        if (!chosen) {
            throw new Error('Operation not found in current product processes');
        }
        return chosen;
    }

    const result = await pool.query(
        `SELECT pp.id, pp.sequence_number, pp.target_units, pp.product_id,
                o.id AS operation_id, o.operation_code, o.operation_name,
                ws.workspace_code, ws.workspace_name
         FROM product_processes pp
         JOIN operations o ON pp.operation_id = o.id
         LEFT JOIN workspaces ws ON pp.workspace_id = ws.id AND ws.is_active = true
         WHERE pp.id = $1 AND pp.product_id = ANY($2::int[])
         LIMIT 1`,
        [processPayload.id, [primaryId, incomingId].filter(Boolean)]
    );
    const row = result.rows[0];
    if (!row) {
        throw new Error('Process not found for current line products');
    }
    const isActive = isProcessActiveForChangeover({
        productId: row.product_id,
        sequenceNumber: row.sequence_number,
        primaryId,
        incomingId,
        changeoverSequence
    });
    const isNextIncoming = incomingId
        && row.product_id === incomingId
        && row.sequence_number === changeoverSequence + 1;
    if (!isActive && !isNextIncoming) {
        throw new Error('Process not active for current changeover boundary');
    }
    return row;
};

const resolveNextProcessForLine = async (lineId, processId, workDate = null) => {
    // Find next process in the SAME product's chain (no cross-product forwarding)
    const result = await pool.query(
        `SELECT next_pp.id
         FROM product_processes pp
         JOIN product_processes next_pp
            ON next_pp.product_id = pp.product_id
           AND next_pp.sequence_number > pp.sequence_number
           AND next_pp.is_active = true
         WHERE pp.id = $1
         ORDER BY next_pp.sequence_number
         LIMIT 1`,
        [processId]
    );
    return result.rows[0]?.id || null;
};

const refreshProcessWip = async (lineId, processId, workDate) => {
    const totals = await pool.query(
        `SELECT
            COALESCE(SUM(CASE
                WHEN transaction_type IN ('issued', 'received') AND to_process_id = $2 THEN quantity
                WHEN transaction_type = 'forwarded' AND to_process_id = $2 THEN quantity
                ELSE 0 END), 0) as materials_in,
            COALESCE(SUM(CASE
                WHEN transaction_type IN ('forwarded', 'used') AND from_process_id = $2 THEN quantity
                ELSE 0 END), 0) as materials_out
         FROM material_transactions
         WHERE line_id = $1 AND work_date = $3`,
        [lineId, processId, workDate]
    );
    const materialsIn = parseInt(totals.rows[0]?.materials_in || 0, 10);
    const materialsOut = parseInt(totals.rows[0]?.materials_out || 0, 10);
    await pool.query(
        `INSERT INTO process_material_wip (line_id, process_id, work_date, materials_in, materials_out, wip_quantity)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (line_id, process_id, work_date)
         DO UPDATE SET
            materials_in = EXCLUDED.materials_in,
            materials_out = EXCLUDED.materials_out,
            wip_quantity = EXCLUDED.wip_quantity,
            updated_at = NOW()`,
        [lineId, processId, workDate, materialsIn, materialsOut, materialsIn - materialsOut]
    );
};

router.get('/supervisor/lines', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pl.id,
                   pl.line_code,
                   pl.line_name,
                   COALESCE(ldp.product_id, pl.current_product_id) as current_product_id,
                   COALESCE(p_plan.product_code, p.product_code) as product_code,
                   ldp.incoming_product_id,
                   COALESCE(ldp.changeover_sequence, 0) as changeover_sequence,
                   ip.product_code as incoming_product_code
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = CURRENT_DATE
            LEFT JOIN products p_plan ON ldp.product_id = p_plan.id
            LEFT JOIN products p ON pl.current_product_id = p.id
            LEFT JOIN products ip ON ldp.incoming_product_id = ip.id
            WHERE pl.is_active = true
            ORDER BY pl.line_name
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/supervisor/processes/:lineId', async (req, res) => {
    const { lineId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
        const { primaryId, incomingId, changeoverSequence, incomingMaxSequence } = await getLineProductIds(lineId, date);
        if (!primaryId) {
            return res.json({ success: true, data: [], workstation_plan: [] });
        }

        // Fetch daily-plan meta for changeover state and targets
        const metaResult = await pool.query(
            `SELECT ldp.target_units, ldp.incoming_target_units, ldp.changeover_started_at,
                    ip.product_code AS incoming_product_code, ip.product_name AS incoming_product_name
             FROM line_daily_plans ldp
             LEFT JOIN products ip ON ip.id = ldp.incoming_product_id
             WHERE ldp.line_id = $1 AND ldp.work_date = $2`,
            [lineId, date]
        );
        const meta = metaResult.rows[0] || {};
        const changeoverActive = !!meta.changeover_started_at;
        const activeProductId = changeoverActive ? incomingId : primaryId;
        const activeTarget = changeoverActive
            ? (parseInt(meta.incoming_target_units, 10) || 0)
            : (parseInt(meta.target_units, 10) || 0);

        // Build shared response fields
        const sharedFields = {
            changeover: incomingId ? true : false,
            changeover_active: changeoverActive,
            changeover_started_at: meta.changeover_started_at || null,
            active_target: activeTarget,
            primary_product_id: primaryId,
            incoming_product_id: incomingId,
            incoming_product_code: meta.incoming_product_code || null,
            incoming_product_name: meta.incoming_product_name || null,
            changeover_sequence: changeoverSequence,
            incoming_max_sequence: incomingMaxSequence,
            changeover_enabled: CHANGEOVER_ENABLED
        };

        // Try to get line workstation plan — filtered to the active product only
        const planResult = await pool.query(
            `SELECT lpw.id as workstation_plan_id, lpw.workstation_number, lpw.workstation_code,
                    lpw.takt_time_seconds, lpw.actual_sam_seconds, lpw.workload_pct,
                    lpw.product_id,
                    pp.id as process_id, pp.sequence_number, pp.operation_sah,
                    o.operation_code, o.operation_name,
                    p.product_code, p.target_qty,
                    ewa.employee_id as assigned_employee_id,
                    e.emp_code as assigned_emp_code,
                    e.emp_name as assigned_emp_name,
                    lpwp.sequence_in_workstation
             FROM line_plan_workstations lpw
             JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
             JOIN product_processes pp ON lpwp.product_process_id = pp.id
             JOIN operations o ON pp.operation_id = o.id
             JOIN products p ON pp.product_id = p.id
             LEFT JOIN employee_workstation_assignments ewa
                ON (ewa.line_plan_workstation_id = lpw.id OR (ewa.line_id = lpw.line_id AND ewa.work_date = lpw.work_date AND ewa.workstation_code = lpw.workstation_code))
                AND ewa.is_overtime = false
             LEFT JOIN employees e ON ewa.employee_id = e.id
             WHERE lpw.line_id = $1 AND lpw.work_date = $2
               AND lpw.product_id = $3
             ORDER BY lpw.workstation_number, lpwp.sequence_in_workstation`,
            [lineId, date, activeProductId]
        );

        if (planResult.rows.length > 0) {
            // Group by workstation
            const wsMap = new Map();
            for (const row of planResult.rows) {
                if (!wsMap.has(row.workstation_plan_id)) {
                    wsMap.set(row.workstation_plan_id, {
                        id: row.workstation_plan_id,
                        workstation_number: row.workstation_number,
                        workstation_code: row.workstation_code,
                        takt_time_seconds: row.takt_time_seconds,
                        actual_sam_seconds: row.actual_sam_seconds,
                        workload_pct: row.workload_pct,
                        assigned_employee_id: row.assigned_employee_id,
                        assigned_emp_code: row.assigned_emp_code,
                        assigned_emp_name: row.assigned_emp_name,
                        processes: []
                    });
                }
                wsMap.get(row.workstation_plan_id).processes.push({
                    id: row.process_id,
                    sequence_number: row.sequence_number,
                    operation_code: row.operation_code,
                    operation_name: row.operation_name,
                    operation_sah: row.operation_sah,
                    product_code: row.product_code,
                    target_qty: row.target_qty,
                    sequence_in_workstation: row.sequence_in_workstation
                });
            }
            const workstations = Array.from(wsMap.values());
            // Also build flat process list for backward compat (hourly progress uses process_id)
            const flatProcesses = planResult.rows.map(row => ({
                id: row.process_id,
                sequence_number: row.sequence_number,
                operation_code: row.operation_code,
                operation_name: row.operation_name,
                operation_sah: row.operation_sah,
                product_code: row.product_code,
                target_qty: row.target_qty,
                workstation_code: row.workstation_code,
                workstation_plan_id: row.workstation_plan_id,
                assigned_employee_id: row.assigned_employee_id,
                assigned_emp_code: row.assigned_emp_code,
                assigned_emp_name: row.assigned_emp_name
            }));
            return res.json({
                success: true,
                data: flatProcesses,
                workstation_plan: workstations,
                has_plan: true,
                ...sharedFields
            });
        }

        // Fallback: no workstation plan yet — return flat processes grouped by product_processes.workstation_code
        const result = await pool.query(`
            SELECT pp.id, pp.sequence_number, pp.product_id,
                   o.operation_code, o.operation_name,
                   p.product_code, p.target_qty,
                   pp.workstation_code, pp.group_name,
                   ewa.employee_id as assigned_employee_id,
                   e.emp_code as assigned_emp_code,
                   e.emp_name as assigned_emp_name
            FROM product_processes pp
            JOIN operations o ON pp.operation_id = o.id
            JOIN products p ON pp.product_id = p.id
            LEFT JOIN employee_workstation_assignments ewa ON ewa.workstation_code = pp.workstation_code AND ewa.line_id = $4 AND ewa.work_date = $5 AND ewa.is_overtime = false
            LEFT JOIN employees e ON ewa.employee_id = e.id
            WHERE pp.is_active = true
              AND (
                (pp.product_id = $1 AND ($2::int IS NULL OR pp.sequence_number > $3))
                OR (pp.product_id = $2 AND pp.sequence_number <= ($3 + 1))
              )
            ORDER BY pp.product_id = $1 DESC, pp.sequence_number
        `, [primaryId, incomingId, changeoverSequence, lineId, date]);
        res.json({
            success: true,
            data: result.rows,
            workstation_plan: [],
            has_plan: false,
            ...sharedFields
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Advance changeover boundary by one process sequence
router.post('/supervisor/changeover-advance', async (req, res) => {
    const { line_id, work_date } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    if (!CHANGEOVER_ENABLED) {
        return res.status(403).json({ success: false, error: 'Changeover is disabled' });
    }
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    try {
        const planResult = await pool.query(
            `SELECT id, incoming_product_id, changeover_sequence, is_locked
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const plan = planResult.rows[0];
        if (!plan || !plan.incoming_product_id) {
            return res.status(400).json({ success: false, error: 'No incoming product set for this line/date' });
        }
        if (plan.is_locked) {
            return res.status(403).json({ success: false, error: 'Daily plan is locked' });
        }

        const maxSeqResult = await pool.query(
            `SELECT COALESCE(MAX(sequence_number), 0) as max_seq
             FROM product_processes
             WHERE product_id = $1 AND is_active = true`,
            [plan.incoming_product_id]
        );
        const maxSeq = parseInt(maxSeqResult.rows[0]?.max_seq || 0, 10);
        const currentSeq = parseInt(plan.changeover_sequence || 0, 10);
        const nextSeq = Math.min(currentSeq + 1, maxSeq);

        const before = await pool.query(
            `SELECT * FROM line_daily_plans WHERE id = $1`,
            [plan.id]
        );
        const updateResult = await pool.query(
            `UPDATE line_daily_plans
             SET changeover_sequence = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING changeover_sequence`,
            [nextSeq, plan.id]
        );

        await logAudit(
            'line_daily_plans',
            plan.id,
            'changeover_advance',
            updateResult.rows[0],
            before.rows[0] || null
        );
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
        res.json({
            success: true,
            data: {
                changeover_sequence: updateResult.rows[0].changeover_sequence,
                max_sequence: maxSeq
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Set changeover boundary to a specific sequence
router.post('/supervisor/changeover-set', async (req, res) => {
    const { line_id, work_date, changeover_sequence } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    if (!CHANGEOVER_ENABLED) {
        return res.status(403).json({ success: false, error: 'Changeover is disabled' });
    }
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    try {
        const planResult = await pool.query(
            `SELECT id, incoming_product_id, changeover_sequence, is_locked
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const plan = planResult.rows[0];
        if (!plan || !plan.incoming_product_id) {
            return res.status(400).json({ success: false, error: 'No incoming product set for this line/date' });
        }
        if (plan.is_locked) {
            return res.status(403).json({ success: false, error: 'Daily plan is locked' });
        }

        const maxSeq = await getIncomingMaxSequence(plan.incoming_product_id);
        const requested = Math.max(0, parseInt(changeover_sequence || 0, 10));
        const nextSeq = Math.min(requested, maxSeq);

        const before = await pool.query(
            `SELECT * FROM line_daily_plans WHERE id = $1`,
            [plan.id]
        );
        const updateResult = await pool.query(
            `UPDATE line_daily_plans
             SET changeover_sequence = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING changeover_sequence`,
            [nextSeq, plan.id]
        );
        await logAudit(
            'line_daily_plans',
            plan.id,
            'changeover_set',
            updateResult.rows[0],
            before.rows[0] || null
        );
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
        res.json({
            success: true,
            data: {
                changeover_sequence: updateResult.rows[0].changeover_sequence,
                max_sequence: maxSeq
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Supervisor-triggered changeover activation — only allowed after primary target is met
router.post('/supervisor/changeover/activate', async (req, res) => {
    const { line_id, work_date } = req.body;
    if (!line_id || !work_date)
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    if (!CHANGEOVER_ENABLED)
        return res.status(403).json({ success: false, error: 'Changeover is disabled' });
    try {
        const planResult = await pool.query(
            `SELECT target_units, incoming_product_id, changeover_started_at, is_locked
             FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const plan = planResult.rows[0];
        if (!plan)
            return res.status(404).json({ success: false, error: 'No daily plan found for this line/date' });
        if (!plan.incoming_product_id)
            return res.status(400).json({ success: false, error: 'No changeover product configured for this line' });
        if (plan.changeover_started_at)
            return res.status(400).json({ success: false, error: 'Changeover is already active' });
        if (plan.is_locked)
            return res.status(403).json({ success: false, error: 'Daily plan is locked' });

        // Compute actual output: use the highest hourly quantity per process, then sum.
        // This handles both single-entry and cumulative hourly models.
        const outputResult = await pool.query(
            `SELECT COALESCE(SUM(q), 0) AS total
             FROM (
                 SELECT MAX(quantity) AS q
                 FROM line_process_hourly_progress
                 WHERE line_id = $1 AND work_date = $2
                 GROUP BY process_id
             ) sub`,
            [line_id, work_date]
        );
        const actualOutput = parseInt(outputResult.rows[0]?.total || 0, 10);
        const targetUnits = parseInt(plan.target_units, 10) || 0;
        if (actualOutput < targetUnits) {
            return res.status(400).json({
                success: false,
                error: `Target not yet met. Current output: ${actualOutput}, Target: ${targetUnits}`
            });
        }

        await pool.query(
            `UPDATE line_daily_plans SET changeover_started_at = NOW(), updated_at = NOW()
             WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        realtime.broadcast('data_change', {
            entity: 'changeover', action: 'activated', line_id, work_date
        });
        res.json({ success: true, message: 'Changeover activated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/supervisor/resolve-process', async (req, res) => {
    const { line_id, process_qr, work_date } = req.body;
    if (!line_id || !process_qr) {
        return res.status(400).json({ success: false, error: 'line_id and process_qr are required' });
    }

    const processParsed = parseSupervisorQr(process_qr);
    if (!processParsed || !processParsed.id) {
        return res.status(400).json({ success: false, error: 'Invalid process QR payload' });
    }

    try {
        const process = await resolveProcessForLine(line_id, processParsed, work_date);
        const employeeResult = await pool.query(
            `SELECT e.id, e.emp_code, e.emp_name
             FROM employee_process_assignments a
             JOIN employees e ON e.id = a.employee_id
             WHERE a.line_id = $1 AND a.process_id = $2
             LIMIT 1`,
            [line_id, process.id]
        );
        res.json({
            success: true,
            data: {
                process: {
                    id: process.id,
                    sequence_number: process.sequence_number,
                    operation_id: process.operation_id,
                    operation_code: process.operation_code,
                    operation_name: process.operation_name,
                    target_units: process.target_units || 0,
                    workspace_code: process.workspace_code || null,
                    workspace_name: process.workspace_name || null
                },
                employee: employeeResult.rows[0] || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/supervisor/resolve-employee', async (req, res) => {
    const { line_id, employee_qr, work_date } = req.body;
    if (!line_id || !employee_qr) {
        return res.status(400).json({ success: false, error: 'line_id and employee_qr are required' });
    }

    const employeeParsed = parseSupervisorQr(employee_qr);
    if (!employeeParsed) {
        return res.status(400).json({ success: false, error: 'Invalid employee QR payload' });
    }

    try {
        let employeeId = employeeParsed.id;
        let employee = null;
        if (!employeeId) {
            const rawCode = employeeParsed.code || employeeParsed.emp_code || employeeParsed.raw;
            if (!rawCode) {
                return res.status(400).json({ success: false, error: 'Invalid employee QR payload' });
            }
            const empResult = await pool.query(
                `SELECT id, emp_code, emp_name FROM employees WHERE emp_code = $1 AND is_active = true`,
                [rawCode]
            );
            employee = empResult.rows[0];
            if (!employee) {
                return res.status(404).json({ success: false, error: 'Employee not found' });
            }
            employeeId = employee.id;
        } else {
            const empResult = await pool.query(
                `SELECT id, emp_code, emp_name FROM employees WHERE id = $1 AND is_active = true`,
                [employeeId]
            );
            employee = empResult.rows[0];
            if (!employee) {
                return res.status(404).json({ success: false, error: 'Employee not found' });
            }
        }

        const assignmentResult = await pool.query(
            `SELECT process_id FROM employee_process_assignments WHERE line_id = $1 AND employee_id = $2`,
            [line_id, employeeId]
        );
        const assignment = assignmentResult.rows[0];
        if (!assignment) {
            return res.status(400).json({ success: false, error: 'Employee not assigned to this line' });
        }

        const process = await resolveProcessForLine(line_id, { id: assignment.process_id, type: 'process' }, work_date);
        res.json({
            success: true,
            data: {
                process: {
                    id: process.id,
                    sequence_number: process.sequence_number,
                    operation_id: process.operation_id,
                    operation_code: process.operation_code,
                    operation_name: process.operation_name,
                    target_units: process.target_units || 0,
                    workspace_code: process.workspace_code || null,
                    workspace_name: process.workspace_name || null
                },
                employee
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/supervisor/assign', async (req, res) => {
    const { line_id, process_id, employee_qr, quantity_completed, work_date, materials_at_link, existing_materials, confirm_change } = req.body;
    if (!line_id || !process_id || !employee_qr) {
        return res.status(400).json({ success: false, error: 'line_id, process_id and employee_qr are required' });
    }
    const effectiveDate = work_date || new Date().toISOString().slice(0, 10);
    if (await isDayLocked(effectiveDate)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    if (await isLineClosed(line_id, effectiveDate)) {
        return res.status(403).json({ success: false, error: 'Shift is closed for this line' });
    }

    const employeeParsed = parseSupervisorQr(employee_qr);
    if (!employeeParsed) {
        return res.status(400).json({ success: false, error: 'Invalid employee QR payload' });
    }

    let startedTransaction = false;
    try {
        const process = await resolveProcessForLine(line_id, { id: process_id, type: 'process' }, effectiveDate);

        let employeeId = employeeParsed.id;
        let employee = null;
        if (!employeeId) {
            const rawCode = employeeParsed.code || employeeParsed.emp_code || employeeParsed.raw;
            if (!rawCode) {
                return res.status(400).json({ success: false, error: 'Invalid employee QR payload' });
            }
            const empResult = await pool.query(
                `SELECT id, emp_code, emp_name FROM employees WHERE emp_code = $1 AND is_active = true`,
                [rawCode]
            );
            employee = empResult.rows[0];
            if (!employee) {
                return res.status(404).json({ success: false, error: 'Employee not found' });
            }
            employeeId = employee.id;
        } else {
            const empResult = await pool.query(
                `SELECT id, emp_code, emp_name FROM employees WHERE id = $1 AND is_active = true`,
                [employeeId]
            );
            employee = empResult.rows[0];
            if (!employee) {
                return res.status(404).json({ success: false, error: 'Employee not found' });
            }
        }

        const currentAssignmentResult = await pool.query(
            `SELECT employee_id FROM employee_process_assignments WHERE line_id = $1 AND process_id = $2`,
            [line_id, process.id]
        );
        const currentAssignment = currentAssignmentResult.rows[0];

        if (currentAssignment && currentAssignment.employee_id === employeeId) {
            const now = new Date();
            const date = effectiveDate;
            const inTime = now.toTimeString().slice(0, 5);
            if ((materials_at_link || 0) > 0) {
                await pool.query(
                    `INSERT INTO material_transactions
                     (line_id, work_date, transaction_type, quantity, to_process_id, notes, recorded_by)
                     VALUES ($1, $2, 'issued', $3, $4, $5, $6)`,
                    [
                        line_id,
                        effectiveDate,
                        materials_at_link,
                        process.id,
                        'Initial materials at link',
                        null
                    ]
                );
                await pool.query(
                    `INSERT INTO process_material_wip (line_id, process_id, work_date, materials_in, wip_quantity)
                     VALUES ($1, $2, $3, $4, $4)
                     ON CONFLICT (line_id, process_id, work_date)
                     DO UPDATE SET
                        materials_in = process_material_wip.materials_in + EXCLUDED.materials_in,
                        wip_quantity = process_material_wip.wip_quantity + $4,
                        updated_at = NOW()`,
                    [line_id, process.id, effectiveDate, materials_at_link]
                );
            }
            if ((existing_materials || 0) > 0) {
                await pool.query(
                    `INSERT INTO material_transactions
                     (line_id, work_date, transaction_type, quantity, to_process_id, notes, recorded_by)
                     VALUES ($1, $2, 'received', $3, $4, $5, $6)`,
                    [
                        line_id,
                        effectiveDate,
                        existing_materials,
                        process.id,
                        'Existing materials at process',
                        null
                    ]
                );
                await pool.query(
                    `INSERT INTO process_material_wip (line_id, process_id, work_date, materials_in, wip_quantity)
                     VALUES ($1, $2, $3, $4, $4)
                     ON CONFLICT (line_id, process_id, work_date)
                     DO UPDATE SET
                        materials_in = process_material_wip.materials_in + EXCLUDED.materials_in,
                        wip_quantity = process_material_wip.wip_quantity + $4,
                        updated_at = NOW()`,
                    [line_id, process.id, effectiveDate, existing_materials]
                );
            }
            await pool.query(
                `INSERT INTO employee_attendance (employee_id, attendance_date, in_time, out_time, status, notes)
                 VALUES ($1, $2, $3, $4, 'present', 'Supervisor scan')
                 ON CONFLICT (employee_id, attendance_date)
                 DO UPDATE SET in_time = COALESCE(employee_attendance.in_time, EXCLUDED.in_time),
                               status = 'present',
                               updated_at = NOW()`,
                [employeeId, date, inTime, '17:00']
            );
            realtime.broadcast('data_change', { entity: 'attendance', action: 'update', employee_id: employeeId, date });
            return res.json({
                success: true,
                data: {
                    process: {
                        id: process.id,
                        sequence_number: process.sequence_number,
                        operation_id: process.operation_id,
                        operation_code: process.operation_code,
                        operation_name: process.operation_name,
                        target_units: process.target_units || 0
                    },
                    employee
                }
            });
        }

        if (currentAssignment && currentAssignment.employee_id !== employeeId) {
            if (!confirm_change) {
                return res.status(400).json({ success: false, error: 'Confirm change required' });
            }
            const qtyValue = Number.isFinite(parseInt(quantity_completed, 10))
                ? parseInt(quantity_completed, 10)
                : null;
            if (qtyValue === null || qtyValue < 0) {
                return res.status(400).json({ success: false, error: 'Quantity completed is required to change employee' });
            }
        }

        const existingEmployeeAssignment = await pool.query(
            `SELECT line_id, process_id FROM employee_process_assignments WHERE employee_id = $1`,
            [employeeId]
        );
        const existing = existingEmployeeAssignment.rows[0];
        if (existing && (existing.line_id !== Number(line_id) || existing.process_id !== Number(process_id))) {
            if (!confirm_change) {
                return res.status(400).json({ success: false, error: 'Confirm change required' });
            }
        }

        await pool.query('BEGIN');
        startedTransaction = true;

        if (currentAssignment && currentAssignment.employee_id !== employeeId) {
            const qtyValue = parseInt(quantity_completed, 10);
            const updateResult = await pool.query(
                `UPDATE process_assignment_history
                 SET end_time = NOW(), quantity_completed = $1
                 WHERE line_id = $2 AND process_id = $3 AND employee_id = $4 AND end_time IS NULL`,
                [qtyValue, line_id, process.id, currentAssignment.employee_id]
            );
            if (updateResult.rowCount === 0) {
                await pool.query(
                    `INSERT INTO process_assignment_history
                     (line_id, process_id, employee_id, start_time, end_time, quantity_completed, changed_by)
                     VALUES ($1, $2, $3, NOW(), NOW(), $4, $5)`,
                    [line_id, process.id, currentAssignment.employee_id, qtyValue, null]
                );
            }
        }
        await pool.query(
            `DELETE FROM employee_process_assignments WHERE employee_id = $1`,
            [employeeId]
        );
        await pool.query(
            `DELETE FROM employee_process_assignments WHERE line_id = $1 AND process_id = $2`,
            [line_id, process.id]
        );
        await pool.query(
            `INSERT INTO employee_process_assignments (line_id, process_id, employee_id)
             VALUES ($1, $2, $3)`,
            [line_id, process.id, employeeId]
        );
        await pool.query(
            `INSERT INTO process_assignment_history
             (line_id, process_id, employee_id, start_time, quantity_completed, materials_at_link, existing_materials, changed_by)
             VALUES ($1, $2, $3, NOW(), 0, $4, $5, $6)`,
            [line_id, process.id, employeeId, materials_at_link || 0, existing_materials || 0, null]
        );
        if ((materials_at_link || 0) > 0) {
            await pool.query(
                `INSERT INTO material_transactions
                 (line_id, work_date, transaction_type, quantity, to_process_id, notes, recorded_by)
                 VALUES ($1, $2, 'issued', $3, $4, $5, $6)`,
                [
                    line_id,
                    effectiveDate,
                    materials_at_link,
                    process.id,
                    'Initial materials at link',
                    null
                ]
            );
            await pool.query(
                `INSERT INTO process_material_wip (line_id, process_id, work_date, materials_in, wip_quantity)
                 VALUES ($1, $2, $3, $4, $4)
                 ON CONFLICT (line_id, process_id, work_date)
                 DO UPDATE SET
                    materials_in = process_material_wip.materials_in + EXCLUDED.materials_in,
                    wip_quantity = process_material_wip.wip_quantity + $4,
                    updated_at = NOW()`,
                [line_id, process.id, effectiveDate, materials_at_link]
            );
        }
        if ((existing_materials || 0) > 0) {
            await pool.query(
                `INSERT INTO material_transactions
                 (line_id, work_date, transaction_type, quantity, to_process_id, notes, recorded_by)
                 VALUES ($1, $2, 'received', $3, $4, $5, $6)`,
                [
                    line_id,
                    effectiveDate,
                    existing_materials,
                    process.id,
                    'Existing materials at process',
                    null
                ]
            );
            await pool.query(
                `INSERT INTO process_material_wip (line_id, process_id, work_date, materials_in, wip_quantity)
                 VALUES ($1, $2, $3, $4, $4)
                 ON CONFLICT (line_id, process_id, work_date)
                 DO UPDATE SET
                    materials_in = process_material_wip.materials_in + EXCLUDED.materials_in,
                    wip_quantity = process_material_wip.wip_quantity + $4,
                    updated_at = NOW()`,
                [line_id, process.id, effectiveDate, existing_materials]
            );
        }

        const now = new Date();
        const date = effectiveDate;
        const inTime = now.toTimeString().slice(0, 5);
        await pool.query(
            `INSERT INTO employee_attendance (employee_id, attendance_date, in_time, out_time, status, notes)
             VALUES ($1, $2, $3, $4, 'present', 'Supervisor scan')
             ON CONFLICT (employee_id, attendance_date)
             DO UPDATE SET in_time = COALESCE(employee_attendance.in_time, EXCLUDED.in_time),
                           status = 'present',
                           updated_at = NOW()`,
            [employeeId, date, inTime, '17:00']
        );

        await pool.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'attendance', action: 'update', employee_id: employeeId, date });
        res.json({
            success: true,
            data: {
                process: {
                    id: process.id,
                    sequence_number: process.sequence_number,
                    operation_id: process.operation_id,
                    operation_code: process.operation_code,
                    operation_name: process.operation_name,
                    target_units: process.target_units || 0
                },
                employee
            }
        });
    } catch (err) {
        if (startedTransaction) {
            await pool.query('ROLLBACK');
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/supervisor/scan', async (req, res) => {
    const { line_id, employee_qr, process_qr } = req.body;
    if (!line_id || !employee_qr || !process_qr) {
        return res.status(400).json({ success: false, error: 'line_id, employee_qr and process_qr are required' });
    }

    const employeeParsed = parseSupervisorQr(employee_qr);
    const processParsed = parseSupervisorQr(process_qr);
    if (!employeeParsed || !employeeParsed.id || !processParsed || !processParsed.id) {
        return res.status(400).json({ success: false, error: 'Invalid QR payload' });
    }

    try {
        const employeeId = employeeParsed.id;
        const process = await resolveProcessForLine(line_id, processParsed);
        const processId = process.id;

        const assignment = await pool.query(
            `SELECT 1 FROM employee_process_assignments
             WHERE employee_id = $1 AND process_id = $2 AND line_id = $3`,
            [employeeId, processId, line_id]
        );
        if (assignment.rowCount === 0) {
            return res.status(400).json({ success: false, error: 'Employee is not assigned to this line/process' });
        }

        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        if (await isDayLocked(date)) {
            return res.status(403).json({ success: false, error: 'Production day is locked' });
        }
        const inTime = now.toTimeString().slice(0, 5);
        await pool.query(
            `INSERT INTO employee_attendance (employee_id, attendance_date, in_time, out_time, status, notes)
             VALUES ($1, $2, $3, $4, 'present', 'Supervisor scan')
             ON CONFLICT (employee_id, attendance_date)
             DO UPDATE SET in_time = COALESCE(employee_attendance.in_time, EXCLUDED.in_time),
                           status = 'present',
                           updated_at = NOW()`,
            [employeeId, date, inTime, '17:00']
        );

        realtime.broadcast('data_change', { entity: 'attendance', action: 'update', employee_id: employeeId, date });
        res.json({ success: true, data: { employee_id: employeeId, process_id: processId, line_id } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Close shift for a line
router.post('/supervisor/close-shift', async (req, res) => {
    const { line_id, work_date, notes } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO line_shift_closures (line_id, work_date, notes)
             VALUES ($1, $2, $3)
             ON CONFLICT (line_id, work_date)
             DO UPDATE SET closed_at = NOW(), notes = EXCLUDED.notes
             RETURNING *`,
            [line_id, work_date, notes || null]
        );
        await logAudit('line_shift_closures', result.rows[0].id, 'close', result.rows[0], null);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin unlock shift
router.post('/line-shifts/unlock', async (req, res) => {
    const { line_id, work_date } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    try {
        const before = await pool.query(
            `SELECT * FROM line_shift_closures WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        await pool.query(
            `DELETE FROM line_shift_closures WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        await logAudit('line_shift_closures', 0, 'unlock', null, before.rows[0] || null);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/line-shifts', async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
    }
    try {
        const result = await pool.query(
            `SELECT lsc.line_id, lsc.work_date, lsc.closed_at, lsc.notes,
                    pl.line_name, pl.line_code
             FROM line_shift_closures lsc
             JOIN production_lines pl ON pl.id = lsc.line_id
             WHERE lsc.work_date = $1
             ORDER BY pl.line_name`,
            [date]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/supervisor/progress', async (req, res) => {
    const { line_id, work_date, hour_slot, quantity, forwarded_quantity, remaining_quantity, qa_rejection, remarks, shortfall_reason } = req.body;
    // Support both: workstation_plan_id (new model) or process_id (legacy)
    const { workstation_plan_id, process_id } = req.body;
    if (!line_id || !work_date || hour_slot === undefined || (!process_id && !workstation_plan_id)) {
        return res.status(400).json({ success: false, error: 'line_id, work_date, hour_slot, and either process_id or workstation_plan_id are required' });
    }
    const hourValue = parseInt(hour_slot, 10);
    if (!Number.isFinite(hourValue) || hourValue < 8 || hourValue > 19) {
        return res.status(400).json({ success: false, error: 'hour_slot must be between 8 and 19' });
    }
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    if (await isLineClosed(line_id, work_date)) {
        return res.status(403).json({ success: false, error: 'Shift is closed for this line' });
    }
    try {
        // New model: workstation_plan_id — fan out to all processes in this workstation
        if (workstation_plan_id) {
            const wsResult = await pool.query(
                `SELECT lpw.id, lpw.workstation_code,
                        ewa.employee_id,
                        array_agg(lpwp.product_process_id ORDER BY lpwp.sequence_in_workstation) as process_ids
                 FROM line_plan_workstations lpw
                 JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
                 LEFT JOIN employee_workstation_assignments ewa
                    ON (ewa.line_plan_workstation_id = lpw.id OR (ewa.line_id = lpw.line_id AND ewa.work_date = lpw.work_date AND ewa.workstation_code = lpw.workstation_code))
                 WHERE lpw.id = $1 AND lpw.line_id = $2
                 GROUP BY lpw.id, lpw.workstation_code, ewa.employee_id`,
                [workstation_plan_id, line_id]
            );
            if (!wsResult.rows[0]) {
                return res.status(400).json({ success: false, error: 'Workstation plan not found' });
            }
            const ws = wsResult.rows[0];
            if (!ws.employee_id) {
                return res.status(400).json({ success: false, error: 'No employee assigned to this workstation' });
            }
            const completed = parseInt(quantity || 0, 10);
            const forwarded = parseInt(forwarded_quantity || completed, 10);
            const remaining = parseInt(remaining_quantity || 0, 10);
            const rejected = parseInt(qa_rejection || 0, 10);
            // Fan out: save same quantity for all processes in this workstation
            const savedProcessIds = [];
            for (const pid of ws.process_ids) {
                await pool.query(
                    `INSERT INTO line_process_hourly_progress
                     (line_id, process_id, employee_id, work_date, hour_slot, quantity, forwarded_quantity, remaining_quantity, qa_rejection, remarks, shortfall_reason)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                     ON CONFLICT (line_id, process_id, work_date, hour_slot)
                     DO UPDATE SET quantity = EXCLUDED.quantity,
                                   employee_id = EXCLUDED.employee_id,
                                   forwarded_quantity = EXCLUDED.forwarded_quantity,
                                   remaining_quantity = EXCLUDED.remaining_quantity,
                                   qa_rejection = EXCLUDED.qa_rejection,
                                   remarks = EXCLUDED.remarks,
                                   shortfall_reason = EXCLUDED.shortfall_reason,
                                   updated_at = NOW()`,
                    [line_id, pid, ws.employee_id, work_date, hourValue, completed, forwarded, remaining, rejected, remarks || null, shortfall_reason || null]
                );
                savedProcessIds.push(pid);
            }
            if (remarks !== undefined) {
                await pool.query(
                    `INSERT INTO line_hourly_reports (line_id, work_date, hour_slot, remarks, updated_at)
                     VALUES ($1, $2, $3, $4, NOW())
                     ON CONFLICT (line_id, work_date, hour_slot)
                     DO UPDATE SET remarks = EXCLUDED.remarks, updated_at = NOW()`,
                    [line_id, work_date, hourValue, remarks || null]
                );
            }
            realtime.broadcast('data_change', { entity: 'progress', action: 'update', line_id, workstation_plan_id, work_date, hour_slot });
            return res.json({ success: true, data: { workstation_plan_id, process_ids: savedProcessIds, quantity: completed } });
        }

        // Legacy model: single process_id
        const assignmentResult = await pool.query(
            `SELECT ewa.employee_id
             FROM employee_workstation_assignments ewa
             JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = ewa.line_plan_workstation_id
             WHERE lpwp.product_process_id = $1 AND ewa.line_id = $2 AND ewa.work_date = $3
             LIMIT 1`,
            [process_id, line_id, work_date]
        );
        // Fallback to old workstation_code matching
        const assignment = assignmentResult.rows[0] || (await pool.query(
            `SELECT ewa.employee_id
             FROM employee_workstation_assignments ewa
             JOIN product_processes pp ON pp.workstation_code = ewa.workstation_code
             WHERE pp.id = $1 AND ewa.line_id = $2
             LIMIT 1`,
            [process_id, line_id]
        )).rows[0];
        if (!assignment) {
            return res.status(400).json({ success: false, error: 'No employee assigned to this workstation' });
        }
        const completed = parseInt(quantity || 0, 10);
        const forwarded = parseInt(forwarded_quantity || 0, 10);
        const remaining = parseInt(remaining_quantity || 0, 10);
        const rejected = parseInt(qa_rejection || 0, 10);
        if (rejected < 0 || rejected > completed) {
            return res.status(400).json({ success: false, error: 'QA Rejection must be between 0 and Completed' });
        }
        if (completed !== forwarded + remaining) {
            return res.status(400).json({ success: false, error: 'Completed must equal Forwarded + Remaining' });
        }
        const result = await pool.query(
            `INSERT INTO line_process_hourly_progress
             (line_id, process_id, employee_id, work_date, hour_slot, quantity, forwarded_quantity, remaining_quantity, qa_rejection, remarks, shortfall_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (line_id, process_id, work_date, hour_slot)
             DO UPDATE SET quantity = EXCLUDED.quantity,
                           employee_id = EXCLUDED.employee_id,
                           forwarded_quantity = EXCLUDED.forwarded_quantity,
                           remaining_quantity = EXCLUDED.remaining_quantity,
                           qa_rejection = EXCLUDED.qa_rejection,
                           remarks = EXCLUDED.remarks,
                           shortfall_reason = EXCLUDED.shortfall_reason,
                           updated_at = NOW()
             RETURNING *`,
            [line_id, process_id, assignment.employee_id, work_date, hourValue, completed, forwarded, remaining, rejected, remarks || null, shortfall_reason || null]
        );
        if (remarks !== undefined) {
            await pool.query(
                `INSERT INTO line_hourly_reports (line_id, work_date, hour_slot, remarks, updated_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (line_id, work_date, hour_slot)
                 DO UPDATE SET remarks = EXCLUDED.remarks, updated_at = NOW()`,
                [line_id, work_date, hourValue, remarks || null]
            );
        }
        const nextProcessId = forwarded > 0
            ? await resolveNextProcessForLine(line_id, process_id, work_date)
            : null;
        const forwardNote = `Hourly progress ${hourValue}`;
        await pool.query(
            `DELETE FROM material_transactions
             WHERE line_id = $1 AND work_date = $2 AND transaction_type = 'forwarded'
               AND from_process_id = $3 AND notes = $4`,
            [line_id, work_date, process_id, forwardNote]
        );
        if (forwarded > 0 && nextProcessId) {
            await pool.query(
                `INSERT INTO material_transactions
                 (line_id, work_date, transaction_type, quantity, from_process_id, to_process_id, notes, recorded_by)
                 VALUES ($1, $2, 'forwarded', $3, $4, $5, $6, $7)`,
                [line_id, work_date, forwarded, process_id, nextProcessId, forwardNote, null]
            );
            await refreshProcessWip(line_id, process_id, work_date);
            await refreshProcessWip(line_id, nextProcessId, work_date);
        } else {
            await refreshProcessWip(line_id, process_id, work_date);
        }
        const remainingTotalResult = await pool.query(
            `SELECT COALESCE(SUM(remaining_quantity), 0) AS qty
             FROM line_process_hourly_progress
             WHERE line_id = $1 AND process_id = $2 AND work_date = $3`,
            [line_id, process_id, work_date]
        );
        const remainingTotal = parseInt(remainingTotalResult.rows[0]?.qty || 0, 10);
        await pool.query(
            `INSERT INTO process_material_wip (line_id, process_id, work_date, wip_quantity)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (line_id, process_id, work_date)
             DO UPDATE SET
                wip_quantity = EXCLUDED.wip_quantity,
                updated_at = NOW()`,
            [line_id, process_id, work_date, remainingTotal]
        );

        if (CHANGEOVER_ENABLED && completed > 0) {
            const planResult = await pool.query(
                `SELECT id, incoming_product_id, changeover_sequence
                 FROM line_daily_plans
                 WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            const plan = planResult.rows[0];
            if (plan?.incoming_product_id) {
                const procResult = await pool.query(
                    `SELECT product_id, sequence_number
                     FROM product_processes
                     WHERE id = $1`,
                    [process_id]
                );
                const proc = procResult.rows[0];
                if (proc && parseInt(proc.product_id, 10) === parseInt(plan.incoming_product_id, 10)) {
                    const seq = parseInt(proc.sequence_number || 0, 10);
                    const currentSeq = parseInt(plan.changeover_sequence || 0, 10);
                    if (seq > currentSeq) {
                        const maxSeq = await getIncomingMaxSequence(plan.incoming_product_id);
                        const nextSeq = Math.min(seq, maxSeq);
                        const before = await pool.query(
                            `SELECT * FROM line_daily_plans WHERE id = $1`,
                            [plan.id]
                        );
                        const updateResult = await pool.query(
                            `UPDATE line_daily_plans
                             SET changeover_sequence = $1, updated_at = NOW()
                             WHERE id = $2
                             RETURNING changeover_sequence`,
                            [nextSeq, plan.id]
                        );
                        await logAudit(
                            'line_daily_plans',
                            plan.id,
                            'changeover_auto',
                            updateResult.rows[0],
                            before.rows[0] || null
                        );
                        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
                    }
                }
            }
        }
        realtime.broadcast('data_change', { entity: 'progress', action: 'update', line_id, process_id, work_date, hour_slot });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/supervisor/progress', async (req, res) => {
    const { line_id, work_date } = req.query;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    try {
        const result = await pool.query(
            `SELECT lpp.id,
                    lpp.process_id,
                    lpp.hour_slot,
                    lpp.quantity,
                    lpp.qa_rejection,
                    lpp.remarks,
                    lpp.shortfall_reason,
                    o.operation_code,
                    o.operation_name,
                    ws.workspace_code,
                    ws.workspace_name
             FROM line_process_hourly_progress lpp
             JOIN product_processes pp ON lpp.process_id = pp.id
             JOIN operations o ON pp.operation_id = o.id
             LEFT JOIN workspaces ws ON pp.workspace_id = ws.id AND ws.is_active = true
             WHERE lpp.line_id = $1 AND lpp.work_date = $2
             ORDER BY lpp.hour_slot, o.operation_code`,
            [line_id, work_date]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Hourly employee efficiency for a line
router.get('/supervisor/employee-hourly-efficiency', async (req, res) => {
    const { line_id, date, hour } = req.query;
    if (!line_id || !date || hour === undefined) {
        return res.status(400).json({ success: false, error: 'line_id, date, and hour are required' });
    }
    const hourValue = parseInt(hour, 10);
    if (!Number.isFinite(hourValue)) {
        return res.status(400).json({ success: false, error: 'hour must be a number' });
    }
    try {
        const result = await pool.query(
            `SELECT e.id, e.emp_code, e.emp_name,
                    e.manpower_factor,
                    o.operation_code, o.operation_name,
                    pp.operation_sah,
                    COALESCE(SUM(lph.quantity), 0) as total_output,
                    COALESCE(SUM(lph.qa_rejection), 0) as total_rejection
             FROM line_process_hourly_progress lph
             JOIN employees e ON lph.employee_id = e.id
             JOIN product_processes pp ON lph.process_id = pp.id
             JOIN operations o ON pp.operation_id = o.id
             WHERE lph.line_id = $1 AND lph.work_date = $2 AND lph.hour_slot = $3
             GROUP BY e.id, e.emp_code, e.emp_name, e.manpower_factor,
                      o.operation_code, o.operation_name, pp.operation_sah
             ORDER BY e.emp_code`,
            [line_id, date, hourValue]
        );
        const data = result.rows.map(row => {
            const output = parseInt(row.total_output || 0, 10);
            const sah = parseFloat(row.operation_sah || 0);
            const mp = parseFloat(row.manpower_factor || 1);
            const efficiency = mp > 0 && sah > 0
                ? Math.round(((output * sah) / mp) * 100 * 100) / 100
                : 0;
            return {
                ...row,
                efficiency_percent: efficiency
            };
        });
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Final stitching and final QA status per line
router.get('/lines-final-status', async (req, res) => {
    const { date } = req.query;
    const workDate = date || new Date().toISOString().split('T')[0];
    try {
        const result = await pool.query(
            `WITH targets AS (
                SELECT pl.id as line_id,
                       pl.line_name,
                       pl.line_code,
                       COALESCE(ldp.target_units, pl.target_units, 0) as target
                FROM production_lines pl
                LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $1
                WHERE pl.is_active = true
            ),
            final_stitch AS (
                SELECT lph.line_id,
                       COALESCE(SUM(lph.quantity), 0) as output
                FROM line_process_hourly_progress lph
                JOIN product_processes pp ON lph.process_id = pp.id
                JOIN operations o ON pp.operation_id = o.id
                WHERE lph.work_date = $1
                  AND o.operation_category = 'STITCHING'
                  AND lower(o.operation_name) LIKE '%final%'
                GROUP BY lph.line_id
            ),
            final_qa AS (
                SELECT lph.line_id,
                       COALESCE(SUM(lph.quantity), 0) as output,
                       COALESCE(SUM(lph.qa_rejection), 0) as rejection
                FROM line_process_hourly_progress lph
                JOIN product_processes pp ON lph.process_id = pp.id
                JOIN operations o ON pp.operation_id = o.id
                WHERE lph.work_date = $1
                  AND (lower(o.operation_name) LIKE '%qa%' OR lower(o.operation_name) LIKE '%quality%')
                GROUP BY lph.line_id
            )
            SELECT t.line_id, t.line_name, t.line_code, t.target,
                   COALESCE(fs.output, 0) as final_stitch_output,
                   COALESCE(fq.output, 0) as final_qa_output,
                   COALESCE(fq.rejection, 0) as final_qa_rejection
            FROM targets t
            LEFT JOIN final_stitch fs ON fs.line_id = t.line_id
            LEFT JOIN final_qa fq ON fq.line_id = t.line_id
            ORDER BY t.line_id`,
            [workDate]
        );
        const data = result.rows.map(row => ({
            ...row,
            final_stitch_remaining: Math.max((parseInt(row.target) || 0) - (parseInt(row.final_stitch_output) || 0), 0),
            final_qa_remaining: Math.max((parseInt(row.target) || 0) - (parseInt(row.final_qa_output) || 0), 0)
        }));
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PRODUCTION LINE DETAILS
// ============================================================================
router.get('/lines/:id/details', async (req, res) => {
    const { id } = req.params;
    try {
        const lineResult = await pool.query(`
            SELECT pl.*,
                   COALESCE(ldp.product_id, pl.current_product_id) as active_product_id,
                   COALESCE(p_plan.product_code, p.product_code) as product_code,
                   COALESCE(p_plan.product_name, p.product_name) as product_name,
                   ldp.target_units as daily_target_units,
                   ldp.incoming_product_id,
                   ip.product_code as incoming_product_code,
                   ip.product_name as incoming_product_name,
                   COALESCE(ldp.incoming_target_units, 0) as incoming_target_units,
                   COALESCE(ldp.changeover_sequence, 0) as changeover_sequence
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = CURRENT_DATE
            LEFT JOIN products p_plan ON ldp.product_id = p_plan.id
            LEFT JOIN products p ON pl.current_product_id = p.id
            LEFT JOIN products ip ON ldp.incoming_product_id = ip.id
            WHERE pl.id = $1
        `, [id]);
        const line = lineResult.rows[0];
        if (!line) {
            return res.status(404).json({ success: false, error: 'Line not found' });
        }
        line.changeover = !!line.incoming_product_id && CHANGEOVER_ENABLED;
        let changeoverSequence = parseInt(line.changeover_sequence || 0, 10);
        let incomingMaxSequence = 0;
        if (line.incoming_product_id && CHANGEOVER_ENABLED) {
            incomingMaxSequence = await getIncomingMaxSequence(line.incoming_product_id);
        }
        changeoverSequence = Math.max(0, Math.min(changeoverSequence, incomingMaxSequence));

        const employeesResult = await pool.query(`
            SELECT e.*
            FROM employees e
            WHERE e.is_active = true
            ORDER BY e.emp_code
        `);
        const employees = employeesResult.rows;

        // Get processes for both primary and incoming products
        let processes = [];
        const productId = line.active_product_id || line.current_product_id;
        const hasProducts = !!productId || !!line.incoming_product_id;
        if (hasProducts) {
            const processesResult = await pool.query(`
                SELECT pp.*, pp.product_id,
                       o.operation_code, o.operation_name, o.operation_category, o.qr_code_path,
                       pr.product_code as product_code,
                       ws.id as workspace_id, ws.workspace_code, ws.workspace_name
                FROM product_processes pp
                JOIN operations o ON pp.operation_id = o.id
                JOIN products pr ON pp.product_id = pr.id
                LEFT JOIN workspaces ws ON pp.workspace_id = ws.id AND ws.is_active = true
                WHERE pp.is_active = true
                  AND (
                    (pp.product_id = $1 AND ($2::int IS NULL OR pp.sequence_number > $3))
                    OR (pp.product_id = $2 AND pp.sequence_number <= $3)
                  )
                ORDER BY pp.product_id = $1 DESC, pp.sequence_number
            `, [productId, line.incoming_product_id, changeoverSequence]);
            processes = processesResult.rows;
        }

        let assignments = [];
        let allAssignments = [];
        if (processes.length) {
            const processIds = processes.map(proc => proc.id);
            const assignmentsResult = await pool.query(`
                SELECT a.process_id, a.employee_id, a.line_id, e.emp_code, e.emp_name
                FROM employee_process_assignments a
                JOIN employees e ON a.employee_id = e.id
                WHERE a.process_id = ANY($1::int[]) AND a.line_id = $2
            `, [processIds, id]);
            assignments = assignmentsResult.rows;
        }
        const allAssignmentsResult = await pool.query(`
            SELECT process_id, employee_id, line_id
            FROM employee_process_assignments
        `);
        allAssignments = allAssignmentsResult.rows;

        // Get workstations for this line
        const workstationsResult = await pool.query(`
            SELECT id, workspace_code, workspace_name, workspace_type
            FROM workspaces
            WHERE line_id = $1 AND is_active = true
            ORDER BY workspace_code
        `, [id]);

        res.json({
            success: true,
            data: {
                line,
                employees,
                processes,
                assignments,
                allAssignments,
                workstations: workstationsResult.rows,
                changeover_enabled: CHANGEOVER_ENABLED,
                incoming_max_sequence: incomingMaxSequence,
                changeover_sequence: changeoverSequence
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// MATERIAL TRACKING (Supervisor)
// ============================================================================

// Get material summary for a line on a date
router.get('/supervisor/materials', async (req, res) => {
    const { line_id, date } = req.query;
    if (!line_id || !date) {
        return res.status(400).json({ success: false, error: 'line_id and date are required' });
    }
    try {
        const processesResult = await pool.query(
            `SELECT pp.id, pp.sequence_number, o.operation_code, o.operation_name
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             WHERE pp.product_id = (
                SELECT COALESCE(ldp.product_id, pl.current_product_id)
                FROM production_lines pl
                LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $2
                WHERE pl.id = $1
             ) AND pp.is_active = true
             ORDER BY pp.sequence_number`,
            [line_id, date]
        );

        // Get summary from view
        const summaryResult = await pool.query(`
            SELECT * FROM v_daily_material_summary
            WHERE line_id = $1 AND work_date = $2
        `, [line_id, date]);
        const summary = summaryResult.rows[0] || {
            total_issued: 0,
            total_used: 0,
            total_returned: 0,
            total_forwarded: 0,
            total_received: 0
        };

        // Get transactions for the day
        const transactionsResult = await pool.query(`
            SELECT mt.*,
                   p_from.sequence_number as from_sequence,
                   o_from.operation_name as from_operation,
                   p_to.sequence_number as to_sequence,
                   o_to.operation_name as to_operation,
                   u.full_name as recorded_by_name
            FROM material_transactions mt
            LEFT JOIN product_processes p_from ON mt.from_process_id = p_from.id
            LEFT JOIN operations o_from ON p_from.operation_id = o_from.id
            LEFT JOIN product_processes p_to ON mt.to_process_id = p_to.id
            LEFT JOIN operations o_to ON p_to.operation_id = o_to.id
            LEFT JOIN users u ON mt.recorded_by = u.id
            WHERE mt.line_id = $1 AND mt.work_date = $2
            ORDER BY mt.created_at DESC
        `, [line_id, date]);

        // Get WIP by process
        const wipResult = await pool.query(`
            SELECT pmw.*, pp.sequence_number, o.operation_code, o.operation_name
            FROM process_material_wip pmw
            JOIN product_processes pp ON pmw.process_id = pp.id
            JOIN operations o ON pp.operation_id = o.id
            WHERE pmw.line_id = $1 AND pmw.work_date = $2
            ORDER BY pp.sequence_number
        `, [line_id, date]);
        const wipRows = wipResult.rows || [];
        const wipMap = new Map(wipRows.map(row => [String(row.process_id), row]));

        // Get line metrics for opening stock reference
        const metricsResult = await pool.query(`
            SELECT materials_issued, forwarded_quantity, remaining_wip
            FROM line_daily_metrics
            WHERE line_id = $1 AND work_date = $2
        `, [line_id, date]);
        const metrics = metricsResult.rows[0] || {};

        res.json({
            success: true,
            data: {
                summary: {
                    ...summary,
                    opening_stock: metrics.materials_issued || 0,
                    forwarded: metrics.forwarded_quantity || 0,
                    wip: metrics.remaining_wip || 0
                },
                transactions: transactionsResult.rows,
                wip_by_process: processesResult.rows.map(proc => ({
                    process_id: proc.id,
                    sequence_number: proc.sequence_number,
                    operation_code: proc.operation_code,
                    operation_name: proc.operation_name,
                    materials_in: wipMap.get(String(proc.id))?.materials_in || 0,
                    materials_out: wipMap.get(String(proc.id))?.materials_out || 0,
                    wip_quantity: wipMap.get(String(proc.id))?.wip_quantity || 0
                }))
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Record a material transaction
router.post('/supervisor/materials', async (req, res) => {
    const { line_id, work_date, transaction_type, quantity, from_process_id, to_process_id, notes, user_id } = req.body;
    if (!line_id || !work_date || !transaction_type || quantity === undefined) {
        return res.status(400).json({ success: false, error: 'line_id, work_date, transaction_type and quantity are required' });
    }
    const validTypes = ['issued', 'used', 'returned', 'forwarded', 'received'];
    if (!validTypes.includes(transaction_type)) {
        return res.status(400).json({ success: false, error: `Invalid transaction_type. Must be one of: ${validTypes.join(', ')}` });
    }
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO material_transactions
             (line_id, work_date, transaction_type, quantity, from_process_id, to_process_id, notes, recorded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [line_id, work_date, transaction_type, quantity, from_process_id || null, to_process_id || null, notes || null, user_id || null]
        );

        // Update process WIP if forwarding between processes
        if ((transaction_type === 'forwarded' || transaction_type === 'used') && from_process_id) {
            await pool.query(`
                INSERT INTO process_material_wip (line_id, process_id, work_date, materials_out, wip_quantity)
                VALUES ($1, $2, $3, $4, -$4)
                ON CONFLICT (line_id, process_id, work_date)
                DO UPDATE SET
                    materials_out = process_material_wip.materials_out + EXCLUDED.materials_out,
                    wip_quantity = process_material_wip.wip_quantity - $4,
                    updated_at = NOW()
            `, [line_id, from_process_id, work_date, quantity]);
        }

        if ((transaction_type === 'received' || transaction_type === 'issued') && to_process_id) {
            await pool.query(`
                INSERT INTO process_material_wip (line_id, process_id, work_date, materials_in, wip_quantity)
                VALUES ($1, $2, $3, $4, $4)
                ON CONFLICT (line_id, process_id, work_date)
                DO UPDATE SET
                    materials_in = process_material_wip.materials_in + EXCLUDED.materials_in,
                    wip_quantity = process_material_wip.wip_quantity + $4,
                    updated_at = NOW()
            `, [line_id, to_process_id, work_date, quantity]);
        }

        await logAudit('material_transactions', result.rows[0].id, 'create', result.rows[0], null);
        realtime.broadcast('data_change', { entity: 'materials', action: 'create', line_id, work_date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get processes for material forwarding dropdown
router.get('/supervisor/materials/processes/:lineId', async (req, res) => {
    const { lineId } = req.params;
    const { date } = req.query;
    const workDate = date || new Date().toISOString().slice(0, 10);
    try {
        // Get product for the line on this date
        const planResult = await pool.query(
            `SELECT product_id FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [lineId, workDate]
        );
        let productId = planResult.rows[0]?.product_id;
        if (!productId) {
            const lineResult = await pool.query(
                `SELECT current_product_id FROM production_lines WHERE id = $1`,
                [lineId]
            );
            productId = lineResult.rows[0]?.current_product_id;
        }
        if (!productId) {
            return res.json({ success: true, data: [] });
        }

        const result = await pool.query(`
            SELECT pp.id, pp.sequence_number, o.operation_code, o.operation_name
            FROM product_processes pp
            JOIN operations o ON pp.operation_id = o.id
            WHERE pp.product_id = $1 AND pp.is_active = true
            ORDER BY pp.sequence_number
        `, [productId]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/supervisor/materials/log', async (req, res) => {
    const { line_id, date, process_id } = req.query;
    if (!line_id || !date || !process_id) {
        return res.status(400).json({ success: false, error: 'line_id, date, and process_id are required' });
    }
    try {
        const result = await pool.query(
            `SELECT mt.*,
                    p_from.sequence_number as from_sequence,
                    o_from.operation_name as from_operation,
                    p_to.sequence_number as to_sequence,
                    o_to.operation_name as to_operation
             FROM material_transactions mt
             LEFT JOIN product_processes p_from ON mt.from_process_id = p_from.id
             LEFT JOIN operations o_from ON p_from.operation_id = o_from.id
             LEFT JOIN product_processes p_to ON mt.to_process_id = p_to.id
             LEFT JOIN operations o_to ON p_to.operation_id = o_to.id
             WHERE mt.line_id = $1 AND mt.work_date = $2
               AND (mt.from_process_id = $3 OR mt.to_process_id = $3)
             ORDER BY mt.created_at DESC`,
            [line_id, date, process_id]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// END-OF-SHIFT SUMMARY (Supervisor)
// ============================================================================

// Get end-of-shift summary for a line
router.get('/supervisor/shift-summary', async (req, res) => {
    const { line_id, date } = req.query;
    if (!line_id || !date) {
        return res.status(400).json({ success: false, error: 'line_id and date are required' });
    }
    try {
        // Get line info with both products
        const lineResult = await pool.query(`
            SELECT pl.*,
                   COALESCE(ldp.product_id, pl.current_product_id) as product_id,
                   COALESCE(p.product_code, '') as product_code,
                   COALESCE(p.product_name, '') as product_name,
                   COALESCE(ldp.target_units, pl.target_units, 0) as target,
                   ldp.incoming_product_id,
                   COALESCE(ip.product_code, '') as incoming_product_code,
                   COALESCE(ip.product_name, '') as incoming_product_name,
                   COALESCE(ldp.incoming_target_units, 0) as incoming_target,
                   COALESCE(ldp.changeover_sequence, 0) as changeover_sequence
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $2
            LEFT JOIN products p ON COALESCE(ldp.product_id, pl.current_product_id) = p.id
            LEFT JOIN products ip ON ldp.incoming_product_id = ip.id
            WHERE pl.id = $1
        `, [line_id, date]);
        const line = lineResult.rows[0];
        if (!line) {
            return res.status(404).json({ success: false, error: 'Line not found' });
        }
        const hasChangeover = !!line.incoming_product_id && CHANGEOVER_ENABLED;
        let changeoverSequence = parseInt(line.changeover_sequence || 0, 10);

        // Get total SAH for product(s)
        let totalSAH = 0;
        let incomingSAH = 0;
        if (line.product_id) {
            const sahResult = await pool.query(`
                SELECT COALESCE(SUM(operation_sah), 0) as total_sah
                FROM product_processes
                WHERE product_id = $1 AND is_active = true
            `, [line.product_id]);
            totalSAH = parseFloat(sahResult.rows[0].total_sah) || 0;
        }
        if (line.incoming_product_id) {
            const sahResult2 = await pool.query(`
                SELECT COALESCE(SUM(operation_sah), 0) as total_sah
                FROM product_processes
                WHERE product_id = $1 AND is_active = true
            `, [line.incoming_product_id]);
            incomingSAH = parseFloat(sahResult2.rows[0].total_sah) || 0;
        }
        let incomingMaxSequence = 0;
        if (line.incoming_product_id && CHANGEOVER_ENABLED) {
            incomingMaxSequence = await getIncomingMaxSequence(line.incoming_product_id);
        }
        changeoverSequence = Math.max(0, Math.min(changeoverSequence, incomingMaxSequence));

        // Get hourly output summary
        const hourlyResult = await pool.query(`
            SELECT hour_slot, SUM(quantity) as total_quantity
            FROM line_process_hourly_progress
            WHERE line_id = $1 AND work_date = $2
            GROUP BY hour_slot
            ORDER BY hour_slot
        `, [line_id, date]);
        const hourlyOutput = hourlyResult.rows;
        const hourlyTotal = hourlyOutput.reduce((sum, h) => sum + parseInt(h.total_quantity || 0), 0);

        const shiftResult = await pool.query(
            `SELECT closed_at FROM line_shift_closures WHERE line_id = $1 AND work_date = $2`,
            [line_id, date]
        );
        const shiftClosed = shiftResult.rowCount > 0;
        const shiftClosedAt = shiftResult.rows[0]?.closed_at || null;

        // Get output by process (both products if changeover)
        const processOutputResult = await pool.query(`
            SELECT pp.id as process_id,
                   pp.sequence_number,
                   pp.product_id,
                   p.product_code,
                   o.operation_code,
                   o.operation_name,
                   COALESCE(SUM(lph.quantity), 0) as total_quantity
            FROM product_processes pp
            JOIN operations o ON pp.operation_id = o.id
            JOIN products p ON pp.product_id = p.id
            LEFT JOIN line_process_hourly_progress lph
                ON lph.process_id = pp.id AND lph.line_id = $1 AND lph.work_date = $2
            WHERE pp.is_active = true
              AND (
                (pp.product_id = $3 AND ($4::int IS NULL OR pp.sequence_number > $5))
                OR (pp.product_id = $4 AND pp.sequence_number <= $5)
              )
            GROUP BY pp.id, pp.sequence_number, pp.product_id, p.product_code, o.operation_code, o.operation_name
            ORDER BY pp.product_id = $3 DESC, pp.sequence_number
        `, [line_id, date, line.product_id, line.incoming_product_id, changeoverSequence]);

        // Get employee attendance and output (includes both products' employees)
        const employeeResult = await pool.query(`
            SELECT e.id, e.emp_code, e.emp_name,
                   e.manpower_factor,
                   att.in_time, att.out_time, att.status,
                   COALESCE(SUM(lph.quantity), 0) as total_output,
                   pp.sequence_number,
                   pp.product_id,
                   pp.operation_sah,
                   p.product_code as product_code,
                   o.operation_code,
                   o.operation_name
            FROM employees e
            JOIN employee_process_assignments epa ON e.id = epa.employee_id AND epa.line_id = $1
            JOIN product_processes pp ON epa.process_id = pp.id
            JOIN products p ON pp.product_id = p.id
            JOIN operations o ON pp.operation_id = o.id
            LEFT JOIN employee_attendance att ON e.id = att.employee_id AND att.attendance_date = $2
            LEFT JOIN line_process_hourly_progress lph
                ON lph.employee_id = e.id AND lph.line_id = $1 AND lph.work_date = $2
            WHERE e.is_active = true
              AND (
                (pp.product_id = $3 AND ($4::int IS NULL OR pp.sequence_number > $5))
                OR (pp.product_id = $4 AND pp.sequence_number <= $5)
              )
            GROUP BY e.id, e.emp_code, e.emp_name, e.manpower_factor, att.in_time, att.out_time, att.status,
                     pp.sequence_number, pp.product_id, pp.operation_sah, p.product_code, o.operation_code, o.operation_name
            ORDER BY pp.product_id = $3 DESC, pp.sequence_number, e.emp_code
        `, [line_id, date, line.product_id, line.incoming_product_id, changeoverSequence]);

        // Get material summary
        const materialResult = await pool.query(`
            SELECT * FROM v_daily_material_summary
            WHERE line_id = $1 AND work_date = $2
        `, [line_id, date]);
        const materials = materialResult.rows[0] || {
            total_issued: 0,
            total_used: 0,
            total_returned: 0,
            total_forwarded: 0
        };

        // Get line metrics
        const metricsResult = await pool.query(`
            SELECT * FROM line_daily_metrics
            WHERE line_id = $1 AND work_date = $2
        `, [line_id, date]);
        const metrics = metricsResult.rows[0] || {
            forwarded_quantity: 0,
            remaining_wip: 0,
            materials_issued: 0,
            qa_output: 0
        };
        const qaOutput = parseInt(metrics.qa_output || 0);
        const totalOutput = qaOutput > 0 ? qaOutput : hourlyTotal;

        // Get hourly remarks
        const remarksResult = await pool.query(`
            SELECT hour_slot, remarks, updated_at
            FROM line_hourly_reports
            WHERE line_id = $1 AND work_date = $2 AND remarks IS NOT NULL AND remarks != ''
            ORDER BY hour_slot
        `, [line_id, date]);

        // Get working hours
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60);
        const workingSeconds = workingHours * 3600;

        // Calculate metrics
        const manpower = employeeResult.rows.length;
        const target = parseInt(line.target) || 0;
        const taktTime = target > 0 ? Math.round(workingSeconds / target) : 0;

        let efficiency = 0;
        if (manpower > 0 && workingHours > 0 && totalSAH > 0) {
            const earnedHours = totalOutput * totalSAH;
            const availableHours = manpower * workingHours;
            efficiency = Math.round((earnedHours / availableHours) * 100 * 100) / 100;
        }

        const completion = target > 0 ? Math.round((totalOutput / target) * 100 * 10) / 10 : 0;

        const employees = employeeResult.rows.map(row => {
            const output = parseInt(row.total_output || 0);
            const sah = parseFloat(row.operation_sah || 0);
            const mp = parseFloat(row.manpower_factor || 1);
            let hours = workingHours;
            if (row.in_time && row.out_time) {
                const [inH, inM] = row.in_time.split(':').map(Number);
                const [outH, outM] = row.out_time.split(':').map(Number);
                const diff = (outH + outM / 60) - (inH + inM / 60);
                if (diff > 0) hours = diff;
            }
            const efficiency = hours > 0 && sah > 0 && mp > 0
                ? Math.round(((output * sah) / (hours * mp)) * 100 * 100) / 100
                : 0;
            return {
                ...row,
                efficiency_percent: efficiency
            };
        });

        res.json({
            success: true,
            data: {
                line: {
                    id: line.id,
                    line_code: line.line_code,
                    line_name: line.line_name,
                    product_code: line.product_code,
                    product_name: line.product_name,
                    incoming_product_id: line.incoming_product_id || null,
                    incoming_product_code: line.incoming_product_code || null,
                    incoming_product_name: line.incoming_product_name || null,
                    changeover: hasChangeover,
                    changeover_sequence: changeoverSequence,
                    incoming_max_sequence: incomingMaxSequence,
                    changeover_enabled: CHANGEOVER_ENABLED
                },
                shift: {
                    is_closed: shiftClosed,
                    closed_at: shiftClosedAt
                },
                date: date,
                metrics: {
                    target: target,
                    incoming_target: parseInt(line.incoming_target) || 0,
                    total_output: totalOutput,
                    qa_output: qaOutput,
                    hourly_output: hourlyTotal,
                    manpower: manpower,
                    working_hours: workingHours,
                    total_sah: totalSAH,
                    incoming_sah: incomingSAH,
                    takt_time_seconds: taktTime,
                    takt_time_display: taktTime > 0 ? `${Math.floor(taktTime / 60)}m ${taktTime % 60}s` : '-',
                    efficiency_percent: efficiency,
                    completion_percent: completion
                },
                hourly_output: hourlyOutput,
                process_output: processOutputResult.rows,
                employees: employees,
                materials: {
                    ...materials,
                    opening_stock: metrics.materials_issued,
                    forwarded_to_next: metrics.forwarded_quantity,
                    remaining_wip: metrics.remaining_wip
                },
                hourly_remarks: remarksResult.rows
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET hourly remarks for a line
router.get('/supervisor/hourly-remarks', async (req, res) => {
    const { line_id, date } = req.query;
    if (!line_id || !date) {
        return res.status(400).json({ success: false, error: 'line_id and date are required' });
    }
    try {
        const result = await pool.query(
            `SELECT hour_slot, remarks, updated_at
             FROM line_hourly_reports
             WHERE line_id = $1 AND work_date = $2 AND remarks IS NOT NULL AND remarks != ''
             ORDER BY hour_slot`,
            [line_id, date]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// WORKSTATION MANAGEMENT
// ============================================================================

// GET all workstations (optional ?line_id= filter)
router.get('/workstations', async (req, res) => {
    const { line_id } = req.query;
    try {
        let query = `
            SELECT w.*, pl.line_code, pl.line_name,
                   COUNT(pp.id) as process_count
            FROM workspaces w
            LEFT JOIN production_lines pl ON w.line_id = pl.id
            LEFT JOIN product_processes pp ON pp.workspace_id = w.id AND pp.is_active = true
            WHERE w.is_active = true
        `;
        const params = [];
        if (line_id) {
            params.push(line_id);
            query += ` AND w.line_id = $${params.length}`;
        }
        query += ` GROUP BY w.id, pl.line_code, pl.line_name ORDER BY w.workspace_code`;
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET single workstation with assigned processes
router.get('/workstations/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const wsResult = await pool.query(`
            SELECT w.*, pl.line_code, pl.line_name
            FROM workspaces w
            LEFT JOIN production_lines pl ON w.line_id = pl.id
            WHERE w.id = $1
        `, [id]);
        if (!wsResult.rows[0]) {
            return res.status(404).json({ success: false, error: 'Workstation not found' });
        }
        const processesResult = await pool.query(`
            SELECT pp.id, pp.sequence_number, pp.operation_sah, pp.cycle_time_seconds, pp.manpower_required,
                   o.operation_code, o.operation_name, o.operation_category,
                   pr.product_code, pr.product_name
            FROM product_processes pp
            JOIN operations o ON pp.operation_id = o.id
            JOIN products pr ON pp.product_id = pr.id
            WHERE pp.workspace_id = $1 AND pp.is_active = true
            ORDER BY pp.product_id, pp.sequence_number
        `, [id]);
        res.json({
            success: true,
            data: {
                ...wsResult.rows[0],
                processes: processesResult.rows
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST create workstation
router.post('/workstations', async (req, res) => {
    const { workspace_code, workspace_name, workspace_type, line_id, group_name, worker_input_mapping } = req.body;
    if (!workspace_code || !workspace_name) {
        return res.status(400).json({ success: false, error: 'workspace_code and workspace_name are required' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO workspaces (workspace_code, workspace_name, workspace_type, line_id, group_name, worker_input_mapping, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
            [workspace_code, workspace_name, workspace_type || null, line_id || null, group_name || null, worker_input_mapping || 'CONT']
        );
        realtime.broadcast('data_change', { entity: 'workstations', action: 'create' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, error: 'Workstation code already exists' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT update workstation
router.put('/workstations/:id', async (req, res) => {
    const { id } = req.params;
    const { workspace_code, workspace_name, workspace_type, line_id, group_name, worker_input_mapping } = req.body;
    if (!workspace_code || !workspace_name) {
        return res.status(400).json({ success: false, error: 'workspace_code and workspace_name are required' });
    }
    try {
        const result = await pool.query(
            `UPDATE workspaces
             SET workspace_code = $1, workspace_name = $2, workspace_type = $3, line_id = $4,
                 group_name = $5, worker_input_mapping = $6, updated_at = NOW()
             WHERE id = $7 RETURNING *`,
            [workspace_code, workspace_name, workspace_type || null, line_id || null, group_name || null, worker_input_mapping || 'CONT', id]
        );
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Workstation not found' });
        }
        realtime.broadcast('data_change', { entity: 'workstations', action: 'update' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, error: 'Workstation code already exists' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE (soft-delete) workstation
router.delete('/workstations/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Unlink all processes from this workstation
        await pool.query(`UPDATE product_processes SET workspace_id = NULL WHERE workspace_id = $1`, [id]);
        const result = await pool.query(
            `UPDATE workspaces SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Workstation not found' });
        }
        realtime.broadcast('data_change', { entity: 'workstations', action: 'delete' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT assign processes to a workstation
router.put('/workstations/:id/processes', async (req, res) => {
    const { id } = req.params;
    const { process_ids } = req.body;
    if (!Array.isArray(process_ids)) {
        return res.status(400).json({ success: false, error: 'process_ids must be an array' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Remove all current process assignments for this workstation
        await client.query(`UPDATE product_processes SET workspace_id = NULL WHERE workspace_id = $1`, [id]);
        // Assign new processes
        if (process_ids.length > 0) {
            await client.query(
                `UPDATE product_processes SET workspace_id = $1 WHERE id = ANY($2::int[])`,
                [id, process_ids]
            );
        }
        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'workstations', action: 'processes_updated' });
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }see same employee is able to select for more work station
});

// GET workstations for a specific line with processes and employees
router.get('/lines/:id/workstations', async (req, res) => {
    const { id } = req.params;
    try {
        const wsResult = await pool.query(`
            SELECT w.*
            FROM workspaces w
            WHERE w.line_id = $1 AND w.is_active = true
            ORDER BY w.workspace_code
        `, [id]);

        const workstations = [];
        for (const ws of wsResult.rows) {
            const procResult = await pool.query(`
                SELECT pp.id, pp.sequence_number, pp.operation_sah, pp.cycle_time_seconds,
                       o.operation_code, o.operation_name,
                       epa.employee_id, e.emp_code, e.emp_name
                FROM product_processes pp
                JOIN operations o ON pp.operation_id = o.id
                LEFT JOIN employee_process_assignments epa ON epa.process_id = pp.id AND epa.line_id = $1
                LEFT JOIN employees e ON epa.employee_id = e.id
                WHERE pp.workspace_id = $2 AND pp.is_active = true
                ORDER BY pp.sequence_number
            `, [id, ws.id]);
            workstations.push({ ...ws, processes: procResult.rows });
        }
        res.json({ success: true, data: workstations });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// OSM REPORT — Stagewise Hourly Output per Workstation
// ============================================================================
router.get('/osm-report', async (req, res) => {
    const { line_id, date } = req.query;
    if (!line_id || !date) {
        return res.status(400).json({ success: false, error: 'line_id and date are required' });
    }
    try {
        const inTime  = await getSettingValue('default_in_time',  '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const [inH, inM]   = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingSeconds = (outH * 3600 + outM * 60) - (inH * 3600 + inM * 60);
        const workingHours   = workingSeconds / 3600;

        const lineResult = await pool.query(`
            SELECT pl.line_name, pl.line_code,
                   ldp.target_units, ldp.product_id,
                   p.product_code, p.product_name
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $2
            LEFT JOIN products p ON p.id = ldp.product_id
            WHERE pl.id = $1
        `, [line_id, date]);

        if (!lineResult.rows[0]) {
            return res.status(404).json({ success: false, error: 'Line not found' });
        }
        const line = lineResult.rows[0];

        if (!line.product_id) {
            return res.json({
                success: true,
                line_name: line.line_name, line_code: line.line_code,
                product_code: '', product_name: '', date,
                target_units: 0, in_time: inTime, out_time: outTime,
                working_hours: workingHours, workstations: []
            });
        }

        const wsResult = await pool.query(`
            SELECT lpw.id as ws_id,
                   lpw.workstation_number, lpw.workstation_code,
                   COALESCE(lpw.group_name, '') as group_name,
                   lpw.actual_sam_seconds, lpw.takt_time_seconds, lpw.workload_pct,
                   array_agg(pp.id ORDER BY lpwp.sequence_in_workstation) as process_ids,
                   array_agg(o.operation_code || ' - ' || o.operation_name
                             ORDER BY lpwp.sequence_in_workstation) as process_details
            FROM line_plan_workstations lpw
            JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
            JOIN product_processes pp ON lpwp.product_process_id = pp.id
            JOIN operations o ON pp.operation_id = o.id
            WHERE lpw.line_id = $1 AND lpw.work_date = $2 AND lpw.product_id = $3
            GROUP BY lpw.id, lpw.workstation_number, lpw.workstation_code, lpw.group_name,
                     lpw.actual_sam_seconds, lpw.takt_time_seconds, lpw.workload_pct
            ORDER BY lpw.workstation_number
        `, [line_id, date, line.product_id]);

        if (!wsResult.rows.length) {
            return res.json({
                success: true,
                line_name: line.line_name, line_code: line.line_code,
                product_code: line.product_code || '', product_name: line.product_name || '',
                date, target_units: parseInt(line.target_units || 0),
                in_time: inTime, out_time: outTime,
                working_hours: workingHours, workstations: []
            });
        }

        const wsIds = wsResult.rows.map(r => r.ws_id);
        const progressResult = await pool.query(`
            SELECT lpwp.workstation_id, lph.hour_slot,
                   MAX(lph.quantity) as quantity,
                   string_agg(DISTINCT lph.shortfall_reason, '; ')
                       FILTER (WHERE lph.shortfall_reason IS NOT NULL AND lph.shortfall_reason <> '')
                       as shortfall_reason
            FROM line_plan_workstation_processes lpwp
            JOIN line_process_hourly_progress lph
                ON lph.process_id = lpwp.product_process_id
               AND lph.line_id = $1 AND lph.work_date = $2
            WHERE lpwp.workstation_id = ANY($3::int[])
            GROUP BY lpwp.workstation_id, lph.hour_slot
            ORDER BY lpwp.workstation_id, lph.hour_slot
        `, [line_id, date, wsIds]);

        const hourlyMap = {};
        for (const row of progressResult.rows) {
            if (!hourlyMap[row.workstation_id]) hourlyMap[row.workstation_id] = {};
            hourlyMap[row.workstation_id][row.hour_slot] = {
                quantity: parseInt(row.quantity || 0),
                shortfall_reason: row.shortfall_reason || null
            };
        }

        const workstations = wsResult.rows.map(ws => ({
            workstation_code:   ws.workstation_code,
            workstation_number: ws.workstation_number,
            group_name:         ws.group_name,
            sam_seconds:        parseFloat(ws.actual_sam_seconds || 0),
            takt_time_seconds:  parseFloat(ws.takt_time_seconds  || 0),
            workload_pct:       parseFloat(ws.workload_pct       || 0),
            process_details:    (ws.process_details || []).join(' / '),
            hourly:             hourlyMap[ws.ws_id] || {}
        }));

        res.json({
            success: true,
            line_name: line.line_name, line_code: line.line_code,
            product_code: line.product_code || '', product_name: line.product_name || '',
            date, target_units: parseInt(line.target_units || 0),
            in_time: inTime, out_time: outTime,
            working_hours: workingHours, workstations
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
