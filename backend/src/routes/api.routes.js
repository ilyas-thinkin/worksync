const express = require('express');
const router = express.Router();
const pool = require('../config/db.config');
const realtime = require('../realtime');

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

const logAudit = async (tableName, recordId, action, newValues = null, oldValues = null) => {
    try {
        await pool.query(
            `INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values)
             VALUES ($1, $2, $3, $4, $5)`,
            [tableName, recordId, action, oldValues, newValues]
        );
    } catch (err) {
        // audit failures should not block main flow
    }
};

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
            `SELECT lp.id, lp.line_id, lp.product_id, lp.work_date, lp.target_units,
                    pl.line_code, pl.line_name,
                    p.product_code, p.product_name
             FROM line_daily_plans lp
             JOIN production_lines pl ON lp.line_id = pl.id
             JOIN products p ON lp.product_id = p.id
             WHERE lp.work_date = $1
             ORDER BY pl.line_name`,
            [date]
        );
        const linesResult = await pool.query(
            `SELECT id, line_code, line_name FROM production_lines WHERE is_active = true ORDER BY line_name`
        );
        const productsResult = await pool.query(
            `SELECT id, product_code, product_name FROM products WHERE is_active = true ORDER BY product_code`
        );
        res.json({
            success: true,
            data: {
                plans: plansResult.rows,
                lines: linesResult.rows,
                products: productsResult.rows
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/daily-plans', async (req, res) => {
    const { line_id, product_id, work_date, target_units, user_id } = req.body;
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    try {
        const before = await pool.query(
            `SELECT * FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const result = await pool.query(
            `INSERT INTO line_daily_plans (line_id, product_id, work_date, target_units, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $5)
             ON CONFLICT (line_id, work_date)
             DO UPDATE SET product_id = EXCLUDED.product_id,
                           target_units = EXCLUDED.target_units,
                           updated_by = EXCLUDED.updated_by,
                           updated_at = NOW()
             RETURNING *`,
            [line_id, product_id, work_date, target_units || 0, user_id || null]
        );
        await logAudit('line_daily_plans', result.rows[0].id, before.rowCount ? 'update' : 'create', result.rows[0], before.rows[0] || null);
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
    const { line_id, work_date, forwarded_quantity, remaining_wip, materials_issued, user_id } = req.body;
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    try {
        const before = await pool.query(
            `SELECT * FROM line_daily_metrics WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const result = await pool.query(
            `INSERT INTO line_daily_metrics (line_id, work_date, forwarded_quantity, remaining_wip, materials_issued, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (line_id, work_date)
             DO UPDATE SET forwarded_quantity = EXCLUDED.forwarded_quantity,
                           remaining_wip = EXCLUDED.remaining_wip,
                           materials_issued = EXCLUDED.materials_issued,
                           updated_by = EXCLUDED.updated_by,
                           updated_at = NOW()
             RETURNING *`,
            [line_id, work_date, forwarded_quantity || 0, remaining_wip || 0, materials_issued || 0, user_id || null]
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

// ============================================================================
// PRODUCTION LINES
// ============================================================================
router.get('/lines', async (req, res) => {
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
            ORDER BY pl.id
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/lines', async (req, res) => {
    const { line_code, line_name, hall_location, current_product_id, target_units, efficiency } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO production_lines (line_code, line_name, hall_location, current_product_id, target_units, efficiency, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
            [line_code, line_name, hall_location, current_product_id, target_units || 0, efficiency || 0]
        );
        realtime.broadcast('data_change', { entity: 'lines', action: 'create', id: result.rows[0].id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/lines/:id', async (req, res) => {
    const { id } = req.params;
    const { line_code, line_name, hall_location, current_product_id, target_units, efficiency, is_active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE production_lines
             SET line_code = $1, line_name = $2, hall_location = $3, current_product_id = $4, target_units = $5, efficiency = $6, is_active = $7, updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [line_code, line_name, hall_location, current_product_id, target_units || 0, efficiency || 0, is_active, id]
        );
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

router.post('/employees', async (req, res) => {
    const { emp_code, emp_name, designation, default_line_id } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO employees (emp_code, emp_name, designation, default_line_id, is_active)
             VALUES ($1, $2, $3, $4, true) RETURNING *`,
            [emp_code, emp_name, designation, default_line_id]
        );
        realtime.broadcast('data_change', { entity: 'employees', action: 'create', id: result.rows[0].id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/employees/:id', async (req, res) => {
    const { id } = req.params;
    const { emp_code, emp_name, designation, default_line_id, is_active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE employees
             SET emp_code = $1, emp_name = $2, designation = $3, default_line_id = $4, is_active = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [emp_code, emp_name, designation, default_line_id, is_active, id]
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
            ORDER BY p.product_code
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
        res.json({ success: true, data: { product: product.rows[0], processes: processes.rows } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/products', async (req, res) => {
    const { product_code, product_name, product_description, category, line_ids } = req.body;
    const normalizedLineIds = Array.isArray(line_ids)
        ? line_ids.map((id) => parseInt(id, 10)).filter(Boolean)
        : [];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO products (product_code, product_name, product_description, category, is_active)
             VALUES ($1, $2, $3, $4, true) RETURNING *`,
            [product_code, product_name, product_description, category]
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
    const { product_code, product_name, product_description, category, line_ids, is_active } = req.body;
    const normalizedLineIds = Array.isArray(line_ids)
        ? line_ids.map((lineId) => parseInt(lineId, 10)).filter(Boolean)
        : [];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE products
             SET product_code = $1, product_name = $2, product_description = $3, category = $4, is_active = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [product_code, product_name, product_description, category, is_active, id]
        );

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

router.post('/operations', async (req, res) => {
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
    const {
        product_id,
        operation_id,
        sequence_number,
        operation_sah,
        cycle_time_seconds,
        manpower_required,
        target_units
    } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO product_processes
             (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds, manpower_required, target_units, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
            [
                product_id,
                operation_id,
                sequence_number,
                operation_sah,
                cycle_time_seconds,
                manpower_required || 1,
                target_units || 0
            ]
        );
        realtime.broadcast('data_change', { entity: 'product_processes', action: 'create', product_id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/product-processes/:id', async (req, res) => {
    const { id } = req.params;
    const { sequence_number, operation_sah, cycle_time_seconds, manpower_required, target_units } = req.body;
    try {
        const result = await pool.query(
            `UPDATE product_processes
             SET sequence_number = $1,
                 operation_sah = $2,
                 cycle_time_seconds = $3,
                 manpower_required = $4,
                 target_units = $5,
                 updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [sequence_number, operation_sah, cycle_time_seconds, manpower_required, target_units || 0, id]
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

const resolveProcessForLine = async (lineId, processPayload, workDate = null) => {
    const dateValue = workDate || new Date().toISOString().slice(0, 10);
    const planResult = await pool.query(
        `SELECT product_id FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
        [lineId, dateValue]
    );
    const plan = planResult.rows[0];
    let productId = plan?.product_id;

    if (!productId) {
        const lineResult = await pool.query(
            `SELECT current_product_id FROM production_lines WHERE id = $1`,
            [lineId]
        );
        productId = lineResult.rows[0]?.current_product_id;
    }

    if (!productId) {
        throw new Error('Line has no product assigned for this date');
    }

    if (processPayload.type === 'operation') {
        const result = await pool.query(
            `SELECT pp.id, pp.sequence_number, pp.target_units, o.id AS operation_id, o.operation_code, o.operation_name
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             WHERE pp.product_id = $1 AND pp.operation_id = $2
             ORDER BY pp.sequence_number
             LIMIT 1`,
            [productId, processPayload.id]
        );
        if (!result.rows[0]) {
            throw new Error('Operation not found in current product process');
        }
        return result.rows[0];
    }

    const result = await pool.query(
        `SELECT pp.id, pp.sequence_number, pp.target_units, o.id AS operation_id, o.operation_code, o.operation_name
         FROM product_processes pp
         JOIN operations o ON pp.operation_id = o.id
         WHERE pp.id = $1 AND pp.product_id = $2
         LIMIT 1`,
        [processPayload.id, productId]
    );
    if (!result.rows[0]) {
        throw new Error('Process not found for current line product');
    }
    return result.rows[0];
};

router.get('/supervisor/lines', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pl.id,
                   pl.line_code,
                   pl.line_name,
                   COALESCE(ldp.product_id, pl.current_product_id) as current_product_id,
                   COALESCE(p_plan.product_code, p.product_code) as product_code
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = CURRENT_DATE
            LEFT JOIN products p_plan ON ldp.product_id = p_plan.id
            LEFT JOIN products p ON pl.current_product_id = p.id
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
    try {
        const planResult = await pool.query(
            `SELECT product_id FROM line_daily_plans WHERE line_id = $1 AND work_date = CURRENT_DATE`,
            [lineId]
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
            WHERE pp.product_id = $1
            ORDER BY pp.sequence_number
        `, [productId]);
        res.json({ success: true, data: result.rows });
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
                    target_units: process.target_units || 0
                },
                employee: employeeResult.rows[0] || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/supervisor/assign', async (req, res) => {
    const { line_id, process_id, employee_qr, quantity_completed, work_date, materials_at_link, confirm_change } = req.body;
    if (!line_id || !process_id || !employee_qr) {
        return res.status(400).json({ success: false, error: 'line_id, process_id and employee_qr are required' });
    }
    const effectiveDate = work_date || new Date().toISOString().slice(0, 10);
    if (await isDayLocked(effectiveDate)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
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
             (line_id, process_id, employee_id, start_time, quantity_completed, materials_at_link, changed_by)
             VALUES ($1, $2, $3, NOW(), 0, $4, $5)`,
            [line_id, process.id, employeeId, materials_at_link || 0, null]
        );

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

router.post('/supervisor/progress', async (req, res) => {
    const { line_id, process_id, work_date, hour_slot, quantity } = req.body;
    if (!line_id || !process_id || !work_date || hour_slot === undefined) {
        return res.status(400).json({ success: false, error: 'line_id, process_id, work_date, hour_slot are required' });
    }
    const hourValue = parseInt(hour_slot, 10);
    if (!Number.isFinite(hourValue) || hourValue < 8 || hourValue > 19) {
        return res.status(400).json({ success: false, error: 'hour_slot must be between 8 and 19' });
    }
    try {
        if (await isDayLocked(work_date)) {
            return res.status(403).json({ success: false, error: 'Production day is locked' });
        }
        const assignmentResult = await pool.query(
            `SELECT employee_id FROM employee_process_assignments WHERE line_id = $1 AND process_id = $2`,
            [line_id, process_id]
        );
        const assignment = assignmentResult.rows[0];
        if (!assignment) {
            return res.status(400).json({ success: false, error: 'No employee assigned to this line/process' });
        }
        const result = await pool.query(
            `INSERT INTO line_process_hourly_progress (line_id, process_id, employee_id, work_date, hour_slot, quantity)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (line_id, process_id, work_date, hour_slot)
             DO UPDATE SET quantity = EXCLUDED.quantity,
                           employee_id = EXCLUDED.employee_id,
                           updated_at = NOW()
             RETURNING *`,
            [line_id, process_id, assignment.employee_id, work_date, hourValue, quantity || 0]
        );
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
                    o.operation_code,
                    o.operation_name
             FROM line_process_hourly_progress lpp
             JOIN product_processes pp ON lpp.process_id = pp.id
             JOIN operations o ON pp.operation_id = o.id
             WHERE lpp.line_id = $1 AND lpp.work_date = $2
             ORDER BY lpp.hour_slot, o.operation_code`,
            [line_id, work_date]
        );
        res.json({ success: true, data: result.rows });
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
                   ldp.target_units as daily_target_units
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = CURRENT_DATE
            LEFT JOIN products p_plan ON ldp.product_id = p_plan.id
            LEFT JOIN products p ON pl.current_product_id = p.id
            WHERE pl.id = $1
        `, [id]);
        const line = lineResult.rows[0];
        if (!line) {
            return res.status(404).json({ success: false, error: 'Line not found' });
        }

        const employeesResult = await pool.query(`
            SELECT e.*
            FROM employees e
            WHERE e.is_active = true
            ORDER BY e.emp_code
        `);
        const employees = employeesResult.rows;

        let processes = [];
        const productId = line.active_product_id || line.current_product_id;
        if (productId) {
            const processesResult = await pool.query(`
                SELECT pp.*, o.operation_code, o.operation_name, o.operation_category, o.qr_code_path
                FROM product_processes pp
                JOIN operations o ON pp.operation_id = o.id
                WHERE pp.product_id = $1
                ORDER BY pp.sequence_number
            `, [productId]);
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

        res.json({
            success: true,
            data: {
                line,
                employees,
                processes,
                assignments,
                allAssignments
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
