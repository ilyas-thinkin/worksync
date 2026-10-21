/**
 * Plan change log — one row in plan_change_log per plan-changing request (Excel upload,
 * on-screen plan save, plan copy) and per automatic overnight copy.
 *
 * Uploads used to leave no trace: the 2026-10-21 Vimala/Rumiya mix-up had to be rebuilt from
 * deleted plan rows. There are no per-person accounts, so "who" is the signed-in role plus the
 * device (IP, browser). Logging must never break or slow the request it describes, so every
 * write happens after the response is handed to Express and swallows its own errors.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db.config');
const { getClientIP } = require('../middleware/audit');

// Uploaded files are kept outside UPLOADS_DIR on purpose: that folder is served publicly at
// /uploads, and plan files carry employee codes and names.
const ARCHIVE_DIR = process.env.PLAN_UPLOAD_ARCHIVE_DIR
    || path.join(process.env.BACKUP_DIR || path.join(__dirname, '..', '..', '..', 'backups'), 'plan-uploads');

// The choices a user makes in the upload's confirmation prompts. Recorded as sent so a log row
// shows, e.g., that an override was used rather than the recommended option.
const CONFIRMATION_FIELDS = [
    'line_id', 'product_mode', 'work_date',
    'confirm_line', 'confirm_new_line', 'use_line_id',
    'confirm_product', 'confirm_plan_product', 'new_product_code',
    'skip_missing_employees', 'confirm_shared_processes', 'confirm_replace_carried',
    'source_date', 'source_line_id', 'product_id'
];

function pickConfirmations(body) {
    if (!body || typeof body !== 'object') return null;
    const picked = {};
    for (const key of CONFIRMATION_FIELDS) {
        const value = body[key];
        if (value === undefined || value === null || value === '') continue;
        picked[key] = typeof value === 'object' ? value : String(value);
    }
    return Object.keys(picked).length ? picked : null;
}

function outcomeFor(statusCode, body) {
    if (body && body.success) return 'success';
    if (statusCode === 409 && body?.code === 'SHARED_PROCESSES_IN_USE') return 'blocked';
    if (statusCode === 409) return 'needs_confirmation';
    return 'error';
}

function toIntOrNull(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}

async function recordPlanChange(entry) {
    try {
        await pool.query(
            `INSERT INTO plan_change_log
               (event, outcome, outcome_code, line_id, line_code, work_date, product_id, product_code,
                product_mode, file_name, file_size, file_sha256, file_saved_path, role, ip_address,
                user_agent, workstations, processes, employees_assigned, confirmations, details, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                     $19, $20, $21, $22)`,
            [
                entry.event,
                entry.outcome,
                entry.outcome_code || null,
                toIntOrNull(entry.line_id),
                entry.line_code || null,
                entry.work_date || null,
                toIntOrNull(entry.product_id),
                entry.product_code || null,
                entry.product_mode || null,
                entry.file_name || null,
                toIntOrNull(entry.file_size),
                entry.file_sha256 || null,
                entry.file_saved_path || null,
                entry.role || null,
                entry.ip_address || null,
                entry.user_agent || null,
                toIntOrNull(entry.workstations),
                toIntOrNull(entry.processes),
                toIntOrNull(entry.employees_assigned),
                entry.confirmations ? JSON.stringify(entry.confirmations) : null,
                entry.details ? JSON.stringify(entry.details) : null,
                entry.error || null
            ]
        );
    } catch (err) {
        console.error('[plan-change-log] could not record entry:', err.message);
    }
}

// Files are stored by content hash, so re-uploading the same file keeps one copy.
async function archiveUploadedFile(file, sha256) {
    if (!file?.buffer || !sha256) return null;
    try {
        const ext = (path.extname(file.originalname || '') || '.xlsx').toLowerCase().replace(/[^.a-z0-9]/g, '');
        const target = path.join(ARCHIVE_DIR, `${sha256}${ext}`);
        await fs.promises.mkdir(ARCHIVE_DIR, { recursive: true });
        try {
            await fs.promises.access(target);
        } catch (_) {
            await fs.promises.writeFile(target, file.buffer);
        }
        return target;
    } catch (err) {
        console.error('[plan-change-log] could not archive uploaded file:', err.message);
        return null;
    }
}

/**
 * Starts tracking one request. Returns a context object the route fills in as it resolves the
 * line/product (ctx.line_id, ctx.product_code, ctx.details, ...). The row is written once, when
 * the route sends its JSON response, with the outcome taken from that response.
 */
function trackPlanChange(req, res, event) {
    const file = req.file || null;
    const sha256 = file?.buffer ? crypto.createHash('sha256').update(file.buffer).digest('hex') : null;
    const ctx = { event, details: {} };
    const originalJson = res.json.bind(res);
    let recorded = false;

    res.json = (body) => {
        if (!recorded) {
            recorded = true;
            const statusCode = res.statusCode;
            const outcome = outcomeFor(statusCode, body);
            const summary = body?.summary || {};
            const details = { ...(ctx.details || {}) };
            if (outcome !== 'success' && body?.code === 'SHARED_PROCESSES_IN_USE') {
                details.other_lines = body.other_lines || [];
            }
            if (outcome === 'success' && body?.message) details.message = body.message;
            const entry = {
                event,
                outcome,
                outcome_code: body?.code || null,
                line_id: ctx.line_id,
                line_code: ctx.line_code || summary.line || null,
                work_date: ctx.work_date || summary.date || null,
                product_id: ctx.product_id,
                product_code: ctx.product_code || summary.product || null,
                product_mode: ctx.product_mode || null,
                file_name: file?.originalname || null,
                file_size: file?.size ?? file?.buffer?.length ?? null,
                file_sha256: sha256,
                role: req.user?.role || null,
                ip_address: getClientIP(req),
                user_agent: req.headers['user-agent'] || null,
                workstations: ctx.workstations ?? summary.workstations ?? null,
                processes: ctx.processes ?? summary.processes ?? null,
                employees_assigned: ctx.employees_assigned ?? summary.employees_assigned ?? null,
                confirmations: pickConfirmations(req.body),
                details: Object.keys(details).length ? details : null,
                error: outcome === 'error' ? String(body?.error || body?.message || `HTTP ${statusCode}`) : null
            };
            setImmediate(async () => {
                if (outcome === 'success' && file) {
                    entry.file_saved_path = await archiveUploadedFile(file, sha256);
                }
                await recordPlanChange(entry);
            });
        }
        return originalJson(body);
    };
    return ctx;
}

module.exports = {
    trackPlanChange,
    recordPlanChange,
    ARCHIVE_DIR
};
