const express = require('express');
const router = express.Router();
const pool = require('../config/db.config');
const realtime = require('../realtime');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
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
const OPERATION_CODE_LOCK_KEY = 32001;
const REGULAR_HISTORY_HOURS = [8, 9, 10, 11, 13, 14, 15, 16];
const OT_HISTORY_HOURS = [17, 18, 19];
const ISO_PLAN_MONTH_RE = /^(\d{4})-(\d{2})(?:-\d{2})?$/;
const SLASH_PLAN_MONTH_RE = /^(\d{4})\/(\d{2})(?:\/\d{2})?$/;
const ISO_WORK_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_WORK_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
const DASH_WORK_DATE_RE = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/;

// Normalize workstation codes so W01 / WS01 / ws01 / w01 / 01 / 1 all match.
// Strips leading letters then parses the numeric part as an integer.
function normalizeWsCode(code) {
    const m = String(code || '').match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : String(code || '').toUpperCase().trim();
}

function normalizePlanMonth(value) {
    if (value === null || value === undefined) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    const isoMatch = raw.match(ISO_PLAN_MONTH_RE);
    if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2]}`;
    }

    const slashMatch = raw.match(SLASH_PLAN_MONTH_RE);
    if (slashMatch) {
        return `${slashMatch[1]}-${slashMatch[2]}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 7);
    }

    const err = new Error('Plan month must be in YYYY-MM format or a valid date');
    err.statusCode = 400;
    throw err;
}

function normalizeWorkDate(value) {
    if (value === null || value === undefined) return '';
    const raw = String(value).trim();
    if (!raw) return '';

    const toDateString = (year, month, day) => {
        const y = Number(year);
        const m = Number(month);
        const d = Number(day);
        if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
        if (m < 1 || m > 12 || d < 1 || d > 31) return '';
        const dt = new Date(y, m - 1, d);
        if (dt.getFullYear() !== y || dt.getMonth() !== (m - 1) || dt.getDate() !== d) return '';
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };

    const isoMatch = raw.match(ISO_WORK_DATE_RE);
    if (isoMatch) {
        const normalized = toDateString(isoMatch[1], isoMatch[2], isoMatch[3]);
        if (normalized) return normalized;
    }

    const slashMatch = raw.match(SLASH_WORK_DATE_RE);
    if (slashMatch) {
        const month = Number(slashMatch[1]);
        const day = Number(slashMatch[2]);
        let year = Number(slashMatch[3]);
        if (slashMatch[3].length === 2) {
            year += year >= 70 ? 1900 : 2000;
        }
        const normalized = toDateString(year, month, day);
        if (normalized) return normalized;
    }

    const dashMatch = raw.match(DASH_WORK_DATE_RE);
    if (dashMatch) {
        const first = Number(dashMatch[1]);
        const second = Number(dashMatch[2]);
        let year = Number(dashMatch[3]);
        if (dashMatch[3].length === 2) {
            year += year >= 70 ? 1900 : 2000;
        }
        // Interpret dashed ambiguous dates as MM-DD-YYYY by default (matches Excel mm-dd-yy display),
        // but switch to DD-MM-YYYY when first part cannot be a month.
        const month = first > 12 && second <= 12 ? second : first;
        const day = first > 12 && second <= 12 ? first : second;
        const normalized = toDateString(year, month, day);
        if (normalized) return normalized;
    }

    if (/^\d+(\.\d+)?$/.test(raw)) {
        const serial = Number(raw);
        if (Number.isFinite(serial) && serial > 0) {
            // Excel serial date system (Windows 1900 date base).
            const ms = Math.round((serial - 25569) * 86400 * 1000);
            const dt = new Date(ms);
            if (!Number.isNaN(dt.getTime())) {
                return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
            }
        }
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }

    const err = new Error('Date must be in YYYY-MM-DD format or a valid Excel date (row 5)');
    err.statusCode = 400;
    throw err;
}

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

const collectDuplicateEmployeeIds = (items, selector) => {
    const seen = new Set();
    const duplicates = new Set();
    for (const item of items || []) {
        const raw = selector(item);
        const employeeId = raw ? parseInt(raw, 10) : null;
        if (!employeeId) continue;
        if (seen.has(employeeId)) duplicates.add(employeeId);
        else seen.add(employeeId);
    }
    return Array.from(duplicates);
};

async function generateNextOperationCode(db) {
    await db.query('SELECT pg_advisory_xact_lock($1)', [OPERATION_CODE_LOCK_KEY]);
    const result = await db.query(
        `SELECT COALESCE(MAX(SUBSTRING(operation_code FROM '^OP-([0-9]+)$')::int), 0) + 1 AS next_num
         FROM operations
         WHERE operation_code ~ '^OP-[0-9]+$'`
    );
    const nextNum = parseInt(result.rows[0]?.next_num || 1, 10);
    return `OP-${String(nextNum).padStart(4, '0')}`;
}

const getHistoryHours = (isOvertime = false) => (isOvertime ? OT_HISTORY_HOURS : REGULAR_HISTORY_HOURS);

function resolveHistoryEffectiveFromHour(workDate, isOvertime = false, attendanceStart = null, linkedAt = null) {
    const hours = getHistoryHours(isOvertime);
    if (!hours.length) return null;
    const firstHour = hours[0];
    const lastHour = hours[hours.length - 1];
    const today = new Date().toISOString().slice(0, 10);

    if (attendanceStart) {
        const startHour = new Date(attendanceStart).getHours();
        const nextHour = hours.find(h => h >= startHour);
        return nextHour ?? null;
    }

    if (linkedAt) {
        const linkedHour = new Date(linkedAt).getHours();
        const nextHour = hours.find(h => h >= linkedHour);
        return nextHour ?? null;
    }

    if (workDate !== today) return firstHour;

    const nowHour = new Date().getHours();
    if (nowHour < firstHour) return firstHour;
    const nextHour = hours.find(h => h > nowHour);
    // After the last working hour (e.g. testing at 8 PM), attribute to the last hour
    return nextHour ?? lastHour;
}

function resolveHistoryEffectiveToHour(workDate, isOvertime = false) {
    const fromHour = resolveHistoryEffectiveFromHour(workDate, isOvertime);
    if (fromHour === null) return getHistoryHours(isOvertime).slice(-1)[0] ?? null;
    return fromHour - 1;
}

async function closeAssignmentHistoryForEmployee(db, {
    employeeId,
    workDate,
    isOvertime = false,
    effectiveToHour = null
}) {
    const normalizedEmployeeId = employeeId ? parseInt(employeeId, 10) : null;
    if (!normalizedEmployeeId || !workDate) return null;
    const hours = getHistoryHours(isOvertime);
    if (!hours.length) return null;
    const boundedToHour = Number.isFinite(effectiveToHour)
        ? effectiveToHour
        : resolveHistoryEffectiveToHour(workDate, isOvertime);

    const activeResult = await db.query(
        `SELECT id, effective_from_hour
         FROM employee_workstation_assignment_history
         WHERE employee_id = $1
           AND work_date = $2
           AND is_overtime = $3
           AND effective_to_hour IS NULL
         ORDER BY effective_from_hour DESC, id DESC
         LIMIT 1`,
        [normalizedEmployeeId, workDate, !!isOvertime]
    );
    const activeRow = activeResult.rows[0];
    if (!activeRow) return null;

    if (boundedToHour < parseInt(activeRow.effective_from_hour, 10)) {
        await db.query(
            `DELETE FROM employee_workstation_assignment_history
             WHERE id = $1`,
            [activeRow.id]
        );
        return { closed: false, deleted: true };
    }

    await db.query(
        `UPDATE employee_workstation_assignment_history
         SET effective_to_hour = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [boundedToHour, activeRow.id]
    );
    return { closed: true, deleted: false };
}

async function syncAssignmentHistoryForCurrentRow(db, {
    lineId,
    workDate,
    workstationCode,
    employeeId,
    linePlanWorkstationId = null,
    isOvertime = false,
    isLinked = false,
    linkedAt = null,
    attendanceStart = null,
    lateReason = null,
    forceCurrentHourStart = false
}) {
    const normalizedEmployeeId = employeeId ? parseInt(employeeId, 10) : null;
    if (!normalizedEmployeeId || !workDate || !workstationCode || !isLinked) return null;

    const activeResult = await db.query(
        `SELECT id, line_id, workstation_code, line_plan_workstation_id, effective_from_hour
         FROM employee_workstation_assignment_history
         WHERE employee_id = $1
           AND work_date = $2
           AND is_overtime = $3
           AND effective_to_hour IS NULL
         ORDER BY effective_from_hour DESC, id DESC
         LIMIT 1`,
        [normalizedEmployeeId, workDate, !!isOvertime]
    );
    const activeRow = activeResult.rows[0];
    const fromHour = forceCurrentHourStart
        ? resolveHistoryEffectiveFromHour(workDate, isOvertime)
        : activeRow
        ? resolveHistoryEffectiveFromHour(workDate, isOvertime)
        : resolveHistoryEffectiveFromHour(workDate, isOvertime, attendanceStart, linkedAt);
    if (fromHour === null) return null;
    if (activeRow) {
        const activeFrom = parseInt(activeRow.effective_from_hour, 10);
        const activePlanWsId = activeRow.line_plan_workstation_id ? parseInt(activeRow.line_plan_workstation_id, 10) : null;
        const nextPlanWsId = linePlanWorkstationId ? parseInt(linePlanWorkstationId, 10) : null;
        if (
            parseInt(activeRow.line_id, 10) === parseInt(lineId, 10) &&
            activeRow.workstation_code === workstationCode &&
            activePlanWsId === nextPlanWsId
        ) {
            await db.query(
                `UPDATE employee_workstation_assignment_history
                 SET linked_at = COALESCE($1, linked_at),
                     attendance_start = COALESCE($2, attendance_start),
                     late_reason = COALESCE($3, late_reason),
                     updated_at = NOW()
                 WHERE id = $4`,
                [linkedAt || null, attendanceStart || null, lateReason || null, activeRow.id]
            );
            return { reused: true };
        }
        const closeHour = fromHour - 1;
        if (closeHour < activeFrom) {
            await db.query(`DELETE FROM employee_workstation_assignment_history WHERE id = $1`, [activeRow.id]);
        } else {
            await db.query(
                `UPDATE employee_workstation_assignment_history
                 SET effective_to_hour = $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [closeHour, activeRow.id]
            );
        }
    }

    await db.query(
        `INSERT INTO employee_workstation_assignment_history
           (line_id, work_date, employee_id, workstation_code, line_plan_workstation_id, is_overtime,
            effective_from_hour, effective_to_hour, linked_at, attendance_start, late_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10)`,
        [
            lineId,
            workDate,
            normalizedEmployeeId,
            workstationCode,
            linePlanWorkstationId ? parseInt(linePlanWorkstationId, 10) : null,
            !!isOvertime,
            fromHour,
            linkedAt || null,
            attendanceStart || null,
            lateReason || null
        ]
    );
    return { reused: false };
}

async function closeHistoryForWorkstationAssignmentIfNeeded(db, {
    lineId,
    workDate,
    workstationCode,
    isOvertime = false,
    nextEmployeeId = null
}) {
    if (!lineId || !workDate || !workstationCode) return null;
    const existingResult = await db.query(
        `SELECT employee_id, is_linked
         FROM employee_workstation_assignments
         WHERE line_id = $1
           AND work_date = $2
           AND workstation_code = $3
           AND is_overtime = $4
         LIMIT 1`,
        [lineId, workDate, workstationCode, !!isOvertime]
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow || !existingRow.employee_id) return null;
    const existingEmployeeId = parseInt(existingRow.employee_id, 10);
    const normalizedNextEmployeeId = nextEmployeeId ? parseInt(nextEmployeeId, 10) : null;
    if (normalizedNextEmployeeId && normalizedNextEmployeeId === existingEmployeeId) return existingRow;
    if (existingRow.is_linked) {
        await closeAssignmentHistoryForEmployee(db, {
            employeeId: existingEmployeeId,
            workDate,
            isOvertime
        });
    }
    return existingRow;
}

async function clearEmployeeAssignmentConflicts(db, employeeId, workDate, isOvertime, keepLineId, keepWorkstationCode) {
    const normalizedEmployeeId = employeeId ? parseInt(employeeId, 10) : null;
    if (!normalizedEmployeeId || !workDate) return [];

    const params = [normalizedEmployeeId, workDate, !!isOvertime];
    let sql = `
        DELETE FROM employee_workstation_assignments
        WHERE employee_id = $1
          AND work_date = $2
          AND is_overtime = $3
    `;

    if (keepLineId && keepWorkstationCode) {
        params.push(keepLineId, keepWorkstationCode);
        sql += ` AND NOT (line_id = $4 AND workstation_code = $5)`;
    }

    sql += ' RETURNING line_id, workstation_code, employee_id, is_linked';
    const result = await db.query(sql, params);
    for (const row of result.rows) {
        if (row.is_linked) {
            await closeAssignmentHistoryForEmployee(db, {
                employeeId: row.employee_id,
                workDate,
                isOvertime
            });
        }
    }
    return result.rows;
}

async function findEmployeeAssignmentConflicts(db, employeeIds, workDate, isOvertime, keepLineId, keepWorkstationCodes = []) {
    const normalizedEmployeeIds = (employeeIds || [])
        .map(id => parseInt(id, 10))
        .filter(id => Number.isFinite(id));
    if (!normalizedEmployeeIds.length || !workDate) return [];

    const params = [normalizedEmployeeIds, workDate, !!isOvertime];
    let sql = `
        SELECT ewa.employee_id,
               e.emp_code,
               e.emp_name,
               ewa.line_id,
               pl.line_code,
               pl.line_name,
               ewa.workstation_code
        FROM employee_workstation_assignments ewa
        LEFT JOIN employees e ON e.id = ewa.employee_id
        LEFT JOIN production_lines pl ON pl.id = ewa.line_id
        WHERE ewa.employee_id = ANY($1::int[])
          AND ewa.work_date = $2
          AND ewa.is_overtime = $3
    `;

    if (keepLineId && keepWorkstationCodes.length) {
        params.push(keepLineId, keepWorkstationCodes);
        sql += ` AND NOT (ewa.line_id = $4 AND ewa.workstation_code = ANY($5::text[]))`;
    }

    sql += ` ORDER BY e.emp_code, ewa.line_id, ewa.workstation_code`;
    const result = await db.query(sql, params);
    return result.rows;
}

async function findLatestPriorDailyPlanForLine(db, lineId, workDate) {
    if (!lineId || !workDate) return null;
    const result = await db.query(
        `SELECT *
         FROM line_daily_plans
         WHERE line_id = $1
           AND work_date < $2
         ORDER BY work_date DESC
         LIMIT 1`,
        [lineId, workDate]
    );
    return result.rows[0] || null;
}

async function hasDailyPlanDeletionMarker(db, lineId, workDate) {
    if (!lineId || !workDate) return false;
    const result = await db.query(
        `SELECT 1
         FROM line_daily_plan_delete_markers
         WHERE line_id = $1
           AND work_date = $2
         LIMIT 1`,
        [lineId, workDate]
    );
    return result.rowCount > 0;
}

async function getLineActualOutput(db, lineId, workDate, productId = null) {
    if (!lineId || !workDate) return 0;

    const normalizedProductId = productId ? parseInt(productId, 10) : null;
    if (normalizedProductId) {
        const lastWsResult = await db.query(
            `SELECT id
             FROM line_plan_workstations
             WHERE line_id = $1
               AND work_date = $2
               AND product_id = $3
             ORDER BY workstation_number DESC, id DESC
             LIMIT 1`,
            [lineId, workDate, normalizedProductId]
        );
        const lastWorkstationId = parseInt(lastWsResult.rows[0]?.id || 0, 10) || null;
        if (lastWorkstationId) {
            const outputResult = await db.query(
                `WITH representative_process AS (
                     SELECT lpwp.product_process_id
                     FROM line_plan_workstation_processes lpwp
                     JOIN product_processes pp ON pp.id = lpwp.product_process_id
                     WHERE lpwp.workstation_id = $1
                     ORDER BY lpwp.sequence_in_workstation DESC,
                              pp.sequence_number DESC,
                              lpwp.product_process_id DESC
                     LIMIT 1
                 ),
                 per_hour AS (
                     SELECT lph.hour_slot,
                            MAX(lph.quantity) AS qty
                     FROM representative_process rp
                     JOIN line_process_hourly_progress lph
                       ON lph.process_id = rp.product_process_id
                      AND lph.line_id = $2
                      AND lph.work_date = $3
                     GROUP BY lph.hour_slot
                 )
                 SELECT COALESCE(SUM(qty), 0) AS total
                 FROM per_hour`,
                [lastWorkstationId, lineId, workDate]
            );
            return parseInt(outputResult.rows[0]?.total || 0, 10);
        }

        const lastProcessResult = await db.query(
            `SELECT pp.id
             FROM product_processes pp
             WHERE pp.product_id = $1
               AND pp.is_active = true
             ORDER BY pp.sequence_number DESC, pp.id DESC
             LIMIT 1`,
            [normalizedProductId]
        );
        const representativeProcessId = parseInt(lastProcessResult.rows[0]?.id || 0, 10) || 0;
        if (representativeProcessId > 0) {
            const outputResult = await db.query(
                `SELECT COALESCE(SUM(qty), 0) AS total
                 FROM (
                     SELECT MAX(quantity) AS qty
                     FROM line_process_hourly_progress
                     WHERE line_id = $1
                       AND work_date = $2
                       AND process_id = $3
                     GROUP BY hour_slot
                 ) sub`,
                [lineId, workDate, representativeProcessId]
            );
            return parseInt(outputResult.rows[0]?.total || 0, 10);
        }
    }

    const outputResult = await db.query(
        `SELECT COALESCE(SUM(q), 0) AS total
         FROM (
             SELECT MAX(quantity) AS q
             FROM line_process_hourly_progress
             WHERE line_id = $1 AND work_date = $2
             GROUP BY process_id
         ) sub`,
        [lineId, workDate]
    );
    return parseInt(outputResult.rows[0]?.total || 0, 10);
}

async function getProductTargetQuantity(db, productId, fallbackTargetUnits = 0) {
    const normalizedProductId = productId ? parseInt(productId, 10) : null;
    if (!normalizedProductId) return Math.max(0, parseInt(fallbackTargetUnits || 0, 10) || 0);
    const result = await db.query(
        `SELECT target_qty
         FROM products
         WHERE id = $1
         LIMIT 1`,
        [normalizedProductId]
    );
    const productTarget = parseInt(result.rows[0]?.target_qty || 0, 10) || 0;
    return productTarget > 0
        ? productTarget
        : Math.max(0, parseInt(fallbackTargetUnits || 0, 10) || 0);
}

async function getCumulativeWorkstationOutput(db, {
    lineId,
    productId,
    workstationCode,
    throughDate
}) {
    const normalizedProductId = productId ? parseInt(productId, 10) : null;
    const normalizedWsCode = String(workstationCode || '').trim();
    if (!lineId || !normalizedProductId || !normalizedWsCode || !throughDate) return 0;

    const outputResult = await db.query(
        `WITH workstation_days AS (
             SELECT lpw.id, lpw.work_date
             FROM line_plan_workstations lpw
             WHERE lpw.line_id = $1
               AND lpw.product_id = $2
               AND lpw.workstation_code = $3
               AND lpw.work_date <= $4
         ),
         representative_process AS (
             SELECT DISTINCT ON (wd.id)
                    wd.id AS workstation_id,
                    wd.work_date,
                    lpwp.product_process_id
             FROM workstation_days wd
             JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = wd.id
             JOIN product_processes pp ON pp.id = lpwp.product_process_id
             ORDER BY wd.id,
                      lpwp.sequence_in_workstation DESC,
                      pp.sequence_number DESC,
                      lpwp.product_process_id DESC
         ),
         per_hour AS (
             SELECT rp.work_date,
                    rp.product_process_id,
                    lph.hour_slot,
                    MAX(lph.quantity) AS qty
             FROM representative_process rp
             JOIN line_process_hourly_progress lph
               ON lph.process_id = rp.product_process_id
              AND lph.line_id = $1
              AND lph.work_date = rp.work_date
             GROUP BY rp.work_date, rp.product_process_id, lph.hour_slot
         )
         SELECT COALESCE(SUM(qty), 0) AS total
         FROM per_hour`,
        [lineId, normalizedProductId, normalizedWsCode, throughDate]
    );
    return parseInt(outputResult.rows[0]?.total || 0, 10);
}

function getRemainingShiftHours(startedAt, inTime, outTime, lunchMins = 0) {
    if (!startedAt || !inTime || !outTime) return 0;
    const start = new Date(startedAt);
    if (Number.isNaN(start.getTime())) return 0;
    const startMins = (start.getHours() * 60) + start.getMinutes();
    const remainingMins = getNetWorkingMinutes(inTime, outTime, lunchMins, startMins);
    return Math.round((remainingMins / 60) * 100) / 100;
}

const DEFAULT_LUNCH_START_HOUR = 12;

function parseClockToMinutes(value, fallback = '00:00') {
    const [hours, minutes] = String(value || fallback).split(':').map(Number);
    return ((hours || 0) * 60) + (minutes || 0);
}

function getLunchOverlapMinutes(startMins, endMins, lunchMins = 0) {
    const normalizedLunchMins = Math.max(0, parseInt(lunchMins, 10) || 0);
    if (normalizedLunchMins <= 0) return 0;
    const lunchStartMins = DEFAULT_LUNCH_START_HOUR * 60;
    const lunchEndMins = lunchStartMins + normalizedLunchMins;
    const overlapStart = Math.max(startMins, lunchStartMins);
    const overlapEnd = Math.min(endMins, lunchEndMins);
    return Math.max(0, overlapEnd - overlapStart);
}

function getNetWorkingMinutes(inTime, outTime, lunchMins = 0, startMinsOverride = null) {
    const shiftStartMins = Number.isFinite(startMinsOverride)
        ? startMinsOverride
        : parseClockToMinutes(inTime, '08:00');
    const shiftEndMins = parseClockToMinutes(outTime, '17:00');
    const grossMinutes = Math.max(0, shiftEndMins - shiftStartMins);
    const lunchOverlapMinutes = getLunchOverlapMinutes(shiftStartMins, shiftEndMins, lunchMins);
    return Math.max(0, grossMinutes - lunchOverlapMinutes);
}

function buildShiftStartTimestamp(workDate, inTime = '08:00') {
    if (!workDate) return null;
    const safeTime = String(inTime || '08:00').slice(0, 5) || '08:00';
    return `${workDate} ${safeTime}:00`;
}

async function getShiftWindowDetails() {
    const inTime = await getSettingValue('default_in_time', '08:00');
    const outTime = await getSettingValue('default_out_time', '17:00');
    const lunchMins = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10) || 0;
    const totalMinutes = getNetWorkingMinutes(inTime, outTime, lunchMins);
    return {
        inTime,
        outTime,
        lunchMins,
        workingHours: Math.round((totalMinutes / 60) * 100) / 100,
        workingSeconds: totalMinutes * 60
    };
}

function roundMetric(value, digits = 2) {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return 0;
    const factor = 10 ** digits;
    return Math.round(num * factor) / factor;
}

function computeTaktTimeFromTarget(targetUnits, workingSeconds) {
    const target = parseFloat(targetUnits);
    const seconds = parseFloat(workingSeconds);
    if (!(target > 0) || !(seconds > 0)) return 0;
    return seconds / target;
}

function computeTargetUnitsFromTakt(taktTimeSeconds, workingSeconds) {
    const takt = parseFloat(taktTimeSeconds);
    const seconds = parseFloat(workingSeconds);
    if (!(takt > 0) || !(seconds > 0)) return 0;
    return seconds / takt;
}

function computeHourlyTargetFromTakt(taktTimeSeconds) {
    const takt = parseFloat(taktTimeSeconds);
    if (!(takt > 0)) return 0;
    return 3600 / takt;
}

async function getEffectiveRegularSourceWorkstations(db, lineId, workDate) {
    await ensureDailyPlanCarryForwardForLine(lineId, workDate, db);

    const planResult = await db.query(
        `SELECT product_id, target_units, incoming_product_id, incoming_target_units
         FROM line_daily_plans
         WHERE line_id = $1 AND work_date = $2`,
        [lineId, workDate]
    );
    const plan = planResult.rows[0];
    if (!plan?.product_id) return null;

    const primaryId = parseInt(plan.product_id, 10);
    const incomingId = plan.incoming_product_id ? parseInt(plan.incoming_product_id, 10) : null;

    const buildWsQuery = (productId) => db.query(
        `SELECT lpw.id AS workstation_plan_id,
                lpw.workstation_number,
                lpw.workstation_code,
                lpw.group_name,
                lpw.actual_sam_seconds,
                lpw.takt_time_seconds,
                lpw.workload_pct,
                lpw.product_id,
                lpw.ws_changeover_active,
                lpw.ws_changeover_started_at
         FROM line_plan_workstations lpw
         WHERE lpw.line_id = $1
           AND lpw.work_date = $2
           AND lpw.product_id = $3
         ORDER BY lpw.workstation_number, lpw.id`,
        [lineId, workDate, productId]
    );

    const primaryPlanResult = await buildWsQuery(primaryId);
    const incomingPlanResult = incomingId ? await buildWsQuery(incomingId) : { rows: [] };

    const incomingByCode = new Map();
    for (const row of incomingPlanResult.rows) {
        incomingByCode.set(normalizeWsCode(row.workstation_code), row);
    }

    return {
        primary_product_id: primaryId,
        incoming_product_id: incomingId,
        workstations: primaryPlanResult.rows.map(row => {
            const incomingRow = incomingByCode.get(normalizeWsCode(row.workstation_code)) || null;
            const isChangeover = !!(row.ws_changeover_active && incomingId && incomingRow);
            const sourceRow = isChangeover ? incomingRow : row;
            return {
                primary_workstation_id: parseInt(row.workstation_plan_id, 10),
                primary_source_plan_workstation_id: parseInt(row.workstation_plan_id, 10),
                primary_group_name: row.group_name || null,
                primary_actual_sam_seconds: parseFloat(row.actual_sam_seconds || 0),
                primary_takt_time_seconds: parseFloat(row.takt_time_seconds || 0),
                primary_workload_pct: parseFloat(row.workload_pct || 0),
                co_source_plan_workstation_id: incomingRow ? parseInt(incomingRow.workstation_plan_id, 10) : null,
                co_group_name: incomingRow?.group_name || null,
                co_actual_sam_seconds: incomingRow ? parseFloat(incomingRow.actual_sam_seconds || 0) : null,
                co_takt_time_seconds: incomingRow ? parseFloat(incomingRow.takt_time_seconds || 0) : null,
                co_workload_pct: incomingRow ? parseFloat(incomingRow.workload_pct || 0) : null,
                source_line_plan_workstation_id: parseInt(sourceRow.workstation_plan_id, 10),
                workstation_number: row.workstation_number != null ? parseInt(row.workstation_number, 10) : null,
                workstation_code: row.workstation_code,
                group_name: sourceRow.group_name || row.group_name || null,
                actual_sam_seconds: parseFloat(sourceRow.actual_sam_seconds || 0),
                takt_time_seconds: parseFloat(sourceRow.takt_time_seconds || 0),
                workload_pct: parseFloat(sourceRow.workload_pct || 0),
                source_product_id: isChangeover ? incomingId : primaryId,
                source_mode: isChangeover ? 'changeover' : 'primary',
                is_changeover: isChangeover,
                ws_changeover_started_at: row.ws_changeover_started_at || null
            };
        })
    };
}

async function getEffectiveRegularSourceProcesses(db, lineId, workDate) {
    const effectiveWsState = await getEffectiveRegularSourceWorkstations(db, lineId, workDate);
    const workstations = effectiveWsState?.workstations || [];
    const wsIds = workstations
        .map(ws => parseInt(ws.source_line_plan_workstation_id, 10))
        .filter(id => Number.isFinite(id));
    if (!wsIds.length) return [];

    const wsMetaById = new Map(
        workstations.map(ws => [parseInt(ws.source_line_plan_workstation_id, 10), ws])
    );

    const result = await db.query(
        `SELECT DISTINCT
                lpw.id AS source_line_plan_workstation_id,
                lpw.workstation_code,
                lpw.workstation_number,
                pp.id AS process_id,
                pp.product_id,
                pp.sequence_number,
                o.operation_code,
                o.operation_name
         FROM line_plan_workstations lpw
         JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
         JOIN product_processes pp ON pp.id = lpwp.product_process_id
         JOIN operations o ON o.id = pp.operation_id
         WHERE lpw.id = ANY($1::int[])
         ORDER BY lpw.workstation_number, pp.sequence_number, pp.id`,
        [wsIds]
    );

    return result.rows.map(row => {
        const wsMeta = wsMetaById.get(parseInt(row.source_line_plan_workstation_id, 10)) || {};
        return {
            process_id: parseInt(row.process_id, 10),
            product_id: parseInt(row.product_id, 10),
            sequence_number: parseInt(row.sequence_number, 10),
            operation_code: row.operation_code,
            operation_name: row.operation_name,
            workstation_code: row.workstation_code,
            workstation_number: row.workstation_number != null ? parseInt(row.workstation_number, 10) : null,
            source_line_plan_workstation_id: parseInt(row.source_line_plan_workstation_id, 10),
            source_product_id: wsMeta.source_product_id || null,
            source_mode: wsMeta.source_mode || 'primary',
            is_changeover: !!wsMeta.is_changeover
        };
    });
}

async function getEffectiveOtSourceWorkstations(db, lineId, workDate) {
    await ensureDailyPlanCarryForwardForLine(lineId, workDate, db);

    const planResult = await db.query(
        `SELECT product_id, target_units, incoming_product_id, incoming_target_units
         FROM line_daily_plans
         WHERE line_id = $1 AND work_date = $2`,
        [lineId, workDate]
    );
    const plan = planResult.rows[0];
    if (!plan?.product_id) return null;

    const primaryId = parseInt(plan.product_id, 10);
    const primaryTarget = parseInt(plan.target_units || 0, 10) || 0;
    const incomingId = plan.incoming_product_id ? parseInt(plan.incoming_product_id, 10) : null;
    const incomingTarget = parseInt(plan.incoming_target_units || 0, 10) || 0;
    const shiftWindow = await getShiftWindowDetails();

    const buildWsPlanQuery = (productId) => db.query(
        `SELECT lpw.id AS workstation_plan_id,
                lpw.workstation_number,
                lpw.workstation_code,
                lpw.group_name,
                lpw.actual_sam_seconds,
                lpw.workload_pct,
                lpw.ws_changeover_active,
                pp.id AS process_id,
                pp.sequence_number,
                pp.operation_sah,
                o.operation_code,
                o.operation_name,
                ewa.employee_id AS assigned_employee_id,
                e.emp_code AS assigned_emp_code,
                e.emp_name AS assigned_emp_name
         FROM line_plan_workstations lpw
         JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
         JOIN product_processes pp ON pp.id = lpwp.product_process_id
         JOIN operations o ON o.id = pp.operation_id
         LEFT JOIN employee_workstation_assignments ewa
           ON (ewa.line_plan_workstation_id = lpw.id
               OR (ewa.line_id = lpw.line_id
                   AND ewa.work_date = lpw.work_date
                   AND ewa.workstation_code = lpw.workstation_code))
          AND ewa.line_id = lpw.line_id
          AND ewa.work_date = lpw.work_date
          AND ewa.is_overtime = false
         LEFT JOIN employees e ON e.id = ewa.employee_id
         WHERE lpw.line_id = $1
           AND lpw.work_date = $2
           AND lpw.product_id = $3
         ORDER BY lpw.workstation_number, lpwp.sequence_in_workstation`,
        [lineId, workDate, productId]
    );

    const primaryPlanResult = await buildWsPlanQuery(primaryId);
    const incomingPlanResult = incomingId ? await buildWsPlanQuery(incomingId) : { rows: [] };

    const incomingByCode = new Map();
    for (const row of incomingPlanResult.rows) {
        const nk = normalizeWsCode(row.workstation_code);
        if (!incomingByCode.has(nk)) {
            incomingByCode.set(nk, []);
        }
        incomingByCode.get(nk).push(row);
    }

    const groupWipResult = await db.query(
        `SELECT group_name, materials_in, output_qty, wip_quantity
         FROM group_wip
         WHERE line_id = $1 AND work_date = $2`,
        [lineId, workDate]
    );
    const groupWipMap = new Map(groupWipResult.rows.map(row => [String(row.group_name), row]));

    const primaryByWsId = new Map();
    for (const row of primaryPlanResult.rows) {
        if (!primaryByWsId.has(row.workstation_plan_id)) {
            primaryByWsId.set(row.workstation_plan_id, []);
        }
        primaryByWsId.get(row.workstation_plan_id).push(row);
    }

    const workstations = [];
    for (const rows of primaryByWsId.values()) {
        const firstPrimary = rows[0];
        const isChangeoverSource = !!(firstPrimary.ws_changeover_active && incomingId && incomingByCode.has(normalizeWsCode(firstPrimary.workstation_code)));
        const activeRows = isChangeoverSource ? incomingByCode.get(normalizeWsCode(firstPrimary.workstation_code)) : rows;
        const firstActive = activeRows[0] || firstPrimary;
        const sourceProductId = isChangeoverSource ? incomingId : primaryId;
        const sourceTaktTimeSeconds = parseFloat(firstActive.takt_time_seconds || 0) || 0;
        const sourceTargetUnits = sourceTaktTimeSeconds > 0
            ? computeTargetUnitsFromTakt(sourceTaktTimeSeconds, shiftWindow.workingSeconds)
            : (isChangeoverSource ? incomingTarget : primaryTarget);
        const sourceHourlyTarget = sourceTaktTimeSeconds > 0
            ? computeHourlyTargetFromTakt(sourceTaktTimeSeconds)
            : (shiftWindow.workingHours > 0 ? ((sourceTargetUnits / shiftWindow.workingHours) || 0) : 0);
        const groupKey = String(firstPrimary.group_name || firstPrimary.workstation_code || '');
        const groupWip = groupWipMap.get(groupKey);

        workstations.push({
            workstation_code: firstPrimary.workstation_code,
            workstation_number: firstPrimary.workstation_number != null ? parseInt(firstPrimary.workstation_number, 10) : null,
            group_name: firstPrimary.group_name || null,
            source_line_plan_workstation_id: firstActive.workstation_plan_id,
            source_product_id: sourceProductId,
            source_mode: isChangeoverSource ? 'changeover' : 'primary',
            source_hourly_target: roundMetric(sourceHourlyTarget, 2),
            source_target_units: roundMetric(sourceTargetUnits, 2),
            source_employee_id: firstActive.assigned_employee_id ? parseInt(firstActive.assigned_employee_id, 10) : null,
            source_emp_code: firstActive.assigned_emp_code || null,
            source_emp_name: firstActive.assigned_emp_name || null,
            actual_sam_seconds: parseFloat(firstActive.actual_sam_seconds || 0),
            workload_pct: parseFloat(firstActive.workload_pct || 0),
            regular_shift_output_quantity: parseInt(groupWip?.output_qty || 0, 10) || 0,
            regular_shift_wip_quantity: parseInt(groupWip?.wip_quantity || 0, 10) || 0,
            processes: activeRows.map(row => ({
                process_id: row.process_id,
                sequence_number: row.sequence_number,
                operation_sah: row.operation_sah,
                operation_code: row.operation_code,
                operation_name: row.operation_name
            }))
        });
    }

    workstations.sort((a, b) => (a.workstation_number ?? 9999) - (b.workstation_number ?? 9999));

    return {
        plan: {
            primary_product_id: primaryId,
            primary_target_units: primaryTarget,
            incoming_product_id: incomingId,
            incoming_target_units: incomingTarget
        },
        shiftWindow,
        workstations
    };
}

async function recalculateOtPlanTarget(db, otPlanId) {
    if (!otPlanId) return 0;
    const shiftWindow = await getShiftWindowDetails();
    const targetResult = await db.query(
        `SELECT COALESCE(SUM(
                    CASE
                        WHEN low.is_active = true
                        THEN ROUND((
                            COALESCE(
                                NULLIF(low.source_hourly_target, 0),
                                CASE
                                    WHEN $2 > 0 AND low.source_product_id = ldp.incoming_product_id
                                    THEN COALESCE(ldp.incoming_target_units, 0) / $2
                                    WHEN $2 > 0
                                    THEN COALESCE(ldp.target_units, 0) / $2
                                    ELSE 0
                                END
                            ) * COALESCE(low.ot_minutes, 0)
                        ) / 60.0)
                        ELSE 0
                    END
                ), 0) AS total_target
         FROM line_ot_workstations low
         JOIN line_ot_plans lop ON lop.id = low.ot_plan_id
         LEFT JOIN line_daily_plans ldp ON ldp.line_id = lop.line_id AND ldp.work_date = lop.work_date
         WHERE low.ot_plan_id = $1`,
        [otPlanId, shiftWindow.workingHours]
    );
    const totalTarget = parseInt(targetResult.rows[0]?.total_target || 0, 10) || 0;
    await db.query(
        `UPDATE line_ot_plans
         SET ot_target_units = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [otPlanId, totalTarget]
    );
    return totalTarget;
}

async function getWorkstationChangeoverSnapshot(db, {
    lineId,
    workDate,
    primaryWorkstationId,
    primaryLineProductId,
    lineTargetUnits,
    workstationCode = null
}) {
    if (!lineId || !workDate || !primaryWorkstationId || !primaryLineProductId) {
        return {
            workstationTarget: 0,
            workstationOutput: 0,
            pendingWip: 0,
            balanceQty: 0
        };
    }

    const primaryWsResult = await db.query(
        `SELECT workstation_code
         FROM line_plan_workstations
         WHERE id = $1
         LIMIT 1`,
        [primaryWorkstationId]
    );
    const resolvedWorkstationCode = String(
        workstationCode || primaryWsResult.rows[0]?.workstation_code || ''
    ).trim();
    const workstationTarget = await getProductTargetQuantity(db, primaryLineProductId, lineTargetUnits);
    const workstationOutput = await getCumulativeWorkstationOutput(db, {
        lineId,
        productId: primaryLineProductId,
        workstationCode: resolvedWorkstationCode,
        throughDate: workDate
    });

    const pendingWipResult = await db.query(
        `SELECT COALESCE(SUM(pmw.wip_quantity), 0) AS qty
         FROM process_material_wip pmw
         JOIN line_plan_workstation_processes lpwp ON lpwp.product_process_id = pmw.process_id
         WHERE lpwp.workstation_id = $1
           AND pmw.line_id = $2
           AND pmw.work_date = $3`,
        [primaryWorkstationId, lineId, workDate]
    );
    const pendingWip = parseInt(pendingWipResult.rows[0]?.qty || 0, 10);

    return {
        workstationTarget,
        workstationOutput,
        pendingWip,
        balanceQty: Math.max(0, workstationTarget - workstationOutput)
    };
}

async function buildChangeoverPromotionSnapshot(db, {
    lineId,
    workDate,
    previousPrimaryProductId,
    newPrimaryProductId,
    beforePlan
}) {
    const productIds = [previousPrimaryProductId, newPrimaryProductId]
        .map(id => parseInt(id, 10))
        .filter(id => Number.isFinite(id));

    const [
        primaryWorkstationsResult,
        incomingWorkstationsResult,
        assignmentsResult,
        assignmentHistoryResult,
        changeoverEventsResult,
        groupWipResult,
        productProcessesResult
    ] = await Promise.all([
        db.query(
            `SELECT *
             FROM line_plan_workstations
             WHERE line_id = $1 AND work_date = $2 AND product_id = $3
             ORDER BY workstation_number, workstation_code`,
            [lineId, workDate, previousPrimaryProductId]
        ),
        db.query(
            `SELECT *
             FROM line_plan_workstations
             WHERE line_id = $1 AND work_date = $2 AND product_id = $3
             ORDER BY workstation_number, workstation_code`,
            [lineId, workDate, newPrimaryProductId]
        ),
        db.query(
            `SELECT *
             FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND is_overtime = false
             ORDER BY workstation_code, employee_id`,
            [lineId, workDate]
        ),
        db.query(
            `SELECT *
             FROM employee_workstation_assignment_history
             WHERE line_id = $1 AND work_date = $2 AND is_overtime = false
             ORDER BY employee_id, effective_from_hour, id`,
            [lineId, workDate]
        ),
        db.query(
            `SELECT *
             FROM workstation_changeover_events
             WHERE line_id = $1 AND work_date = $2
             ORDER BY workstation_code`,
            [lineId, workDate]
        ),
        db.query(
            `SELECT *
             FROM group_wip
             WHERE line_id = $1 AND work_date = $2
             ORDER BY group_name`,
            [lineId, workDate]
        ),
        productIds.length
            ? db.query(
                `SELECT *
                 FROM product_processes
                 WHERE product_id = ANY($1::int[])
                 ORDER BY product_id, sequence_number, id`,
                [productIds]
            )
            : Promise.resolve({ rows: [] })
    ]);

    const processIds = productProcessesResult.rows
        .map(row => parseInt(row.id, 10))
        .filter(id => Number.isFinite(id));

    const [hourlyProgressResult, materialWipResult] = await Promise.all([
        processIds.length
            ? db.query(
                `SELECT *
                 FROM line_process_hourly_progress
                 WHERE line_id = $1 AND work_date = $2 AND process_id = ANY($3::int[])
                 ORDER BY hour_slot, process_id, id`,
                [lineId, workDate, processIds]
            )
            : Promise.resolve({ rows: [] }),
        processIds.length
            ? db.query(
                `SELECT *
                 FROM process_material_wip
                 WHERE line_id = $1 AND work_date = $2 AND process_id = ANY($3::int[])
                 ORDER BY process_id, id`,
                [lineId, workDate, processIds]
            )
            : Promise.resolve({ rows: [] })
    ]);

    return {
        captured_at: new Date().toISOString(),
        line_id: parseInt(lineId, 10),
        work_date: workDate,
        previous_daily_plan: beforePlan,
        previous_primary_product_id: previousPrimaryProductId,
        new_primary_product_id: newPrimaryProductId,
        primary_workstations: primaryWorkstationsResult.rows,
        incoming_workstations: incomingWorkstationsResult.rows,
        employee_assignments: assignmentsResult.rows,
        assignment_history: assignmentHistoryResult.rows,
        changeover_events: changeoverEventsResult.rows,
        group_wip: groupWipResult.rows,
        product_processes: productProcessesResult.rows,
        line_process_hourly_progress: hourlyProgressResult.rows,
        process_material_wip: materialWipResult.rows
    };
}

async function normalizeRegularAssignmentsToProductWorkstations(db, {
    lineId,
    workDate,
    productId
}) {
    await db.query(
        `UPDATE employee_workstation_assignments ewa
         SET line_plan_workstation_id = lpw.id,
             assigned_at = NOW()
         FROM line_plan_workstations lpw
         WHERE ewa.line_id = $1
           AND ewa.work_date = $2
           AND ewa.is_overtime = false
           AND lpw.line_id = ewa.line_id
           AND lpw.work_date = ewa.work_date
           AND lpw.workstation_code = ewa.workstation_code
           AND lpw.product_id = $3
           AND (ewa.line_plan_workstation_id IS DISTINCT FROM lpw.id)`,
        [lineId, workDate, productId]
    );

    await db.query(
        `UPDATE employee_workstation_assignment_history hist
         SET line_plan_workstation_id = lpw.id,
             updated_at = NOW()
         FROM line_plan_workstations lpw
         WHERE hist.line_id = $1
           AND hist.work_date = $2
           AND hist.is_overtime = false
           AND hist.effective_to_hour IS NULL
           AND lpw.line_id = hist.line_id
           AND lpw.work_date = hist.work_date
           AND lpw.workstation_code = hist.workstation_code
           AND lpw.product_id = $3
           AND (hist.line_plan_workstation_id IS DISTINCT FROM lpw.id)`,
        [lineId, workDate, productId]
    );
}

async function ensureDailyPlanCarryForwardForLine(lineId, workDate, client = null) {
    if (!lineId || !workDate) return null;
    const ownsClient = !client || typeof client.release !== 'function';
    const db = ownsClient ? await pool.connect() : client;
    try {
        if (ownsClient) await db.query('BEGIN');

        const existing = await db.query(
            `SELECT *
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2
             LIMIT 1`,
            [lineId, workDate]
        );
        if (existing.rowCount > 0) {
            if (ownsClient) await db.query('COMMIT');
            return existing.rows[0];
        }
        if (await hasDailyPlanDeletionMarker(db, lineId, workDate)) {
            if (ownsClient) await db.query('COMMIT');
            return null;
        }

        const sourcePlan = await findLatestPriorDailyPlanForLine(db, lineId, workDate);
        if (!sourcePlan) {
            if (ownsClient) await db.query('COMMIT');
            return null;
        }

        const insertResult = await db.query(
            `INSERT INTO line_daily_plans
               (line_id, product_id, work_date, target_units,
                incoming_product_id, incoming_target_units, changeover_sequence,
                overtime_minutes, overtime_target, ot_enabled, changeover_started_at,
                created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
             ON CONFLICT (line_id, work_date) DO NOTHING
             RETURNING *`,
            [
                lineId,
                sourcePlan.product_id,
                workDate,
                parseInt(sourcePlan.target_units || 0, 10) || 0,
                sourcePlan.incoming_product_id || null,
                parseInt(sourcePlan.incoming_target_units || 0, 10) || 0,
                parseInt(sourcePlan.changeover_sequence || 0, 10) || 0,
                sourcePlan.overtime_minutes || 0,
                sourcePlan.overtime_target || 0,
                !!sourcePlan.ot_enabled,
                null,
                sourcePlan.updated_by || sourcePlan.created_by || null
            ]
        );
        const insertedPlan = insertResult.rows[0];
        if (!insertedPlan) {
            const current = await db.query(
                `SELECT *
                 FROM line_daily_plans
                 WHERE line_id = $1 AND work_date = $2
                 LIMIT 1`,
                [lineId, workDate]
            );
            if (ownsClient) await db.query('COMMIT');
            return current.rows[0] || null;
        }

        if (sourcePlan.product_id) {
            await copyWorkstationPlanFromDate(lineId, sourcePlan.work_date, lineId, workDate, sourcePlan.product_id, db, {
                copyEmployees: true
            });
        }

        if (sourcePlan.incoming_product_id) {
            await copyWorkstationPlanFromDate(lineId, sourcePlan.work_date, lineId, workDate, sourcePlan.incoming_product_id, db, {
                copyEmployees: false
            });
        }

        const refreshed = await db.query(
            `SELECT *
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2
             LIMIT 1`,
            [lineId, workDate]
        );
        if (ownsClient) await db.query('COMMIT');
        return refreshed.rows[0] || insertedPlan;
    } catch (err) {
        if (ownsClient) {
            await db.query('ROLLBACK').catch(() => {});
        }
        throw err;
    } finally {
        if (ownsClient) db.release();
    }
}

async function ensureDailyPlansCarryForward(workDate, client = null) {
    if (!workDate) return 0;
    const db = client || pool;
    const linesResult = await db.query(
        `SELECT id
         FROM production_lines
         WHERE is_active = true
         ORDER BY id`
    );
    let createdCount = 0;
    for (const row of linesResult.rows) {
        const before = await db.query(
            `SELECT 1
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2
             LIMIT 1`,
            [row.id, workDate]
        );
        if (before.rowCount > 0) continue;
        const inserted = await ensureDailyPlanCarryForwardForLine(row.id, workDate, db);
        if (inserted) createdCount += 1;
    }
    return createdCount;
}

async function getRegularAssignmentStateByEmployee(db, workDate) {
    if (!workDate) return new Map();
    const result = await db.query(
        `SELECT employee_id, is_linked, linked_at, late_reason, attendance_start
         FROM employee_workstation_assignments
         WHERE work_date = $1
           AND is_overtime = false
           AND employee_id IS NOT NULL
         ORDER BY is_linked DESC, linked_at DESC NULLS LAST, assigned_at DESC NULLS LAST, id DESC`,
        [workDate]
    );
    const stateByEmployee = new Map();
    for (const row of result.rows) {
        const employeeId = parseInt(row.employee_id, 10);
        if (!employeeId || stateByEmployee.has(employeeId)) continue;
        stateByEmployee.set(employeeId, row);
    }
    return stateByEmployee;
}

async function detachRegularAssignmentsFromPlan(db, lineId, workDate, productId) {
    if (!lineId || !workDate || !productId) return;
    const oldPlanRows = await db.query(
        `SELECT id
         FROM line_plan_workstations
         WHERE line_id = $1 AND work_date = $2 AND product_id = $3`,
        [lineId, workDate, productId]
    );
    const oldIds = oldPlanRows.rows.map(row => parseInt(row.id, 10)).filter(Boolean);
    if (!oldIds.length) return;
    await db.query(
        `UPDATE employee_workstation_assignments
         SET line_plan_workstation_id = NULL
         WHERE line_id = $1
           AND work_date = $2
           AND is_overtime = false
           AND line_plan_workstation_id = ANY($3::int[])`,
        [lineId, workDate, oldIds]
    );
}

function getPreservedRegularAssignmentState(stateByEmployee, employeeId) {
    const normalizedEmployeeId = employeeId ? parseInt(employeeId, 10) : null;
    const previous = normalizedEmployeeId ? stateByEmployee.get(normalizedEmployeeId) : null;
    if (!previous || !previous.is_linked) {
        return {
            is_linked: false,
            linked_at: null,
            late_reason: null,
            attendance_start: null
        };
    }
    return {
        is_linked: true,
        linked_at: previous.linked_at || null,
        late_reason: previous.late_reason || null,
        attendance_start: previous.attendance_start || null
    };
}

const REPORT_WORK_HOURS = [8, 9, 10, 11, 13, 14, 15, 16];
const formatHourRangeLabel = (hourSlot) => {
    const hour = parseInt(hourSlot, 10);
    if (!Number.isFinite(hour)) return '';
    const start = `${String(hour).padStart(2, '0')}:00`;
    const end = `${String(hour + 1).padStart(2, '0')}:00`;
    const idx = REPORT_WORK_HOURS.indexOf(hour);
    const n = (idx >= 0 ? idx : 0) + 1;
    const mod10 = n % 10;
    const mod100 = n % 100;
    const ord = (mod10 === 1 && mod100 !== 11) ? `${n}st`
        : (mod10 === 2 && mod100 !== 12) ? `${n}nd`
        : (mod10 === 3 && mod100 !== 13) ? `${n}rd`
        : `${n}th`;
    return `${ord} hour (${start}-${end})`;
};

async function getEmployeeProgressForWindow(db, lineId, workDate, { exactHour = null, endHour = null, isOvertime = false, hoursDenom = 1 } = {}) {
    const useOt = !!isOvertime;
    const workstationTable = useOt ? 'line_ot_workstations' : 'line_plan_workstations';
    const processJoin = useOt
        ? `LEFT JOIN line_ot_workstation_processes wproc ON wproc.ot_workstation_id = a.workstation_id`
        : `LEFT JOIN line_plan_workstation_processes wproc ON wproc.workstation_id = a.workstation_id`;
    const workstationProductField = 'ws.source_product_id';
    const lateralProductField = useOt ? 'ws_match.source_product_id' : 'ws_match.product_id';
    let incomingProductId = null;
    if (!useOt) {
        const planResult = await db.query(
            `SELECT incoming_product_id
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [lineId, workDate]
        );
        incomingProductId = planResult.rows[0]?.incoming_product_id
            ? parseInt(planResult.rows[0].incoming_product_id, 10)
            : null;
    }
    const historyHours = getHistoryHours(useOt);
    const defaultWindowEnd = historyHours[historyHours.length - 1] || 23;
    const params = [lineId, workDate];
    let windowEndHour = defaultWindowEnd;
    let hourPredicate = '';
    let assignmentWindowPredicate = '';
    if (Number.isFinite(exactHour)) {
        params.push(parseInt(exactHour, 10));
        windowEndHour = parseInt(exactHour, 10);
        hourPredicate = `AND lph.hour_slot = $${params.length}`;
        assignmentWindowPredicate = `AND hist.effective_from_hour <= $${params.length}
                                     AND COALESCE(hist.effective_to_hour, 999) >= $${params.length}`;
    } else if (Number.isFinite(endHour)) {
        params.push(parseInt(endHour, 10));
        windowEndHour = parseInt(endHour, 10);
        hourPredicate = `AND lph.hour_slot <= $${params.length}`;
        assignmentWindowPredicate = `AND hist.effective_from_hour <= $${params.length}`;
    }
    params.push(useOt);
    const overtimeIndex = params.length;
    params.push(windowEndHour);
    const windowEndIndex = params.length;

    const result = await db.query(
        `WITH assignments AS (
             SELECT hist.id AS history_id,
                    hist.employee_id,
                    hist.workstation_code,
                    hist.line_plan_workstation_id,
                    hist.effective_from_hour,
                    COALESCE(hist.effective_to_hour, 999) AS effective_to_hour,
                    ws.id AS workstation_id,
                    ws.workstation_number,
                    COALESCE(ws.group_name, '') AS group_name,
                    COALESCE(ws.actual_sam_seconds, 0) AS actual_sam_seconds,
                    ${workstationProductField} AS source_product_id
             FROM employee_workstation_assignment_history hist
             LEFT JOIN LATERAL (
                 SELECT ws_match.id,
                        ws_match.workstation_number,
                        ws_match.group_name,
                        ws_match.actual_sam_seconds,
                        ${lateralProductField} AS source_product_id
                 FROM ${workstationTable} ws_match
                 WHERE (
                         hist.line_plan_workstation_id IS NOT NULL
                         AND ws_match.id = hist.line_plan_workstation_id
                       )
                    OR (
                         hist.line_plan_workstation_id IS NULL
                         AND ws_match.line_id = hist.line_id
                         AND ws_match.work_date = hist.work_date
                         AND ws_match.workstation_code = hist.workstation_code
                       )
                 ORDER BY
                     CASE
                         WHEN hist.line_plan_workstation_id IS NOT NULL
                          AND ws_match.id = hist.line_plan_workstation_id THEN 0
                         ELSE 1
                     END,
                     ws_match.id DESC
                 LIMIT 1
             ) ws ON true
             WHERE hist.line_id = $1
               AND hist.work_date = $2
               AND hist.is_overtime = $${overtimeIndex}
               AND hist.employee_id IS NOT NULL
               ${assignmentWindowPredicate}
         ),
         ws_hour AS (
             SELECT a.workstation_id,
                    lph.hour_slot,
                    MAX(lph.quantity) AS hour_output,
                    MAX(lph.qa_rejection) AS hour_rejection,
                    MAX(lph.updated_at) AS hour_updated
             FROM assignments a
             ${processJoin}
             LEFT JOIN line_process_hourly_progress lph
               ON lph.process_id = wproc.product_process_id
              AND lph.line_id = $1
              AND lph.work_date = $2
              ${hourPredicate}
             GROUP BY a.workstation_id, lph.hour_slot
         ),
         assignment_stats AS (
             SELECT a.history_id,
                    a.employee_id,
                    a.workstation_id,
                    a.workstation_code,
                    a.workstation_number,
                    a.group_name,
                    a.actual_sam_seconds,
                    COALESCE(SUM(wh.hour_output), 0) AS total_output,
                    COALESCE(SUM(wh.hour_rejection), 0) AS total_rejection,
                    COALESCE(SUM((wh.hour_output * a.actual_sam_seconds) / 3600.0), 0) AS total_sah_hours,
                    MAX(wh.hour_updated) AS last_updated
             FROM assignments a
             LEFT JOIN ws_hour wh
               ON wh.workstation_id = a.workstation_id
              AND wh.hour_slot >= a.effective_from_hour
              AND wh.hour_slot <= LEAST(a.effective_to_hour, $${windowEndIndex})
             GROUP BY a.history_id, a.employee_id, a.workstation_id, a.workstation_code, a.workstation_number, a.group_name, a.actual_sam_seconds
         ),
         employee_totals AS (
             SELECT employee_id,
                    COALESCE(SUM(total_output), 0) AS total_output,
                    COALESCE(SUM(total_rejection), 0) AS total_rejection,
                    COALESCE(SUM(total_sah_hours), 0) AS total_sah_hours,
                    MAX(last_updated) AS last_updated
             FROM assignment_stats
             GROUP BY employee_id
         ),
         current_assignment AS (
             SELECT DISTINCT ON (employee_id)
                    employee_id,
                    workstation_id,
                    workstation_code,
                    workstation_number,
                    group_name,
                    actual_sam_seconds,
                    source_product_id
             FROM assignments
             ORDER BY employee_id, effective_from_hour DESC, history_id DESC
         )
         SELECT e.id,
                e.emp_code,
                e.emp_name,
                e.manpower_factor,
                ca.workstation_id,
                ca.workstation_code,
                ca.workstation_number,
                ca.group_name,
                ca.actual_sam_seconds,
                ca.source_product_id,
                COALESCE(et.total_output, 0) AS total_output,
                COALESCE(et.total_rejection, 0) AS total_rejection,
                COALESCE(et.total_sah_hours, 0) AS total_sah_hours,
                et.last_updated
         FROM employee_totals et
         JOIN employees e ON e.id = et.employee_id
         LEFT JOIN current_assignment ca ON ca.employee_id = et.employee_id
         ORDER BY ca.workstation_number NULLS LAST, ca.workstation_code, e.emp_code`,
        params
    );

    return result.rows.map(row => {
        const output = parseInt(row.total_output || 0, 10);
        const sahHours = parseFloat(row.total_sah_hours || 0);
        const denom = parseFloat(hoursDenom || 0);
        const efficiency = (sahHours > 0 && denom > 0)
            ? Math.round((sahHours / denom) * 10000) / 100
            : 0;
        const sourceProductId = row.source_product_id != null ? parseInt(row.source_product_id, 10) : null;
        const isChangeover = !useOt && !!incomingProductId && sourceProductId === incomingProductId;
        return {
            id: row.id,
            emp_code: row.emp_code,
            emp_name: row.emp_name,
            manpower_factor: parseFloat(row.manpower_factor || 1) || 1,
            workstation_id: row.workstation_id,
            workstation_code: row.workstation_code,
            workstation_number: row.workstation_number != null ? parseInt(row.workstation_number, 10) : null,
            group_name: row.group_name || '',
            actual_sam_seconds: parseFloat(row.actual_sam_seconds || 0),
            operation_code: row.workstation_code,
            operation_name: row.group_name || 'Workstation',
            source_product_id: sourceProductId,
            source_mode: isChangeover ? 'changeover' : 'primary',
            is_changeover: isChangeover,
            total_output: output,
            total_rejection: parseInt(row.total_rejection || 0, 10),
            efficiency_percent: efficiency,
            last_updated: row.last_updated
        };
    });
}

async function getHourlyEmployeeProgress(db, lineId, workDate, hourSlot, isOvertime = false) {
    return getEmployeeProgressForWindow(db, lineId, workDate, { exactHour: hourSlot, isOvertime, hoursDenom: 1 });
}

async function getCumulativeEmployeeProgress(db, lineId, workDate, endHour, isOvertime = false, hoursDenom = 1) {
    return getEmployeeProgressForWindow(db, lineId, workDate, { endHour, isOvertime, hoursDenom });
}

async function getWorkstationProgressForWindow(db, lineId, workDate, { exactHour = null, endHour = null, isOvertime = false, hoursDenom = 1, splitBySource = false } = {}) {
    const useOt = !!isOvertime;
    const workstationTable = useOt ? 'line_ot_workstations' : 'line_plan_workstations';
    const processJoin = useOt
        ? `LEFT JOIN line_ot_workstation_processes wproc ON wproc.ot_workstation_id = a.workstation_id`
        : `LEFT JOIN line_plan_workstation_processes wproc ON wproc.workstation_id = a.workstation_id`;
    const lateralProductField = useOt ? 'ws_match.source_product_id' : 'ws_match.product_id';
    let incomingProductId = null;
    if (!useOt) {
        const planResult = await db.query(
            `SELECT incoming_product_id
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [lineId, workDate]
        );
        incomingProductId = planResult.rows[0]?.incoming_product_id
            ? parseInt(planResult.rows[0].incoming_product_id, 10)
            : null;
    }
    const historyHours = getHistoryHours(useOt);
    const defaultWindowEnd = historyHours[historyHours.length - 1] || 23;
    const params = [lineId, workDate];
    let windowEndHour = defaultWindowEnd;
    let hourPredicate = '';
    let assignmentWindowPredicate = '';
    const coveredSourceGroup = splitBySource ? `, a.source_product_id` : '';
    const finalSourceSelect = splitBySource ? `,
                source_product_id` : '';
    const finalSourceGroup = splitBySource ? `, source_product_id` : '';

    if (Number.isFinite(exactHour)) {
        params.push(parseInt(exactHour, 10));
        windowEndHour = parseInt(exactHour, 10);
        hourPredicate = `AND lph.hour_slot = $${params.length}`;
        assignmentWindowPredicate = `AND hist.effective_from_hour <= $${params.length}
                                     AND COALESCE(hist.effective_to_hour, 999) >= $${params.length}`;
    } else if (Number.isFinite(endHour)) {
        params.push(parseInt(endHour, 10));
        windowEndHour = parseInt(endHour, 10);
        hourPredicate = `AND lph.hour_slot <= $${params.length}`;
        assignmentWindowPredicate = `AND hist.effective_from_hour <= $${params.length}`;
    }

    params.push(useOt);
    const overtimeIndex = params.length;
    params.push(windowEndHour);
    const windowEndIndex = params.length;

    const result = await db.query(
        `WITH assignments AS (
             SELECT hist.id AS history_id,
                    hist.employee_id,
                    hist.workstation_code,
                    hist.line_plan_workstation_id,
                    hist.effective_from_hour,
                    COALESCE(hist.effective_to_hour, 999) AS effective_to_hour,
                    ws.id AS workstation_id,
                    ws.workstation_number,
                    COALESCE(ws.group_name, '') AS group_name,
                    COALESCE(ws.actual_sam_seconds, 0) AS actual_sam_seconds,
                    ws.source_product_id
             FROM employee_workstation_assignment_history hist
             LEFT JOIN LATERAL (
                 SELECT ws_match.id,
                        ws_match.workstation_number,
                        ws_match.group_name,
                        ws_match.actual_sam_seconds,
                        ${lateralProductField} AS source_product_id
                 FROM ${workstationTable} ws_match
                 WHERE (
                         hist.line_plan_workstation_id IS NOT NULL
                         AND ws_match.id = hist.line_plan_workstation_id
                       )
                    OR (
                         hist.line_plan_workstation_id IS NULL
                         AND ws_match.line_id = hist.line_id
                         AND ws_match.work_date = hist.work_date
                         AND ws_match.workstation_code = hist.workstation_code
                       )
                 ORDER BY
                     CASE
                         WHEN hist.line_plan_workstation_id IS NOT NULL
                          AND ws_match.id = hist.line_plan_workstation_id THEN 0
                         ELSE 1
                     END,
                     ws_match.id DESC
                 LIMIT 1
             ) ws ON true
             WHERE hist.line_id = $1
               AND hist.work_date = $2
               AND hist.is_overtime = $${overtimeIndex}
               AND hist.employee_id IS NOT NULL
               ${assignmentWindowPredicate}
         ),
         ws_hour AS (
             SELECT a.workstation_id,
                    lph.hour_slot,
                    MAX(lph.quantity) AS hour_output,
                    MAX(lph.qa_rejection) AS hour_rejection,
                    MAX(lph.updated_at) AS hour_updated
             FROM assignments a
             ${processJoin}
             LEFT JOIN line_process_hourly_progress lph
               ON lph.process_id = wproc.product_process_id
              AND lph.line_id = $1
              AND lph.work_date = $2
              ${hourPredicate}
             GROUP BY a.workstation_id, lph.hour_slot
         ),
         covered_ws_hours AS (
             SELECT a.workstation_code,
                    a.workstation_number,
                    a.group_name,
                    ${splitBySource ? 'a.source_product_id,' : ''}
                    wh.hour_slot,
                    MAX(COALESCE(wh.hour_output, 0)) AS hour_output,
                    MAX(COALESCE(wh.hour_rejection, 0)) AS hour_rejection,
                    MAX(wh.hour_updated) AS hour_updated,
                    MAX(a.actual_sam_seconds) AS actual_sam_seconds
             FROM assignments a
             LEFT JOIN ws_hour wh
               ON wh.workstation_id = a.workstation_id
              AND wh.hour_slot >= a.effective_from_hour
              AND wh.hour_slot <= LEAST(a.effective_to_hour, $${windowEndIndex})
             GROUP BY a.workstation_code, a.workstation_number, a.group_name${coveredSourceGroup}, wh.hour_slot
         )
         SELECT workstation_code,
                workstation_number,
                group_name${finalSourceSelect},
                COALESCE(SUM(hour_output), 0) AS total_output,
                COALESCE(SUM(hour_rejection), 0) AS total_rejection,
                COALESCE(SUM((hour_output * actual_sam_seconds) / 3600.0), 0) AS total_sah_hours,
                MAX(hour_updated) AS last_updated
         FROM covered_ws_hours
         GROUP BY workstation_code, workstation_number, group_name${finalSourceGroup}
         ORDER BY workstation_number NULLS LAST, workstation_code${finalSourceGroup}`,
        params
    );

    return result.rows.map(row => {
        const sahHours = parseFloat(row.total_sah_hours || 0);
        const denom = parseFloat(hoursDenom || 0);
        const efficiency = (sahHours > 0 && denom > 0)
            ? Math.round((sahHours / denom) * 10000) / 100
            : 0;

        return {
            workstation_code: row.workstation_code,
            workstation_number: row.workstation_number != null ? parseInt(row.workstation_number, 10) : null,
            group_name: row.group_name || '',
            source_product_id: row.source_product_id != null ? parseInt(row.source_product_id, 10) : null,
            source_mode: splitBySource && !useOt && !!incomingProductId && parseInt(row.source_product_id || 0, 10) === incomingProductId
                ? 'changeover'
                : 'primary',
            total_output: parseInt(row.total_output || 0, 10),
            total_rejection: parseInt(row.total_rejection || 0, 10),
            total_sah_hours: sahHours,
            efficiency_percent: efficiency,
            last_updated: row.last_updated || null
        };
    });
}

async function getWorkstationOutputMap(db, lineId, workDate, workstationIds, { exactHour = null, endHour = null } = {}) {
    if (!Array.isArray(workstationIds) || !workstationIds.length) return {};
    const params = [lineId, workDate, workstationIds];
    let hourPredicate = '';
    if (Number.isFinite(exactHour)) {
        params.push(parseInt(exactHour, 10));
        hourPredicate = `AND lph.hour_slot = $4`;
    } else if (Number.isFinite(endHour)) {
        params.push(parseInt(endHour, 10));
        hourPredicate = `AND lph.hour_slot <= $4`;
    }

    const result = await db.query(
        `SELECT grouped.workstation_id, COALESCE(SUM(grouped.hour_output), 0) AS total_output
         FROM (
             SELECT lpwp.workstation_id, lph.hour_slot, MAX(lph.quantity) AS hour_output
             FROM line_plan_workstation_processes lpwp
             LEFT JOIN line_process_hourly_progress lph
               ON lph.process_id = lpwp.product_process_id
              AND lph.line_id = $1
              AND lph.work_date = $2
              ${hourPredicate}
             WHERE lpwp.workstation_id = ANY($3::int[])
             GROUP BY lpwp.workstation_id, lph.hour_slot
         ) grouped
         GROUP BY grouped.workstation_id`,
        params
    );

    const outputMap = {};
    result.rows.forEach(row => {
        outputMap[row.workstation_id] = parseInt(row.total_output || 0, 10);
    });
    return outputMap;
}

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
        await ensureDailyPlansCarryForward(date);
        const plansResult = await pool.query(
            `SELECT lp.id, lp.line_id, lp.product_id, lp.work_date, lp.target_units, lp.is_locked,
                    lp.incoming_product_id, lp.incoming_target_units, lp.changeover_sequence,
                    lp.overtime_minutes, lp.overtime_target, lp.ot_enabled,
                    lp.changeover_started_at,
                    pl.line_code, pl.line_name,
                    p.product_code, p.product_name, p.target_qty,
                    ip.product_code as incoming_product_code, ip.product_name as incoming_product_name,
                    ip.target_qty as incoming_target_qty,
                    0 AS product_cumulative,
                    0 AS incoming_cumulative
             FROM line_daily_plans lp
             JOIN production_lines pl ON lp.line_id = pl.id
             JOIN products p ON lp.product_id = p.id
             LEFT JOIN products ip ON lp.incoming_product_id = ip.id
             WHERE lp.work_date = $1
             ORDER BY pl.line_name`,
            [date]
        );
        const enrichedPlans = await Promise.all(
            plansResult.rows.map(async (plan) => ({
                ...plan,
                product_cumulative: await getLineActualOutput(pool, plan.line_id, plan.work_date, plan.product_id),
                incoming_cumulative: plan.incoming_product_id
                    ? await getLineActualOutput(pool, plan.line_id, plan.work_date, plan.incoming_product_id)
                    : 0
            }))
        );
        const linesResult = await pool.query(
            `SELECT pl.id,
                    pl.line_code,
                    pl.line_name,
                    pl.line_leader,
                    NULL::INTEGER as current_product_id,
                    0 as target_units,
                    NULL::TEXT as current_product_code,
                    NULL::TEXT as current_product_name,
                    pl.current_product_id as live_current_product_id,
                    pl.target_units as live_target_units,
                    p.product_code as live_current_product_code,
                    p.product_name as live_current_product_name
             FROM production_lines pl
             LEFT JOIN products p ON pl.current_product_id = p.id
             WHERE pl.is_active = true
             ORDER BY pl.line_name`
        );
        const productsResult = await pool.query(
            `SELECT id, product_code, product_name, target_qty, plan_month FROM products WHERE is_active = true ORDER BY product_code`
        );
        res.json({
            success: true,
            data: {
                plans: enrichedPlans,
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
        // Cap target_units against remaining order quantity (across all lines producing this product)
        let finalTarget = parseInt(target_units || 0);
        let capWarning = null;
        if (product_id && finalTarget > 0) {
            const capRes = await pool.query(`
                SELECT
                    COALESCE(p.target_qty, 0) AS order_qty,
                    COALESCE((
                        SELECT SUM(max_qty) FROM (
                            SELECT MAX(lph.quantity) AS max_qty
                            FROM line_process_hourly_progress lph
                            WHERE lph.process_id = (
                                SELECT id FROM product_processes
                                WHERE product_id = p.id AND is_active = true
                                ORDER BY sequence_number ASC LIMIT 1
                            )
                            AND lph.work_date < $2
                            GROUP BY lph.work_date, lph.hour_slot
                        ) sub
                    ), 0) AS produced_before_today,
                    COALESCE((
                        SELECT SUM(ldp.target_units)
                        FROM line_daily_plans ldp
                        WHERE ldp.product_id = p.id AND ldp.work_date = $2 AND ldp.line_id != $3
                    ), 0) AS other_lines_today
                FROM products p WHERE p.id = $1
            `, [product_id, work_date, line_id]);
            if (capRes.rows[0]) {
                const orderQty = parseInt(capRes.rows[0].order_qty);
                const produced = parseInt(capRes.rows[0].produced_before_today);
                const otherLines = parseInt(capRes.rows[0].other_lines_today);
                if (orderQty > 0) {
                    const remaining = Math.max(0, orderQty - produced - otherLines);
                    if (finalTarget > remaining) {
                        finalTarget = remaining;
                        capWarning = `Target capped at ${remaining} — Order Qty: ${orderQty}, Already produced: ${produced}, Other lines today: ${otherLines}`;
                    }
                }
            }
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
            [line_id, product_id, work_date, finalTarget, incoming_product_id || null, incoming_target_units || 0, normalizedChangeover, user_id || null]
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
                [product_id, finalTarget, line_id]
            );
            realtime.broadcast('data_change', { entity: 'lines', action: 'update', id: line_id });
        }
        await logAudit('line_daily_plans', result.rows[0].id, before.rowCount ? 'update' : 'create', result.rows[0], before.rows[0] || null);

        // Auto-copy workstation plan from most recent day with same product, if none exists yet for today
        let copied_from = null;
        const existingWsPlan = await pool.query(
            `SELECT id FROM line_plan_workstations WHERE line_id=$1 AND work_date=$2 AND product_id=$3 LIMIT 1`,
            [line_id, work_date, product_id]
        );
        if (!existingWsPlan.rows.length) {
            const srcDate = await findLatestWorkstationPlanDate(line_id, product_id, work_date);
            if (srcDate) {
                copied_from = srcDate instanceof Date ? srcDate.toISOString().slice(0, 10) : String(srcDate).slice(0, 10);
                await copyWorkstationPlanFromDate(line_id, srcDate, line_id, work_date, product_id, null);
            }
        }

        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
        res.json({ success: true, data: result.rows[0], copied_from, cap_warning: capWarning || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /daily-plans — partial update: only updates the fields provided in the body.
// Use this when the plan already exists and only specific fields changed.
router.patch('/daily-plans', async (req, res) => {
    const { line_id, work_date, ...fields } = req.body;
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    try {
        const lockCheck = await pool.query(
            `SELECT is_locked FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        if (lockCheck.rows[0]?.is_locked) {
            return res.status(403).json({ success: false, error: 'Daily plan is locked' });
        }

        // Cap target_units against remaining order quantity if being updated
        let capWarning = null;
        if ('target_units' in fields && parseInt(fields.target_units || 0) > 0) {
            const existing = await pool.query(
                `SELECT product_id FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            const productId = ('product_id' in fields ? fields.product_id : existing.rows[0]?.product_id);
            if (productId) {
                const capRes = await pool.query(`
                    SELECT
                        COALESCE(p.target_qty, 0) AS order_qty,
                        COALESCE((
                            SELECT SUM(max_qty) FROM (
                                SELECT MAX(lph.quantity) AS max_qty
                                FROM line_process_hourly_progress lph
                                WHERE lph.process_id = (
                                    SELECT id FROM product_processes
                                    WHERE product_id = p.id AND is_active = true
                                    ORDER BY sequence_number ASC LIMIT 1
                                )
                                AND lph.work_date < $2
                                GROUP BY lph.work_date, lph.hour_slot
                            ) sub
                        ), 0) AS produced_before_today,
                        COALESCE((
                            SELECT SUM(ldp.target_units)
                            FROM line_daily_plans ldp
                            WHERE ldp.product_id = p.id AND ldp.work_date = $2 AND ldp.line_id != $3
                        ), 0) AS other_lines_today
                    FROM products p WHERE p.id = $1
                `, [productId, work_date, line_id]);
                if (capRes.rows[0]) {
                    const orderQty = parseInt(capRes.rows[0].order_qty);
                    const produced = parseInt(capRes.rows[0].produced_before_today);
                    const otherLines = parseInt(capRes.rows[0].other_lines_today);
                    if (orderQty > 0) {
                        const remaining = Math.max(0, orderQty - produced - otherLines);
                        if (parseInt(fields.target_units) > remaining) {
                            fields.target_units = remaining;
                            capWarning = `Target capped at ${remaining} — Order Qty: ${orderQty}, Already produced: ${produced}, Other lines today: ${otherLines}`;
                        }
                    }
                }
            }
        }

        const allowed = ['target_units', 'incoming_target_units', 'product_id', 'incoming_product_id', 'changeover_sequence'];
        const setClauses = [];
        const values = [line_id, work_date];
        for (const key of allowed) {
            if (key in fields) {
                values.push(fields[key] ?? null);
                setClauses.push(`${key} = $${values.length}`);
            }
        }
        if (!setClauses.length) {
            return res.status(400).json({ success: false, error: 'No valid fields to update' });
        }
        setClauses.push('updated_at = NOW()');

        const result = await pool.query(
            `UPDATE line_daily_plans SET ${setClauses.join(', ')} WHERE line_id = $1 AND work_date = $2 RETURNING *`,
            values
        );
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Daily plan not found — save the full plan first' });
        }

        // If target_units changed and this is today, sync production_lines.target_units
        if ('target_units' in fields && work_date === new Date().toISOString().slice(0, 10)) {
            await pool.query(
                `UPDATE production_lines SET target_units = $1, updated_at = NOW() WHERE id = $2`,
                [fields.target_units ?? 0, line_id]
            );
            realtime.broadcast('data_change', { entity: 'lines', action: 'update', id: line_id });
        }

        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
        res.json({ success: true, data: result.rows[0], cap_warning: capWarning || null });
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

// POST /lines/:lineId/workstation-plan/copy-from-date — copy WS plan + employees (same or cross-line)
// Body: { from_date, to_date, product_id, from_line_id? }
// :lineId = target line. from_line_id defaults to :lineId (same-line copy).
router.post('/lines/:lineId/workstation-plan/copy-from-date', async (req, res) => {
    const toLineId = req.params.lineId;
    const { from_date, to_date, product_id, from_line_id, copy_employees, force_reassign } = req.body;
    if (!from_date || !to_date || !product_id) {
        return res.status(400).json({ success: false, error: 'from_date, to_date, product_id required' });
    }
    const fromLineId = from_line_id || toLineId;
    const shouldCopyEmployees = !(copy_employees === false || copy_employees === 'false');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const targetPlan = await client.query(
            `SELECT ldp.product_id, p.product_code, p.product_name
             FROM line_daily_plans ldp
             JOIN products p ON p.id = ldp.product_id
             WHERE ldp.line_id=$1 AND ldp.work_date=$2`,
            [toLineId, to_date]
        );
        if (!targetPlan.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: `Target line has no daily plan set for ${to_date}. Set a product and target first.` });
        }

        if (shouldCopyEmployees && !(force_reassign === true || force_reassign === 'true')) {
            const sourceEmpResult = await client.query(
                `SELECT workstation_code, employee_id
                 FROM employee_workstation_assignments
                 WHERE line_id = $1
                   AND work_date = $2
                   AND is_overtime = false
                   AND employee_id IS NOT NULL`,
                [fromLineId, from_date]
            );
            const keepCodes = sourceEmpResult.rows.map(row => row.workstation_code).filter(Boolean);
            const conflicts = await findEmployeeAssignmentConflicts(
                client,
                sourceEmpResult.rows.map(row => row.employee_id),
                to_date,
                false,
                toLineId,
                keepCodes
            );

            if (conflicts.length) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    requires_confirmation: true,
                    error: 'Some employees are already assigned on the target date.',
                    conflicts: conflicts.map(row => ({
                        employee_id: row.employee_id,
                        emp_code: row.emp_code,
                        emp_name: row.emp_name,
                        line_id: row.line_id,
                        line_code: row.line_code,
                        line_name: row.line_name,
                        workstation_code: row.workstation_code
                    }))
                });
            }
        }

        const copied = await copyWorkstationPlanFromDate(fromLineId, from_date, toLineId, to_date, product_id, client, {
            targetProductId: targetPlan.rows[0].product_id,
            copyEmployees: shouldCopyEmployees
        });
        if (!copied) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: `No workstation plan found for ${from_date}` });
        }
        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'workstations', action: 'copied', line_id: toLineId, work_date: to_date });
        res.json({
            success: true,
            copied_from: from_date,
            from_line_id: fromLineId,
            target_product_id: targetPlan.rows[0].product_id,
            copied_employees: shouldCopyEmployees
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// GET /lines/:lineId/workstation-plan/latest-date?product_id=&before_date= — find most recent WS plan date
router.get('/lines/:lineId/workstation-plan/latest-date', async (req, res) => {
    const { lineId } = req.params;
    const { product_id, before_date } = req.query;
    if (!product_id || !before_date) {
        return res.status(400).json({ success: false, error: 'product_id and before_date required' });
    }
    try {
        const date = await findLatestWorkstationPlanDate(lineId, product_id, before_date);
        res.json({ success: true, date: date ? (date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10)) : null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /lines/:lineId/workstation-plan/preview?date=X&product_id=Y — workstation summary for copy-plan preview modal
router.get('/lines/:lineId/workstation-plan/preview', async (req, res) => {
    const { lineId } = req.params;
    const { date, product_id } = req.query;
    if (!date) return res.status(400).json({ success: false, error: 'date required' });
    try {
        const previewProductId = product_id ? parseInt(product_id, 10) : null;
        if (product_id && !previewProductId) {
            return res.status(400).json({ success: false, error: 'invalid product_id' });
        }
        const wsParams = previewProductId ? [lineId, date, previewProductId] : [lineId, date];
        const wsRes = await pool.query(
            `SELECT w.id, w.workstation_code, w.workstation_number, w.group_name, w.product_id,
                    e.emp_code, e.emp_name
             FROM line_plan_workstations w
             LEFT JOIN employee_workstation_assignments ewa
                 ON ewa.line_id = w.line_id AND ewa.work_date = w.work_date
                 AND ewa.workstation_code = w.workstation_code AND ewa.is_overtime = false
             LEFT JOIN employees e ON e.id = ewa.employee_id
             WHERE w.line_id = $1 AND w.work_date = $2
               ${previewProductId ? 'AND w.product_id = $3' : ''}
             ORDER BY w.workstation_number`,
            wsParams
        );
        if (!wsRes.rows.length) {
            return res.json({ success: true, workstations: [], date, product_id: null });
        }
        let sourcePlanProductId = previewProductId;
        if (!sourcePlanProductId) {
            const productIdCounts = {};
            for (const row of wsRes.rows) {
                const pid = String(row.product_id);
                productIdCounts[pid] = (productIdCounts[pid] || 0) + 1;
            }
            sourcePlanProductId = parseInt(
                Object.entries(productIdCounts).sort((a, b) => b[1] - a[1])[0][0],
                10
            );
        }

        const filteredWsRows = wsRes.rows.filter(r => String(r.product_id) === String(sourcePlanProductId));
        const wsIds = filteredWsRows.map(r => r.id);
        const productRes = await pool.query(
            `SELECT product_code, product_name
             FROM products
             WHERE id = $1`,
            [sourcePlanProductId]
        );
        const procRes = await pool.query(
            `SELECT lwp.workstation_id,
                    COUNT(*) AS process_count,
                    COUNT(*) FILTER (WHERE lwp.osm_checked = true) AS osm_checked_count,
                    STRING_AGG(o.operation_name, ', ' ORDER BY lwp.sequence_in_workstation) AS process_names
             FROM line_plan_workstation_processes lwp
             JOIN product_processes pp ON pp.id = lwp.product_process_id
             JOIN operations o ON o.id = pp.operation_id
             WHERE lwp.workstation_id = ANY($1::int[])
             GROUP BY lwp.workstation_id`,
            [wsIds]
        );
        const procMap = {};
        for (const r of procRes.rows) {
            procMap[r.workstation_id] = {
                process_count: parseInt(r.process_count,10),
                osm_checked_count: parseInt(r.osm_checked_count,10),
                process_names: r.process_names || ''
            };
        }
        const workstations = filteredWsRows.map(w => ({
            workstation_code:   w.workstation_code,
            workstation_number: w.workstation_number,
            group_name:         w.group_name || '',
            employee:           w.emp_code ? `${w.emp_code} – ${w.emp_name}` : null,
            process_count:      procMap[w.id]?.process_count || 0,
            osm_checked_count:  procMap[w.id]?.osm_checked_count || 0,
            process_names:      procMap[w.id]?.process_names || '',
        }));
        res.json({
            success: true,
            workstations,
            date,
            product_id: sourcePlanProductId,
            product_code: productRes.rows[0]?.product_code || '',
            product_name: productRes.rows[0]?.product_name || ''
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// OT PLAN ENDPOINTS
// ============================================================================

// PATCH /daily-plans/ot-toggle — enable or disable OT for a daily plan
// On enable: auto-creates line_ot_plans (copies from regular workstation plan)
router.patch('/daily-plans/ot-toggle', async (req, res) => {
    const { line_id, work_date, ot_enabled } = req.body;
    if (!line_id || !work_date || ot_enabled == null) {
        return res.status(400).json({ success: false, error: 'line_id, work_date, ot_enabled required' });
    }
    const enable = ot_enabled === true || ot_enabled === 'true';
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Get the daily plan
        const planRes = await client.query(
            `SELECT id, product_id, target_units FROM line_daily_plans WHERE line_id=$1 AND work_date=$2`,
            [line_id, work_date]
        );
        if (!planRes.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Daily plan not found' });
        }
        const plan = planRes.rows[0];

        if (enable) {
            const otPlanRes = await client.query(
                `INSERT INTO line_ot_plans (line_id, work_date, product_id, global_ot_minutes, ot_target_units)
                 VALUES ($1, $2, $3, 60, 0)
                 ON CONFLICT (line_id, work_date)
                 DO UPDATE SET product_id = EXCLUDED.product_id,
                               updated_at = NOW()
                 RETURNING *`,
                [line_id, work_date, plan.product_id]
            );
            const otPlanId = otPlanRes.rows[0].id;

            const existingWsResult = await client.query(
                `SELECT workstation_code, is_active, ot_minutes
                 FROM line_ot_workstations
                 WHERE ot_plan_id = $1`,
                [otPlanId]
            );
            const existingByCode = new Map(
                existingWsResult.rows.map(row => [String(row.workstation_code), row])
            );

            if (existingWsResult.rows.length === 0) {
                const sourceState = await getEffectiveOtSourceWorkstations(client, line_id, work_date);
                if (sourceState?.workstations?.length) {
                    for (const ws of sourceState.workstations) {
                        const preserved = existingByCode.get(String(ws.workstation_code));
                        const otWsRes = await client.query(
                            `INSERT INTO line_ot_workstations
                               (ot_plan_id, workstation_code, workstation_number, group_name, is_active, ot_minutes,
                                actual_sam_seconds, source_line_plan_workstation_id, source_product_id, source_mode,
                                source_hourly_target, source_employee_id, regular_shift_output_quantity,
                                regular_shift_wip_quantity)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                             RETURNING id`,
                            [
                                otPlanId,
                                ws.workstation_code,
                                ws.workstation_number,
                                ws.group_name,
                                preserved ? preserved.is_active !== false : true,
                                preserved ? (parseInt(preserved.ot_minutes || 0, 10) || 0) : 0,
                                ws.actual_sam_seconds,
                                ws.source_line_plan_workstation_id,
                                ws.source_product_id,
                                ws.source_mode,
                                ws.source_hourly_target,
                                ws.source_employee_id,
                                ws.regular_shift_output_quantity,
                                ws.regular_shift_wip_quantity
                            ]
                        );
                        const otWsId = otWsRes.rows[0].id;

                        for (let i = 0; i < ws.processes.length; i++) {
                            await client.query(
                                `INSERT INTO line_ot_workstation_processes
                                   (ot_workstation_id, product_process_id, sequence_in_workstation)
                                 VALUES ($1, $2, $3)`,
                                [otWsId, ws.processes[i].process_id, i + 1]
                            );
                        }

                        if (ws.source_employee_id) {
                            await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                                lineId: line_id,
                                workDate: work_date,
                                workstationCode: ws.workstation_code,
                                isOvertime: true,
                                nextEmployeeId: ws.source_employee_id
                            });
                            await clearEmployeeAssignmentConflicts(
                                client,
                                ws.source_employee_id,
                                work_date,
                                true,
                                line_id,
                                ws.workstation_code
                            );
                            await client.query(
                                `INSERT INTO employee_workstation_assignments
                                   (line_id, work_date, workstation_code, employee_id, is_overtime, line_plan_workstation_id)
                                 VALUES ($1,$2,$3,$4,true,$5)
                                 ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                                 DO UPDATE SET employee_id = EXCLUDED.employee_id,
                                               line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                               assigned_at = NOW()`,
                                [line_id, work_date, ws.workstation_code, ws.source_employee_id, null]
                            );
                            await syncAssignmentHistoryForCurrentRow(client, {
                                lineId: line_id,
                                workDate: work_date,
                                workstationCode: ws.workstation_code,
                                employeeId: ws.source_employee_id,
                                isOvertime: true
                            });
                        }
                    }
                    await recalculateOtPlanTarget(client, otPlanId);
                }
            }
        }

        // Set ot_enabled flag
        await client.query(
            `UPDATE line_daily_plans SET ot_enabled=$3, updated_at=NOW() WHERE line_id=$1 AND work_date=$2`,
            [line_id, work_date, enable]
        );
        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'ot_toggle', line_id, work_date, ot_enabled: enable });
        res.json({ success: true, ot_enabled: enable });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// GET /lines/:lineId/ot-plan?date= — return full OT plan with workstations and processes
router.get('/lines/:lineId/ot-plan', async (req, res) => {
    const { lineId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
        const shiftWindow = await getShiftWindowDetails();
        const dailyPlanRes = await pool.query(
            `SELECT product_id, target_units, incoming_product_id, incoming_target_units
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [lineId, date]
        );
        const dailyPlan = dailyPlanRes.rows[0] || {};

        // Get OT plan
        const planRes = await pool.query(
            `SELECT op.*, p.product_code, p.product_name
             FROM line_ot_plans op
             LEFT JOIN products p ON p.id = op.product_id
             WHERE op.line_id=$1 AND op.work_date=$2`,
            [lineId, date]
        );
        if (!planRes.rows[0]) {
            return res.json({ success: true, data: null });
        }
        const otPlan = planRes.rows[0];

        // Get OT workstations
        const wsRes = await pool.query(
            `SELECT * FROM line_ot_workstations WHERE ot_plan_id=$1 ORDER BY workstation_number`,
            [otPlan.id]
        );

        const workstations = [];
        for (const ws of wsRes.rows) {
            // Get processes
            const procRes = await pool.query(
                `SELECT pp.id AS process_id,
                        pp.product_id,
                        pp.sequence_number,
                        pp.operation_sah,
                        pp.cycle_time_seconds,
                        o.operation_code,
                        o.operation_name,
                        p.product_code,
                        p.product_name
                 FROM line_ot_workstation_processes lwp
                 JOIN product_processes pp ON pp.id = lwp.product_process_id
                 JOIN operations o ON o.id = pp.operation_id
                 JOIN products p ON p.id = pp.product_id
                 WHERE lwp.ot_workstation_id=$1
                 ORDER BY lwp.sequence_in_workstation`,
                [ws.id]
            );
            // Get OT employee assignment
            const empRes = await pool.query(
                `SELECT ewa.employee_id, e.emp_code, e.emp_name
                 FROM employee_workstation_assignments ewa
                 JOIN employees e ON e.id = ewa.employee_id
                WHERE ewa.line_id=$1 AND ewa.work_date=$2 AND ewa.workstation_code=$3 AND ewa.is_overtime=true`,
                [lineId, date, ws.workstation_code]
            );
            const sourceEmpRes = await pool.query(
                `SELECT id, emp_code, emp_name
                 FROM employees
                 WHERE id = $1`,
                [ws.source_employee_id || null]
            );

            const sourceProductId = ws.source_product_id
                ? parseInt(ws.source_product_id, 10)
                : (procRes.rows[0]?.product_id ? parseInt(procRes.rows[0].product_id, 10) : null);
            const hourlyTarget = (parseFloat(ws.source_hourly_target || 0) || 0) > 0
                ? (parseFloat(ws.source_hourly_target || 0) || 0)
                : (() => {
                    const fallbackTarget = sourceProductId && sourceProductId === parseInt(dailyPlan.incoming_product_id || 0, 10)
                        ? (parseInt(dailyPlan.incoming_target_units || 0, 10) || 0)
                        : (parseInt(dailyPlan.target_units || 0, 10) || 0);
                    return shiftWindow.workingHours > 0 ? (fallbackTarget / shiftWindow.workingHours) : 0;
                })();
            const sourceTargetUnits = hourlyTarget > 0 && shiftWindow.workingHours > 0
                ? hourlyTarget * shiftWindow.workingHours
                : (sourceProductId && sourceProductId === parseInt(dailyPlan.incoming_product_id || 0, 10)
                    ? (parseInt(dailyPlan.incoming_target_units || 0, 10) || 0)
                    : (parseInt(dailyPlan.target_units || 0, 10) || 0));
            const otMinutes = parseInt(ws.ot_minutes || 0, 10) || 0;
            const otTargetUnits = Math.round((hourlyTarget * otMinutes) / 60);
            workstations.push({
                ...ws,
                processes: procRes.rows,
                assigned_employee: empRes.rows[0] || null,
                source_employee: sourceEmpRes.rows[0] || null,
                source_product_id: sourceProductId,
                source_target_units: roundMetric(sourceTargetUnits, 2),
                source_hourly_target: roundMetric(hourlyTarget, 2),
                ot_target_units: otTargetUnits
            });
        }

        // All products, employees, factory-wide OT assignments, and all processes for layout editor
        const [prodsRes, empsRes, allOtRes, allProcsRes] = await Promise.all([
            pool.query(`SELECT id, product_code, product_name FROM products WHERE is_active=true ORDER BY product_name`),
            pool.query(`SELECT id, emp_code, emp_name FROM employees WHERE is_active=true ORDER BY emp_name`),
            pool.query(
                `SELECT employee_id, workstation_code, line_id
                 FROM employee_workstation_assignments
                 WHERE work_date=$1 AND is_overtime=true AND employee_id IS NOT NULL`,
                [date]
            ),
            pool.query(
                `SELECT pp.id, pp.sequence_number, pp.operation_sah,
                        o.operation_code, o.operation_name
                 FROM product_processes pp
                 JOIN operations o ON o.id = pp.operation_id
                 WHERE pp.product_id=$1 AND pp.is_active=true
                 ORDER BY pp.sequence_number`,
                [otPlan.product_id]
            )
        ]);

        // Compute per_hour_target from daily plan target and shift working hours
        let perHourTarget = 0;
        try {
            const dailyTarget = parseInt(dailyPlan.target_units, 10) || 0;
            if (dailyTarget > 0 && shiftWindow.workingHours > 0) perHourTarget = dailyTarget / shiftWindow.workingHours;
        } catch (_) { /* non-fatal */ }

        const computedOtTarget = workstations.reduce((sum, ws) => {
            if (ws.is_active === false) return sum;
            return sum + (parseInt(ws.ot_target_units || 0, 10) || 0);
        }, 0);

        res.json({
            success: true,
            data: {
                ot_plan: {
                    ...otPlan,
                    computed_ot_target_units: computedOtTarget
                },
                workstations,
                products: prodsRes.rows,
                employees: empsRes.rows,
                all_ot_assignments: allOtRes.rows,
                all_processes: allProcsRes.rows,
                per_hour_target: Math.round(perHourTarget * 100) / 100
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /lines/:lineId/ot-plan/supervisor-auth — IE toggles supervisor authorization
router.patch('/lines/:lineId/ot-plan/supervisor-auth', async (req, res) => {
    const { lineId } = req.params;
    const { date, supervisor_authorized } = req.body;
    if (!date || typeof supervisor_authorized !== 'boolean') {
        return res.status(400).json({ success: false, error: 'date and supervisor_authorized (boolean) required' });
    }
    try {
        const result = await pool.query(
            `UPDATE line_ot_plans SET supervisor_authorized=$3, updated_at=NOW()
             WHERE line_id=$1 AND work_date=$2 RETURNING id`,
            [lineId, date, supervisor_authorized]
        );
        if (!result.rows[0]) return res.status(404).json({ success: false, error: 'OT plan not found' });
        realtime.broadcast('data_change', { entity: 'ot_plan', line_id: lineId, work_date: date, supervisor_authorized });
        res.json({ success: true, supervisor_authorized });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /lines/:lineId/ot-plan — update OT defaults and recompute derived target
router.put('/lines/:lineId/ot-plan', async (req, res) => {
    const { lineId } = req.params;
    const { date, global_ot_minutes } = req.body;
    if (!date) {
        return res.status(400).json({ success: false, error: 'date is required' });
    }
    const globalMins = parseInt(global_ot_minutes, 10) || 60;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const planRes = await client.query(
            `SELECT id
             FROM line_ot_plans
             WHERE line_id = $1 AND work_date = $2`,
            [lineId, date]
        );
        if (!planRes.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'OT plan not found. Enable OT first.' });
        }
        const otPlanId = planRes.rows[0].id;
        await client.query(
            `UPDATE line_ot_plans
             SET global_ot_minutes = $3,
                 updated_at = NOW()
             WHERE line_id = $1 AND work_date = $2`,
            [lineId, date, globalMins]
        );
        const recomputedTarget = await recalculateOtPlanTarget(client, otPlanId);

        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'ot_plan', line_id: lineId, work_date: date });
        res.json({ success: true, computed_ot_target_units: recomputedTarget });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// PUT /lines/:lineId/ot-plan/workstations — bulk update active/inactive and ot_minutes per WS
router.put('/lines/:lineId/ot-plan/workstations', async (req, res) => {
    const { lineId } = req.params;
    const { date, workstations } = req.body;
    if (!date || !Array.isArray(workstations)) {
        return res.status(400).json({ success: false, error: 'date and workstations[] required' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const planRes = await client.query(
            `SELECT id FROM line_ot_plans WHERE line_id=$1 AND work_date=$2`, [lineId, date]
        );
        if (!planRes.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'OT plan not found' });
        }
        const otPlanId = planRes.rows[0].id;
        for (const ws of workstations) {
            await client.query(
                `UPDATE line_ot_workstations
                 SET is_active=$3, ot_minutes=$4, updated_at=NOW()
                 WHERE ot_plan_id=$1 AND workstation_code=$2`,
                [otPlanId, ws.workstation_code, ws.is_active, parseInt(ws.ot_minutes, 10) || 0]
            );
        }
        const recomputedTarget = await recalculateOtPlanTarget(client, otPlanId);
        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'ot_plan', line_id: lineId, work_date: date });
        res.json({ success: true, updated: workstations.length, computed_ot_target_units: recomputedTarget });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// PUT /lines/:lineId/ot-plan/layout — full workstation layout replace (for OT layout editor)
// Body: { date, workstations: [{workstation_code, workstation_number, group_name, ot_minutes, processes:[pp_id,...]}] }
router.put('/lines/:lineId/ot-plan/layout', async (req, res) => {
    const { lineId } = req.params;
    const { date, workstations } = req.body;
    if (!date || !Array.isArray(workstations)) {
        return res.status(400).json({ success: false, error: 'date and workstations[] required' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const planRes = await client.query(
            `SELECT id FROM line_ot_plans WHERE line_id=$1 AND work_date=$2`, [lineId, date]
        );
        if (!planRes.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'OT plan not found' });
        }
        const otPlanId = planRes.rows[0].id;

        // Preserve employee assignments (keyed by workstation_code) before cascade-delete
        const empRes = await client.query(
            `SELECT ewa.workstation_code, ewa.employee_id
             FROM employee_workstation_assignments ewa
             WHERE ewa.line_id=$1 AND ewa.work_date=$2 AND ewa.is_overtime=true AND ewa.employee_id IS NOT NULL`,
            [lineId, date]
        );
        const empByCode = {};
        for (const ea of empRes.rows) empByCode[ea.workstation_code] = ea.employee_id;

        // Delete existing OT workstations (cascades to processes and employee assignments)
        await client.query(`DELETE FROM line_ot_workstations WHERE ot_plan_id=$1`, [otPlanId]);

        // Re-insert workstations, processes, and employee assignments
        for (let i = 0; i < workstations.length; i++) {
            const ws = workstations[i];
            const wsNum = ws.workstation_number || (i + 1);
            const newWs = await client.query(
                `INSERT INTO line_ot_workstations
                   (ot_plan_id, workstation_code, workstation_number, group_name, is_active, ot_minutes, actual_sam_seconds)
                 VALUES ($1,$2,$3,$4,true,$5,
                   (SELECT COALESCE(SUM(pp.operation_sah * 3600), 0)
                    FROM product_processes pp WHERE pp.id = ANY($6::int[])))
                 RETURNING id`,
                [otPlanId, ws.workstation_code, wsNum, ws.group_name || null,
                 parseInt(ws.ot_minutes, 10) || 0, ws.processes]
            );
            const newWsId = newWs.rows[0].id;
            for (let j = 0; j < ws.processes.length; j++) {
                await client.query(
                    `INSERT INTO line_ot_workstation_processes (ot_workstation_id, product_process_id, sequence_in_workstation)
                     VALUES ($1,$2,$3)`,
                    [newWsId, ws.processes[j], j + 1]
                );
            }
            // Re-link employee if they were assigned to this workstation code
            const empId = empByCode[ws.workstation_code];
            if (empId) {
                await clearEmployeeAssignmentConflicts(
                    client,
                    empId,
                    date,
                    true,
                    lineId,
                    ws.workstation_code
                );
                await client.query(
                    `INSERT INTO employee_workstation_assignments
                       (line_id, work_date, workstation_code, employee_id, is_overtime, line_plan_workstation_id)
                     VALUES ($1,$2,$3,$4,true,$5)
                     ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                     DO UPDATE SET employee_id=EXCLUDED.employee_id,
                                   line_plan_workstation_id=EXCLUDED.line_plan_workstation_id`,
                    [lineId, date, ws.workstation_code, empId, null]
                );
            }
        }

        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'ot_plan', action: 'layout_update', line_id: lineId, work_date: date });
        res.json({ success: true, workstation_count: workstations.length });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// POST /lines/:lineId/ot-plan/employee — assign or clear employee on OT workstation
router.post('/lines/:lineId/ot-plan/employee', async (req, res) => {
    const { lineId } = req.params;
    const { date, workstation_code, employee_id } = req.body;
    if (!date || !workstation_code) {
        return res.status(400).json({ success: false, error: 'date and workstation_code required' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const otWsRes = await client.query(
            `SELECT low.id
             FROM line_ot_workstations low
             JOIN line_ot_plans lop ON lop.id = low.ot_plan_id
             WHERE lop.line_id = $1
               AND lop.work_date = $2
               AND low.workstation_code = $3
             LIMIT 1`,
            [lineId, date, workstation_code]
        );
        const otWorkstationId = otWsRes.rows[0]?.id || null;
        if (!otWorkstationId) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'OT workstation not found' });
        }

        await closeHistoryForWorkstationAssignmentIfNeeded(client, {
            lineId,
            workDate: date,
            workstationCode: workstation_code,
            isOvertime: true,
            nextEmployeeId: employee_id || null
        });

        if (employee_id) {
            await clearEmployeeAssignmentConflicts(
                client,
                employee_id,
                date,
                true,
                lineId,
                workstation_code
            );
            await client.query(
                `INSERT INTO employee_workstation_assignments
                   (line_id, work_date, workstation_code, employee_id, is_overtime, line_plan_workstation_id)
                 VALUES ($1,$2,$3,$4,true,$5)
                 ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                 DO UPDATE SET employee_id = EXCLUDED.employee_id,
                               line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                               assigned_at = NOW()`,
                [lineId, date, workstation_code, employee_id, null]
            );
            await syncAssignmentHistoryForCurrentRow(client, {
                lineId,
                workDate: date,
                workstationCode: workstation_code,
                employeeId: employee_id,
                isOvertime: true
            });
        } else {
            await client.query(
                `DELETE FROM employee_workstation_assignments
                 WHERE line_id=$1 AND work_date=$2 AND workstation_code=$3 AND is_overtime=true`,
                [lineId, date, workstation_code]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ============================================================================
// PLAN HISTORY — all lines' workstation plans for a given date
// ============================================================================
router.get('/plan-history', async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const lineId = req.query.line_id ? parseInt(req.query.line_id, 10) : null;
    try {
        const params = [date];
        let lineFilter = '';
        if (Number.isFinite(lineId)) {
            params.push(lineId);
            lineFilter = ` AND lpw.line_id = $${params.length}`;
        }

        // Historical plan view should come from saved workstation plans, not only current masters.
        const linesRes = await pool.query(
            `SELECT DISTINCT
                    lpw.line_id,
                    COALESCE(ldp.product_id, lpw.product_id) AS product_id,
                    COALESCE(ldp.target_units, 0)            AS target_units,
                    COALESCE(ldp.is_locked, false)           AS is_locked,
                    COALESCE(pl.line_code, 'LINE-' || lpw.line_id::text) AS line_code,
                    COALESCE(pl.line_name, 'Line ' || lpw.line_id::text) AS line_name,
                    COALESCE(p.product_code, '')             AS product_code,
                    COALESCE(p.product_name, '')             AS product_name
             FROM line_plan_workstations lpw
             LEFT JOIN line_daily_plans ldp
                    ON ldp.line_id = lpw.line_id AND ldp.work_date = lpw.work_date
             LEFT JOIN production_lines pl ON pl.id = lpw.line_id
             LEFT JOIN products p ON p.id = COALESCE(ldp.product_id, lpw.product_id)
             WHERE lpw.work_date = $1
             ${lineFilter}
             ORDER BY line_name, line_code`,
            params
        );

        const lines = [];
        for (const line of linesRes.rows) {
            // Workstations for this line+date+product
            const wsRes = await pool.query(
                `SELECT w.id, w.workstation_code, w.workstation_number, w.group_name,
                        w.actual_sam_seconds, w.workload_pct,
                        e.emp_code, e.emp_name
                 FROM line_plan_workstations w
                 LEFT JOIN employee_workstation_assignments ewa
                     ON ewa.line_id = w.line_id AND ewa.work_date = w.work_date
                     AND ewa.workstation_code = w.workstation_code AND ewa.is_overtime = false
                 LEFT JOIN employees e ON e.id = ewa.employee_id
                 WHERE w.line_id = $1 AND w.work_date = $2
                 ORDER BY w.workstation_number`,
                [line.line_id, date]
            );

            const workstations = [];
            for (const ws of wsRes.rows) {
                const procRes = await pool.query(
                    `SELECT o.operation_code, o.operation_name, pp.operation_sah
                     FROM line_plan_workstation_processes lwp
                     JOIN product_processes pp ON pp.id = lwp.product_process_id
                     JOIN operations o ON o.id = pp.operation_id
                     WHERE lwp.workstation_id = $1
                     ORDER BY lwp.sequence_in_workstation`,
                    [ws.id]
                );
                workstations.push({
                    workstation_code:   ws.workstation_code,
                    workstation_number: ws.workstation_number,
                    group_name:         ws.group_name,
                    actual_sam_seconds: ws.actual_sam_seconds,
                    workload_pct:       ws.workload_pct,
                    processes:          procRes.rows,
                    employee:           ws.emp_code ? { emp_code: ws.emp_code, emp_name: ws.emp_name } : null
                });
            }

            lines.push({
                line_id:          line.line_id,
                line_code:        line.line_code,
                line_name:        line.line_name,
                product_id:       line.product_id,
                product_code:     line.product_code,
                product_name:     line.product_name,
                target_units:     line.target_units,
                is_locked:        line.is_locked,
                workstation_count: workstations.length,
                process_count:    workstations.reduce((s, w) => s + w.processes.length, 0),
                workstations
            });
        }

        res.json({ success: true, date, lines });
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
        const lunchMinsEff = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10);
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60) - lunchMinsEff / 60;
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
                    const diff = getNetWorkingMinutes(row.in_time, row.out_time, lunchMinsEff) / 60;
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
        const lunchMinsRange = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10);
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60) - lunchMinsRange / 60;
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
                        const diff = getNetWorkingMinutes(row.in_time, row.out_time, lunchMinsRange) / 60;
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
    if (!['admin', 'ie'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, error: 'Admin or IE access required' });
    }
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
    if (!['admin', 'ie'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, error: 'Admin or IE access required' });
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

router.delete('/daily-plans', async (req, res) => {
    const line_id = req.body?.line_id || req.query?.line_id;
    const work_date = req.body?.work_date || req.query?.work_date;
    const forceDelete = ['1', 'true', 'yes'].includes(String(req.body?.force || req.query?.force || '').toLowerCase());
    if (!line_id || !work_date) {
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    }
    if (!['admin', 'ie'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, error: 'Admin or IE access required' });
    }
    const client = await pool.connect();
    try {
        const planResult = await client.query(
            `SELECT * FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const plan = planResult.rows[0];
        if (!plan) {
            return res.status(404).json({ success: false, error: 'Daily plan not found' });
        }
        if (plan.is_locked) {
            return res.status(403).json({ success: false, error: 'Daily plan is locked' });
        }

        const deps = await client.query(
            `SELECT
                (SELECT COUNT(*) FROM line_process_hourly_progress WHERE line_id = $1 AND work_date = $2) AS hourly_progress,
                (SELECT COUNT(*) FROM material_transactions WHERE line_id = $1 AND work_date = $2) AS materials,
                (SELECT COUNT(*) FROM process_material_wip WHERE line_id = $1 AND work_date = $2) AS process_wip,
                (SELECT COUNT(*) FROM group_wip WHERE line_id = $1 AND work_date = $2) AS group_wip,
                (SELECT COUNT(*) FROM line_daily_metrics WHERE line_id = $1 AND work_date = $2) AS metrics,
                (SELECT COUNT(*) FROM line_shift_closures WHERE line_id = $1 AND work_date = $2) AS shift_closures,
                (SELECT COUNT(*) FROM worker_departures WHERE line_id = $1 AND work_date = $2) AS worker_departures,
                (SELECT COUNT(*) FROM worker_adjustments WHERE line_id = $1 AND work_date = $2) AS worker_adjustments,
                (SELECT COUNT(*)
                   FROM line_ot_progress lop
                   JOIN line_ot_workstations low ON low.id = lop.ot_workstation_id
                   JOIN line_ot_plans lot ON lot.id = low.ot_plan_id
                  WHERE lot.line_id = $1 AND lot.work_date = $2) AS ot_progress`,
            [line_id, work_date]
        );
        const depRow = deps.rows[0] || {};
        const hasData = Object.values(depRow).some(v => parseInt(v || 0, 10) > 0);
        if (hasData && !forceDelete) {
            return res.status(400).json({
                success: false,
                error: 'This daily plan has ongoing data. Delete it permanently?',
                requires_confirmation: true,
                details: depRow
            });
        }

        await client.query('BEGIN');
        if (hasData) {
            await client.query(
                `DELETE FROM line_process_hourly_progress WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            await client.query(
                `DELETE FROM material_transactions WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            await client.query(
                `DELETE FROM process_material_wip WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            await client.query(
                `DELETE FROM group_wip WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            await client.query(
                `DELETE FROM line_daily_metrics WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            await client.query(
                `DELETE FROM line_shift_closures WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            await client.query(
                `DELETE FROM worker_departures WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            await client.query(
                `DELETE FROM worker_adjustments WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
        }
        await client.query(
            `DELETE FROM employee_workstation_assignments WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        await client.query(
            `DELETE FROM line_ot_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        await client.query(
            `DELETE FROM line_plan_workstations
             WHERE line_id = $1
               AND work_date = $2
               AND product_id = ANY($3::int[])`,
            [line_id, work_date, [plan.product_id, plan.incoming_product_id].filter(Boolean)]
        );
        await client.query(
            `INSERT INTO line_daily_plan_delete_markers (line_id, work_date, deleted_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (line_id, work_date) DO UPDATE
               SET deleted_by = EXCLUDED.deleted_by,
                   deleted_at = CURRENT_TIMESTAMP`,
            [line_id, work_date, req.user?.id || null]
        );
        const deleteResult = await client.query(
            `DELETE FROM line_daily_plans WHERE id = $1 RETURNING id`,
            [plan.id]
        );
        if (!deleteResult.rowCount) {
            throw new Error('Daily plan could not be deleted');
        }
        if (work_date === new Date().toISOString().slice(0, 10)) {
            await client.query(
                `UPDATE production_lines
                 SET current_product_id = NULL,
                     target_units = 0,
                     updated_at = NOW()
                 WHERE id = $1`,
                [line_id]
            );
        }
        await client.query('COMMIT');

        await logAudit('line_daily_plans', plan.id, 'delete', null, plan, req);
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'delete', line_id, work_date });
        if (work_date === new Date().toISOString().slice(0, 10)) {
            realtime.broadcast('data_change', { entity: 'lines', action: 'update', id: line_id });
        }
        res.json({ success: true, message: 'Daily plan deleted successfully', deleted_id: deleteResult.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// POST /daily-plans/copy — copy a plan from source_date to target_date for a line
router.post('/daily-plans/copy', async (req, res) => {
    const { line_id, source_date, target_date } = req.body;
    if (!line_id || !source_date || !target_date) {
        return res.status(400).json({ success: false, error: 'line_id, source_date and target_date are required' });
    }
    if (!['admin', 'ie'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, error: 'Admin or IE access required' });
    }
    if (source_date === target_date) {
        return res.status(400).json({ success: false, error: 'Source and target dates must be different' });
    }
    const client = await pool.connect();
    try {
        // Fetch source plan
        const srcPlan = await client.query(
            `SELECT * FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, source_date]
        );
        if (!srcPlan.rows[0]) {
            return res.status(404).json({ success: false, error: `No plan found for ${source_date}` });
        }
        const src = srcPlan.rows[0];

        // Check target is not locked
        const tgtLocked = await client.query(
            `SELECT is_locked FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, target_date]
        );
        if (tgtLocked.rows[0]?.is_locked) {
            return res.status(403).json({ success: false, error: `Plan for ${target_date} is locked and cannot be overwritten` });
        }

        await client.query('BEGIN');

        // Upsert daily plan
        await client.query(
            `INSERT INTO line_daily_plans
               (line_id, product_id, work_date, target_units, incoming_product_id, incoming_target_units, changeover_sequence)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (line_id, work_date) DO UPDATE SET
               product_id = EXCLUDED.product_id,
               target_units = EXCLUDED.target_units,
               incoming_product_id = EXCLUDED.incoming_product_id,
               incoming_target_units = EXCLUDED.incoming_target_units,
               changeover_sequence = EXCLUDED.changeover_sequence,
               changeover_started_at = NULL,
               updated_at = NOW()`,
            [line_id, src.product_id, target_date, src.target_units,
             src.incoming_product_id || null, src.incoming_target_units || 0, src.changeover_sequence || null]
        );

        // Clear existing workstation plan for target date
        const oldWs = await client.query(
            `SELECT id FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2`,
            [line_id, target_date]
        );
        if (oldWs.rows.length > 0) {
            const oldIds = oldWs.rows.map(r => r.id);
            await client.query(`DELETE FROM line_plan_workstation_processes WHERE workstation_id = ANY($1)`, [oldIds]);
            await client.query(`DELETE FROM line_plan_workstations WHERE id = ANY($1)`, [oldIds]);
        }
        await client.query(
            `DELETE FROM employee_workstation_assignments WHERE line_id = $1 AND work_date = $2 AND is_overtime = false`,
            [line_id, target_date]
        );

        // Copy workstation plan
        const srcWs = await client.query(
            `SELECT * FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2 ORDER BY workstation_number`,
            [line_id, source_date]
        );

        for (const ws of srcWs.rows) {
            const newWs = await client.query(
                `INSERT INTO line_plan_workstations
                   (line_id, work_date, product_id, workstation_number, workstation_code,
                    takt_time_seconds, actual_sam_seconds, workload_pct, group_name)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [line_id, target_date, ws.product_id, ws.workstation_number, ws.workstation_code,
                 ws.takt_time_seconds, ws.actual_sam_seconds, ws.workload_pct, ws.group_name || null]
            );
            const newWsId = newWs.rows[0].id;

            // Copy processes for this workstation
            const srcProcs = await client.query(
                `SELECT * FROM line_plan_workstation_processes WHERE workstation_id = $1 ORDER BY sequence_in_workstation`,
                [ws.id]
            );
            for (const proc of srcProcs.rows) {
                await client.query(
                    `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation)
                     VALUES ($1,$2,$3)`,
                    [newWsId, proc.product_process_id, proc.sequence_in_workstation]
                );
            }

            // Copy employee assignment but reset link state for the fresh day
            const srcEmp = await client.query(
                `SELECT employee_id FROM employee_workstation_assignments
                 WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false`,
                [line_id, source_date, ws.workstation_code]
            );
            if (srcEmp.rows[0]?.employee_id) {
                await clearEmployeeAssignmentConflicts(
                    client,
                    srcEmp.rows[0].employee_id,
                    target_date,
                    false,
                    line_id,
                    ws.workstation_code
                );
                await client.query(
                    `INSERT INTO employee_workstation_assignments
                       (line_id, workstation_code, employee_id, work_date, line_plan_workstation_id, is_linked)
                     VALUES ($1,$2,$3,$4,$5,$6)
                     ON CONFLICT (line_id, work_date, workstation_code, is_overtime) DO UPDATE
                       SET employee_id = EXCLUDED.employee_id,
                           line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                           is_linked = EXCLUDED.is_linked, assigned_at = NOW()`,
                    [line_id, ws.workstation_code, srcEmp.rows[0].employee_id, target_date, newWsId, false]
                );
            }
        }

        await client.query('COMMIT');

        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'copy', line_id, source_date, target_date });
        res.json({ success: true, message: `Plan copied from ${source_date} to ${target_date}` });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
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

        const shiftWindow = await getShiftWindowDetails();
        const workingHours = shiftWindow.workingHours;
        const workingSeconds = shiftWindow.workingSeconds;

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
        const shiftWindow = await getShiftWindowDetails();
        const workingHours = shiftWindow.workingHours;
        const workingSeconds = shiftWindow.workingSeconds;

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

router.post('/employees/qr-export', async (req, res) => {
    const requestedIds = Array.isArray(req.body?.employee_ids)
        ? req.body.employee_ids.map(id => parseInt(id, 10)).filter(Number.isFinite)
        : [];

    try {
        const result = requestedIds.length > 0
            ? await pool.query(
                `SELECT id, emp_name, emp_code, qr_code_path
                 FROM employees
                 WHERE id = ANY($1::int[])
                 ORDER BY emp_code`,
                [requestedIds]
            )
            : await pool.query(
                `SELECT id, emp_name, emp_code, qr_code_path
                 FROM employees
                 ORDER BY emp_code`
            );

        const employees = result.rows;
        if (!employees.length) {
            return res.status(400).json({ success: false, error: 'No employees selected for export' });
        }

        for (const employee of employees) {
            const expectedPath = `qrcodes/employees/${employee.id}.svg`;
            if (employee.qr_code_path !== expectedPath) {
                employee.qr_code_path = await qrUtils.generateEmployeeQrById(employee.id);
            }
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'WorkSync';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet('Employee QR Codes', {
            views: [{ state: 'frozen', ySplit: 1 }]
        });

        sheet.columns = [
            { header: 'S.No', key: 'sno', width: 8 },
            { header: 'Employee Name', key: 'emp_name', width: 28 },
            { header: 'Employee code', key: 'emp_code', width: 18 },
            { header: 'QR Code', key: 'qr_code', width: 18 }
        ];

        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '1F4E78' }
        };
        headerRow.height = 22;

        for (const [index, employee] of employees.entries()) {
            const rowNumber = index + 2;
            sheet.getCell(`A${rowNumber}`).value = index + 1;
            sheet.getCell(`B${rowNumber}`).value = employee.emp_name;
            sheet.getCell(`C${rowNumber}`).value = employee.emp_code;
            sheet.getRow(rowNumber).height = 78;
            sheet.getCell(`A${rowNumber}`).alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.getCell(`B${rowNumber}`).alignment = { vertical: 'middle' };
            sheet.getCell(`C${rowNumber}`).alignment = { vertical: 'middle' };

            const payload = JSON.stringify({
                type: 'employee',
                id: employee.id,
                code: employee.emp_code,
                name: employee.emp_name
            });
            const pngBuffer = await QRCode.toBuffer(payload, {
                type: 'png',
                width: 140,
                margin: 1
            });
            const imageId = workbook.addImage({ buffer: pngBuffer, extension: 'png' });
            sheet.addImage(imageId, {
                tl: { col: 3 + 0.18, row: (rowNumber - 1) + 0.12 },
                ext: { width: 70, height: 70 }
            });
        }

        sheet.eachRow((row, rowNumber) => {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                    right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
                };
                if (rowNumber > 1) {
                    cell.alignment = { ...(cell.alignment || {}), vertical: 'middle' };
                }
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="employee_qr_codes_${stamp}.xlsx"`);
        res.send(Buffer.from(buffer));
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
        await qrUtils.generateEmployeeQrById(result.rows[0].id);
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
        if (result.rows[0]) {
            await qrUtils.generateEmployeeQrById(result.rows[0].id);
        }
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
                   (SELECT COALESCE(SUM(pp.operation_sah), 0) FROM product_processes pp WHERE pp.product_id = p.id AND pp.is_active = true) as total_sah,
                   (SELECT COALESCE(SUM(slot.max_qty), 0)
                    FROM (SELECT id FROM product_processes WHERE product_id = p.id AND is_active = true ORDER BY sequence_number ASC LIMIT 1) fp
                    CROSS JOIN LATERAL (SELECT MAX(quantity) AS max_qty FROM line_process_hourly_progress WHERE process_id = fp.id GROUP BY work_date, hour_slot) slot
                   ) AS cumulative_output
            FROM products p
            LEFT JOIN LATERAL (
                SELECT
                    string_agg(pl.line_code, ', ' ORDER BY pl.line_code) as line_names,
                    array_agg(pl.id ORDER BY pl.id) as line_ids
                FROM production_lines pl
                WHERE pl.current_product_id = p.id
            ) line_info ON true
            LEFT JOIN LATERAL (
                SELECT
                    string_agg(pl.line_code, ', ' ORDER BY pl.line_code) as line_names,
                    array_agg(pl.id ORDER BY pl.id) as line_ids
                FROM line_daily_plans ldp
                JOIN production_lines pl ON ldp.line_id = pl.id
                WHERE ldp.work_date = CURRENT_DATE AND ldp.product_id = p.id
            ) today_primary ON true
            LEFT JOIN LATERAL (
                SELECT
                    string_agg(pl.line_code, ', ' ORDER BY pl.line_code) as line_names,
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

        // Use the line target (target_units from daily plan) for takt time — not the order quantity.
        // Fall back to the most recent plan for this product if no plan exists for today.
        const planRes = await pool.query(
            `SELECT target_units FROM line_daily_plans
             WHERE product_id = $1 AND target_units > 0
             ORDER BY work_date DESC LIMIT 1`,
            [id]
        );
        const lineTarget = parseInt(planRes.rows[0]?.target_units || 0);
        const taktTime = lineTarget > 0 ? Math.round(28800 / lineTarget) : 0;

        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Product Process Setup');

        ws.columns = [
            { width: 15 }, { width: 15 }, { width: 22 }, { width: 18 },
            { width: 35 }, { width: 20 }, { width: 18 }, { width: 15 }
        ];

        const boldFont = { bold: true, size: 11 };
        const titleFont = { bold: true, size: 14 };
        const borderAll = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' }
        };

        // Title
        ws.mergeCells('A1:H1');
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
            ['TARGET', lineTarget],
            ['TAKT TIME', taktTime]
        ];
        headerFields.forEach(([label, value], idx) => {
            const row = idx + 2;
            ws.mergeCells(`A${row}:D${row}`);
            ws.mergeCells(`E${row}:H${row}`);
            const lc = ws.getCell(`A${row}`);
            lc.value = label; lc.font = boldFont; lc.alignment = { horizontal: 'center' }; lc.border = borderAll;
            const vc = ws.getCell(`E${row}`);
            vc.value = value; vc.font = boldFont; vc.alignment = { horizontal: 'center' }; vc.border = borderAll;
        });

        // Table header (row 8)
        const tableHeaders = ['GROUP', 'WORK STATION', 'WORKER INPUT MAPPING', 'PROCESS CODE', 'PROCESS DETAILS', 'PROCESS TIME (SEC)', 'CYCLE TIME (SEC)', 'WORK LOAD %'];
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
                proc.operation_code || '', proc.operation_name, procTime, cycleTime
            ];
            values.forEach((val, colIdx) => {
                const cell = row.getCell(colIdx + 1);
                cell.value = val; cell.border = borderAll; cell.alignment = { horizontal: 'center' };
            });
            const loadCell = row.getCell(8);
            loadCell.value = workLoad; loadCell.numFmt = '0%';
            loadCell.border = borderAll; loadCell.alignment = { horizontal: 'center' };
        });

        // Total row
        const totalRowNum = dataStartRow + processes.length;
        const totalRow = ws.getRow(totalRowNum);
        ws.mergeCells(`A${totalRowNum}:E${totalRowNum}`);
        const tlc = totalRow.getCell(1);
        tlc.value = 'TOTAL TIME IN SECS'; tlc.font = boldFont; tlc.alignment = { horizontal: 'center' }; tlc.border = borderAll;
        const tpc = totalRow.getCell(6);
        tpc.value = totalProcessTime; tpc.font = boldFont; tpc.border = borderAll; tpc.alignment = { horizontal: 'center' };
        const tcc = totalRow.getCell(7);
        tcc.value = totalProcessTime; tcc.font = boldFont; tcc.border = borderAll; tcc.alignment = { horizontal: 'center' };
        totalRow.getCell(8).border = borderAll;

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
        const operationsResult = await pool.query(
            `SELECT operation_code, operation_name
             FROM operations
             WHERE is_active = true
             ORDER BY operation_code`
        );
        const operations = operationsResult.rows;
        const operationCount = Math.max(operations.length, 1);

        // Columns: SEQ | PROCESS CODE (auto) | SELECT OPERATION | SAM (seconds)
        ws.columns = [
            { width: 12 }, { width: 18 }, { width: 45 }, { width: 18 }
        ];

        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        const inputFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        const autoFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBEBEB' } };
        const boldFont = { bold: true, size: 11 };
        const titleFont = { bold: true, size: 14 };
        const borderAll = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' }
        };

        // Title row (merged A1:D1)
        ws.mergeCells('A1:D1');
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
            ws.mergeCells(`A${row}:B${row}`);
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
            ws.getCell(`D${row}`).border = borderAll;
        });

        // Table header (row 6)
        const tableHeaders = ['SEQ', 'PROCESS CODE (auto)', 'SELECT OPERATION', 'SAM (seconds)'];
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
        ws.getCell('C6').note = {
            texts: [
                { font: { bold: true }, text: 'Existing process: ' },
                { text: 'select it from the dropdown so the code fills automatically.\n' },
                { font: { bold: true }, text: 'New process: ' },
                { text: 'type the process name manually and leave the code blank. Upload will create a new process code.' }
            ]
        };

        // Hidden config sheet for operation dropdown and code lookup
        const cfg = workbook.addWorksheet('Config');
        cfg.state = 'hidden';
        operations.forEach((op, i) => {
            cfg.getCell(i + 1, 1).value = op.operation_code;
            cfg.getCell(i + 1, 2).value = op.operation_name;
            cfg.getCell(i + 1, 3).value = `${op.operation_code} | ${op.operation_name}`;
        });

        // Example data rows (rows 7+): [SEQ, combinedOperation, SAM_seconds]
        const exampleData = [
            ['1', 'TOP PASTING', 28],
            ['2', 'KIMLON PASTING', 22],
            ['3', 'ATTACHING TOP & KIMLON', 35],
            ['4', 'GUSSET STITCHING -2NOS', 45],
            ['5', 'GUSSET LAMPING -2NOS', 40],
            ['6', 'GUSSET SHAPING', 30],
            ['7', 'PATTI PROMOTOR', 25],
            ['8', 'PATTI PRIMER 1', 20],
            ['9', 'PATTI PRIMER 2', 20],
            ['10', 'PATTI DYE', 38],
            ['11', 'CLEANING', 15],
        ];

        for (let rowNum = 7; rowNum <= 306; rowNum++) {
            const row = ws.getRow(rowNum);
            for (let col = 1; col <= 4; col++) {
                const cell = row.getCell(col);
                cell.border = borderAll;
                cell.alignment = { horizontal: col === 3 ? 'left' : 'center', vertical: 'middle' };
                cell.fill = col === 2 ? autoFill : inputFill;
            }

            row.getCell(2).value = { formula:
                `=IF(C${rowNum}="","",IF(ISNUMBER(FIND("|",C${rowNum})),` +
                `TRIM(LEFT(C${rowNum},FIND("|",C${rowNum})-1)),` +
                `IF(ISNUMBER(MATCH(C${rowNum},Config!$A$1:$A$${operationCount},0)),C${rowNum},` +
                `IFERROR(INDEX(Config!$A$1:$A$${operationCount},MATCH(C${rowNum},Config!$B$1:$B$${operationCount},0)),"")` +
                `)))`
            };

            row.getCell(3).dataValidation = {
                type: 'list',
                allowBlank: true,
                formulae: [`Config!$C$1:$C$${operationCount}`],
                showErrorMessage: true,
                errorTitle: 'Invalid operation',
                error: 'Choose a process from the dropdown or type a new process name manually.'
            };
        }

        exampleData.forEach(([seq, processName, sam], idx) => {
            const rowNum = 7 + idx;
            ws.getCell(`A${rowNum}`).value = seq;
            ws.getCell(`C${rowNum}`).value = processName;
            ws.getCell(`D${rowNum}`).value = sam;
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
            '   - PROCESS CODE (auto): Filled automatically when you select an existing process.',
            '   - SELECT OPERATION: Choose from the dropdown for existing processes or type a new process name manually.',
            '     * Existing process selection auto-fills the process code.',
            '     * New typed process names are allowed. Upload will create a new process code for them.',
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

        // Parse process rows (row 7 onwards, row 6 is the table header).
        // Accept both the new auto-code template and older files for backward compatibility.
        const processRows = [];
        const processCodeHeader = String(sheet.getRow(6).getCell(2).value || '').trim().toUpperCase();
        const processNameHeader = String(sheet.getRow(6).getCell(3).value || '').trim().toUpperCase();
        const hasAutoProcessCodeColumn = processCodeHeader === 'PROCESS CODE (AUTO)';
        const hasManualProcessCodeColumn = processCodeHeader === 'PROCESS CODE';
        const usesFourColumns = hasAutoProcessCodeColumn || hasManualProcessCodeColumn;
        const operationNameColumn = usesFourColumns ? 3 : 2;
        const samColumn = usesFourColumns ? 4 : 3;
        for (let rowNum = 7; rowNum <= sheet.rowCount; rowNum++) {
            const row = sheet.getRow(rowNum);
            const rawCode = usesFourColumns ? row.getCell(2).value : '';
            const rawOperation = row.getCell(operationNameColumn).value;
            const processCode = String(rawCode?.result ?? rawCode ?? '').trim();
            const operationText = String(rawOperation?.result ?? rawOperation ?? '').trim();
            let processName = operationText;
            let derivedCode = '';

            if (operationText.includes('|')) {
                const [left, ...rest] = operationText.split('|');
                derivedCode = String(left || '').trim();
                processName = rest.join('|').trim();
            }

            const effectiveCode = processCode || derivedCode;
            const looksLikeHeaderRow = rowNum === 7 && processNameHeader.includes('SELECT OPERATION');
            if (!processName || looksLikeHeaderRow) continue;
            const seqVal = row.getCell(1).value;
            const samVal = row.getCell(samColumn).value;
            processRows.push({
                sequence_override: seqVal ? parseInt(seqVal) : null,
                process_code: effectiveCode,
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
            // No sequence shifting needed — uq_product_sequence is a partial index (WHERE is_active = true)
        } else {
            productAction = 'created';
            const insertResult = await client.query(
                `INSERT INTO products (product_code, product_name, product_description, category, buyer_name, is_active, created_by)
                 VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
                [styleNo, description, description, productCategory || null, buyerName || null, req.user?.id || null]
            );
            productId = insertResult.rows[0].id;
        }

        // 2. Process each row - create operations and product_processes
        const newOperations = [];
        const insertedProcessIds = [];
        const operationCacheByCode = {};
        const operationCacheByName = {};
        let autoSeq = 1;

        for (const row of processRows) {
            const processNameUpper = row.process_name.toUpperCase();
            const processCodeUpper = String(row.process_code || '').trim().toUpperCase();
            const sequenceNumber = row.sequence_override || autoSeq;
            const operationSah = row.sam_seconds > 0 ? row.sam_seconds / 3600 : 0;

            let resolvedOperation = processCodeUpper
                ? operationCacheByCode[processCodeUpper]
                : operationCacheByName[processNameUpper];

            if (!resolvedOperation && processCodeUpper) {
                const opResult = await client.query(
                    `SELECT id, operation_code, is_active
                     FROM operations
                     WHERE UPPER(TRIM(operation_code)) = $1
                     LIMIT 1`,
                    [processCodeUpper]
                );
                if (opResult.rows[0]) resolvedOperation = opResult.rows[0];
            }

            if (!resolvedOperation && !processCodeUpper) {
                const opResult = await client.query(
                    `SELECT id, operation_code, is_active
                     FROM operations
                     WHERE UPPER(TRIM(operation_name)) = $1
                     LIMIT 1`,
                    [processNameUpper]
                );
                if (opResult.rows[0]) resolvedOperation = opResult.rows[0];
            }

            if (resolvedOperation && resolvedOperation.is_active === false) {
                await client.query(
                    `UPDATE operations
                     SET is_active = true, updated_at = NOW(), updated_by = $1
                     WHERE id = $2`,
                    [req.user?.id || null, resolvedOperation.id]
                );
                resolvedOperation.is_active = true;
            }

            let operationId;
            let operationCode;
            if (resolvedOperation) {
                operationId = resolvedOperation.id;
                operationCode = resolvedOperation.operation_code;
            } else {
                const opCode = processCodeUpper || await generateNextOperationCode(client);
                const newOp = await client.query(
                    `INSERT INTO operations (operation_code, operation_name, is_active, created_by)
                     VALUES ($1, $2, true, $3) RETURNING id, operation_code`,
                    [opCode, row.process_name, req.user?.id || null]
                );
                operationId = newOp.rows[0].id;
                operationCode = newOp.rows[0].operation_code;
                newOperations.push({ code: operationCode, name: row.process_name });
            }

            if (operationCode) operationCacheByCode[String(operationCode).trim().toUpperCase()] = { id: operationId, operation_code: operationCode, is_active: true };
            operationCacheByName[processNameUpper] = { id: operationId, operation_code: operationCode, is_active: true };

            const inserted = await client.query(
                `INSERT INTO product_processes
                 (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds,
                  manpower_required, is_active, created_by)
                 VALUES ($1, $2, $3, $4, $5, 1, false, $6)
                 RETURNING id`,
                [productId, operationId, sequenceNumber, operationSah, Math.round(row.sam_seconds), req.user?.id || null]
            );
            insertedProcessIds.push(parseInt(inserted.rows[0].id, 10));
            autoSeq++;
        }

        // Activate only the rows inserted by this upload; older rows stay inactive.
        if (insertedProcessIds.length) {
            await client.query(
                `UPDATE product_processes
                 SET is_active = true
                 WHERE id = ANY($1::int[])`,
                [insertedProcessIds]
            );
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
              AND pp.is_active = true
            ORDER BY pp.sequence_number, pp.id
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
    const { product_code, product_name, product_description, category, buyer_name, target_qty, plan_month, line_ids } = req.body;
    const normalizedLineIds = Array.isArray(line_ids)
        ? line_ids.map((id) => parseInt(id, 10)).filter(Boolean)
        : [];
    const client = await pool.connect();
    try {
        const normalizedPlanMonth = normalizePlanMonth(plan_month);
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO products (product_code, product_name, product_description, category, buyer_name, target_qty, plan_month, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
            [product_code, product_name, product_description, category, buyer_name || null, parseInt(target_qty) || 0, normalizedPlanMonth]
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
        res.status(err.statusCode || 500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

router.put('/products/:id', async (req, res) => {
    const { id } = req.params;
    const { product_code, product_name, product_description, category, buyer_name, target_qty, plan_month, line_ids, is_active } = req.body;
    const hasLineIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'line_ids');
    const normalizedLineIds = Array.isArray(line_ids)
        ? line_ids.map((lineId) => parseInt(lineId, 10)).filter(Boolean)
        : [];
    const client = await pool.connect();
    try {
        const normalizedPlanMonth = normalizePlanMonth(plan_month);
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE products
             SET product_code = $1, product_name = $2, product_description = $3, category = $4, buyer_name = $5, target_qty = $6, plan_month = $7, is_active = $8, updated_at = NOW()
             WHERE id = $9 RETURNING *`,
            [product_code, product_name, product_description, category, buyer_name || null, parseInt(target_qty) || 0, normalizedPlanMonth, is_active, id]
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
        res.status(err.statusCode || 500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

router.delete('/products/:id', async (req, res) => {
    const { id } = req.params;
    if (!['admin', 'ie'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, error: 'Admin or IE access required' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const before = await client.query(
            `SELECT *
             FROM products
             WHERE id = $1
             LIMIT 1`,
            [id]
        );
        const product = before.rows[0];
        if (!product) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const dependencyResult = await client.query(
            `WITH product_process_ids AS (
                 SELECT id
                 FROM product_processes
                 WHERE product_id = $1
             )
             SELECT
                 (SELECT COUNT(*) FROM line_daily_plans WHERE product_id = $1) AS primary_daily_plans,
                 (SELECT COUNT(*) FROM defect_log WHERE process_id IN (SELECT id FROM product_process_ids)) AS defect_logs`,
            [id]
        );
        const dependencyRow = dependencyResult.rows[0] || {};
        const blockingDetails = {
            primary_daily_plans: parseInt(dependencyRow.primary_daily_plans || 0, 10) || 0,
            defect_logs: parseInt(dependencyRow.defect_logs || 0, 10) || 0
        };
        const hasBlockingDependencies = Object.values(blockingDetails).some(count => count > 0);
        if (hasBlockingDependencies) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'This style cannot be deleted because it is still used in production records. Remove its daily plans first.',
                details: blockingDetails
            });
        }

        await client.query(
            `UPDATE production_lines
             SET current_product_id = NULL,
                 updated_at = NOW()
             WHERE current_product_id = $1`,
            [id]
        );
        await client.query(
            `UPDATE line_daily_plans
             SET incoming_product_id = NULL,
                 incoming_target_units = 0,
                 changeover_sequence = 0,
                 updated_at = NOW()
             WHERE incoming_product_id = $1`,
            [id]
        );
        await client.query(
            `DELETE FROM line_plan_workstation_processes
             WHERE product_process_id IN (
                 SELECT id
                 FROM product_processes
                 WHERE product_id = $1
             )`,
            [id]
        );
        await client.query(
            `DELETE FROM line_ot_workstation_processes
             WHERE product_process_id IN (
                 SELECT id
                 FROM product_processes
                 WHERE product_id = $1
             )`,
            [id]
        );
        await client.query(
            `DELETE FROM line_plan_workstations
             WHERE product_id = $1`,
            [id]
        );
        await client.query(
            `DELETE FROM line_ot_plans
             WHERE product_id = $1`,
            [id]
        );
        await client.query(
            `DELETE FROM product_processes
             WHERE product_id = $1`,
            [id]
        );
        const deleteResult = await client.query(
            `DELETE FROM products
             WHERE id = $1
             RETURNING *`,
            [id]
        );
        if (!deleteResult.rowCount) {
            throw new Error('Product could not be deleted');
        }
        await client.query('COMMIT');

        await logAudit('products', product.id, 'delete', null, product, req);
        realtime.broadcast('data_change', { entity: 'products', action: 'delete', id });
        res.json({ success: true, message: 'Product deleted successfully', data: deleteResult.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
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
    const { operation_name, operation_description, operation_category } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const operationCode = await generateNextOperationCode(client);
        const result = await client.query(
            `INSERT INTO operations (operation_code, operation_name, operation_description, operation_category, is_active)
             VALUES ($1, $2, $3, $4, true) RETURNING *`,
            [operationCode, operation_name, operation_description, operation_category]
        );
        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'operations', action: 'create', id: result.rows[0].id });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
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
        // Resolve a conflict-safe sequence: use provided value if the slot is free, otherwise MAX+1
        const seqRes = await pool.query(
            `SELECT CASE
               WHEN $2::int IS NOT NULL AND NOT EXISTS (
                   SELECT 1 FROM product_processes WHERE product_id = $1 AND sequence_number = $2::int
               ) THEN $2::int
               ELSE (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM product_processes WHERE product_id = $1)
             END AS safe_seq`,
            [product_id, sequence_number || null]
        );
        const safeSeq = seqRes.rows[0].safe_seq;
        const result = await pool.query(
            `INSERT INTO product_processes
             (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds, manpower_required, is_active)
             VALUES ($1, $2, $3, $4, $5, 1, true) RETURNING *`,
            [product_id, operation_id, safeSeq, samHours, samSeconds]
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
    const { line_id, workstation_code, employee_id, work_date, line_plan_workstation_id, material_provided, is_linked, late_reason } = req.body;
    if (!line_id || !workstation_code) {
        return res.status(400).json({ success: false, error: 'line_id and workstation_code are required' });
    }
    const validLateReasons = ['linking_took_time', 'meeting', 'permission', 'other'];
    if (late_reason && !validLateReasons.includes(late_reason)) {
        return res.status(400).json({ success: false, error: 'Invalid late_reason' });
    }
    const date = work_date || new Date().toISOString().slice(0, 10);
    const matQty = (material_provided !== undefined && material_provided !== null) ? parseInt(material_provided, 10) : null;
    const linked = is_linked === true || is_linked === 'true';
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let displacedWorkstations = [];

        // Compute attendance_start when linking
        let linkedAt = null;
        let attendanceStart = null;
        if (linked && employee_id) {
            const inTime = await getSettingValue('default_in_time', '08:00');
            linkedAt = new Date();
            const nineAM = new Date(`${date}T09:00:00`);
            // linking_took_time and meeting: employee was present but scan was delayed → credit full shift
            const creditFullShift = linkedAt < nineAM || ['linking_took_time', 'meeting'].includes(late_reason);
            attendanceStart = creditFullShift
                ? new Date(`${date}T${inTime}:00`)
                : linkedAt;
        }

        if (employee_id) {
            // Read existing EWA to preserve linked state when caller doesn't explicitly link
            // (e.g. CO employee change sends no is_linked — should inherit existing link)
            const existingEwaResult = await client.query(
                `SELECT is_linked, linked_at, attendance_start, late_reason
                 FROM employee_workstation_assignments
                 WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false`,
                [line_id, date, workstation_code]
            );
            const existingEwa = existingEwaResult.rows[0];
            const effectiveLinked = linked || (existingEwa?.is_linked === true);
            const effectiveLinkedAt = linked ? linkedAt : (existingEwa?.linked_at || null);
            const effectiveAttendanceStart = linked ? attendanceStart : (existingEwa?.attendance_start || null);
            const effectiveLateReason = linked ? (late_reason || null) : (existingEwa?.late_reason || null);

            await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                lineId: line_id,
                workDate: date,
                workstationCode: workstation_code,
                isOvertime: false,
                nextEmployeeId: employee_id
            });
            const displacedResult = await clearEmployeeAssignmentConflicts(
                client, employee_id, date, false, line_id, workstation_code
            );
            displacedWorkstations = displacedResult.map(row => row.workstation_code);

            await client.query(
                `INSERT INTO employee_workstation_assignments
                   (line_id, workstation_code, employee_id, work_date, line_plan_workstation_id, is_linked, linked_at, late_reason, attendance_start)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                 DO UPDATE SET employee_id             = EXCLUDED.employee_id,
                               line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                               is_linked              = EXCLUDED.is_linked,
                               linked_at              = CASE WHEN EXCLUDED.is_linked THEN EXCLUDED.linked_at ELSE employee_workstation_assignments.linked_at END,
                               late_reason            = CASE WHEN EXCLUDED.is_linked THEN EXCLUDED.late_reason ELSE employee_workstation_assignments.late_reason END,
                               attendance_start       = CASE WHEN EXCLUDED.is_linked THEN EXCLUDED.attendance_start ELSE employee_workstation_assignments.attendance_start END,
                               assigned_at            = NOW()`,
                [line_id, workstation_code, employee_id, date, line_plan_workstation_id || null,
                 effectiveLinked, effectiveLinkedAt, effectiveLateReason, effectiveAttendanceStart]
            );
            await syncAssignmentHistoryForCurrentRow(client, {
                lineId: line_id,
                workDate: date,
                workstationCode: workstation_code,
                employeeId: employee_id,
                linePlanWorkstationId: line_plan_workstation_id || null,
                isOvertime: false,
                isLinked: effectiveLinked,
                linkedAt: effectiveLinkedAt,
                attendanceStart: effectiveAttendanceStart,
                lateReason: effectiveLateReason,
                forceCurrentHourStart: displacedWorkstations.length > 0
            });
        } else {
            await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                lineId: line_id,
                workDate: date,
                workstationCode: workstation_code,
                isOvertime: false,
                nextEmployeeId: null
            });
            await client.query(
                `DELETE FROM employee_workstation_assignments
                 WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false`,
                [line_id, date, workstation_code]
            );
        }
        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'workstation_assignments', action: 'update', line_id, workstation_code, work_date: date });
        res.json({
            success: true,
            data: {
                line_id,
                workstation_code,
                employee_id: employee_id || null,
                work_date: date,
                linked_at: linkedAt,
                attendance_start: attendanceStart,
                displaced_workstations: displacedWorkstations
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// PATCH /workstation-assignments/material — save material_provided for an existing assignment
router.patch('/workstation-assignments/material', async (req, res) => {
    const { line_id, workstation_code, material_provided, work_date } = req.body;
    if (!line_id || !workstation_code) {
        return res.status(400).json({ success: false, error: 'line_id and workstation_code are required' });
    }
    const date = work_date || new Date().toISOString().slice(0, 10);
    const qty = parseInt(material_provided, 10);
    if (isNaN(qty) || qty < 0) {
        return res.status(400).json({ success: false, error: 'material_provided must be a non-negative integer' });
    }
    try {
        const result = await pool.query(
            `UPDATE employee_workstation_assignments
             SET material_provided = COALESCE(material_provided, 0) + $1
             WHERE line_id = $2 AND work_date = $3 AND workstation_code = $4 AND is_overtime = false`,
            [qty, line_id, date, workstation_code]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'No employee assigned to this workstation. Assign an employee in the Morning section first.' });
        }
        // Refresh group WIP — find which group this workstation belongs to
        const wsGrpResult = await pool.query(
            `SELECT COALESCE(group_name, workstation_code) AS group_identifier
             FROM line_plan_workstations
             WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3
             LIMIT 1`,
            [line_id, date, workstation_code]
        );
        if (wsGrpResult.rows[0]?.group_identifier) {
            await refreshGroupWip(line_id, date, wsGrpResult.rows[0].group_identifier);
        }
        const totalResult = await pool.query(
            `SELECT COALESCE(material_provided, 0) AS material_provided
             FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false`,
            [line_id, date, workstation_code]
        );
        const totalQty = parseInt(totalResult.rows[0]?.material_provided || 0, 10);
        realtime.broadcast('data_change', { entity: 'workstation_assignments', action: 'update', line_id, workstation_code, work_date: date });
        res.json({
            success: true,
            data: {
                line_id,
                workstation_code,
                material_provided: totalQty,
                added_quantity: qty,
                work_date: date
            }
        });
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

async function syncProductProcessListFromSource(sourceProductId, targetProductId, db) {
    if (!sourceProductId || !targetProductId || String(sourceProductId) === String(targetProductId)) {
        return { copied: false, count: 0 };
    }

    const sourceProcs = await db.query(
        `SELECT operation_id, sequence_number, operation_sah, cycle_time_seconds,
                COALESCE(manpower_required, 1) AS manpower_required,
                COALESCE(osm_checked, false) AS osm_checked
         FROM product_processes
         WHERE product_id = $1 AND is_active = true
         ORDER BY sequence_number`,
        [sourceProductId]
    );

    if (!sourceProcs.rows.length) {
        throw new Error('Source product has no active process list to copy.');
    }

    await db.query(
        `UPDATE product_processes
         SET is_active = false, updated_at = NOW()
         WHERE product_id = $1 AND is_active = true`,
        [targetProductId]
    );

    const insertedIds = [];
    for (const proc of sourceProcs.rows) {
        const insertRes = await db.query(
            `INSERT INTO product_processes
               (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds, manpower_required, is_active, osm_checked)
             VALUES ($1, $2, $3, $4, $5, $6, false, $7)
             RETURNING id`,
            [
                targetProductId,
                proc.operation_id,
                proc.sequence_number,
                proc.operation_sah,
                proc.cycle_time_seconds,
                proc.manpower_required,
                proc.osm_checked
            ]
        );
        insertedIds.push(insertRes.rows[0].id);
    }

    if (insertedIds.length) {
        await db.query(
            `UPDATE product_processes
             SET is_active = true
             WHERE id = ANY($1::int[])`,
            [insertedIds]
        );
    }

    return { copied: true, count: insertedIds.length };
}

// Helper: copy a workstation plan from one date to another, optionally carrying employees too.
// Returns the from_date used, or null if no source plan was found.
// Pass client for transactional use; if client is null, uses pool (auto-commit).
// fromLineId/toLineId can differ for cross-line copies
async function copyWorkstationPlanFromDate(fromLineId, fromDate, toLineId, toDate, sourceProductId, client, options = {}) {
    const {
        targetProductId = sourceProductId,
        copyEmployees = true,
        copyChangeoverState = false,
        carriedChangeoverStartAt = null
    } = options;
    const db = client || pool;
    // Find source workstations
    const srcWs = await db.query(
        `SELECT * FROM line_plan_workstations
         WHERE line_id=$1 AND work_date=$2 AND product_id=$3
         ORDER BY workstation_number`,
        [fromLineId, fromDate, sourceProductId]
    );
    if (!srcWs.rows.length) return null;

    const wsIds = srcWs.rows.map(r => r.id);
    // Source processes (may include inactive product_processes)
    const srcLpwp = await db.query(
        `SELECT lpwp.workstation_id,
                lpwp.product_process_id,
                lpwp.sequence_in_workstation,
                COALESCE(lpwp.osm_checked, false) AS osm_checked,
                pp.operation_id,
                pp.sequence_number
         FROM line_plan_workstation_processes lpwp
         JOIN product_processes pp ON pp.id = lpwp.product_process_id
         WHERE lpwp.workstation_id = ANY($1::int[])
         ORDER BY lpwp.workstation_id, lpwp.sequence_in_workstation`,
        [wsIds]
    );

    let targetProcs = await db.query(
        `SELECT id, operation_id, sequence_number
         FROM product_processes
         WHERE product_id = $1 AND is_active = true
         ORDER BY sequence_number`,
        [targetProductId]
    );

    if (String(targetProductId) !== String(sourceProductId) && targetProcs.rows.length < srcLpwp.rows.length) {
        await syncProductProcessListFromSource(sourceProductId, targetProductId, db);
        targetProcs = await db.query(
            `SELECT id, operation_id, sequence_number
             FROM product_processes
             WHERE product_id = $1 AND is_active = true
             ORDER BY sequence_number`,
            [targetProductId]
        );
    }
    const targetByKey = new Map();
    const targetByOp = new Map();
    const targetBySequence = new Map();
    const targetIdSet = new Set();
    for (const p of targetProcs.rows) {
        targetIdSet.add(p.id);
        const key = `${p.operation_id}:${p.sequence_number}`;
        if (!targetByKey.has(key)) targetByKey.set(key, p.id);
        if (!targetByOp.has(p.operation_id)) targetByOp.set(p.operation_id, []);
        targetByOp.get(p.operation_id).push(p.id);
        if (!targetBySequence.has(p.sequence_number)) targetBySequence.set(p.sequence_number, []);
        targetBySequence.get(p.sequence_number).push(p.id);
    }
    const usedTargetProcessIds = new Set();

    const takeFirstUnused = (ids = []) => ids.find(id => !usedTargetProcessIds.has(id)) || null;

    // Fetch source employee assignments BEFORE deleting anything (cascade would wipe them on self-copy)
    const empByWsCode = {};
    if (copyEmployees) {
        const srcEmps = await db.query(
            `SELECT workstation_code, employee_id FROM employee_workstation_assignments
             WHERE line_id=$1 AND work_date=$2 AND is_overtime=false AND employee_id IS NOT NULL`,
            [fromLineId, fromDate]
        );
        for (const ea of srcEmps.rows) {
            empByWsCode[ea.workstation_code] = {
                employee_id: ea.employee_id
            };
        }
    }

    // Delete existing plan for target line+date+product (cascades to employee assignments via FK)
    await db.query(
        `DELETE FROM line_plan_workstations WHERE line_id=$1 AND work_date=$2 AND product_id=$3`,
        [toLineId, toDate, targetProductId]
    );

    let insertedProcessCount = 0;
    for (const ws of srcWs.rows) {
        const newWs = await db.query(
            `INSERT INTO line_plan_workstations
               (line_id, work_date, product_id, workstation_number, workstation_code,
                takt_time_seconds, actual_sam_seconds, workload_pct, group_name, co_employee_id,
                ws_changeover_active, ws_changeover_started_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [toLineId, toDate, targetProductId, ws.workstation_number, ws.workstation_code,
             ws.takt_time_seconds, ws.actual_sam_seconds, ws.workload_pct, ws.group_name, ws.co_employee_id || null,
             copyChangeoverState ? ws.ws_changeover_active === true : false,
             copyChangeoverState && ws.ws_changeover_active === true
                 ? (carriedChangeoverStartAt || ws.ws_changeover_started_at || null)
                 : null]
        );
        const newWsId = newWs.rows[0].id;
        const wsProcs = srcLpwp.rows.filter(r => r.workstation_id === ws.id);
        for (const proc of wsProcs) {
            const key = `${proc.operation_id}:${proc.sequence_number}`;
            let mappedId = targetByKey.get(key);
            if (mappedId && usedTargetProcessIds.has(mappedId)) mappedId = null;
            if (!mappedId) {
                mappedId = takeFirstUnused(targetBySequence.get(proc.sequence_number));
            }
            if (!mappedId) {
                mappedId = takeFirstUnused(targetByOp.get(proc.operation_id));
            }
            if (!mappedId && targetIdSet.has(proc.product_process_id) && !usedTargetProcessIds.has(proc.product_process_id)) {
                mappedId = proc.product_process_id;
            }
            if (!mappedId) continue;
            await db.query(
                `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation, osm_checked)
                 VALUES ($1, $2, $3, $4)`,
                [newWsId, mappedId, proc.sequence_in_workstation, proc.osm_checked]
            );
            usedTargetProcessIds.add(mappedId);
            insertedProcessCount += 1;
        }
        // Copy employee assignment with the new workstation ID so the display JOIN works
        const emp = copyEmployees ? empByWsCode[ws.workstation_code] : null;
        if (emp?.employee_id) {
            await clearEmployeeAssignmentConflicts(
                db,
                emp.employee_id,
                toDate,
                false,
                toLineId,
                ws.workstation_code
            );
            await db.query(
                `INSERT INTO employee_workstation_assignments
                   (line_id, work_date, workstation_code, employee_id, is_overtime, line_plan_workstation_id, is_linked)
                 VALUES ($1,$2,$3,$4,false,$5,$6)
                 ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                 DO UPDATE SET employee_id=EXCLUDED.employee_id,
                               line_plan_workstation_id=EXCLUDED.line_plan_workstation_id,
                               is_linked=EXCLUDED.is_linked,
                               assigned_at=NOW()`,
                [toLineId, toDate, ws.workstation_code, emp.employee_id, newWsId, false]
            );
        }
    }
    if (insertedProcessCount === 0) {
        throw new Error('No matching active processes found for this product. Update the style process list before copying the plan.');
    }
    return fromDate;
}

async function carryForwardMixedLineState(lineId, sourceDate, targetDate, sourcePlan, client) {
    if (!lineId || !sourceDate || !targetDate || !sourcePlan?.product_id) return null;
    const db = client || pool;
    const shiftWindow = await getShiftWindowDetails();
    const shiftStartAt = buildShiftStartTimestamp(targetDate, shiftWindow.inTime);

    await copyWorkstationPlanFromDate(lineId, sourceDate, lineId, targetDate, sourcePlan.product_id, db, {
        copyEmployees: false,
        copyChangeoverState: true,
        carriedChangeoverStartAt: shiftStartAt
    });

    if (sourcePlan.incoming_product_id) {
        const existingIncomingResult = await db.query(
            `SELECT 1
             FROM line_plan_workstations
             WHERE line_id = $1 AND work_date = $2 AND product_id = $3
             LIMIT 1`,
            [lineId, targetDate, sourcePlan.incoming_product_id]
        );
        if (existingIncomingResult.rowCount === 0) {
            await copyWorkstationPlanFromDate(lineId, sourceDate, lineId, targetDate, sourcePlan.incoming_product_id, db, {
                copyEmployees: false
            });
        }
    }

    const [
        sourcePrimaryWsResult,
        targetPrimaryWsResult,
        targetIncomingWsResult,
        sourceAssignmentsResult,
        sourceGroupWipResult,
        sourceProcessWipResult
    ] = await Promise.all([
        db.query(
            `SELECT id, workstation_code, workstation_number, group_name, ws_changeover_active
             FROM line_plan_workstations
             WHERE line_id = $1 AND work_date = $2 AND product_id = $3
             ORDER BY workstation_number, id`,
            [lineId, sourceDate, sourcePlan.product_id]
        ),
        db.query(
            `SELECT id, workstation_code, workstation_number, group_name
             FROM line_plan_workstations
             WHERE line_id = $1 AND work_date = $2 AND product_id = $3
             ORDER BY workstation_number, id`,
            [lineId, targetDate, sourcePlan.product_id]
        ),
        sourcePlan.incoming_product_id
            ? db.query(
                `SELECT id, workstation_code, workstation_number, group_name
                 FROM line_plan_workstations
                 WHERE line_id = $1 AND work_date = $2 AND product_id = $3
                 ORDER BY workstation_number, id`,
                [lineId, targetDate, sourcePlan.incoming_product_id]
            )
            : Promise.resolve({ rows: [] }),
        db.query(
            `SELECT *
             FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND is_overtime = false
             ORDER BY workstation_code, assigned_at DESC NULLS LAST, id DESC`,
            [lineId, sourceDate]
        ),
        db.query(
            `SELECT group_name, materials_in, output_qty, wip_quantity
             FROM group_wip
             WHERE line_id = $1 AND work_date = $2
             ORDER BY group_name`,
            [lineId, sourceDate]
        ),
        db.query(
            `SELECT process_id, materials_in, materials_out, wip_quantity
             FROM process_material_wip
             WHERE line_id = $1 AND work_date = $2
             ORDER BY process_id`,
            [lineId, sourceDate]
        )
    ]);

    const sourcePrimaryByCode = new Map(
        sourcePrimaryWsResult.rows.map(row => [String(row.workstation_code || ''), row])
    );
    const targetPrimaryByCode = new Map(
        targetPrimaryWsResult.rows.map(row => [String(row.workstation_code || ''), row])
    );
    const targetIncomingByCode = new Map(
        targetIncomingWsResult.rows.map(row => [String(row.workstation_code || ''), row])
    );
    const sourceAssignmentsByCode = new Map();
    for (const row of sourceAssignmentsResult.rows) {
        const key = String(row.workstation_code || '');
        if (!key || sourceAssignmentsByCode.has(key)) continue;
        sourceAssignmentsByCode.set(key, row);
    }

    const leaderByGroup = new Map();
    for (const row of [...targetPrimaryWsResult.rows, ...targetIncomingWsResult.rows]) {
        const key = String(row.group_name || row.workstation_code || '');
        if (!leaderByGroup.has(key)) {
            leaderByGroup.set(key, row);
        }
    }

    const previousStateByEmployee = new Map();
    for (const row of sourceAssignmentsResult.rows) {
        const employeeId = row.employee_id ? parseInt(row.employee_id, 10) : null;
        if (!employeeId || previousStateByEmployee.has(employeeId)) continue;
        previousStateByEmployee.set(employeeId, {
            is_linked: row.is_linked === true,
            linked_at: row.is_linked ? shiftStartAt : null,
            late_reason: row.is_linked ? (row.late_reason || null) : null,
            attendance_start: row.is_linked ? shiftStartAt : null
        });
    }

    await db.query(
        `DELETE FROM employee_workstation_assignment_history
         WHERE line_id = $1 AND work_date = $2 AND is_overtime = false`,
        [lineId, targetDate]
    );

    let anyActiveChangeover = false;
    for (const [workstationCode, sourcePrimaryWs] of sourcePrimaryByCode.entries()) {
        const sourceAssignment = sourceAssignmentsByCode.get(workstationCode);
        if (!sourceAssignment?.employee_id) continue;

        const isChangeover = !!(
            sourcePrimaryWs.ws_changeover_active === true
            && sourcePlan.incoming_product_id
            && targetIncomingByCode.has(workstationCode)
        );
        if (isChangeover) anyActiveChangeover = true;

        const targetWs = isChangeover
            ? targetIncomingByCode.get(workstationCode)
            : targetPrimaryByCode.get(workstationCode);
        if (!targetWs?.id) continue;

        const employeeId = parseInt(sourceAssignment.employee_id, 10);
        const preservedState = previousStateByEmployee.get(employeeId) || {
            is_linked: false,
            linked_at: null,
            late_reason: null,
            attendance_start: null
        };

        await clearEmployeeAssignmentConflicts(
            db,
            employeeId,
            targetDate,
            false,
            lineId,
            workstationCode
        );

        await db.query(
            `INSERT INTO employee_workstation_assignments
               (line_id, work_date, workstation_code, employee_id, is_overtime, line_plan_workstation_id,
                material_provided, is_linked, linked_at, late_reason, attendance_start)
             VALUES ($1, $2, $3, $4, false, $5, 0, $6, $7, $8, $9)
             ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
             DO UPDATE SET employee_id              = EXCLUDED.employee_id,
                           line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                           material_provided        = EXCLUDED.material_provided,
                           is_linked                = EXCLUDED.is_linked,
                           linked_at                = EXCLUDED.linked_at,
                           late_reason              = EXCLUDED.late_reason,
                           attendance_start         = EXCLUDED.attendance_start,
                           assigned_at              = NOW()`,
            [
                lineId,
                targetDate,
                workstationCode,
                employeeId,
                targetWs.id,
                preservedState.is_linked,
                preservedState.linked_at,
                preservedState.late_reason,
                preservedState.attendance_start
            ]
        );

        if (preservedState.is_linked) {
            await syncAssignmentHistoryForCurrentRow(db, {
                lineId,
                workDate: targetDate,
                workstationCode,
                employeeId,
                linePlanWorkstationId: targetWs.id,
                isOvertime: false,
                isLinked: preservedState.is_linked,
                linkedAt: preservedState.linked_at,
                attendanceStart: preservedState.attendance_start,
                lateReason: preservedState.late_reason,
                forceCurrentHourStart: true
            });
        }
    }

    for (const row of sourceGroupWipResult.rows) {
        const carriedWip = parseInt(row.wip_quantity || 0, 10) || 0;
        const groupKey = String(row.group_name || '');
        if (!groupKey || carriedWip <= 0) continue;

        const leader = leaderByGroup.get(groupKey);
        if (leader?.workstation_code) {
            await db.query(
                `UPDATE employee_workstation_assignments
                 SET material_provided = $4,
                     assigned_at = NOW()
                 WHERE line_id = $1
                   AND work_date = $2
                   AND workstation_code = $3
                   AND is_overtime = false`,
                [lineId, targetDate, leader.workstation_code, carriedWip]
            );
        }

        await db.query(
            `INSERT INTO group_wip (line_id, work_date, group_name, materials_in, output_qty, wip_quantity)
             VALUES ($1, $2, $3, $4, 0, $4)
             ON CONFLICT (line_id, work_date, group_name)
             DO UPDATE SET materials_in = EXCLUDED.materials_in,
                           output_qty = EXCLUDED.output_qty,
                           wip_quantity = EXCLUDED.wip_quantity,
                           updated_at = NOW()`,
            [lineId, targetDate, groupKey, carriedWip]
        );
    }

    for (const row of sourceProcessWipResult.rows) {
        const carriedWip = parseInt(row.wip_quantity || 0, 10) || 0;
        if (carriedWip <= 0) continue;
        await db.query(
            `INSERT INTO process_material_wip
               (line_id, process_id, work_date, materials_in, materials_out, wip_quantity)
             VALUES ($1, $2, $3, $4, 0, $4)
             ON CONFLICT (line_id, process_id, work_date)
             DO UPDATE SET materials_in = EXCLUDED.materials_in,
                           materials_out = EXCLUDED.materials_out,
                           wip_quantity = EXCLUDED.wip_quantity,
                           updated_at = NOW()`,
            [lineId, parseInt(row.process_id, 10), targetDate, carriedWip]
        );
    }

    await db.query(
        `UPDATE line_daily_plans
         SET changeover_started_at = $3,
             updated_at = NOW()
         WHERE line_id = $1 AND work_date = $2`,
        [lineId, targetDate, anyActiveChangeover ? shiftStartAt : null]
    );

    return {
        anyActiveChangeover
    };
}

async function remapProcessMaterialWipBetweenWorkstations(db, {
    lineId,
    workDate,
    fromWorkstationId,
    toWorkstationId
}) {
    const normalizedFromWsId = parseInt(fromWorkstationId, 10);
    const normalizedToWsId = parseInt(toWorkstationId, 10);
    if (!normalizedFromWsId || !normalizedToWsId) return;

    const [fromProcResult, toProcResult] = await Promise.all([
        db.query(
            `SELECT lpwp.product_process_id,
                    lpwp.sequence_in_workstation,
                    pp.operation_id,
                    pp.sequence_number
             FROM line_plan_workstation_processes lpwp
             JOIN product_processes pp ON pp.id = lpwp.product_process_id
             WHERE lpwp.workstation_id = $1
             ORDER BY lpwp.sequence_in_workstation, lpwp.product_process_id`,
            [normalizedFromWsId]
        ),
        db.query(
            `SELECT lpwp.product_process_id,
                    lpwp.sequence_in_workstation,
                    pp.operation_id,
                    pp.sequence_number
             FROM line_plan_workstation_processes lpwp
             JOIN product_processes pp ON pp.id = lpwp.product_process_id
             WHERE lpwp.workstation_id = $1
             ORDER BY lpwp.sequence_in_workstation, lpwp.product_process_id`,
            [normalizedToWsId]
        )
    ]);

    if (!fromProcResult.rows.length || !toProcResult.rows.length) return;

    const toByKey = new Map();
    const toBySequence = new Map();
    for (const row of toProcResult.rows) {
        const key = `${row.operation_id}:${row.sequence_number}`;
        if (!toByKey.has(key)) toByKey.set(key, row.product_process_id);
        if (!toBySequence.has(row.sequence_in_workstation)) {
            toBySequence.set(row.sequence_in_workstation, row.product_process_id);
        }
    }

    for (const row of fromProcResult.rows) {
        const fromProcessId = parseInt(row.product_process_id, 10);
        if (!fromProcessId) continue;
        const key = `${row.operation_id}:${row.sequence_number}`;
        const toProcessId = parseInt(
            toByKey.get(key) || toBySequence.get(row.sequence_in_workstation) || 0,
            10
        ) || null;
        if (!toProcessId || toProcessId === fromProcessId) continue;

        const wipResult = await db.query(
            `SELECT materials_in, materials_out, wip_quantity
             FROM process_material_wip
             WHERE line_id = $1 AND process_id = $2 AND work_date = $3
             LIMIT 1`,
            [lineId, fromProcessId, workDate]
        );
        const wipRow = wipResult.rows[0];
        if (!wipRow) continue;

        await db.query(
            `INSERT INTO process_material_wip
               (line_id, process_id, work_date, materials_in, materials_out, wip_quantity)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (line_id, process_id, work_date)
             DO UPDATE SET materials_in = process_material_wip.materials_in + EXCLUDED.materials_in,
                           materials_out = process_material_wip.materials_out + EXCLUDED.materials_out,
                           wip_quantity = process_material_wip.wip_quantity + EXCLUDED.wip_quantity,
                           updated_at = NOW()`,
            [
                lineId,
                toProcessId,
                workDate,
                parseInt(wipRow.materials_in || 0, 10) || 0,
                parseInt(wipRow.materials_out || 0, 10) || 0,
                parseInt(wipRow.wip_quantity || 0, 10) || 0
            ]
        );

        await db.query(
            `DELETE FROM process_material_wip
             WHERE line_id = $1 AND process_id = $2 AND work_date = $3`,
            [lineId, fromProcessId, workDate]
        );
    }
}

// Helper: find the most recent past date that has a workstation plan for line+product
async function findLatestWorkstationPlanDate(lineId, productId, beforeDate) {
    const res = await pool.query(
        `SELECT DISTINCT work_date FROM line_plan_workstations
         WHERE line_id=$1 AND product_id=$2 AND work_date < $3
         ORDER BY work_date DESC LIMIT 1`,
        [lineId, productId, beforeDate]
    );
    return res.rows[0]?.work_date || null;
}

async function ensureWorkstationPlanCarryForward(lineId, workDate, productId, client = null) {
    if (!lineId || !workDate || !productId) return null;
    const db = client || pool;
    const existing = await db.query(
        `SELECT 1
         FROM line_plan_workstations
         WHERE line_id = $1 AND work_date = $2 AND product_id = $3
         LIMIT 1`,
        [lineId, workDate, productId]
    );
    if (existing.rowCount > 0) return null;

    const sourceDate = await findLatestWorkstationPlanDate(lineId, productId, workDate);
    if (!sourceDate) return null;

    await copyWorkstationPlanFromDate(lineId, sourceDate, lineId, workDate, productId, client);
    return sourceDate;
}

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

        // Get working seconds from settings (subtract lunch break)
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const lunchMinsGen = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10);
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingSeconds = ((outH * 60 + outM) - (inH * 60 + inM) - lunchMinsGen) * 60;
        const taktTime = workingSeconds / plan.target_units;

        // Get product processes ordered by sequence
        const procResult = await pool.query(
            `SELECT pp.id, pp.sequence_number, pp.operation_sah, pp.operation_id,
                    pp.osm_checked,
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
                    `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation, osm_checked)
                     VALUES ($1, $2, $3, $4)`,
                    [wsRow.id, ws.processes[i].id, i + 1, ws.processes[i].osm_checked || false]
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
        const planResult = await pool.query(
            `SELECT product_id
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [lineId, date]
        );
        const planProductId = planResult.rows[0]?.product_id || null;
        if (planProductId) {
            await ensureWorkstationPlanCarryForward(lineId, date, planProductId);
        }

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

// PUT /workstation-plan/processes/:lpwpId/osm — toggle osm_checked flag on a workstation process
router.put('/workstation-plan/processes/:lpwpId/osm', async (req, res) => {
    const { lpwpId } = req.params;
    const { osm_checked } = req.body;
    if (typeof osm_checked !== 'boolean') {
        return res.status(400).json({ success: false, error: 'osm_checked (boolean) is required' });
    }
    try {
        // Resolve product_process_id from this lpwp
        const ppRes = await pool.query(
            `SELECT product_process_id FROM line_plan_workstation_processes WHERE id = $1`,
            [lpwpId]
        );
        if (!ppRes.rows[0]) return res.status(404).json({ success: false, error: 'Process mapping not found' });
        const ppId = ppRes.rows[0].product_process_id;

        // Persist at product level so it applies to all days/plans for this product
        await pool.query(`UPDATE product_processes SET osm_checked = $1 WHERE id = $2`, [osm_checked, ppId]);

        // Propagate to all line_plan_workstation_processes rows sharing this product_process
        const result = await pool.query(
            `UPDATE line_plan_workstation_processes SET osm_checked = $1 WHERE product_process_id = $2 RETURNING id`,
            [osm_checked, ppId]
        );
        res.json({ success: true, updated_count: result.rows.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /supervisor/changeover/co-assign — supervisor sets co_employee_id for a workstation
router.patch('/supervisor/changeover/co-assign', async (req, res) => {
    const { line_id, work_date, workstation_code, employee_id } = req.body;
    if (!line_id || !work_date || !workstation_code) {
        return res.status(400).json({ success: false, error: 'line_id, work_date, workstation_code required' });
    }
    try {
        const result = await pool.query(
            `UPDATE line_plan_workstations SET co_employee_id = $1, updated_at = NOW()
             WHERE line_id = $2 AND work_date = $3 AND workstation_code = $4
             RETURNING id`,
            [employee_id || null, line_id, work_date, workstation_code]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, error: 'Workstation plan row not found' });
        }
        realtime.broadcast('data_change', { type: 'co_employee_update', workstation_code, line_id, work_date });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /workstation-plan/workstations/:wsId/co-employee — IE pre-assigns changeover employee for a workstation
router.put('/workstation-plan/workstations/:wsId/co-employee', async (req, res) => {
    const { wsId } = req.params;
    const { co_employee_id } = req.body;
    try {
        const result = await pool.query(
            `UPDATE line_plan_workstations SET co_employee_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
            [co_employee_id || null, wsId]
        );
        if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Workstation not found' });
        realtime.broadcast('data_change', { type: 'co_employee_update', workstation_id: parseInt(wsId) });
        res.json({ success: true });
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
            const pidResult = await pool.query('SELECT operation_sah, osm_checked FROM product_processes WHERE id = $1', [process_ids[i]]);
            if (pidResult.rows[0]) totalSam += parseFloat(pidResult.rows[0].operation_sah || 0) * 3600;
            await pool.query(
                `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation, osm_checked)
                 VALUES ($1, $2, $3, $4)`,
                [wsId, process_ids[i], i + 1, pidResult.rows[0] ? (pidResult.rows[0].osm_checked || false) : false]
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

// PUT /workstation-plan/workstations/:wsId/takt — update takt time + recalculate workload for a single workstation
router.put('/workstation-plan/workstations/:wsId/takt', async (req, res) => {
    const { wsId } = req.params;
    try {
        const wsResult = await pool.query('SELECT * FROM line_plan_workstations WHERE id = $1', [wsId]);
        const ws = wsResult.rows[0];
        if (!ws) return res.status(404).json({ success: false, error: 'Workstation not found' });
        const shiftWindow = await getShiftWindowDetails();
        const workingSeconds = parseFloat(req.body.working_seconds || 0) > 0
            ? parseFloat(req.body.working_seconds)
            : shiftWindow.workingSeconds;
        const requestedTarget = parseFloat(req.body.target_units);
        const requestedTakt = parseFloat(req.body.takt_time_seconds);
        const takt = requestedTarget > 0
            ? computeTaktTimeFromTarget(requestedTarget, workingSeconds)
            : requestedTakt;
        if (!(takt > 0)) {
            return res.status(400).json({ success: false, error: 'Provide a positive takt_time_seconds or target_units value' });
        }
        const sam = parseFloat(ws.actual_sam_seconds || 0);
        const workload = sam > 0 ? Math.round((sam / takt) * 10000) / 100 : 0;
        const targetUnits = computeTargetUnitsFromTakt(takt, workingSeconds);
        const hourlyTargetUnits = computeHourlyTargetFromTakt(takt);
        await pool.query(
            'UPDATE line_plan_workstations SET takt_time_seconds = $1, workload_pct = $2, updated_at = NOW() WHERE id = $3',
            [takt, workload, wsId]
        );
        const otUpdateResult = await pool.query(
            `UPDATE line_ot_workstations
             SET source_hourly_target = $1,
                 updated_at = NOW()
             WHERE source_line_plan_workstation_id = $2`,
            [roundMetric(hourlyTargetUnits, 2), wsId]
        );
        if ((otUpdateResult.rowCount || 0) > 0) {
            const impactedOtPlans = await pool.query(
                `SELECT DISTINCT ot_plan_id
                 FROM line_ot_workstations
                 WHERE source_line_plan_workstation_id = $1`,
                [wsId]
            );
            for (const row of impactedOtPlans.rows) {
                await recalculateOtPlanTarget(pool, row.ot_plan_id);
            }
            realtime.broadcast('data_change', { entity: 'ot_plan', action: 'update', line_id: ws.line_id, work_date: ws.work_date });
        }
        realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'update', line_id: ws.line_id, work_date: ws.work_date });
        res.json({
            success: true,
            takt_time_seconds: roundMetric(takt, 2),
            target_units: roundMetric(targetUnits, 2),
            hourly_target_units: roundMetric(hourlyTargetUnits, 2),
            workload_pct: workload
        });
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
                    ldp.overtime_minutes, ldp.overtime_target, ldp.ot_enabled,
                    ldp.incoming_product_id, ldp.incoming_target_units, ldp.changeover_sequence,
                    ldp.is_locked,
                    p.product_code, p.product_name
             FROM line_daily_plans ldp
             JOIN products p ON ldp.product_id = p.id
             WHERE ldp.line_id = $1 AND ldp.work_date = $2`,
            [lineId, date]
        );

        let overtime_minutes = 0, overtime_target = 0, ot_enabled = false;
        let plan_id = null, incoming_product_id = null, incoming_target_units = 0;
        let changeover_sequence = 0, is_locked = false;
        if (planResult.rows[0]) {
            ({ product_id, target_units, product_code, product_name,
               overtime_minutes, overtime_target, ot_enabled, plan_id,
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
            'SELECT line_code, line_name, line_leader FROM production_lines WHERE id = $1', [lineId]
        );
        const lineInfo = lineInfoResult.rows[0] || {};

        if (!planResult.rows[0]) {
            return res.status(400).json({
                success: false,
                error: `Save the daily plan first before opening line details for ${lineInfo.line_code || 'this line'} on ${date}`
            });
        }

        if (planResult.rows[0] && !overrideProductId) {
            await ensureWorkstationPlanCarryForward(lineId, date, product_id);
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
                    ws_info.lpw_id, ws_info.lpwp_id, ws_info.osm_checked,
                    ws_info.group_name, ws_info.workstation_code,
                    ws_info.takt_time_seconds,
                    ws_info.workload_pct, ws_info.actual_sam_seconds,
                    ws_info.is_ot_skipped,
                    ws_info.co_employee_id,
                    e_co.emp_code AS co_emp_code, e_co.emp_name AS co_emp_name,
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
                        lpwp.id AS lpwp_id, lpwp.osm_checked,
                        lpw.id AS lpw_id, lpw.group_name, lpw.workstation_code,
                        lpw.takt_time_seconds,
                        lpw.workload_pct, lpw.actual_sam_seconds,
                        lpw.is_ot_skipped, lpw.co_employee_id
                 FROM line_plan_workstations lpw
                 JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
                 WHERE lpw.line_id = $1 AND lpw.work_date = $2 AND lpw.product_id = $3
                 ORDER BY lpwp.product_process_id, lpw.id
             ) ws_info ON ws_info.product_process_id = pp.id
             LEFT JOIN employees e_co ON e_co.id = ws_info.co_employee_id
             LEFT JOIN employee_workstation_assignments ewa
                 ON (ewa.line_plan_workstation_id = ws_info.lpw_id OR (ewa.workstation_code = ws_info.workstation_code AND ewa.line_id = $1 AND ewa.work_date = $2))
                 AND ewa.line_id = $1 AND ewa.work_date = $2 AND ewa.is_overtime = false
             LEFT JOIN employees e ON ewa.employee_id = e.id
             LEFT JOIN employee_workstation_assignments ewa_ot
                 ON (ewa_ot.line_plan_workstation_id = ws_info.lpw_id OR (ewa_ot.workstation_code = ws_info.workstation_code AND ewa_ot.line_id = $1 AND ewa_ot.work_date = $2))
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
            `SELECT ewa.employee_id,
                    ewa.line_id,
                    ewa.workstation_code,
                    ewa.is_overtime,
                    pl.line_code,
                    pl.line_name
             FROM employee_workstation_assignments ewa
             LEFT JOIN production_lines pl ON pl.id = ewa.line_id
             WHERE ewa.work_date = $1 AND ewa.employee_id IS NOT NULL`,
            [date]
        );

        // When viewing a changeover product, remap co_employee_id → employee_id so the
        // IE panel picker shows and saves the changeover-specific employee assignment.
        const isChangeoverView = overrideProductId && overrideProductId !== (planResult.rows[0]?.product_id ?? null);
        const processes = isChangeoverView
            ? processResult.rows.map(row => ({
                ...row,
                employee_id: row.co_employee_id ?? null,
                emp_code:    row.co_emp_code ?? null,
                emp_name:    row.co_emp_name ?? null,
            }))
            : processResult.rows;

        res.json({
            success: true,
            data: {
                line: lineInfo,
                processes,
                employees: empResult.rows,
                all_assignments: allAssignmentsResult.rows,
                products: productsResult.rows,
                global_takt_time_seconds: taktSecs,
                takt_time_seconds: taktSecs,
                target_units: queryTarget,
                overtime_minutes,
                overtime_target,
                ot_enabled,
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

// GET /lines/:lineId/downtime-summary?date= — IE downtime report based on shortfall reasons
router.get('/lines/:lineId/downtime-summary', async (req, res) => {
    const { lineId } = req.params;
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ success: false, error: 'date is required' });
    }
    try {
        const planRes = await pool.query(
            `SELECT product_id, target_units
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [lineId, date]
        );
        const plan = planRes.rows[0];
        if (!plan) {
            return res.json({ success: true, data: {
                total_occurrences: 0,
                minutes_per_occurrence_default: 60,
                per_hour_target: 0,
                by_reason: [],
                by_process: [],
                by_hour: [],
                details: [],
                hours: REPORT_WORK_HOURS
            }});
        }

        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const lunchMins = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10);
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60) - lunchMins / 60;
        const perHourTarget = (workingHours > 0 && plan.target_units > 0)
            ? (plan.target_units / workingHours)
            : 0;

        if (perHourTarget <= 0) {
            return res.json({ success: true, data: {
                total_occurrences: 0,
                minutes_per_occurrence_default: 60,
                per_hour_target: 0,
                by_reason: [],
                by_process: [],
                by_hour: [],
                details: [],
                hours: REPORT_WORK_HOURS
            }});
        }

        const rowsRes = await pool.query(
            `SELECT lph.process_id, lph.hour_slot, COALESCE(lph.quantity, 0) AS quantity, lph.shortfall_reason,
                    pp.sequence_number, o.operation_code, o.operation_name
             FROM line_process_hourly_progress lph
             JOIN product_processes pp ON pp.id = lph.process_id
             JOIN operations o ON o.id = pp.operation_id
             WHERE lph.line_id = $1 AND lph.work_date = $2
               AND pp.product_id = $3
               AND lph.shortfall_reason IS NOT NULL AND lph.shortfall_reason <> ''
               AND COALESCE(lph.quantity, 0)::numeric < $4::numeric
             ORDER BY lph.hour_slot, pp.sequence_number`,
            [lineId, date, plan.product_id, perHourTarget]
        );

        const byReason = new Map();
        const byProcess = new Map();
        const byHour = new Map();

        const details = rowsRes.rows.map(r => {
            const reason = r.shortfall_reason || '';
            byReason.set(reason, (byReason.get(reason) || 0) + 1);
            const pid = parseInt(r.process_id, 10);
            if (!byProcess.has(pid)) {
                byProcess.set(pid, {
                    process_id: pid,
                    operation_code: r.operation_code,
                    operation_name: r.operation_name,
                    count: 0
                });
            }
            byProcess.get(pid).count += 1;
            const hour = parseInt(r.hour_slot, 10);
            byHour.set(hour, (byHour.get(hour) || 0) + 1);

            return {
                process_id: pid,
                operation_code: r.operation_code,
                operation_name: r.operation_name,
                hour_slot: hour,
                quantity: parseFloat(r.quantity || 0),
                reason
            };
        });

        const by_reason = [...byReason.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count);
        const by_process = [...byProcess.values()]
            .sort((a, b) => b.count - a.count);
        const by_hour = [...byHour.entries()]
            .map(([hour_slot, count]) => ({ hour_slot, count }))
            .sort((a, b) => a.hour_slot - b.hour_slot);

        res.json({ success: true, data: {
            total_occurrences: details.length,
            minutes_per_occurrence_default: 60,
            per_hour_target: Math.round(perHourTarget * 100) / 100,
            by_reason,
            by_process,
            by_hour,
            details,
            hours: REPORT_WORK_HOURS
        }});
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
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const planResult = await client.query(
            `SELECT target_units, product_id FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [lineId, work_date]
        );
        // Prefer explicit body values (handles changeover product saves); fall back to DB primary values
        const product_id = bodyProductId ? parseInt(bodyProductId, 10) : (planResult.rows[0]?.product_id ?? null);
        const target_units = bodyTarget ? parseInt(bodyTarget, 10) : (planResult.rows[0]?.target_units ?? 0);
        // Detect if this is a changeover plan save (product differs from primary plan product)
        const primaryProductId = planResult.rows[0]?.product_id ?? null;
        const isChangeoverSave = product_id && primaryProductId && product_id !== primaryProductId;
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
        const samResult = await client.query(
            `SELECT pp.id, pp.sequence_number, pp.operation_sah, o.operation_code
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             WHERE pp.id = ANY($1::int[])`,
            [processIds]
        );
        const samMap = new Map(samResult.rows.map(r => [parseInt(r.id), parseFloat(r.operation_sah || 0)]));
        const seqMap = new Map(samResult.rows.map(r => [parseInt(r.id), { seq: r.sequence_number, code: r.operation_code }]));

        // Build osm_checked map: process_id → boolean
        const osmCheckedMap = new Map();
        rows.forEach(row => {
            if (row.process_id) osmCheckedMap.set(parseInt(row.process_id, 10), !!row.osm_checked);
        });

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
                    takt_time_seconds: (parseFloat(row.takt_time_seconds) || 0) > 0 ? parseFloat(row.takt_time_seconds) : null,
                    processes: []
                });
            }
            const ws = wsMap.get(wsCode);
            ws.processes.push(parseInt(row.process_id, 10));
            if (!ws.employee_id && row.employee_id) ws.employee_id = parseInt(row.employee_id, 10);
            if (!ws.group_name && row.group_name) ws.group_name = (row.group_name || '').trim() || null;
            if (!ws.takt_time_seconds && (parseFloat(row.takt_time_seconds) || 0) > 0) {
                ws.takt_time_seconds = parseFloat(row.takt_time_seconds);
            }
        });

        const assignmentStateByEmployee = !isChangeoverSave
            ? await getRegularAssignmentStateByEmployee(client, work_date)
            : new Map();

        if (!isChangeoverSave) {
            // Only remove EWA rows for workstations that are no longer present in this plan
            // and have not yet been linked by the supervisor (is_linked = false).
            // Already-linked assignments on other workstations are never wiped by an IE plan save.
            const planWsCodes = Array.from(wsMap.keys());
            if (planWsCodes.length > 0) {
                await client.query(
                    `DELETE FROM employee_workstation_assignments
                     WHERE line_id = $1 AND work_date = $2 AND is_overtime = false
                       AND is_linked = false AND workstation_code != ALL($3::text[])`,
                    [lineId, work_date, planWsCodes]
                );
            } else {
                await client.query(
                    `DELETE FROM employee_workstation_assignments
                     WHERE line_id = $1 AND work_date = $2 AND is_overtime = false AND is_linked = false`,
                    [lineId, work_date]
                );
            }
        }

        if (!isChangeoverSave) {
            await detachRegularAssignmentsFromPlan(client, lineId, work_date, product_id);
        }

        // Delete existing plan for this line+date+product only
        await client.query(`DELETE FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2 AND product_id = $3`, [lineId, work_date, product_id]);

        const wsEntries = Array.from(wsMap.values());
        if (!isChangeoverSave) {
            const duplicateEmployeeIds = collectDuplicateEmployeeIds(wsEntries, ws => ws.employee_id);
            if (duplicateEmployeeIds.length) {
                throw new Error(`Each employee can be assigned to only one workstation. Duplicate employee IDs: ${duplicateEmployeeIds.join(', ')}`);
            }
        }
        let wsNumber = 1;
        for (const ws of wsEntries) {
            // De-duplicate process IDs (guard against frontend sending duplicates)
            ws.processes = [...new Set(ws.processes)];
            const actualSam = ws.processes.reduce((sum, pid) => sum + (samMap.get(pid) || 0) * 3600, 0);
            const workstationTaktSecs = (parseFloat(ws.takt_time_seconds) || 0) > 0
                ? parseFloat(ws.takt_time_seconds)
                : taktSecs;
            const workloadPct = workstationTaktSecs > 0 ? (actualSam / workstationTaktSecs) * 100 : 0;
            const wsResult = await client.query(
                `INSERT INTO line_plan_workstations
                 (line_id, work_date, product_id, workstation_number, workstation_code, group_name,
                  takt_time_seconds, actual_sam_seconds, workload_pct)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                [lineId, work_date, product_id, wsNumber++, ws.workstation_code, ws.group_name,
                 Math.round(workstationTaktSecs * 100) / 100,
                 Math.round(actualSam * 100) / 100,
                 Math.round(workloadPct * 100) / 100]
            );
            const wsId = wsResult.rows[0].id;
            for (let i = 0; i < ws.processes.length; i++) {
                const pid = ws.processes[i];
                const osmChecked = osmCheckedMap.get(pid) || false;
                await client.query(
                    `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation, osm_checked)
                     VALUES ($1, $2, $3, $4)`,
                    [wsId, pid, i + 1, osmChecked]
                );
            }
            if (ws.employee_id) {
                if (isChangeoverSave) {
                    // Changeover plan: store IE-suggested employee on the workstation row (co_employee_id)
                    // rather than EWA, so it doesn't overwrite the primary plan's live employee assignments.
                    await client.query(
                        `UPDATE line_plan_workstations SET co_employee_id = $1 WHERE id = $2`,
                        [ws.employee_id, wsId]
                    );
                } else {
                    // Primary plan: write to employee_workstation_assignments (the live assignment table)
                    const preservedState = getPreservedRegularAssignmentState(assignmentStateByEmployee, ws.employee_id);
                    await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                        lineId,
                        workDate: work_date,
                        workstationCode: ws.workstation_code,
                        isOvertime: false,
                        nextEmployeeId: ws.employee_id
                    });
                    await clearEmployeeAssignmentConflicts(
                        client,
                        ws.employee_id,
                        work_date,
                        false,
                        lineId,
                        ws.workstation_code
                    );
                    await client.query(
                        `INSERT INTO employee_workstation_assignments
                         (line_id, work_date, workstation_code, employee_id, line_plan_workstation_id, is_overtime,
                          is_linked, linked_at, late_reason, attendance_start)
                         VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9)
                         ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                         DO UPDATE SET employee_id              = EXCLUDED.employee_id,
                                       line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                       assigned_at              = NOW(),
                                       is_linked                = EXCLUDED.is_linked,
                                       linked_at                = EXCLUDED.linked_at,
                                       late_reason              = EXCLUDED.late_reason,
                                       attendance_start         = EXCLUDED.attendance_start`,
                        [
                            lineId,
                            work_date,
                            ws.workstation_code,
                            ws.employee_id,
                            wsId,
                            preservedState.is_linked,
                            preservedState.linked_at,
                            preservedState.late_reason,
                            preservedState.attendance_start
                        ]
                    );
                    await syncAssignmentHistoryForCurrentRow(client, {
                        lineId,
                        workDate: work_date,
                        workstationCode: ws.workstation_code,
                        employeeId: ws.employee_id,
                        isOvertime: false,
                        isLinked: preservedState.is_linked,
                        linkedAt: preservedState.linked_at,
                        attendanceStart: preservedState.attendance_start,
                        lateReason: preservedState.late_reason,
                        forceCurrentHourStart: preservedState.is_linked
                    });
                }
            } else if (!isChangeoverSave) {
                // No employee planned for this workstation — clear any unlinked EWA for it.
                // Linked (supervisor-confirmed) rows are left untouched.
                await client.query(
                    `DELETE FROM employee_workstation_assignments
                     WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3
                       AND is_overtime = false AND is_linked = false`,
                    [lineId, work_date, ws.workstation_code]
                );
            }
        }

        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'workstation_plan', action: 'saved', line_id: lineId, work_date });
        res.json({ success: true, message: `Saved ${wsEntries.length} workstation(s)` });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
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
    const duplicateEmployeeIds = collectDuplicateEmployeeIds(
        assignments.filter(a => !(isOT && !!a.is_skipped)),
        a => a.employee_id
    );
    if (duplicateEmployeeIds.length) {
        return res.status(400).json({
            success: false,
            error: `Each employee can be assigned to only one workstation. Duplicate employee IDs: ${duplicateEmployeeIds.join(', ')}`
        });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const assignmentStateByEmployee = !isOT
            ? await getRegularAssignmentStateByEmployee(client, work_date)
            : new Map();
        for (const a of assignments) {
            const wsCode = (a.workstation_code || '').trim();
            if (!wsCode) continue;
            const empId = a.employee_id ? parseInt(a.employee_id, 10) : null;
            const isSkipped = isOT && !!a.is_skipped; // only relevant for OT

            // Update is_ot_skipped on the workstation plan row (OT only)
            if (isOT) {
                await client.query(
                    `UPDATE line_plan_workstations SET is_ot_skipped = $1
                     WHERE line_id = $2 AND work_date = $3 AND workstation_code = $4`,
                    [isSkipped, lineId, work_date, wsCode]
                );
            }

            if (empId && !isSkipped) {
                // Resolve the line_plan_workstation_id for this workstation
                const lpwResult = await client.query(
                    `SELECT id FROM line_plan_workstations
                     WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3
                     ORDER BY id LIMIT 1`,
                    [lineId, work_date, wsCode]
                );
                const lpwId = lpwResult.rows[0]?.id || null;
                if (!isOT) {
                    await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                        lineId,
                        workDate: work_date,
                        workstationCode: wsCode,
                        isOvertime: false,
                        nextEmployeeId: empId
                    });
                }
                await clearEmployeeAssignmentConflicts(
                    client,
                    empId,
                    work_date,
                    isOT,
                    lineId,
                    wsCode
                );
                await client.query(
                    `INSERT INTO employee_workstation_assignments
                     (line_id, work_date, workstation_code, employee_id, line_plan_workstation_id, is_overtime)
                     VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                     DO UPDATE SET employee_id = EXCLUDED.employee_id,
                                   line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                   assigned_at = NOW()`,
                    [lineId, work_date, wsCode, empId, lpwId, isOT]
                );
                if (!isOT) {
                    const preservedState = getPreservedRegularAssignmentState(assignmentStateByEmployee, empId);
                    await syncAssignmentHistoryForCurrentRow(client, {
                        lineId,
                        workDate: work_date,
                        workstationCode: wsCode,
                        employeeId: empId,
                        isOvertime: false,
                        isLinked: preservedState.is_linked,
                        linkedAt: preservedState.linked_at,
                        attendanceStart: preservedState.attendance_start,
                        lateReason: preservedState.late_reason,
                        forceCurrentHourStart: preservedState.is_linked
                    });
                }
            } else {
                // Clear assignment (skipped or no employee)
                if (!isOT) {
                    await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                        lineId,
                        workDate: work_date,
                        workstationCode: wsCode,
                        isOvertime: false,
                        nextEmployeeId: null
                    });
                }
                await client.query(
                    `DELETE FROM employee_workstation_assignments
                     WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = $4`,
                    [lineId, work_date, wsCode, isOT]
                );
            }
        }
        await client.query('COMMIT');
        realtime.broadcast('data_change', { entity: 'employee_assignments', action: 'saved', line_id: lineId, work_date, is_overtime: isOT });
        res.json({ success: true, message: `${isOT ? 'OT' : 'Regular'} employee assignments saved` });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
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
                    pp.osm_checked,
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

        const assignmentStateByEmployee = await getRegularAssignmentStateByEmployee(client, workDate);
        await detachRegularAssignmentsFromPlan(client, lineId, workDate, productId);

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

            const seenPpIdsWs = new Set();
            let seqIdx = 1;
            for (let i = 0; i < validRows.length; i++) {
                if (seenPpIdsWs.has(validRows[i].pp.id)) continue;
                seenPpIdsWs.add(validRows[i].pp.id);
                await client.query(
                    `INSERT INTO line_plan_workstation_processes (workstation_id, product_process_id, sequence_in_workstation, osm_checked)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT ON CONSTRAINT line_plan_workstation_process_workstation_id_product_proces_key DO NOTHING`,
                    [wsRow.id, validRows[i].pp.id, seqIdx++, validRows[i].pp.osm_checked || false]
                );
            }

            // Assign employee if provided
            const empCode = rows[0].employee_code;
            if (empCode) {
                const empResult = await client.query(
                    'SELECT id FROM employees WHERE UPPER(emp_code) = UPPER($1) AND is_active = true', [empCode]
                );
                if (empResult.rows[0]) {
                    const preservedState = getPreservedRegularAssignmentState(
                        assignmentStateByEmployee,
                        empResult.rows[0].id
                    );
                    await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                        lineId,
                        workDate,
                        workstationCode: wsCode,
                        isOvertime: false,
                        nextEmployeeId: empResult.rows[0].id
                    });
                    await clearEmployeeAssignmentConflicts(
                        client,
                        empResult.rows[0].id,
                        workDate,
                        false,
                        lineId,
                        wsCode
                    );
                    await client.query(
                        `INSERT INTO employee_workstation_assignments
                         (line_id, workstation_code, employee_id, work_date, line_plan_workstation_id,
                          is_linked, linked_at, late_reason, attendance_start)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                         ON CONFLICT (line_id, work_date, workstation_code)
                         DO UPDATE SET employee_id = EXCLUDED.employee_id,
                                       line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                       is_linked = EXCLUDED.is_linked,
                                       linked_at = EXCLUDED.linked_at,
                                       late_reason = EXCLUDED.late_reason,
                                       attendance_start = EXCLUDED.attendance_start,
                                       assigned_at = NOW()`,
                        [
                            lineId,
                            wsCode,
                            empResult.rows[0].id,
                            workDate,
                            wsRow.id,
                            preservedState.is_linked,
                            preservedState.linked_at,
                            preservedState.late_reason,
                            preservedState.attendance_start
                        ]
                    );
                    await syncAssignmentHistoryForCurrentRow(client, {
                        lineId,
                        workDate,
                        workstationCode: wsCode,
                        employeeId: empResult.rows[0].id,
                        isOvertime: false,
                        isLinked: preservedState.is_linked,
                        linkedAt: preservedState.linked_at,
                        attendanceStart: preservedState.attendance_start,
                        lateReason: preservedState.late_reason,
                        forceCurrentHourStart: preservedState.is_linked
                    });
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

async function generateLinePlanTemplate({ prefill = null } = {}) {
    // Fetch operations, employees, and working hours for dropdown lists / takt time
    const [opsResult, empsResult, settingsResult] = await Promise.all([
        pool.query(`SELECT operation_code, operation_name FROM operations WHERE is_active = true ORDER BY operation_code`),
        pool.query(`SELECT emp_code, emp_name FROM employees WHERE is_active = true ORDER BY emp_name`),
        pool.query(`SELECT key, value FROM app_settings WHERE key IN ('default_in_time','default_out_time','lunch_break_minutes')`)
    ]);
    const operations = opsResult.rows;
    const employees  = empsResult.rows;
    const sm = {};
    settingsResult.rows.forEach(r => { sm[r.key] = r.value; });
    let defaultWorkingSecs = 8 * 3600;
    if (sm.default_in_time && sm.default_out_time) {
        const [inH, inM]   = sm.default_in_time.split(':').map(Number);
        const [outH, outM] = sm.default_out_time.split(':').map(Number);
        const lunchMins = parseInt(sm.lunch_break_minutes || '0', 10) || 0;
        defaultWorkingSecs = Math.max(0, ((outH * 60 + outM) - (inH * 60 + inM) - lunchMins) * 60);
    }

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Line Plan');
    const fillToday = new Date().toISOString().slice(0, 10);
        ws.columns = [
            { width: 14 }, // A: GROUP
            { width: 10 }, // B: OSM
            { width: 16 }, // C: WORKSTATION
            { width: 18 }, // D: OP CODE (auto)
            { width: 36 }, // E: SELECT OPERATION ▼
            { width: 16 }, // F: PROCESS TIME (s)
            { width: 16 }, // G: CYCLE TIME (s)
            { width: 14 }, // H: TAKT TIME (s)   ← NEW
            { width: 13 }, // I: WORKLOAD %       ← NEW
            { width: 12 }, // J: SAH
            { width: 18 }, // K: EMP CODE (auto)
            { width: 28 }, // L: SELECT EMPLOYEE ▼
        ];

        // ── Styles ──────────────────────────────────────────────────────────────
        const boldFont   = { bold: true, size: 11 };
        const labelFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        const greenHdr   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D6F42' } }; // col header auto/calc
        const blueHdr    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }; // col header user input
        const inputFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; // white  = user input
        const autoFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBEBEB' } }; // gray   = formula/auto
        const linkFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }; // green  = WS-linked auto
        const borderAll  = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
        const today = fillToday;

        // ── Row 1: Title ─────────────────────────────────────────────────────────
        ws.mergeCells('A1:L1');
        const titleCell = ws.getCell('A1');
        titleCell.value = 'LINE PLAN UPLOAD';
        titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill  = greenHdr;
        ws.getRow(1).height = 30;

        ws.getRow(2).height = 6; // spacer

        // ── Rows 3-14: File header fields (label | value | note) ────────────────
        // Row 14 is new: WORKING TIME (s) — used by TAKT TIME formula in col H
        const hdrDefaults = prefill || {};
        const hdrRows = [
            { row:3,  label:'LINE CODE',          value:hdrDefaults.line_code || 'RUMIYA',          note:'Production line code. Auto-created if not in system.' },
            { row:4,  label:'HALL NAME',           value:hdrDefaults.line_name || 'Hall B',          note:'Hall/area name (used as line name if auto-creating the line).' },
            { row:5,  label:'DATE',                value:hdrDefaults.date || today,                 note:'Work date — YYYY-MM-DD format.' },
            { row:6,  label:'PRODUCT CODE',        value:hdrDefaults.product_code || '4321',         note:'Style/product code. Auto-created if new.' },
            { row:7,  label:'PRODUCT NAME',        value:hdrDefaults.product_name || 'BILLFOLD WALLET', note:'Full product name.' },
            { row:8,  label:'BUYER NAME',          value:hdrDefaults.buyer_name || '',                note:'Buyer / brand name. Optional.' },
            { row:9,  label:'PLAN MONTH',          value:hdrDefaults.plan_month || '',                note:'Plan month (e.g. 2026-04). Optional.' },
            { row:10, label:'TARGET UNITS',        value:hdrDefaults.target_units ?? 500,             note:'Daily target for this line. Required.' },
            { row:11, label:'CO PRODUCT CODE',     value:hdrDefaults.co_product_code || '',           note:'Optional — changeover product code.' },
            { row:12, label:'CO TARGET',           value:hdrDefaults.co_target_units || '',           note:'Optional — changeover target units.' },
            { row:13, label:'LINE LEADER',         value:hdrDefaults.line_leader || 'Rumiya',         note:'Line leader name.' },
            { row:14, label:'WORKING TIME (s)',     value:hdrDefaults.working_seconds || defaultWorkingSecs, note:`Total working seconds per shift (${defaultWorkingSecs/3600}h). Used for Takt Time = Working Time ÷ Target.` },
        ];
        const leaderFill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD1FAE5'} };
        const wTimeFill   = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFF9C4'} }; // yellow tint for working time
        hdrRows.forEach(({ row, label, value, note }) => {
            const isLeader = label === 'LINE LEADER';
            const isWTime  = label === 'WORKING TIME (s)';
            const isDate   = label === 'DATE';
            const lc = ws.getCell(row, 1);
            lc.value = label; lc.font = boldFont; lc.fill = isWTime ? wTimeFill : labelFill;
            lc.border = borderAll; lc.alignment = { horizontal:'left', vertical:'middle' };
            const vc = ws.getCell(row, 2);
            vc.value = value;
            vc.font  = isLeader ? { bold:true, size:11, color:{argb:'FF1D6F42'} } : { size:11 };
            vc.fill  = isLeader ? leaderFill : isWTime ? wTimeFill : { type:'pattern', pattern:'none' };
            vc.border = borderAll; vc.alignment = { horizontal:'left', vertical:'middle' };
            if (isDate) vc.numFmt = 'yyyy-mm-dd';
            ws.mergeCells(row, 3, row, 12);
            const nc = ws.getCell(row, 3);
            nc.value = note;
            nc.font  = { size:10, italic:true, color:{argb:'FF6B7280'} };
            nc.alignment = { horizontal:'left', vertical:'middle' };
        });

        ws.getRow(15).height = 8; // spacer

        // ── Row 16: Table column headers ─────────────────────────────────────────
        // Blue  = user inputs (A, B, C, E, F, H, L)
        // Green = auto-calc  (D, G, I, J, K)
        const colHeaders = [
            { h:'GROUP',              blue:true  }, // A
            { h:'OSM ☑',              blue:true  }, // B
            { h:'WORKSTATION ▼',      blue:true  }, // C
            { h:'OP CODE (auto)',      blue:false }, // D — formula from E
            { h:'SELECT OPERATION ▼', blue:true  }, // E
            { h:'PROCESS TIME (s)',    blue:true  }, // F
            { h:'CYCLE TIME (s)',      blue:false }, // G — SUMIF
            { h:'TAKT TIME (s)',       blue:true  }, // H — default global takt, editable per workstation
            { h:'WORKLOAD',           blue:false }, // I — cycle / takt
            { h:'SAH',                blue:false }, // J — F/3600
            { h:'EMP CODE (auto)',     blue:false }, // K — formula from L
            { h:'SELECT EMPLOYEE ▼',  blue:true  }, // L — combined dropdown; WS-linked
        ];
        const hRow = ws.getRow(16);
        hRow.height = 22;
        colHeaders.forEach(({ h, blue }, i) => {
            const cell = hRow.getCell(i + 1);
            cell.value = h;
            cell.font  = { bold:true, size:11, color:{argb:'FFFFFFFF'} };
            cell.fill  = blue ? blueHdr : greenHdr;
            cell.border = borderAll;
            cell.alignment = { horizontal:'center', vertical:'middle' };
        });
        ws.getCell('E16').note = {
            texts: [
                { font: { bold: true }, text: 'Existing process: ' },
                { text: 'select it from the dropdown so the code fills automatically.\n' },
                { font: { bold: true }, text: 'New process: ' },
                { text: 'type the process name manually and leave the code blank. Upload will create a new process code.' }
            ]
        };
        ws.getCell('H16').note = {
            texts: [
                { font: { bold: true }, text: 'Default: ' },
                { text: 'global takt time from Working Time / Target.\n' },
                { font: { bold: true }, text: 'Optional override: ' },
                { text: 'type a workstation-specific takt time here if needed.' }
            ]
        };

        // ── Config sheet (hidden) — all dropdown source data ─────────────────────
        const opCount  = Math.max(operations.length, 1);
        const empCount = Math.max(employees.length, 1);

        const cfg = workbook.addWorksheet('Config');
        cfg.state = 'hidden';
        for (let w = 1; w <= 100; w++) cfg.getCell(w, 1).value = `WS${String(w).padStart(2, '0')}`;  // A: WS01-WS100
        for (let g = 1; g <= 50;  g++) cfg.getCell(g, 2).value = `G${g}`;                             // B: G1-G50
        operations.forEach((op, i) => { cfg.getCell(i+1, 3).value = op.operation_code; });            // C: op codes
        operations.forEach((op, i) => { cfg.getCell(i+1, 4).value = op.operation_name; });            // D: op names
        operations.forEach((op, i) => { cfg.getCell(i+1, 5).value = `${op.operation_code} | ${op.operation_name}`; }); // E: combined op
        employees.forEach((emp, i)  => { cfg.getCell(i+1, 6).value = emp.emp_code; });                // F: emp codes
        employees.forEach((emp, i)  => { cfg.getCell(i+1, 7).value = emp.emp_name; });                // G: emp names
        employees.forEach((emp, i)  => { cfg.getCell(i+1, 8).value = `${emp.emp_code} | ${emp.emp_name}`; }); // H: combined emp
        cfg.getCell(1, 9).value = '☐';
        cfg.getCell(2, 9).value = '☑';


        // ── Data rows 17-502 ─────────────────────────────────────────────────────
        // H (TAKT TIME)  = $B$14 / $B$10  (working_seconds / target_units)
        // I (WORKLOAD)   = G / H           (cycle_time / takt_time) — formatted as %
        for (let rowNum = 17; rowNum <= 502; rowNum++) {
            const row = ws.getRow(rowNum);
            row.height = 18;

            const set = (col, fill, numFmt, alignH) => {
                const c = row.getCell(col);
                c.border = borderAll; c.fill = fill;
                c.alignment = { horizontal: alignH || 'center', vertical: 'middle' };
                if (numFmt) c.numFmt = numFmt;
                return c;
            };

            set(1, inputFill);               // A: GROUP
            set(2, inputFill);               // B: OSM
            set(3, inputFill);               // C: WORKSTATION

            // D: OP CODE — auto-extracts from E
            const dCell = set(4, autoFill);
            dCell.value = { formula:
                `=IF(E${rowNum}="","",IF(ISNUMBER(FIND("|",E${rowNum})),` +
                  `TRIM(LEFT(E${rowNum},FIND("|",E${rowNum})-1)),` +
                  `IF(ISNUMBER(MATCH(E${rowNum},Config!$C$1:$C$${opCount},0)),E${rowNum},` +
                    `IFERROR(INDEX(Config!$C$1:$C$${opCount},MATCH(E${rowNum},Config!$D$1:$D$${opCount},0)),"")` +
                  `)))` };

            set(5, inputFill, null, 'left'); // E: SELECT OPERATION
            set(6, inputFill, '0.00');       // F: PROCESS TIME (s)

            // G: CYCLE TIME = SUMIF by WS (if no WS, keep per-process time)
            const ctCell = set(7, autoFill, '0.00');
            ctCell.value = { formula: `=IF(C${rowNum}="",$F${rowNum},SUMIF($C$17:$C$502,C${rowNum},$F$17:$F$502))` };

            // H: TAKT TIME defaults from Working Time / Target, but can be overwritten per workstation
            const taktCell = set(8, inputFill, '0.00');
            taktCell.value = { formula: `=IFERROR($B$14/$B$10,"")` };

            // I: WORKLOAD = cycle_time / takt_time  (formatted as %)
            const wlCell = set(9, autoFill, '0.0%');
            wlCell.value = { formula: `=IFERROR(G${rowNum}/H${rowNum},"")` };

            // J: SAH = F / 3600
            const sahCell = set(10, autoFill, '0.0000');
            sahCell.value = { formula: `=F${rowNum}/3600` };

            // K: EMP CODE — auto-extracts from L
            const kCell = set(11, autoFill);
            kCell.value = { formula:
                `=IF(L${rowNum}="","",IF(ISNUMBER(FIND("|",L${rowNum})),` +
                  `TRIM(LEFT(L${rowNum},FIND("|",L${rowNum})-1)),` +
                  `IF(ISNUMBER(MATCH(L${rowNum},Config!$F$1:$F$${empCount},0)),L${rowNum},` +
                    `IFERROR(INDEX(Config!$F$1:$F$${empCount},MATCH(L${rowNum},Config!$G$1:$G$${empCount},0)),"")` +
                  `)))` };

            // L: SELECT EMPLOYEE — combined dropdown.
            //   Row 17: white user input.
            //   Rows 18+: light-green backward formula — copies L from nearest row above with same WS
            const lCell = row.getCell(12);
            lCell.border = borderAll;
            lCell.alignment = { horizontal:'left', vertical:'middle' };
            if (rowNum === 17) {
                lCell.fill = inputFill;
            } else {
                lCell.fill = linkFill;
                lCell.value = { formula: `=IFERROR(INDEX($L$17:L${rowNum-1},MATCH(C${rowNum},$C$17:C${rowNum-1},0)),"")`, result:'' };
            }
        }

        if (!prefill) {
            // ── Example data [group, osm, ws, combinedOp, processTimeSec] ────────────
            const exampleData = [
                ['G1', '☐', 'WS01', 'Mark Front',    12],
                ['G1', '☑', 'WS01', 'Mark Back',     12],
                ['G1', '☐', 'WS01', 'Sew Front',     30],
                ['G1', '☐', 'WS01', 'Sew Back',      30],
                ['G1', '☑', 'WS02', 'Attach Label',  20],
                ['G1', '☐', 'WS02', 'Trim Thread',   16],
                ['G2', '☐', 'WS03', 'Iron Front',    20],
                ['G2', '☑', 'WS03', 'Iron Back',     10],
                ['G2', '☐', 'WS04', 'Quality Check', 20],
                ['G3', '☑', 'WS05', 'Pack',          10],
                ['G3', '☐', 'WS06', 'Seal',          15],
            ];
            // ── Overlay example values onto rows 17-27 ───────────────────────────────
            exampleData.forEach(([group, osm, wsCode, opInput, pt], idx) => {
                const rowNum = 17 + idx;
                const row = ws.getRow(rowNum);
                row.getCell(1).value = group;    // A
                row.getCell(2).value = osm;      // B
                row.getCell(3).value = wsCode;   // C
                row.getCell(5).value = opInput;  // E
                row.getCell(6).value = pt;       // F
            });
        }

        // ── Data validations ──────────────────────────────────────────────────────
        const dataEnd = 502;
        [
            { range: `A17:A${dataEnd}`, src: `Config!$B$1:$B$50`         }, // GROUP
            { range: `B17:B${dataEnd}`, src: `Config!$I$1:$I$2`          }, // OSM
            { range: `C17:C${dataEnd}`, src: `Config!$A$1:$A$100`        }, // WORKSTATION
            { range: `E17:E${dataEnd}`, src: `Config!$E$1:$E$${opCount}` }, // SELECT OPERATION
            { range: `L17:L${dataEnd}`, src: `Config!$H$1:$H$${empCount}`}, // SELECT EMPLOYEE
        ].forEach(({ range, src }) => {
            ws.dataValidations.add(range, { type:'list', allowBlank:true, showErrorMessage:false, formulae:[src] });
        });

    return { workbook, ws, operations, employees };
}

// GET /lines/plan-upload-template — download the Line Plan Excel template
// Columns: A=GROUP, B=OSM, C=WORKSTATION, D=OP CODE▼, E=OP NAME▼, F=PROCESS TIME, G=CYCLE TIME, H=TAKT TIME, I=WORKLOAD, J=SAH, K=EMP CODE▼, L=EMP NAME▼
router.get('/lines/plan-upload-template', async (req, res) => {
    try {
        const { workbook } = await generateLinePlanTemplate();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="line_plan_template.xlsx"');
        res.setHeader('Cache-Control', 'no-store');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /lines/plan-upload-template/filled?line_id=&date= — download plan in upload template format
router.get('/lines/plan-upload-template/filled', async (req, res) => {
    const { line_id, date } = req.query;
    if (!line_id || !date) {
        return res.status(400).json({ success: false, error: 'line_id and date are required' });
    }
    try {
        const requestedMode = String(req.query.product_mode || 'primary').trim().toLowerCase();
        const planRes = await pool.query(
            `SELECT ldp.*, pl.line_code, pl.line_name, pl.line_leader,
                    p.product_code, p.product_name, p.buyer_name, p.plan_month
             FROM line_daily_plans ldp
             JOIN production_lines pl ON pl.id = ldp.line_id
             JOIN products p ON p.id = ldp.product_id
             WHERE ldp.line_id = $1 AND ldp.work_date = $2`,
            [line_id, date]
        );
        if (!planRes.rows[0]) {
            return res.status(404).json({ success: false, error: 'No daily plan found for this line/date' });
        }
        const plan = planRes.rows[0];
        const isChangeoverMode = requestedMode === 'changeover';
        if (isChangeoverMode && !plan.incoming_product_id) {
            return res.status(400).json({ success: false, error: 'No changeover product configured for this line/date' });
        }

        let coProductCode = '';
        let selectedProduct = {
            id: plan.product_id,
            product_code: plan.product_code,
            product_name: plan.product_name,
            buyer_name: plan.buyer_name || '',
            plan_month: plan.plan_month || '',
            target_units: plan.target_units
        };
        if (plan.incoming_product_id) {
            const coRes = await pool.query(
                `SELECT id, product_code, product_name, buyer_name, plan_month
                 FROM products
                 WHERE id = $1`,
                [plan.incoming_product_id]
            );
            coProductCode = coRes.rows[0]?.product_code || '';
            if (isChangeoverMode && coRes.rows[0]) {
                selectedProduct = {
                    id: coRes.rows[0].id,
                    product_code: coRes.rows[0].product_code,
                    product_name: coRes.rows[0].product_name,
                    buyer_name: coRes.rows[0].buyer_name || '',
                    plan_month: coRes.rows[0].plan_month || '',
                    target_units: plan.incoming_target_units || 0
                };
            }
        }
        const shiftWindow = await getShiftWindowDetails();
        const globalTaktSeconds = selectedProduct.target_units > 0
            ? (shiftWindow.workingSeconds / selectedProduct.target_units)
            : 0;

        const procRes = await pool.query(
            `SELECT pp.id, pp.sequence_number, pp.operation_sah, pp.cycle_time_seconds,
                    o.operation_code, o.operation_name,
                    ws_info.group_name, ws_info.workstation_code,
                    COALESCE(ws_info.osm_checked, false) AS osm_checked,
                    ws_info.takt_time_seconds,
                    e.emp_code, e.emp_name
             FROM product_processes pp
             JOIN operations o ON pp.operation_id = o.id
             LEFT JOIN (
                 SELECT DISTINCT ON (lpwp.product_process_id)
                        lpwp.product_process_id,
                        lpwp.osm_checked,
                        lpw.group_name, lpw.workstation_code, lpw.takt_time_seconds
                 FROM line_plan_workstations lpw
                 JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
                 WHERE lpw.line_id = $1 AND lpw.work_date = $2 AND lpw.product_id = $3
                 ORDER BY lpwp.product_process_id, lpw.id
             ) ws_info ON ws_info.product_process_id = pp.id
             LEFT JOIN employee_workstation_assignments ewa
                 ON ewa.line_id = $1 AND ewa.work_date = $2 AND ewa.workstation_code = ws_info.workstation_code
                 AND ewa.is_overtime = false
             LEFT JOIN employees e ON e.id = ewa.employee_id
             WHERE pp.product_id = $3 AND pp.is_active = true
             ORDER BY pp.sequence_number`,
            [line_id, date, selectedProduct.id]
        );

        const prefillRows = procRes.rows.map(p => ({
            group: p.group_name || '',
            osm: p.osm_checked ? '☑' : '☐',
            workstation: p.workstation_code || '',
            operation: `${p.operation_code} | ${p.operation_name}`,
            process_time: p.cycle_time_seconds != null && Number(p.cycle_time_seconds) > 0
                ? Number(p.cycle_time_seconds)
                : Math.round(parseFloat(p.operation_sah || 0) * 3600 * 100) / 100,
            takt_time_seconds: Number(p.takt_time_seconds || 0) || 0,
            // Changeover templates should stay unassigned so supervisors can decide at runtime.
            employee: isChangeoverMode
                ? ''
                : ((p.emp_code && p.emp_name) ? `${p.emp_code} | ${p.emp_name}` : '')
        }));

        const { workbook, ws } = await generateLinePlanTemplate({
            prefill: {
                line_code: plan.line_code,
                line_name: plan.line_name,
                date,
                product_code: selectedProduct.product_code,
                product_name: selectedProduct.product_name,
                buyer_name: selectedProduct.buyer_name,
                plan_month: selectedProduct.plan_month,
                target_units: selectedProduct.target_units,
                co_product_code: isChangeoverMode ? '' : coProductCode,
                co_target_units: isChangeoverMode ? '' : (plan.incoming_target_units || ''),
                line_leader: plan.line_leader || '',
                working_seconds: null
            }
        });

        // Overlay process rows onto the template (start at row 17)
        prefillRows.forEach((row, idx) => {
            const rowNum = 17 + idx;
            const r = ws.getRow(rowNum);
            r.getCell(1).value = row.group;
            r.getCell(2).value = row.osm;
            r.getCell(3).value = row.workstation;
            r.getCell(5).value = row.operation;
            r.getCell(6).value = row.process_time;
            if ((Number(row.takt_time_seconds) || 0) > 0
                && (!(globalTaktSeconds > 0) || Math.abs(Number(row.takt_time_seconds) - globalTaktSeconds) > 0.01)) {
                r.getCell(8).value = Math.round(Number(row.takt_time_seconds) * 100) / 100;
            }
            r.getCell(12).value = row.employee;
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const suffix = isChangeoverMode ? 'changeover' : 'primary';
        res.setHeader('Content-Disposition', `attachment; filename="line_plan_${plan.line_code || 'line'}_${suffix}_${date}.xlsx"`);
        res.setHeader('Cache-Control', 'no-store');
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
                if (v.result !== undefined && v.result !== null) return String(v.result).trim();
                // Formula cells without cached results should be treated as blank, not "[object Object]".
                if (v.formula !== undefined) return '';
            }
            return String(v).trim();
        };
        const getCellNum = (r, c) => {
            const raw = sheet.getRow(r).getCell(c).value;
            if (raw === null || raw === undefined || raw === '') return 0;
            if (typeof raw === 'object' && raw !== null) {
                if (raw.result !== undefined && raw.result !== null) return parseFloat(raw.result) || 0;
                if (raw.formula !== undefined) return 0;
            }
            return parseFloat(String(raw).replace(/,/g, '')) || 0;
        };
        const normalizeCode = (value) => String(value || '').trim().toUpperCase();
        const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
        const isOsmCheckedValue = (value) => {
            const normalized = String(value || '').trim().toLowerCase();
            return ['1', 'true', 'yes', 'y', 'checked', 'check', 'tick', '☑', '✓'].includes(normalized);
        };
        const requestedLineId = parseInt(String(req.body?.line_id || '').trim(), 10);
        const requestedProductMode = String(req.body?.product_mode || 'primary').trim().toLowerCase() === 'changeover'
            ? 'changeover'
            : 'primary';
        const isDetailMode = Number.isFinite(requestedLineId) && requestedLineId > 0;
        const suppressTemplateEmployeeAssignments = isDetailMode && requestedProductMode === 'changeover';
        const missingEmployeeKey = (empCode, empName) => {
            const code = normalizeCode(empCode);
            const name = normalizeName(empName);
            return code ? `CODE:${code}` : `NAME:${name}`;
        };
        const duplicateAssignmentKey = (wsCode) => `WS:${String(wsCode || '').trim().toUpperCase()}`;

        // Parse header (value in col B = column index 2)
        const lineCode      = normalizeCode(getCellStr(3, 2));
        const hallName      = getCellStr(4, 2);
        const excelWorkDate = normalizeWorkDate(getCellStr(5, 2));
        const requestedDateRaw = String(req.body?.work_date || '').trim();
        let requestedDate = '';
        if (requestedDateRaw) {
            try {
                requestedDate = normalizeWorkDate(requestedDateRaw);
            } catch (_) {
                requestedDate = '';
            }
        }
        const workDate      = requestedDate || excelWorkDate || new Date().toISOString().slice(0, 10);
        const productCode   = normalizeCode(getCellStr(6, 2));
        const productName   = getCellStr(7, 2);
        const buyerName     = getCellStr(8, 2) || null;
        const planMonth     = normalizePlanMonth(getCellStr(9, 2));
        const targetUnits   = Math.round(getCellNum(10, 2));
        const coProductCode = normalizeCode(getCellStr(11, 2));
        const coTarget      = Math.round(getCellNum(12, 2)) || 0;
        const lineLeader    = getCellStr(13, 2) || null;

        if (!lineCode)                         throw new Error('Line Code is required (row 3)');
        if (!workDate || !ISO_WORK_DATE_RE.test(workDate)) throw new Error('Date must be in YYYY-MM-DD format (row 5)');
        if (!productCode)                      throw new Error('Product Code is required (row 6)');
        if (!productName)                      throw new Error('Product Name is required (row 7)');
        if ((!targetUnits || targetUnits <= 0) && !isDetailMode) throw new Error('Target Units must be > 0 (row 10)');

        // Resolve user confirmations from the request body
        const confirmLine    = req.body?.confirm_line === 'true';
        const confirmProduct = req.body?.confirm_product || null; // 'use_existing' | 'replace' | null
        const overrideCode   = req.body?.new_product_code ? normalizeCode(req.body.new_product_code) : null;
        const effectiveProdCode = overrideCode || productCode;
        let summaryLineCode = lineCode;
        let summaryProductCode = effectiveProdCode;
        let effectiveTargetUnits = targetUnits;

        // --- Pre-check: line conflict ---
        if (!isDetailMode && !confirmLine) {
            const lineCheck = await pool.query(
                `SELECT id, line_code, line_name FROM production_lines
                 WHERE UPPER(TRIM(line_code)) = $1 ORDER BY is_active DESC LIMIT 1`,
                [lineCode]
            );
            if (lineCheck.rows[0]) {
                return res.status(409).json({
                    success: false,
                    code: 'LINE_EXISTS',
                    line_code: lineCheck.rows[0].line_code,
                    line_name: lineCheck.rows[0].line_name || lineCheck.rows[0].line_code
                });
            }
        }

        // --- Pre-check: product conflict ---
        if (!isDetailMode && !confirmProduct) {
            const prodCheck = await pool.query(
                `SELECT id, product_code, product_name FROM products WHERE product_code = $1 LIMIT 1`,
                [effectiveProdCode]
            );
            if (prodCheck.rows[0]) {
                return res.status(409).json({
                    success: false,
                    code: 'PRODUCT_EXISTS',
                    product_code: prodCheck.rows[0].product_code,
                    existing_product_name: prodCheck.rows[0].product_name,
                    uploaded_product_name: productName,
                    is_new_code: !!overrideCode
                });
            }
        }

        await client.query('BEGIN');

        // Resolve upload target: either whole daily-plan upload or current line-details product view upload.
        let lineId;
        let lineCreated = false;
        let productId;
        let coProductId = null;
        let detailPlan = null;
        if (isDetailMode) {
            const detailPlanResult = await client.query(
                `SELECT ldp.*,
                        pl.line_code,
                        p.product_code AS primary_product_code,
                        ip.product_code AS incoming_product_code
                 FROM line_daily_plans ldp
                 JOIN production_lines pl ON pl.id = ldp.line_id
                 LEFT JOIN products p ON p.id = ldp.product_id
                 LEFT JOIN products ip ON ip.id = ldp.incoming_product_id
                 WHERE ldp.line_id = $1
                   AND ldp.work_date = $2
                 LIMIT 1`,
                [requestedLineId, workDate]
            );
            detailPlan = detailPlanResult.rows[0];
            if (!detailPlan && requestedProductMode === 'changeover') {
                throw new Error('Daily plan not found for this line/date. Save the line plan first.');
            }

            lineId = requestedLineId;
            summaryLineCode = detailPlan?.line_code || summaryLineCode;
            if (requestedProductMode === 'changeover') {
                if (!detailPlan.incoming_product_id) {
                    // First changeover upload from line-details can bootstrap incoming product/target from template.
                    const incomingProductCode = normalizeCode(productCode);
                    if (!incomingProductCode) {
                        throw new Error('Product Code is required (row 6) to enable changeover upload.');
                    }
                    const incomingProductName = String(productName || incomingProductCode).trim();
                    const incomingProductResult = await client.query(
                        `INSERT INTO products (product_code, product_name, buyer_name, plan_month, is_active)
                         VALUES ($1, $2, $3, $4, true)
                         ON CONFLICT (product_code) DO UPDATE
                           SET product_name = COALESCE(NULLIF(EXCLUDED.product_name, ''), products.product_name),
                               buyer_name = COALESCE(EXCLUDED.buyer_name, products.buyer_name),
                               plan_month = COALESCE(EXCLUDED.plan_month, products.plan_month),
                               is_active = true,
                               updated_at = NOW()
                         RETURNING id, product_code`,
                        [incomingProductCode, incomingProductName, buyerName, planMonth]
                    );
                    detailPlan.incoming_product_id = incomingProductResult.rows[0]?.id || null;
                    detailPlan.incoming_product_code = incomingProductResult.rows[0]?.product_code || incomingProductCode;
                }
                productId = parseInt(detailPlan.incoming_product_id, 10);
                if (!productId) {
                    throw new Error('Unable to resolve changeover product from uploaded template.');
                }
                effectiveTargetUnits = targetUnits > 0
                    ? targetUnits
                    : (parseInt(detailPlan.incoming_target_units || 0, 10) || 0);
                summaryProductCode = detailPlan.incoming_product_code || summaryProductCode;
                if (!effectiveTargetUnits || effectiveTargetUnits <= 0) {
                    throw new Error('Incoming target units must be greater than 0 before uploading the changeover plan.');
                }
                await client.query(
                    `UPDATE line_daily_plans
                     SET incoming_product_id = $3,
                         incoming_target_units = $4,
                         updated_by = $5,
                         updated_at = NOW()
                     WHERE line_id = $1 AND work_date = $2`,
                    [lineId, workDate, productId, effectiveTargetUnits, req.user?.id || null]
                );
            } else {
                if (detailPlan) {
                    productId = parseInt(detailPlan.product_id, 10);
                    effectiveTargetUnits = targetUnits > 0
                        ? targetUnits
                        : (parseInt(detailPlan.target_units || 0, 10) || 0);
                    summaryProductCode = detailPlan.primary_product_code || summaryProductCode;
                } else {
                    // No plan yet — resolve/create product from Excel template and create the plan
                    const prodResult = await client.query(
                        `INSERT INTO products (product_code, product_name, buyer_name, plan_month, is_active)
                         VALUES ($1, $2, $3, $4, true)
                         ON CONFLICT (product_code) DO UPDATE
                           SET product_name = COALESCE(NULLIF(EXCLUDED.product_name, ''), products.product_name),
                               buyer_name   = COALESCE(EXCLUDED.buyer_name, products.buyer_name),
                               plan_month   = COALESCE(EXCLUDED.plan_month, products.plan_month),
                               is_active    = true,
                               updated_at   = NOW()
                         RETURNING id, product_code`,
                        [effectiveProdCode, productName || effectiveProdCode, buyerName, planMonth]
                    );
                    productId = prodResult.rows[0].id;
                    effectiveTargetUnits = targetUnits > 0 ? targetUnits : 0;
                    summaryProductCode = prodResult.rows[0].product_code || summaryProductCode;
                }
            }
        } else {
            // Find or create line — if it already exists, use it as-is (no updates to name/hall)
            const existingLine = await client.query(
                `SELECT id
                 FROM production_lines
                 WHERE UPPER(TRIM(line_code)) = $1
                 ORDER BY is_active DESC, id ASC
                 LIMIT 1`,
                [lineCode]
            );
            if (existingLine.rows[0]) {
                lineId      = existingLine.rows[0].id;
                lineCreated = false;
                await client.query(
                    `UPDATE production_lines
                     SET line_code = COALESCE(NULLIF(line_code, ''), $1),
                         line_name = COALESCE($2, line_name),
                         hall_location = COALESCE($3, hall_location),
                         line_leader = COALESCE($4, line_leader),
                         is_active = true,
                         updated_at = NOW()
                     WHERE id = $5`,
                    [lineCode, hallName || null, hallName || null, lineLeader || null, lineId]
                );
            } else {
                if (!hallName) throw new Error(`Line "${lineCode}" not found. Provide HALL NAME to auto-create it.`);
                const ins = await client.query(
                    `INSERT INTO production_lines (line_code, line_name, hall_location, line_leader, is_active)
                     VALUES ($1, $2, $3, $4, true) RETURNING id`,
                    [lineCode, hallName, hallName, lineLeader]
                );
                lineId      = ins.rows[0].id;
                lineCreated = true;
            }

            // Find or create primary product
            if (confirmProduct === 'use_existing') {
                const existProd = await client.query(
                    `SELECT id FROM products WHERE product_code = $1 LIMIT 1`,
                    [effectiveProdCode]
                );
                if (!existProd.rows[0]) throw new Error(`Product "${effectiveProdCode}" not found`);
                productId = existProd.rows[0].id;
            } else {
                const prodResult = await client.query(
                    `INSERT INTO products (product_code, product_name, buyer_name, plan_month, is_active)
                     VALUES ($1, $2, $3, $4, true)
                     ON CONFLICT (product_code) DO UPDATE
                       SET product_name = EXCLUDED.product_name,
                           buyer_name = COALESCE(EXCLUDED.buyer_name, products.buyer_name),
                           plan_month = COALESCE(EXCLUDED.plan_month, products.plan_month)
                     RETURNING id`,
                    [effectiveProdCode, productName, buyerName, planMonth]
                );
                productId = prodResult.rows[0].id;
            }

            // Find or create changeover product (optional)
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
        }

        // Get working hours → takt time
        const settingsResult = await client.query(
            `SELECT key, value FROM app_settings WHERE key IN ('default_in_time', 'default_out_time', 'lunch_break_minutes')`
        );
        const sm = {};
        settingsResult.rows.forEach(r => { sm[r.key] = r.value; });
        let workingSecs = 8 * 3600;
        if (sm.default_in_time && sm.default_out_time) {
            const [inH, inM]   = sm.default_in_time.split(':').map(Number);
            const [outH, outM] = sm.default_out_time.split(':').map(Number);
            const lunchMins = parseInt(sm.lunch_break_minutes || '0', 10) || 0;
            workingSecs = Math.max(0, ((outH * 60 + outM) - (inH * 60 + inM) - lunchMins) * 60);
        }
        const taktTimeSecs = effectiveTargetUnits > 0 ? workingSecs / effectiveTargetUnits : 0;

        // Parse data rows (start at row 17; stop at first fully empty row)
        // Columns: A=GROUP, B=OSM, C=WORKSTATION, D=OP CODE(formula), E=OPERATION NAME(user input),
        //          F=PROCESS TIME, G=CYCLE TIME(formula), H=TAKT TIME(user input or default formula), I=WORKLOAD(formula),
        //          J=SAH(formula), K=EMP CODE(formula), L=EMPLOYEE(formula via WS table)
        const dataRows = [];
        let autoSeq = 1;
        for (let rowNum = 17; rowNum <= 2001; rowNum++) {
            const rawWsCode = getCellStr(rowNum, 3);   // C: WORKSTATION
            let   opName = getCellStr(rowNum, 5);   // E: SELECT OPERATION (combined "CODE | NAME" or plain)
            const opCode = getCellStr(rowNum, 4);   // D: OP CODE (formula result — auto-extracted from E)
            // Stop when both WS and Operation Name are blank (primary user-entered cols)
            if (!rawWsCode && !opName) break;
            // Strip "CODE | " prefix if user selected from combined dropdown
            const opPipe = opName.indexOf(' | ');
            if (opPipe !== -1) opName = opName.slice(opPipe + 3).trim();
            const osmVal = getCellStr(rowNum, 2);   // B: OSM
            const sah    = getCellNum(rowNum, 10);  // J: SAH (formula result = process_time/3600)
            const taktTimeSeconds = getCellNum(rowNum, 8); // H: TAKT TIME
            if (!sah || sah <= 0) continue;         // skip rows with no process time entered
            // If workstation is blank, auto-assign a sequential one so partially filled templates still upload.
            const wsCode = rawWsCode ? rawWsCode.toUpperCase() : `WS${String(autoSeq).padStart(2, '0')}`;
            let empName = suppressTemplateEmployeeAssignments ? '' : getCellStr(rowNum, 12);   // L: SELECT EMPLOYEE (combined "CODE | NAME" or plain)
            const empPipe = empName.indexOf(' | ');
            if (empPipe !== -1) empName = empName.slice(empPipe + 3).trim();
            dataRows.push({
                seq:        autoSeq,
                group:      getCellStr(rowNum, 1),   // A: GROUP
                osm:        osmVal !== '' ? osmVal : null,
                wsCode:     wsCode.toUpperCase(),
                opCode:     opCode ? opCode.toUpperCase() : '',
                opName,
                sah,
                taktTimeSeconds: taktTimeSeconds > 0 ? taktTimeSeconds : 0,
                empCode:    suppressTemplateEmployeeAssignments ? '' : getCellStr(rowNum, 11), // K: EMP CODE (formula result — auto-extracted from L)
                empName,
                employeeLookupKey: null,
                employeeId: null
            });
            autoSeq++;
        }
        if (!dataRows.length) throw new Error('No process rows found. Data should start at row 17.');

        const providedMissingEmployees = (() => {
            if (suppressTemplateEmployeeAssignments) return [];
            const raw = req.body?.missing_employees;
            if (!raw) return [];
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (err) {
                throw new Error('Invalid missing_employees payload');
            }
        })();
        const providedDuplicateAssignments = (() => {
            if (suppressTemplateEmployeeAssignments) return [];
            const raw = req.body?.duplicate_assignments;
            if (!raw) return [];
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (err) {
                throw new Error('Invalid duplicate_assignments payload');
            }
        })();
        const skipMissingEmployees = ['1', 'true', 'yes'].includes(String(req.body?.skip_missing_employees || '').toLowerCase());

        if (!suppressTemplateEmployeeAssignments && providedDuplicateAssignments.length) {
            const duplicateOverrideMap = new Map();
            for (const entry of providedDuplicateAssignments) {
                const key = String(entry?.key || '').trim();
                if (!key) continue;
                duplicateOverrideMap.set(key, {
                    emp_code: String(entry?.emp_code || '').trim(),
                    emp_name: String(entry?.emp_name || '').trim()
                });
            }
            for (const row of dataRows) {
                const override = duplicateOverrideMap.get(duplicateAssignmentKey(row.wsCode));
                if (!override) continue;
                row.empCode = override.emp_code;
                row.empName = override.emp_name;
            }
        }

        const employeeCodeMap = new Map();
        const employeeNameMap = new Map();

        if (!suppressTemplateEmployeeAssignments) {
            const empCodesRequested = [...new Set(dataRows.map(r => normalizeCode(r.empCode)).filter(Boolean))];
            const empNamesRequested = [...new Set(dataRows.map(r => normalizeName(r.empName)).filter(Boolean))];

            if (empCodesRequested.length) {
                const empByCode = await client.query(
                    `SELECT id, emp_code, emp_name
                     FROM employees
                     WHERE UPPER(TRIM(emp_code)) = ANY($1::text[])
                       AND is_active = true`,
                    [empCodesRequested]
                );
                empByCode.rows.forEach(row => {
                    employeeCodeMap.set(normalizeCode(row.emp_code), row);
                    employeeNameMap.set(normalizeName(row.emp_name), row);
                });
            }
            if (empNamesRequested.length) {
                const empByName = await client.query(
                    `SELECT id, emp_code, emp_name
                     FROM employees
                     WHERE UPPER(TRIM(emp_name)) = ANY($1::text[])
                       AND is_active = true`,
                    [empNamesRequested]
                );
                empByName.rows.forEach(row => {
                    employeeNameMap.set(normalizeName(row.emp_name), row);
                    employeeCodeMap.set(normalizeCode(row.emp_code), row);
                });
            }

            const missingEmployeesMap = new Map();
            for (const row of dataRows) {
                const codeKey = normalizeCode(row.empCode);
                const nameKey = normalizeName(row.empName);
                if (!codeKey && !nameKey) continue;

                let matchedEmployee = null;
                if (codeKey && employeeCodeMap.has(codeKey)) {
                    matchedEmployee = employeeCodeMap.get(codeKey);
                } else if (nameKey && employeeNameMap.has(nameKey)) {
                    matchedEmployee = employeeNameMap.get(nameKey);
                }

                if (matchedEmployee) {
                    row.employeeId = matchedEmployee.id;
                    row.empCode = matchedEmployee.emp_code;
                    row.empName = matchedEmployee.emp_name;
                    continue;
                }

                row.employeeLookupKey = missingEmployeeKey(row.empCode, row.empName);
                if (!missingEmployeesMap.has(row.employeeLookupKey)) {
                    missingEmployeesMap.set(row.employeeLookupKey, {
                        key: row.employeeLookupKey,
                        emp_code: row.empCode || '',
                        emp_name: row.empName || '',
                        workstation_codes: []
                    });
                }
                const missingEntry = missingEmployeesMap.get(row.employeeLookupKey);
                if (!missingEntry.workstation_codes.includes(row.wsCode)) {
                    missingEntry.workstation_codes.push(row.wsCode);
                }
            }

            if (missingEmployeesMap.size) {
                const providedMap = new Map();
                for (const entry of providedMissingEmployees) {
                    const originalKey = String(entry?.key || '').trim();
                    const empCode = String(entry?.emp_code || '').trim();
                    const empName = String(entry?.emp_name || '').trim();
                    if (!originalKey || !empCode || !empName) {
                        throw new Error('Each missing employee entry must include key, emp_code, and emp_name');
                    }
                    providedMap.set(originalKey, { emp_code: empCode, emp_name: empName });
                }

                const unresolvedMissing = [];
                for (const missingEntry of missingEmployeesMap.values()) {
                    if (skipMissingEmployees) continue;
                    if (!providedMap.has(missingEntry.key)) {
                        unresolvedMissing.push(missingEntry);
                    }
                }

                if (unresolvedMissing.length) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        code: 'MISSING_EMPLOYEES',
                        message: 'Some employees from the Excel file were not found.',
                        error: 'Some employees from the Excel file were not found.',
                        missing_employees: unresolvedMissing
                    });
                }

                if (!skipMissingEmployees) {
                    const seenNewCodes = new Set();
                    for (const missingEntry of missingEmployeesMap.values()) {
                        const provided = providedMap.get(missingEntry.key);
                        if (!provided) continue;
                        const normalizedProvidedCode = normalizeCode(provided.emp_code);
                        if (seenNewCodes.has(normalizedProvidedCode)) {
                            throw new Error(`Duplicate employee code in missing employee form: ${provided.emp_code}`);
                        }
                        seenNewCodes.add(normalizedProvidedCode);
                    }

                    for (const missingEntry of missingEmployeesMap.values()) {
                        const provided = providedMap.get(missingEntry.key);
                        if (!provided) continue;
                        const insertedEmployee = await client.query(
                            `INSERT INTO employees (emp_code, emp_name, designation, default_line_id, manpower_factor, is_active)
                             VALUES ($1, $2, $3, $4, $5, true)
                             ON CONFLICT (emp_code) DO UPDATE
                               SET emp_name = EXCLUDED.emp_name,
                                   is_active = true,
                                   updated_at = NOW()
                             RETURNING id, emp_code, emp_name`,
                            [provided.emp_code.trim(), provided.emp_name.trim(), 'Operator', null, 1]
                        );
                        const employeeRow = insertedEmployee.rows[0];
                        employeeCodeMap.set(normalizeCode(employeeRow.emp_code), employeeRow);
                        employeeNameMap.set(normalizeName(employeeRow.emp_name), employeeRow);
                    }

                    for (const row of dataRows) {
                        if (!row.employeeLookupKey) continue;
                        const provided = providedMap.get(row.employeeLookupKey);
                        if (!provided) continue;
                        const matchedEmployee = employeeCodeMap.get(normalizeCode(provided.emp_code.trim()));
                        row.employeeId = matchedEmployee?.id || null;
                        row.empCode = provided.emp_code.trim();
                        row.empName = provided.emp_name.trim();
                    }
                } else {
                    for (const row of dataRows) {
                        if (!row.employeeLookupKey) continue;
                        row.empCode = '';
                        row.empName = '';
                    }
                }
            }

            const employeeToWsMap = new Map();
            for (const row of dataRows) {
                const empCodeKey = normalizeCode(row.empCode);
                if (!empCodeKey) continue;
                if (!employeeToWsMap.has(empCodeKey)) {
                    employeeToWsMap.set(empCodeKey, {
                        emp_code: row.empCode,
                        emp_name: row.empName || '',
                        workstations: [],
                        rows: []
                    });
                }
                const info = employeeToWsMap.get(empCodeKey);
                if (!info.workstations.includes(row.wsCode)) {
                    info.workstations.push(row.wsCode);
                }
                info.rows.push(row);
                if (!info.emp_name && row.empName) info.emp_name = row.empName;
            }

            const duplicateAssignments = [];
            for (const info of employeeToWsMap.values()) {
                if (info.workstations.length <= 1) continue;
                for (const wsCode of info.workstations) {
                    duplicateAssignments.push({
                        key: duplicateAssignmentKey(wsCode),
                        workstation_code: wsCode,
                        emp_code: info.emp_code,
                        emp_name: info.emp_name || '',
                        conflict_workstations: info.workstations
                    });
                }
            }

            if (duplicateAssignments.length) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    code: 'DUPLICATE_EMPLOYEE_ASSIGNMENTS',
                    message: 'Same employee is assigned to multiple workstations.',
                    error: 'Same employee is assigned to multiple workstations.',
                    duplicate_assignments: duplicateAssignments
                });
            }
        }

        // Deactivate all existing product_processes for this product.
        // uq_product_sequence is a PARTIAL unique index (WHERE is_active = true), so deactivated
        // rows do not participate in uniqueness checks — no sequence shifting needed.
        await client.query(
            `UPDATE product_processes SET is_active = false WHERE product_id = $1`,
            [productId]
        );

        // Upsert operations + product_processes.
        // Blank opCode means the process is new and should get a fresh operation code.
        for (const row of dataRows) {
            if (!row.opId) {
                let resolvedOperation = null;

                if (row.opCode) {
                    const byCode = await client.query(
                        `SELECT id, operation_code
                         FROM operations
                         WHERE UPPER(TRIM(operation_code)) = UPPER(TRIM($1))
                         LIMIT 1`,
                        [row.opCode]
                    );
                    if (byCode.rows[0]) {
                        resolvedOperation = byCode.rows[0];
                    }
                }

                if (resolvedOperation) {
                    row.opId = resolvedOperation.id;
                    row.opCode = resolvedOperation.operation_code;
                } else {
                    row.opCode = await generateNextOperationCode(client);
                    const opResult = await client.query(
                        `INSERT INTO operations (operation_code, operation_name, is_active)
                         VALUES ($1, $2, true)
                         RETURNING id`,
                        [row.opCode, row.opName]
                    );
                    row.opId = opResult.rows[0].id;
                }
            }

            // OSM checked: true only when the upload marks the box as checked.
            row.osmChecked = isOsmCheckedValue(row.osm);

            // Insert one product_process row per Excel row so repeated operations are preserved.
            const ppInsert = await client.query(
                `INSERT INTO product_processes
                   (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds, manpower_required, is_active, osm_checked)
                 VALUES ($1, $2, $3, $4, $5, 1, false, $6) RETURNING id`,
                [productId, row.opId, row.seq, row.sah, Math.round(row.sah * 3600), row.osmChecked]
            );
            row.ppId = ppInsert.rows[0].id;
        }

        // Batch-update sequences (all rows are still inactive → partial index not enforced → no conflicts).
        if (dataRows.length) {
            const seqValues = dataRows.map(r => `(${r.ppId}, ${r.seq})`).join(', ');
            await client.query(
                `UPDATE product_processes AS pp
                 SET sequence_number = v.seq
                 FROM (VALUES ${seqValues}) AS v(id, seq)
                 WHERE pp.id = v.id`
            );

            // Activate all rows in this upload in one shot — sequences are final, no conflicts.
            const activePpIds = dataRows.map(r => r.ppId);
            await client.query(
                `UPDATE product_processes SET is_active = true WHERE id = ANY($1)`,
                [activePpIds]
            );
        }

        // Upsert daily plan
        if (isDetailMode) {
            if (requestedProductMode === 'changeover') {
                await client.query(
                    `UPDATE line_daily_plans
                     SET incoming_target_units = $3,
                         updated_by = $4,
                         updated_at = NOW()
                     WHERE line_id = $1 AND work_date = $2`,
                    [lineId, workDate, effectiveTargetUnits, req.user?.id || null]
                );
            } else {
                await client.query(
                    `INSERT INTO line_daily_plans
                       (line_id, product_id, work_date, target_units, created_by, updated_by)
                     VALUES ($1, $2, $3, $4, $5, $5)
                     ON CONFLICT (line_id, work_date) DO UPDATE
                       SET product_id   = EXCLUDED.product_id,
                           target_units = EXCLUDED.target_units,
                           updated_by   = EXCLUDED.updated_by,
                           updated_at   = NOW()`,
                    [lineId, productId, workDate, effectiveTargetUnits, req.user?.id || null]
                );
            }
        } else {
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
                [lineId, productId, workDate, effectiveTargetUnits, coProductId, coTarget, req.user?.id || null]
            );
        }

        const todayIso = new Date().toISOString().slice(0, 10);
        if (workDate === todayIso && (!isDetailMode || requestedProductMode === 'primary')) {
            await client.query(
                `UPDATE production_lines
                 SET current_product_id = $1,
                     target_units = $2,
                     updated_at = NOW()
                 WHERE id = $3`,
                [productId, effectiveTargetUnits, lineId]
            );
        }

        const assignmentStateByEmployee = await getRegularAssignmentStateByEmployee(client, workDate);
        await detachRegularAssignmentsFromPlan(client, lineId, workDate, productId);

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
            const actualSam   = processes.reduce((s, p) => s + (p.sah * 3600), 0);
            const workstationTaktSecs = (() => {
                const explicit = processes.find(p => (Number(p.taktTimeSeconds) || 0) > 0);
                return explicit ? Number(explicit.taktTimeSeconds) : taktTimeSecs;
            })();
            const workloadPct = workstationTaktSecs > 0 ? (actualSam / workstationTaktSecs) * 100 : 0;
            const groupName   = processes.find(p => p.group)?.group || null;

            const wsInsert = await client.query(
                `INSERT INTO line_plan_workstations
                   (line_id, work_date, product_id, workstation_number, workstation_code,
                    takt_time_seconds, actual_sam_seconds, workload_pct, group_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id`,
                [lineId, workDate, productId, wsNumber, wsCode,
                 Math.round(workstationTaktSecs * 100) / 100,
                 Math.round(actualSam * 100) / 100,
                 Math.round(workloadPct * 100) / 100,
                 groupName]
            );
            const wsId = wsInsert.rows[0].id;

            for (let i = 0; i < processes.length; i++) {
                await client.query(
                    `INSERT INTO line_plan_workstation_processes
                       (workstation_id, product_process_id, sequence_in_workstation, osm_checked)
                     VALUES ($1, $2, $3, $4)`,
                    [wsId, processes[i].ppId, i + 1, processes[i].osmChecked || false]
                );
            }

            // Assign employee (first non-empty emp_code in the workstation)
            // Skip if the employee is already assigned to a different line/workstation on this date
            const withEmp = processes.find(p => p.employeeId || p.empCode || p.empName);
            if (withEmp) {
                let empId = withEmp.employeeId || null;
                if (!empId && withEmp.empCode) {
                    const empRow = await client.query(
                        `SELECT id FROM employees WHERE UPPER(TRIM(emp_code)) = UPPER(TRIM($1)) LIMIT 1`,
                        [withEmp.empCode]
                    );
                    empId = empRow.rows[0]?.id || null;
                }
                if (!empId && withEmp.empName) {
                    const empRow = await client.query(
                        `SELECT id FROM employees WHERE UPPER(TRIM(emp_name)) = UPPER(TRIM($1)) LIMIT 1`,
                        [withEmp.empName]
                    );
                    empId = empRow.rows[0]?.id || null;
                }
                if (empId) {
                    const preservedState = getPreservedRegularAssignmentState(assignmentStateByEmployee, empId);
                    await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                        lineId,
                        workDate,
                        workstationCode: wsCode,
                        isOvertime: false,
                        nextEmployeeId: empId
                    });
                    await clearEmployeeAssignmentConflicts(
                        client,
                        empId,
                        workDate,
                        false,
                        lineId,
                        wsCode
                    );
                    await client.query(
                        `INSERT INTO employee_workstation_assignments
                           (line_id, work_date, workstation_code, employee_id, line_plan_workstation_id, is_overtime,
                            is_linked, linked_at, late_reason, attendance_start)
                         VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9)
                         ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                         DO UPDATE SET employee_id              = EXCLUDED.employee_id,
                                       line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                       is_linked                = EXCLUDED.is_linked,
                                       linked_at                = EXCLUDED.linked_at,
                                       late_reason              = EXCLUDED.late_reason,
                                       attendance_start         = EXCLUDED.attendance_start,
                                       assigned_at              = NOW()`,
                        [
                            lineId,
                            workDate,
                            wsCode,
                            empId,
                            wsId,
                            preservedState.is_linked,
                            preservedState.linked_at,
                            preservedState.late_reason,
                            preservedState.attendance_start
                        ]
                    );
                    await syncAssignmentHistoryForCurrentRow(client, {
                        lineId,
                        workDate,
                        workstationCode: wsCode,
                        employeeId: empId,
                        isOvertime: false,
                        isLinked: preservedState.is_linked,
                        linkedAt: preservedState.linked_at,
                        attendanceStart: preservedState.attendance_start,
                        lateReason: preservedState.late_reason,
                        forceCurrentHourStart: preservedState.is_linked
                    });
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
        realtime.broadcast('data_change', {
            entity: 'daily_plans', action: 'update',
            line_id: lineId, work_date: workDate
        });
        if (workDate === todayIso) {
            realtime.broadcast('data_change', {
                entity: 'lines', action: 'update', id: lineId
            });
        }

        res.json({
            success: true,
            message: isDetailMode
                ? `${requestedProductMode === 'changeover' ? 'Changeover' : 'Primary'} line plan uploaded successfully`
                : 'Line plan uploaded successfully',
            summary: {
                line: summaryLineCode,
                product: summaryProductCode,
                date: workDate,
                target: effectiveTargetUnits,
                workstations: wsGroupsMap.size,
                processes: dataRows.length,
                employees_assigned: employeesAssigned
            }
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[plan-upload-excel] ERROR:', err.message);
        res.status(err.statusCode || 500).json({ success: false, error: err.message });
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
    await ensureDailyPlanCarryForwardForLine(lineId, dateValue);
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

// Recalculate and upsert group_wip for one group.
// groupIdentifier = group_name for grouped workstations, workstation_code for ungrouped.
const refreshGroupWip = async (lineId, workDate, groupIdentifier, client = null) => {
    const db = client || pool;
    const groupWsResult = await db.query(
        `SELECT workstation_code FROM line_plan_workstations
         WHERE line_id = $1 AND work_date = $2
           AND (group_name = $3 OR (group_name IS NULL AND workstation_code = $3))
         ORDER BY workstation_number ASC`,
        [lineId, workDate, groupIdentifier]
    );
    const workstationCodes = groupWsResult.rows.map(row => row.workstation_code).filter(Boolean);
    if (!workstationCodes.length) return;

    // During same-day changeover, feed can be given to any workstation in the group.
    // On a normal day only the first workstation will have input, so summing keeps both flows valid.
    const matResult = await db.query(
        `SELECT COALESCE(SUM(material_provided), 0) AS mat
         FROM employee_workstation_assignments
         WHERE line_id = $1
           AND work_date = $2
           AND workstation_code = ANY($3::text[])
           AND is_overtime = false`,
        [lineId, workDate, workstationCodes]
    );
    const materialsIn = parseInt(matResult.rows[0]?.mat || 0, 10);

    // output_qty = cumulative output of the LAST workstation in the group only.
    // The group produces finished units at its last station; summing all stations would double-count WIP.
    const outResult = await db.query(
        `SELECT COALESCE(SUM(qty), 0) AS total_output
         FROM (
             SELECT lphp.hour_slot, MAX(lphp.quantity) AS qty
             FROM line_plan_workstations lpw
             JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
             JOIN line_process_hourly_progress lphp ON lphp.process_id = lpwp.product_process_id
             WHERE lpw.line_id = $1 AND lpw.work_date = $2
               AND lphp.line_id = $1 AND lphp.work_date = $2
               AND lpw.id = (
                   SELECT id FROM line_plan_workstations
                   WHERE line_id = $1 AND work_date = $2
                     AND (group_name = $3 OR (group_name IS NULL AND workstation_code = $3))
                   ORDER BY workstation_number DESC LIMIT 1
               )
             GROUP BY lphp.hour_slot
         ) ws_hr`,
        [lineId, workDate, groupIdentifier]
    );
    const outputQty = parseInt(outResult.rows[0]?.total_output || 0, 10);
    const wipQty = Math.max(0, materialsIn - outputQty);

    await db.query(
        `INSERT INTO group_wip (line_id, work_date, group_name, materials_in, output_qty, wip_quantity)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (line_id, work_date, group_name)
         DO UPDATE SET materials_in  = EXCLUDED.materials_in,
                       output_qty    = EXCLUDED.output_qty,
                       wip_quantity  = EXCLUDED.wip_quantity,
                       updated_at    = NOW()`,
        [lineId, workDate, groupIdentifier, materialsIn, outputQty, wipQty]
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

router.get('/supervisor/ot-plan/:lineId', async (req, res) => {
    const { lineId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
        const shiftWindow = await getShiftWindowDetails();
        // Check if OT is enabled on the daily plan
        const dailyPlanRes = await pool.query(
            `SELECT ot_enabled FROM line_daily_plans WHERE line_id=$1 AND work_date=$2`,
            [lineId, date]
        );
        if (!dailyPlanRes.rows[0] || !dailyPlanRes.rows[0].ot_enabled) {
            return res.json({ success: true, data: null, ot_enabled: false });
        }

        const dailyPlanMetaRes = await pool.query(
            `SELECT product_id, target_units, incoming_product_id, incoming_target_units
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [lineId, date]
        );
        const dailyPlanMeta = dailyPlanMetaRes.rows[0] || {};

        // Get OT plan header
        const planRes = await pool.query(
            `SELECT op.*, p.product_code, p.product_name
             FROM line_ot_plans op
             LEFT JOIN products p ON p.id = op.product_id
             WHERE op.line_id=$1 AND op.work_date=$2`,
            [lineId, date]
        );
        if (!planRes.rows[0]) {
            return res.json({ success: true, data: null, ot_enabled: true });
        }
        const otPlan = planRes.rows[0];

        // Get all employees for assignment picker
        const empsRes = await pool.query(
            `SELECT id, emp_code, emp_name FROM employees WHERE is_active=true ORDER BY emp_name`
        );

        // Get OT workstations
        const wsRes = await pool.query(
            `SELECT * FROM line_ot_workstations WHERE ot_plan_id=$1 ORDER BY workstation_number`,
            [otPlan.id]
        );

        const workstations = [];
        for (const ws of wsRes.rows) {
            // Processes
            const procRes = await pool.query(
                `SELECT pp.id AS process_id,
                        pp.product_id,
                        pp.sequence_number,
                        pp.operation_sah,
                        o.operation_code,
                        o.operation_name,
                        p.product_code,
                        p.product_name
                 FROM line_ot_workstation_processes lowp
                 JOIN product_processes pp ON pp.id = lowp.product_process_id
                 JOIN operations o ON o.id = pp.operation_id
                 JOIN products p ON p.id = pp.product_id
                 WHERE lowp.ot_workstation_id=$1
                 ORDER BY lowp.sequence_in_workstation`,
                [ws.id]
            );
            // OT employee assignment
            const empRes = await pool.query(
                `SELECT ewa.employee_id, e.emp_code, e.emp_name
                 FROM employee_workstation_assignments ewa
                 JOIN employees e ON e.id = ewa.employee_id
                 WHERE ewa.line_id=$1 AND ewa.work_date=$2
                   AND ewa.workstation_code=$3 AND ewa.is_overtime=true`,
                [lineId, date, ws.workstation_code]
            );
            // Existing OT progress
            const progRes = await pool.query(
                `SELECT quantity, qa_rejection, remarks,
                        opening_wip_quantity, ot_target_units,
                        balance_quantity, closing_wip_quantity
                 FROM line_ot_progress
                 WHERE ot_workstation_id=$1 AND work_date=$2`,
                [ws.id, date]
            );
            const sourceEmpRes = await pool.query(
                `SELECT id, emp_code, emp_name
                 FROM employees
                 WHERE id = $1`,
                [ws.source_employee_id || null]
            );

            const sourceProductId = ws.source_product_id
                ? parseInt(ws.source_product_id, 10)
                : (procRes.rows[0]?.product_id ? parseInt(procRes.rows[0].product_id, 10) : null);
            const hourlyTarget = (parseFloat(ws.source_hourly_target || 0) || 0) > 0
                ? (parseFloat(ws.source_hourly_target || 0) || 0)
                : (() => {
                    const fallbackTarget = sourceProductId && sourceProductId === parseInt(dailyPlanMeta.incoming_product_id || 0, 10)
                        ? (parseInt(dailyPlanMeta.incoming_target_units || 0, 10) || 0)
                        : (parseInt(dailyPlanMeta.target_units || 0, 10) || 0);
                    return shiftWindow.workingHours > 0 ? (fallbackTarget / shiftWindow.workingHours) : 0;
                })();
            const sourceTargetUnits = hourlyTarget > 0 && shiftWindow.workingHours > 0
                ? hourlyTarget * shiftWindow.workingHours
                : (sourceProductId && sourceProductId === parseInt(dailyPlanMeta.incoming_product_id || 0, 10)
                    ? (parseInt(dailyPlanMeta.incoming_target_units || 0, 10) || 0)
                    : (parseInt(dailyPlanMeta.target_units || 0, 10) || 0));
            const otMinutes = parseInt(ws.ot_minutes || 0, 10) || 0;
            const otTargetUnits = Math.round((hourlyTarget * otMinutes) / 60);
            const progress = progRes.rows[0] || null;
            workstations.push({
                ...ws,
                processes: procRes.rows,
                assigned_employee_id: empRes.rows[0]?.employee_id || null,
                assigned_emp_code: empRes.rows[0]?.emp_code || null,
                assigned_emp_name: empRes.rows[0]?.emp_name || null,
                source_employee_id: sourceEmpRes.rows[0]?.id || ws.source_employee_id || null,
                source_emp_code: sourceEmpRes.rows[0]?.emp_code || null,
                source_emp_name: sourceEmpRes.rows[0]?.emp_name || null,
                source_product_id: sourceProductId,
                source_target_units: roundMetric(sourceTargetUnits, 2),
                source_hourly_target: roundMetric(hourlyTarget, 2),
                ot_target_units: progress?.ot_target_units != null
                    ? parseInt(progress.ot_target_units || 0, 10)
                    : otTargetUnits,
                opening_wip_quantity: progress?.opening_wip_quantity != null
                    ? parseInt(progress.opening_wip_quantity || 0, 10)
                    : (parseInt(ws.regular_shift_wip_quantity || 0, 10) || 0),
                balance_quantity: progress?.balance_quantity != null
                    ? parseInt(progress.balance_quantity || 0, 10)
                    : Math.max(0, otTargetUnits),
                closing_wip_quantity: progress?.closing_wip_quantity != null
                    ? parseInt(progress.closing_wip_quantity || 0, 10)
                    : Math.max(0, (parseInt(ws.regular_shift_wip_quantity || 0, 10) || 0)),
                progress
            });
        }

        const computedOtTarget = workstations.reduce((sum, ws) => {
            if (ws.is_active === false) return sum;
            return sum + (parseInt(ws.ot_target_units || 0, 10) || 0);
        }, 0);

        res.json({
            success: true,
            ot_enabled: true,
            data: {
                ot_plan: {
                    ...otPlan,
                    computed_ot_target_units: computedOtTarget
                },
                workstations,
                employees: empsRes.rows
            }
        });
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
            return res.json({ success: true, data: [], workstation_plan: [], has_daily_plan: false });
        }

        await ensureWorkstationPlanCarryForward(lineId, date, primaryId);

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
        const primaryTarget = parseInt(meta.target_units, 10) || 0;
        const incomingTarget = parseInt(meta.incoming_target_units, 10) || 0;
        // Keep legacy active_target (used by non-per-WS code paths)
        const activeTarget = changeoverActive ? incomingTarget : primaryTarget;

        // Calculate per-hour targets from shift settings
        const inTime  = await getSettingValue('default_in_time',  '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const lunchMins = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10) || 0;
        const workingHours = getNetWorkingMinutes(inTime, outTime, lunchMins) / 60;
        const workingSeconds = workingHours * 3600;
        const perHourTarget         = workingHours > 0 ? primaryTarget / workingHours : 0;
        const perHourIncomingTarget = workingHours > 0 ? incomingTarget / workingHours : 0;
        const incomingRemainingHours = changeoverActive
            ? getRemainingShiftHours(meta.changeover_started_at, inTime, outTime, lunchMins)
            : workingHours;
        const incomingEffectiveTarget = changeoverActive
            ? Math.round(perHourIncomingTarget * incomingRemainingHours)
            : incomingTarget;

        // Build shared response fields
        const sharedFields = {
            has_daily_plan: true,
            changeover: incomingId ? true : false,
            changeover_active: changeoverActive,
            changeover_started_at: meta.changeover_started_at || null,
            active_target: changeoverActive ? incomingEffectiveTarget : activeTarget,
            primary_target: primaryTarget,
            incoming_target: incomingTarget,
            incoming_effective_target: incomingEffectiveTarget,
            incoming_remaining_hours: incomingRemainingHours,
            per_hour_target: Math.round(perHourTarget * 100) / 100,
            per_hour_incoming_target: Math.round(perHourIncomingTarget * 100) / 100,
            working_hours: workingHours,
            in_time: inTime,
            out_time: outTime,
            primary_product_id: primaryId,
            incoming_product_id: incomingId,
            incoming_product_code: meta.incoming_product_code || null,
            incoming_product_name: meta.incoming_product_name || null,
            total_workstation_count: 0,
            changeover_ready_workstation_count: 0,
            can_finalize_primary: false,
            changeover_sequence: changeoverSequence,
            incoming_max_sequence: incomingMaxSequence,
            changeover_enabled: CHANGEOVER_ENABLED
        };

        // Helper to build workstation query for a given product
        const buildWsPlanQuery = (productId) => pool.query(
            `SELECT lpw.id as workstation_plan_id, lpw.workstation_number, lpw.workstation_code,
                    lpw.takt_time_seconds, lpw.actual_sam_seconds, lpw.workload_pct,
                    lpw.product_id, lpw.group_name, lpw.co_employee_id,
                    e_co.emp_code AS co_emp_code, e_co.emp_name AS co_emp_name,
                    lpw.ws_changeover_active, lpw.ws_changeover_started_at,
                    wce.feed_given AS changeover_feed_given,
                    wce.feed_quantity AS changeover_feed_quantity,
                    wce.primary_output_quantity AS changeover_primary_output_quantity,
                    wce.primary_target_quantity AS changeover_primary_target_quantity,
                    wce.primary_balance_quantity AS changeover_primary_balance_quantity,
                    wce.primary_pending_wip AS changeover_primary_pending_wip,
                    wce.same_employee AS changeover_same_employee,
                    pp.id as process_id, pp.sequence_number, pp.operation_sah,
                    o.operation_code, o.operation_name,
                    p.product_code, p.target_qty,
                    ewa.employee_id as assigned_employee_id,
                    e.emp_code as assigned_emp_code,
                    e.emp_name as assigned_emp_name,
                    ewa.is_linked as assigned_is_linked,
                    ewa.material_provided,
                    lpwp.sequence_in_workstation,
                    wd.id AS departure_id,
                    wd.departure_time, wd.departure_reason,
                    wa.id AS adjustment_id,
                    COALESCE(wa.adjustment_type, wa_emp_comb.adjustment_type) AS coverage_type,
                    COALESCE(wa.reassignment_time, wa_emp_comb.reassignment_time) AS reassignment_time,
                    e_cov.emp_code AS covering_emp_code,
                    e_cov.emp_name AS covering_emp_name,
                    COALESCE(wa.from_workstation_code, wa_emp_comb.vacant_workstation_code) AS covering_from_ws
             FROM line_plan_workstations lpw
             JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
             JOIN product_processes pp ON lpwp.product_process_id = pp.id
             JOIN operations o ON pp.operation_id = o.id
             JOIN products p ON pp.product_id = p.id
             LEFT JOIN employees e_co ON e_co.id = lpw.co_employee_id
             LEFT JOIN workstation_changeover_events wce
                ON wce.line_id = lpw.line_id
               AND wce.work_date = lpw.work_date
               AND wce.workstation_code = lpw.workstation_code
             LEFT JOIN employee_workstation_assignments ewa
                ON (ewa.line_id = lpw.line_id AND ewa.work_date = lpw.work_date
                    AND ewa.workstation_code = lpw.workstation_code)
                AND ewa.is_overtime = false
             LEFT JOIN employees e ON ewa.employee_id = e.id
             LEFT JOIN worker_departures wd
                ON wd.line_id = lpw.line_id AND wd.work_date = lpw.work_date
                AND wd.workstation_code = lpw.workstation_code
                AND wd.employee_id = ewa.employee_id
             LEFT JOIN worker_adjustments wa ON wa.departure_id = wd.id
             LEFT JOIN employees e_cov ON e_cov.id = wa.from_employee_id
             -- Detect when this WS's employee is doing a combine (their original WS)
             LEFT JOIN worker_adjustments wa_emp_comb
                ON wa_emp_comb.from_employee_id = ewa.employee_id
                AND wa_emp_comb.adjustment_type = 'combine'
                AND wa_emp_comb.line_id = lpw.line_id
                AND wa_emp_comb.work_date = lpw.work_date
                AND wa_emp_comb.from_workstation_code = lpw.workstation_code
             WHERE lpw.line_id = $1 AND lpw.work_date = $2 AND lpw.product_id = $3
             ORDER BY lpw.workstation_number, lpwp.sequence_in_workstation`,
            [lineId, date, productId]
        );

        // Fetch primary workstation plan
        const primaryPlanResult = await buildWsPlanQuery(primaryId);

        if (primaryPlanResult.rows.length > 0) {
            // Fetch changeover workstation plan if incoming product exists
            let coPlanRows = [];
            if (incomingId) {
                const coPlanResult = await buildWsPlanQuery(incomingId);
                coPlanRows = coPlanResult.rows;
            }

            // Build changeover WS map keyed by normalized workstation number
            // so W01 / WS01 / ws01 all resolve to the same entry
            // Captures co_employee_id from the INCOMING product's WS plan (IE pre-assignment)
            const coWsMap = new Map();
            for (const row of coPlanRows) {
                const nk = normalizeWsCode(row.workstation_code);
                if (!coWsMap.has(nk)) {
                    coWsMap.set(nk, {
                        plan_id: row.workstation_plan_id,
                        rows: [],
                        co_emp_id: row.co_employee_id || null,
                        co_emp_code: row.co_emp_code || null,
                        co_emp_name: row.co_emp_name || null
                    });
                }
                coWsMap.get(nk).rows.push(row);
            }

            // Group primary WS rows; for ws_changeover_active WSes swap in changeover data
            const wsMap = new Map();
            for (const row of primaryPlanResult.rows) {
                const primaryWsId = row.workstation_plan_id;
                if (!wsMap.has(primaryWsId)) {
                    const nwk = normalizeWsCode(row.workstation_code);
                    const isCoActive = row.ws_changeover_active && incomingId && coWsMap.has(nwk);
                    const coData = isCoActive ? coWsMap.get(nwk) : null;
                    const firstCoRow = coData ? coData.rows[0] : null;
                    const primaryTaktTimeSeconds = parseFloat(row.takt_time_seconds || 0) || 0;
                    const primaryTargetUnits = primaryTaktTimeSeconds > 0
                        ? computeTargetUnitsFromTakt(primaryTaktTimeSeconds, workingSeconds)
                        : primaryTarget;
                    const primaryHourlyTargetUnits = primaryTaktTimeSeconds > 0
                        ? computeHourlyTargetFromTakt(primaryTaktTimeSeconds)
                        : perHourTarget;
                    const coTaktTimeSeconds = parseFloat(firstCoRow?.takt_time_seconds || 0) || 0;
                    const coTargetUnits = coTaktTimeSeconds > 0
                        ? computeTargetUnitsFromTakt(coTaktTimeSeconds, workingSeconds)
                        : incomingTarget;
                    const coHourlyTargetUnits = coTaktTimeSeconds > 0
                        ? computeHourlyTargetFromTakt(coTaktTimeSeconds)
                        : perHourIncomingTarget;
                    const effectiveTargetUnits = isCoActive ? coTargetUnits : primaryTargetUnits;
                    const effectiveHourlyTargetUnits = isCoActive ? coHourlyTargetUnits : primaryHourlyTargetUnits;

                    // Calculate per-WS changeover target (per_hour_incoming * remaining hours)
                    let wsChangeoverTarget = null;
                    let wsChangeoverRemainingHours = null;
                    if (isCoActive && row.ws_changeover_started_at) {
                        wsChangeoverRemainingHours = getRemainingShiftHours(row.ws_changeover_started_at, inTime, outTime, lunchMins);
                        wsChangeoverTarget = roundMetric(coHourlyTargetUnits * wsChangeoverRemainingHours, 2);
                    }

                    // CO employee suggestion — from incoming product's WS plan (IE pre-assignment)
                    const incomingCoData = coWsMap.get(nwk) ?? null;

                    wsMap.set(primaryWsId, {
                        id: isCoActive ? coData.plan_id : primaryWsId,
                        primary_ws_id: primaryWsId,
                        workstation_number: row.workstation_number,
                        workstation_code: row.workstation_code,
                        group_name: row.group_name || null,
                        has_co_plan: coWsMap.has(nwk),
                        co_suggested_emp_id: incomingCoData?.co_emp_id ?? null,
                        co_suggested_emp_code: incomingCoData?.co_emp_code ?? null,
                        co_suggested_emp_name: incomingCoData?.co_emp_name ?? null,
                        takt_time_seconds: isCoActive ? (firstCoRow?.takt_time_seconds ?? row.takt_time_seconds) : row.takt_time_seconds,
                        target_units: roundMetric(effectiveTargetUnits, 2),
                        hourly_target_units: roundMetric(effectiveHourlyTargetUnits, 2),
                        actual_sam_seconds: isCoActive ? (firstCoRow?.actual_sam_seconds ?? row.actual_sam_seconds) : row.actual_sam_seconds,
                        workload_pct: isCoActive ? (firstCoRow?.workload_pct ?? row.workload_pct) : row.workload_pct,
                        ws_changeover_active: !!row.ws_changeover_active,
                        ws_changeover_started_at: row.ws_changeover_started_at || null,
                        ws_changeover_target: wsChangeoverTarget,
                        ws_changeover_remaining_hours: wsChangeoverRemainingHours,
                        ws_changeover_hourly_target: roundMetric(coHourlyTargetUnits, 2),
                        primary_target_units: roundMetric(primaryTargetUnits, 2),
                        primary_hourly_target_units: roundMetric(primaryHourlyTargetUnits, 2),
                        co_target_units: roundMetric(coTargetUnits, 2),
                        co_hourly_target_units: roundMetric(coHourlyTargetUnits, 2),
                        assigned_employee_id: isCoActive ? (firstCoRow?.assigned_employee_id ?? row.assigned_employee_id) : row.assigned_employee_id,
                        assigned_emp_code: isCoActive ? (firstCoRow?.assigned_emp_code ?? row.assigned_emp_code) : row.assigned_emp_code,
                        assigned_emp_name: isCoActive ? (firstCoRow?.assigned_emp_name ?? row.assigned_emp_name) : row.assigned_emp_name,
                        assigned_is_linked: isCoActive ? (firstCoRow?.assigned_is_linked ?? row.assigned_is_linked) : row.assigned_is_linked,
                        material_provided: (isCoActive ? (firstCoRow?.material_provided ?? row.material_provided) : row.material_provided) ?? null,
                        changeover_feed_given: !!row.changeover_feed_given,
                        changeover_feed_quantity: parseInt(row.changeover_feed_quantity || 0, 10),
                        changeover_primary_output_quantity: parseInt(row.changeover_primary_output_quantity || 0, 10),
                        changeover_primary_target_quantity: parseInt(row.changeover_primary_target_quantity || 0, 10),
                        changeover_primary_balance_quantity: parseInt(row.changeover_primary_balance_quantity || 0, 10),
                        changeover_primary_pending_wip: parseInt(row.changeover_primary_pending_wip || 0, 10),
                        changeover_same_employee: row.changeover_same_employee === true,
                        product_id: isCoActive ? incomingId : primaryId,
                        departure_id: row.departure_id || null,
                        departure_time: row.departure_time || null,
                        departure_reason: row.departure_reason || null,
                        adjustment_id: row.adjustment_id || null,
                        coverage_type: row.coverage_type || null,
                        reassignment_time: row.reassignment_time || null,
                        covering_emp_code: row.covering_emp_code || null,
                        covering_emp_name: row.covering_emp_name || null,
                        covering_from_ws: row.covering_from_ws || null,
                        ws_status: row.coverage_type ? 'covered' : (!row.departure_id ? 'active' : (!row.adjustment_id ? 'vacant' : 'covered')),
                        processes: [],
                        co_processes: []
                    });
                }

                const ws = wsMap.get(primaryWsId);
                // If this WS is in changeover, skip primary processes (will add co ones after)
                if (!ws.ws_changeover_active) {
                    ws.processes.push({
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
            }

            // Add changeover processes for ws_changeover_active workstations
            for (const [primaryWsId, ws] of wsMap.entries()) {
                const nwk = normalizeWsCode(ws.workstation_code);
                if (ws.ws_changeover_active && coWsMap.has(nwk)) {
                    for (const coRow of coWsMap.get(nwk).rows) {
                        ws.processes.push({
                            id: coRow.process_id,
                            sequence_number: coRow.sequence_number,
                            operation_code: coRow.operation_code,
                            operation_name: coRow.operation_name,
                            operation_sah: coRow.operation_sah,
                            product_code: coRow.product_code,
                            target_qty: coRow.target_qty,
                            sequence_in_workstation: coRow.sequence_in_workstation
                        });
                    }
                }
            }

            // Keep the incoming workstation process list available even before the workstation switches.
            for (const ws of wsMap.values()) {
                if (!coWsMap.has(ws.workstation_code)) continue;
                ws.co_processes = coWsMap.get(ws.workstation_code).rows.map(coRow => ({
                    id: coRow.process_id,
                    sequence_number: coRow.sequence_number,
                    operation_code: coRow.operation_code,
                    operation_name: coRow.operation_name,
                    operation_sah: coRow.operation_sah,
                    product_code: coRow.product_code,
                    target_qty: coRow.target_qty,
                    sequence_in_workstation: coRow.sequence_in_workstation
                }));
            }

            const workstations = Array.from(wsMap.values());

            // Compute is_group_first for group-level material tracking
            // Workstations are already ordered by workstation_number, so first occurrence = group leader
            const groupLeaderMap = new Map(); // group_name -> leader ws object
            for (const ws of workstations) {
                const g = ws.group_name;
                if (g && !groupLeaderMap.has(g)) groupLeaderMap.set(g, ws);
            }
            for (const ws of workstations) {
                const g = ws.group_name;
                if (!g) {
                    ws.is_group_first = true;
                    ws.group_material_provided = null;
                } else {
                    ws.is_group_first = (groupLeaderMap.get(g) === ws);
                    ws.group_material_provided = ws.is_group_first ? null : (groupLeaderMap.get(g)?.material_provided ?? null);
                }
            }

            // Attach group WIP data to each workstation
            const groupWipResult = await pool.query(
                `SELECT group_name, materials_in, output_qty, wip_quantity
                 FROM group_wip WHERE line_id = $1 AND work_date = $2`,
                [lineId, date]
            );
            const groupWipMap = new Map(groupWipResult.rows.map(r => [r.group_name, r]));
            for (const ws of workstations) {
                const key = ws.group_name || ws.workstation_code;
                const gw = groupWipMap.get(key);
                ws.group_wip_quantity  = gw ? gw.wip_quantity  : null;
                ws.group_materials_in  = gw ? gw.materials_in  : null;
                ws.group_output_qty    = gw ? gw.output_qty    : null;
            }

            // Flat process list for backward compat
            const seenProcessIds = new Set();
            const flatProcesses = [];
            for (const ws of workstations) {
                for (const p of ws.processes) {
                    if (!seenProcessIds.has(p.id)) {
                        seenProcessIds.add(p.id);
                        flatProcesses.push({
                            id: p.id,
                            sequence_number: p.sequence_number,
                            operation_code: p.operation_code,
                            operation_name: p.operation_name,
                            operation_sah: p.operation_sah,
                            product_code: p.product_code,
                            target_qty: p.target_qty,
                            workstation_code: ws.workstation_code,
                            workstation_plan_id: ws.id,
                            assigned_employee_id: ws.assigned_employee_id,
                            assigned_emp_code: ws.assigned_emp_code,
                            assigned_emp_name: ws.assigned_emp_name
                        });
                    }
                }
            }

            return res.json({
                success: true,
                data: flatProcesses,
                workstation_plan: workstations,
                has_plan: true,
                ...sharedFields,
                total_workstation_count: workstations.length,
                changeover_ready_workstation_count: workstations.filter(ws => ws.ws_changeover_active).length,
                can_finalize_primary: !!incomingId && workstations.length > 0 && workstations.every(ws => ws.ws_changeover_active)
            });
        }

        // Fallback: no workstation plan yet — return flat processes
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

// Supervisor-triggered changeover activation — warns when primary target is not yet met,
// but can proceed if the supervisor explicitly confirms.
router.post('/supervisor/changeover/activate', async (req, res) => {
    const { line_id, work_date, force } = req.body;
    if (!line_id || !work_date)
        return res.status(400).json({ success: false, error: 'line_id and work_date are required' });
    if (!CHANGEOVER_ENABLED)
        return res.status(403).json({ success: false, error: 'Changeover is disabled' });
    try {
        const planResult = await pool.query(
            `SELECT product_id, target_units, incoming_product_id, changeover_started_at, is_locked
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

        const actualOutput = await getLineActualOutput(pool, line_id, work_date, plan.product_id);
        const targetUnits = parseInt(plan.target_units, 10) || 0;
        if (actualOutput < targetUnits && !force) {
            return res.json({
                success: false,
                target_warning: true,
                line_output: actualOutput,
                line_target: targetUnits,
                message: `Primary target is ${targetUnits}, but current output is ${actualOutput}. Do you want to start changeover anyway?`
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

// Per-workstation changeover activation — supervisor can start changeover on individual workstations.
// Feed can be given to any workstation during same-day changeover; the workstation then runs the
// incoming product plan while preserving a snapshot of the primary-product state at switch time.
router.post('/supervisor/changeover/activate-workstation', async (req, res) => {
    const {
        line_id,
        work_date,
        workstation_code,
        force,
        employee_id,
        employee_mode,
        feed_given,
        feed_quantity
    } = req.body;
    if (!line_id || !work_date || !workstation_code)
        return res.status(400).json({ success: false, error: 'line_id, work_date and workstation_code are required' });
    if (!CHANGEOVER_ENABLED)
        return res.status(403).json({ success: false, error: 'Changeover is disabled' });
    try {
        const sameEmployeeMode = employee_mode === 'same' || (!employee_mode && !employee_id);
        const feedGiven = feed_given === true || feed_given === 'true';
        const normalizedFeedQty = feedGiven ? Math.max(0, parseInt(feed_quantity || 0, 10) || 0) : 0;
        if (feedGiven && normalizedFeedQty <= 0) {
            return res.status(400).json({ success: false, error: 'Feed quantity must be greater than 0 when feed is given' });
        }

        const planResult = await pool.query(
            `SELECT product_id, target_units, incoming_product_id, incoming_target_units, changeover_started_at, is_locked
             FROM line_daily_plans WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const plan = planResult.rows[0];
        if (!plan) return res.status(404).json({ success: false, error: 'No daily plan found' });
        if (!plan.incoming_product_id) return res.status(400).json({ success: false, error: 'No changeover product configured for this line' });
        if (plan.is_locked) return res.status(403).json({ success: false, error: 'Daily plan is locked' });

        const wsResult = await pool.query(
            `SELECT
                 primary_ws.id AS primary_workstation_id,
                 primary_ws.ws_changeover_active,
                 primary_ws.group_name AS primary_group_name,
                 incoming_ws.id AS incoming_workstation_id,
                 incoming_ws.group_name AS incoming_group_name
             FROM line_plan_workstations primary_ws
             LEFT JOIN line_plan_workstations incoming_ws
               ON incoming_ws.line_id = primary_ws.line_id
              AND incoming_ws.work_date = primary_ws.work_date
              AND regexp_replace(incoming_ws.workstation_code, '[^0-9]', '', 'g')::int = regexp_replace(primary_ws.workstation_code, '[^0-9]', '', 'g')::int
              AND incoming_ws.product_id = $4
             WHERE primary_ws.line_id = $1
               AND primary_ws.work_date = $2
               AND primary_ws.workstation_code = $3
               AND primary_ws.product_id = $5`,
            [line_id, work_date, workstation_code, plan.incoming_product_id, plan.product_id]
        );
        const ws = wsResult.rows[0];
        if (!ws) return res.status(404).json({ success: false, error: `Workstation ${workstation_code} not found in primary product plan` });
        if (!ws.incoming_workstation_id) {
            return res.status(400).json({ success: false, error: `Workstation ${workstation_code} is not available in the changeover product plan` });
        }
        if (ws.ws_changeover_active) return res.status(400).json({ success: false, error: 'Changeover already active for this workstation' });

        const workstationTarget = await getProductTargetQuantity(pool, plan.product_id, plan.target_units);
        const workstationCumulativeOutput = await getCumulativeWorkstationOutput(pool, {
            lineId: line_id,
            productId: plan.product_id,
            workstationCode: workstation_code,
            throughDate: work_date
        });
        if (workstationCumulativeOutput < workstationTarget && !force) {
            const remainingQty = Math.max(0, workstationTarget - workstationCumulativeOutput);
            return res.json({
                success: false,
                target_warning: true,
                line_output: workstationCumulativeOutput,
                line_target: workstationTarget,
                message: `Primary target for ${workstation_code} is ${workstationTarget}, but cumulative primary output is ${workstationCumulativeOutput}. Remaining to target: ${remainingQty}. Do you want to start changeover for ${workstation_code} anyway?`
            });
        }

        const currentAssignmentResult = await pool.query(
            `SELECT employee_id, material_provided, is_linked, linked_at, attendance_start, late_reason
             FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false
             LIMIT 1`,
            [line_id, work_date, workstation_code]
        );
        const currentAssignment = currentAssignmentResult.rows[0] || null;
        const currentEmployeeId = currentAssignment?.employee_id ? parseInt(currentAssignment.employee_id, 10) : null;
        let nextEmployeeId = null;
        if (sameEmployeeMode) {
            if (!currentEmployeeId) {
                return res.status(400).json({ success: false, error: 'No current employee is assigned to continue this changeover' });
            }
            nextEmployeeId = currentEmployeeId;
        } else {
            nextEmployeeId = employee_id ? parseInt(employee_id, 10) : null;
            if (!nextEmployeeId) {
                return res.status(400).json({ success: false, error: 'Select the employee who will run this workstation after changeover' });
            }
        }

        const preservedState = {
            is_linked: currentAssignment?.is_linked === true,
            linked_at: currentAssignment?.linked_at || null,
            attendance_start: currentAssignment?.attendance_start || null,
            late_reason: currentAssignment?.late_reason || null
        };
        const existingMaterialProvided = parseInt(currentAssignment?.material_provided || 0, 10) || 0;
        const snapshot = await getWorkstationChangeoverSnapshot(pool, {
            lineId: line_id,
            workDate: work_date,
            primaryWorkstationId: ws.primary_workstation_id,
            primaryLineProductId: plan.product_id,
            lineTargetUnits: plan.target_units,
            workstationCode: workstation_code
        });
        const groupIdentifier = ws.incoming_group_name || ws.primary_group_name || workstation_code;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `UPDATE line_plan_workstations
                 SET ws_changeover_active = true, ws_changeover_started_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
                [ws.primary_workstation_id]
            );

            await client.query(
                `UPDATE line_daily_plans
                 SET changeover_started_at = COALESCE(changeover_started_at, NOW()),
                     updated_at = NOW()
                 WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );

            await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                lineId: line_id,
                workDate: work_date,
                workstationCode: workstation_code,
                isOvertime: false,
                nextEmployeeId
            });

            if (nextEmployeeId) {
                await clearEmployeeAssignmentConflicts(
                    client,
                    nextEmployeeId,
                    work_date,
                    false,
                    line_id,
                    workstation_code
                );
                await client.query(
                    `INSERT INTO employee_workstation_assignments
                       (line_id, work_date, workstation_code, employee_id, is_overtime, line_plan_workstation_id,
                        material_provided, is_linked, linked_at, late_reason, attendance_start)
                     VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10)
                     ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                     DO UPDATE SET employee_id = EXCLUDED.employee_id,
                                   line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                   material_provided = EXCLUDED.material_provided,
                                   is_linked = EXCLUDED.is_linked,
                                   linked_at = COALESCE(EXCLUDED.linked_at, employee_workstation_assignments.linked_at),
                                   late_reason = COALESCE(EXCLUDED.late_reason, employee_workstation_assignments.late_reason),
                                   attendance_start = COALESCE(EXCLUDED.attendance_start, employee_workstation_assignments.attendance_start),
                                   assigned_at = NOW()`,
                    [
                        line_id,
                        work_date,
                        workstation_code,
                        nextEmployeeId,
                        ws.incoming_workstation_id,
                        existingMaterialProvided + normalizedFeedQty,
                        preservedState.is_linked,
                        preservedState.linked_at,
                        preservedState.late_reason,
                        preservedState.attendance_start
                    ]
                );
                await syncAssignmentHistoryForCurrentRow(client, {
                    lineId: line_id,
                    workDate: work_date,
                    workstationCode: workstation_code,
                    employeeId: nextEmployeeId,
                    linePlanWorkstationId: ws.incoming_workstation_id,
                    isOvertime: false,
                    isLinked: preservedState.is_linked,
                    linkedAt: preservedState.linked_at,
                    attendanceStart: preservedState.attendance_start,
                    lateReason: preservedState.late_reason,
                    forceCurrentHourStart: true
                });
            }

            await client.query(
                `INSERT INTO workstation_changeover_events
                   (line_id, work_date, workstation_code, primary_workstation_id, incoming_workstation_id,
                    primary_product_id, incoming_product_id, primary_employee_id, changeover_employee_id,
                    same_employee, feed_given, feed_quantity, primary_output_quantity, primary_target_quantity,
                    primary_balance_quantity, primary_pending_wip, started_at, started_by, updated_at)
                 VALUES ($1, $2, $3, $4, $5,
                         $6, $7, $8, $9,
                         $10, $11, $12, $13, $14,
                         $15, $16, NOW(), $17, NOW())
                 ON CONFLICT (line_id, work_date, workstation_code)
                 DO UPDATE SET primary_workstation_id = EXCLUDED.primary_workstation_id,
                               incoming_workstation_id = EXCLUDED.incoming_workstation_id,
                               primary_product_id = EXCLUDED.primary_product_id,
                               incoming_product_id = EXCLUDED.incoming_product_id,
                               primary_employee_id = EXCLUDED.primary_employee_id,
                               changeover_employee_id = EXCLUDED.changeover_employee_id,
                               same_employee = EXCLUDED.same_employee,
                               feed_given = EXCLUDED.feed_given,
                               feed_quantity = EXCLUDED.feed_quantity,
                               primary_output_quantity = EXCLUDED.primary_output_quantity,
                               primary_target_quantity = EXCLUDED.primary_target_quantity,
                               primary_balance_quantity = EXCLUDED.primary_balance_quantity,
                               primary_pending_wip = EXCLUDED.primary_pending_wip,
                               started_at = EXCLUDED.started_at,
                               started_by = EXCLUDED.started_by,
                               updated_at = NOW()`,
                [
                    line_id,
                    work_date,
                    workstation_code,
                    ws.primary_workstation_id,
                    ws.incoming_workstation_id,
                    plan.product_id,
                    plan.incoming_product_id,
                    currentEmployeeId,
                    nextEmployeeId,
                    sameEmployeeMode,
                    feedGiven,
                    normalizedFeedQty,
                    snapshot.workstationOutput,
                    snapshot.workstationTarget,
                    snapshot.balanceQty,
                    snapshot.pendingWip,
                    req.user?.id || null
                ]
            );

            await refreshGroupWip(line_id, work_date, groupIdentifier, client);

            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        realtime.broadcast('data_change', {
            entity: 'changeover', action: 'ws_activated', line_id, work_date, workstation_code
        });
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
        realtime.broadcast('data_change', { entity: 'workstation_assignments', action: 'update', line_id, workstation_code, work_date });
        res.json({
            success: true,
            message: `Changeover activated for workstation ${workstation_code}`,
            data: {
                workstation_code,
                same_employee: sameEmployeeMode,
                feed_given: feedGiven,
                feed_quantity: normalizedFeedQty,
                primary_output_quantity: snapshot.workstationOutput,
                primary_target_quantity: snapshot.workstationTarget,
                primary_balance_quantity: snapshot.balanceQty,
                primary_pending_wip: snapshot.pendingWip
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Revert one workstation from the CO product back to the primary product.
// Existing CO progress remains under the CO process IDs; only the live assignment
// pointer and effective workstation source are switched back to primary.
router.post('/supervisor/changeover/revert-workstation', async (req, res) => {
    const { line_id, work_date, workstation_code, employee_id } = req.body;
    if (!line_id || !work_date || !workstation_code) {
        return res.status(400).json({ success: false, error: 'line_id, work_date and workstation_code are required' });
    }
    if (!CHANGEOVER_ENABLED) {
        return res.status(403).json({ success: false, error: 'Changeover is disabled' });
    }
    if (await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    if (await isLineClosed(line_id, work_date)) {
        return res.status(403).json({ success: false, error: 'Shift is closed for this line' });
    }

    try {
        const planResult = await pool.query(
            `SELECT product_id, incoming_product_id, is_locked
             FROM line_daily_plans
             WHERE line_id = $1 AND work_date = $2`,
            [line_id, work_date]
        );
        const plan = planResult.rows[0];
        if (!plan) return res.status(404).json({ success: false, error: 'No daily plan found' });
        if (plan.is_locked) return res.status(403).json({ success: false, error: 'Daily plan is locked' });
        if (!plan.product_id || !plan.incoming_product_id) {
            return res.status(400).json({ success: false, error: 'No changeover product is configured for this line' });
        }

        const wsResult = await pool.query(
            `SELECT
                 primary_ws.id AS primary_workstation_id,
                 primary_ws.ws_changeover_active,
                 primary_ws.group_name AS primary_group_name,
                 incoming_ws.id AS incoming_workstation_id,
                 incoming_ws.group_name AS incoming_group_name
             FROM line_plan_workstations primary_ws
             LEFT JOIN line_plan_workstations incoming_ws
               ON incoming_ws.line_id = primary_ws.line_id
              AND incoming_ws.work_date = primary_ws.work_date
              AND regexp_replace(incoming_ws.workstation_code, '[^0-9]', '', 'g')::int = regexp_replace(primary_ws.workstation_code, '[^0-9]', '', 'g')::int
              AND incoming_ws.product_id = $4
             WHERE primary_ws.line_id = $1
               AND primary_ws.work_date = $2
               AND primary_ws.workstation_code = $3
               AND primary_ws.product_id = $5`,
            [line_id, work_date, workstation_code, plan.incoming_product_id, plan.product_id]
        );
        const ws = wsResult.rows[0];
        if (!ws) {
            return res.status(404).json({ success: false, error: `Workstation ${workstation_code} not found in primary product plan` });
        }
        if (!ws.incoming_workstation_id) {
            return res.status(400).json({ success: false, error: `Workstation ${workstation_code} is not available in the changeover product plan` });
        }
        if (ws.ws_changeover_active !== true) {
            return res.status(400).json({ success: false, error: 'This workstation is already on the primary product' });
        }

        const currentAssignmentResult = await pool.query(
            `SELECT employee_id, material_provided, is_linked, linked_at, attendance_start, late_reason
             FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false
             LIMIT 1`,
            [line_id, work_date, workstation_code]
        );
        const currentAssignment = currentAssignmentResult.rows[0] || null;
        const currentEmployeeId = currentAssignment?.employee_id ? parseInt(currentAssignment.employee_id, 10) : null;
        const nextEmployeeId = employee_id
            ? (parseInt(employee_id, 10) || null)
            : currentEmployeeId;
        const preservedState = {
            is_linked: currentAssignment?.is_linked === true,
            linked_at: currentAssignment?.linked_at || null,
            attendance_start: currentAssignment?.attendance_start || null,
            late_reason: currentAssignment?.late_reason || null
        };
        const materialProvided = parseInt(currentAssignment?.material_provided || 0, 10) || 0;
        const groupIdentifier = ws.primary_group_name || ws.incoming_group_name || workstation_code;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `UPDATE line_plan_workstations
                 SET ws_changeover_active = false,
                     ws_changeover_started_at = NULL,
                     updated_at = NOW()
                 WHERE id = $1`,
                [ws.primary_workstation_id]
            );

            if (currentEmployeeId && currentEmployeeId !== nextEmployeeId) {
                await closeHistoryForWorkstationAssignmentIfNeeded(client, {
                    lineId: line_id,
                    workDate: work_date,
                    workstationCode: workstation_code,
                    isOvertime: false,
                    nextEmployeeId
                });
            }

            if (nextEmployeeId) {
                await clearEmployeeAssignmentConflicts(
                    client,
                    nextEmployeeId,
                    work_date,
                    false,
                    line_id,
                    workstation_code
                );
                await client.query(
                    `INSERT INTO employee_workstation_assignments
                       (line_id, work_date, workstation_code, employee_id, is_overtime, line_plan_workstation_id,
                        material_provided, is_linked, linked_at, late_reason, attendance_start)
                     VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10)
                     ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                     DO UPDATE SET employee_id = EXCLUDED.employee_id,
                                   line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                   material_provided = EXCLUDED.material_provided,
                                   is_linked = EXCLUDED.is_linked,
                                   linked_at = COALESCE(EXCLUDED.linked_at, employee_workstation_assignments.linked_at),
                                   late_reason = COALESCE(EXCLUDED.late_reason, employee_workstation_assignments.late_reason),
                                   attendance_start = COALESCE(EXCLUDED.attendance_start, employee_workstation_assignments.attendance_start),
                                   assigned_at = NOW()`,
                    [
                        line_id,
                        work_date,
                        workstation_code,
                        nextEmployeeId,
                        ws.primary_workstation_id,
                        materialProvided,
                        preservedState.is_linked,
                        preservedState.linked_at,
                        preservedState.late_reason,
                        preservedState.attendance_start
                    ]
                );
                if (preservedState.is_linked) {
                    await syncAssignmentHistoryForCurrentRow(client, {
                        lineId: line_id,
                        workDate: work_date,
                        workstationCode: workstation_code,
                        employeeId: nextEmployeeId,
                        linePlanWorkstationId: ws.primary_workstation_id,
                        isOvertime: false,
                        isLinked: preservedState.is_linked,
                        linkedAt: preservedState.linked_at,
                        attendanceStart: preservedState.attendance_start,
                        lateReason: preservedState.late_reason,
                        forceCurrentHourStart: true
                    });
                }
            } else {
                await client.query(
                    `UPDATE employee_workstation_assignments
                     SET line_plan_workstation_id = $4,
                         assigned_at = NOW()
                     WHERE line_id = $1
                       AND work_date = $2
                       AND workstation_code = $3
                       AND is_overtime = false`,
                    [line_id, work_date, workstation_code, ws.primary_workstation_id]
                );
            }

            const activeResult = await client.query(
                `SELECT EXISTS(
                     SELECT 1
                     FROM line_plan_workstations
                     WHERE line_id = $1
                       AND work_date = $2
                       AND product_id = $3
                       AND ws_changeover_active = true
                 ) AS has_active_changeover`,
                [line_id, work_date, plan.product_id]
            );
            const hasActiveChangeover = activeResult.rows[0]?.has_active_changeover === true;

            await client.query(
                `UPDATE line_daily_plans
                 SET changeover_started_at = CASE
                         WHEN $3 THEN COALESCE(changeover_started_at, NOW())
                         ELSE NULL
                     END,
                     updated_at = NOW()
                 WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date, hasActiveChangeover]
            );

            await remapProcessMaterialWipBetweenWorkstations(client, {
                lineId: line_id,
                workDate: work_date,
                fromWorkstationId: ws.incoming_workstation_id,
                toWorkstationId: ws.primary_workstation_id
            });

            await refreshGroupWip(line_id, work_date, groupIdentifier, client);

            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        realtime.broadcast('data_change', {
            entity: 'changeover', action: 'ws_reverted', line_id, work_date, workstation_code
        });
        realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
        realtime.broadcast('data_change', { entity: 'workstation_assignments', action: 'update', line_id, workstation_code, work_date });
        res.json({
            success: true,
            message: `Workstation ${workstation_code} switched back to the primary product`,
            data: {
                workstation_code,
                employee_id: nextEmployeeId,
                material_provided: materialProvided
            }
        });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// Finalize changeover into the new primary product once every workstation has switched.
// This preserves the previous primary state in an archive row and then promotes the incoming
// product to become the line's primary product for the same day.
router.post('/supervisor/changeover/finalize-primary', async (req, res) => {
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

    let beforePlan = null;
    let archiveRecord = null;
    let updatedPlan = null;
    let promotedProductId = null;
    let promotedTargetUnits = 0;
    const fail = (status, message) => {
        const err = new Error(message);
        err.status = status;
        throw err;
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const planResult = await client.query(
            `SELECT ldp.*,
                    p.product_code AS primary_product_code,
                    p.product_name AS primary_product_name,
                    ip.product_code AS incoming_product_code,
                    ip.product_name AS incoming_product_name
             FROM line_daily_plans ldp
             LEFT JOIN products p ON p.id = ldp.product_id
             LEFT JOIN products ip ON ip.id = ldp.incoming_product_id
             WHERE ldp.line_id = $1 AND ldp.work_date = $2
             FOR UPDATE OF ldp`,
            [line_id, work_date]
        );
        beforePlan = planResult.rows[0];
        if (!beforePlan) {
            fail(404, 'No daily plan found for this line/date');
        }
        if (beforePlan.is_locked) {
            fail(403, 'Daily plan is locked');
        }
        if (!beforePlan.product_id || !beforePlan.incoming_product_id) {
            fail(400, 'No changeover product is available to promote');
        }

        const previousPrimaryProductId = parseInt(beforePlan.product_id, 10);
        promotedProductId = parseInt(beforePlan.incoming_product_id, 10);
        promotedTargetUnits = parseInt(beforePlan.incoming_target_units || 0, 10) || 0;
        if (promotedTargetUnits <= 0) {
            fail(400, 'Incoming target must be greater than 0 before promotion');
        }

        const archiveCheckResult = await client.query(
            `SELECT id
             FROM changeover_primary_promotions
             WHERE line_id = $1 AND work_date = $2
             LIMIT 1`,
            [line_id, work_date]
        );
        if (archiveCheckResult.rowCount > 0) {
            fail(409, 'Primary promotion has already been completed for this line/date');
        }

        const primaryWsResult = await client.query(
            `SELECT id, workstation_code, ws_changeover_active
             FROM line_plan_workstations
             WHERE line_id = $1 AND work_date = $2 AND product_id = $3
             ORDER BY workstation_number, workstation_code
             FOR UPDATE`,
            [line_id, work_date, previousPrimaryProductId]
        );
        if (primaryWsResult.rowCount === 0) {
            fail(400, 'No primary workstation plan exists for this line/date');
        }

        const incomingWsResult = await client.query(
            `SELECT id, workstation_code
             FROM line_plan_workstations
             WHERE line_id = $1 AND work_date = $2 AND product_id = $3
             ORDER BY workstation_number, workstation_code
             FOR UPDATE`,
            [line_id, work_date, promotedProductId]
        );
        if (incomingWsResult.rowCount === 0) {
            fail(400, 'No changeover workstation plan exists for this line/date');
        }

        const incomingByCode = new Map(
            incomingWsResult.rows.map(row => [String(row.workstation_code || ''), row])
        );
        const missingIncoming = primaryWsResult.rows
            .filter(row => !incomingByCode.has(String(row.workstation_code || '')))
            .map(row => row.workstation_code);
        if (missingIncoming.length > 0) {
            fail(400, `Missing changeover workstation mapping for: ${missingIncoming.join(', ')}`);
        }

        const pendingWorkstations = primaryWsResult.rows
            .filter(row => row.ws_changeover_active !== true)
            .map(row => row.workstation_code);
        if (pendingWorkstations.length > 0) {
            fail(400, `All workstations must switch to CO before promotion. Pending: ${pendingWorkstations.join(', ')}`);
        }

        const snapshot = await buildChangeoverPromotionSnapshot(client, {
            lineId: line_id,
            workDate: work_date,
            previousPrimaryProductId,
            newPrimaryProductId: promotedProductId,
            beforePlan
        });

        const archiveInsertResult = await client.query(
            `INSERT INTO changeover_primary_promotions
               (line_id, work_date, previous_primary_product_id, new_primary_product_id,
                previous_primary_target_units, new_primary_target_units, promoted_by, snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, line_id, work_date, previous_primary_product_id, new_primary_product_id,
                       previous_primary_target_units, new_primary_target_units, promoted_at, promoted_by`,
            [
                line_id,
                work_date,
                previousPrimaryProductId,
                promotedProductId,
                parseInt(beforePlan.target_units || 0, 10) || 0,
                promotedTargetUnits,
                req.user?.id || null,
                snapshot
            ]
        );
        archiveRecord = archiveInsertResult.rows[0];

        await normalizeRegularAssignmentsToProductWorkstations(client, {
            lineId: line_id,
            workDate: work_date,
            productId: promotedProductId
        });

        const updatedPlanResult = await client.query(
            `UPDATE line_daily_plans
             SET product_id = $1,
                 target_units = $2,
                 incoming_product_id = NULL,
                 incoming_target_units = 0,
                 changeover_sequence = 0,
                 changeover_started_at = NULL,
                 updated_by = COALESCE($3, updated_by),
                 updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [promotedProductId, promotedTargetUnits, req.user?.id || null, beforePlan.id]
        );
        updatedPlan = updatedPlanResult.rows[0];

        if (work_date === new Date().toISOString().slice(0, 10)) {
            await client.query(
                `UPDATE production_lines
                 SET current_product_id = $1,
                     target_units = $2,
                     updated_by = COALESCE($3, updated_by),
                     updated_at = NOW()
                 WHERE id = $4`,
                [promotedProductId, promotedTargetUnits, req.user?.id || null, line_id]
            );
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(err.status || 500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }

    await logAudit(
        'changeover_primary_promotions',
        archiveRecord.id,
        'create',
        archiveRecord,
        null,
        req
    );
    await logAudit(
        'line_daily_plans',
        updatedPlan.id,
        'changeover_finalize_primary',
        {
            ...updatedPlan,
            archived_promotion_id: archiveRecord.id
        },
        beforePlan,
        req
    );

    realtime.broadcast('data_change', { entity: 'daily_plans', action: 'update', line_id, work_date });
    realtime.broadcast('data_change', { entity: 'changeover', action: 'finalized_primary', line_id, work_date });
    realtime.broadcast('data_change', { entity: 'workstation_assignments', action: 'update', line_id, work_date });
    if (work_date === new Date().toISOString().slice(0, 10)) {
        realtime.broadcast('data_change', { entity: 'lines', action: 'update', id: line_id });
    }

    res.json({
        success: true,
        message: `${beforePlan.incoming_product_code || beforePlan.incoming_product_name || 'Changeover product'} is now the primary product`,
        data: {
            archived_promotion_id: archiveRecord.id,
            previous_primary_product_id: beforePlan.product_id,
            previous_primary_product_code: beforePlan.primary_product_code || null,
            previous_primary_product_name: beforePlan.primary_product_name || null,
            new_primary_product_id: promotedProductId,
            new_primary_product_code: beforePlan.incoming_product_code || null,
            new_primary_product_name: beforePlan.incoming_product_name || null,
            new_primary_target_units: promotedTargetUnits
        }
    });
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

// Resolve employee by QR without requiring line process assignment (used for morning linking)
router.post('/supervisor/resolve-employee-by-qr', async (req, res) => {
    const { employee_qr } = req.body;
    if (!employee_qr) {
        return res.status(400).json({ success: false, error: 'employee_qr is required' });
    }
    const parsed = parseSupervisorQr(employee_qr);
    if (!parsed) {
        return res.status(400).json({ success: false, error: 'Invalid employee QR payload' });
    }
    try {
        let employee = null;
        if (parsed.id) {
            const r = await pool.query(
                `SELECT id, emp_code, emp_name FROM employees WHERE id = $1 AND is_active = true`,
                [parsed.id]
            );
            employee = r.rows[0] || null;
        }
        if (!employee) {
            const rawCode = parsed.code || parsed.emp_code || parsed.raw;
            if (rawCode) {
                const r = await pool.query(
                    `SELECT id, emp_code, emp_name FROM employees WHERE emp_code = $1 AND is_active = true`,
                    [rawCode]
                );
                employee = r.rows[0] || null;
            }
        }
        if (!employee) {
            return res.status(404).json({ success: false, error: 'Employee not found' });
        }
        res.json({ success: true, data: { employee } });
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

// ─── WORKER DEPARTURE & ADJUSTMENT ───────────────────────────────────────────

// GET /supervisor/line-status/:lineId — workstation list with departure/vacancy/coverage status
router.get('/supervisor/line-status/:lineId', async (req, res) => {
    const { lineId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
        const result = await pool.query(
            `SELECT
                ewa.workstation_code,
                lpw.id AS workstation_plan_id,
                lpw.workstation_number,
                ewa.employee_id,
                e.emp_code,
                e.emp_name,
                wd.id           AS departure_id,
                wd.departure_time,
                wd.departure_reason,
                wd.notes        AS departure_notes,
                wa.id           AS adjustment_id,
                wa.adjustment_type,
                wa.reassignment_time,
                wa.from_employee_id  AS covering_employee_id,
                e_cov.emp_code  AS covering_emp_code,
                e_cov.emp_name  AS covering_emp_name,
                wa.from_workstation_code AS covering_from_ws
             FROM employee_workstation_assignments ewa
             JOIN employees e ON e.id = ewa.employee_id
             LEFT JOIN line_plan_workstations lpw
                ON lpw.line_id = ewa.line_id AND lpw.work_date = ewa.work_date
                AND lpw.workstation_code = ewa.workstation_code
             LEFT JOIN worker_departures wd
                ON wd.line_id = ewa.line_id AND wd.work_date = ewa.work_date
                AND wd.workstation_code = ewa.workstation_code AND wd.employee_id = ewa.employee_id
             LEFT JOIN worker_adjustments wa ON wa.departure_id = wd.id
             LEFT JOIN employees e_cov ON e_cov.id = wa.from_employee_id
             WHERE ewa.line_id = $1 AND ewa.work_date = $2 AND ewa.is_overtime = false
             ORDER BY COALESCE(lpw.workstation_number, 999999), ewa.workstation_code`,
            [lineId, date]
        );
        const workstations = result.rows.map(row => ({
            workstation_code: row.workstation_code,
            workstation_plan_id: row.workstation_plan_id,
            workstation_number: row.workstation_number || null,
            employee_id: row.employee_id,
            emp_code: row.emp_code,
            emp_name: row.emp_name,
            status: !row.departure_id ? 'active' : (!row.adjustment_id ? 'vacant' : 'covered'),
            departure_id: row.departure_id || null,
            departure_time: row.departure_time || null,
            departure_reason: row.departure_reason || null,
            departure_notes: row.departure_notes || null,
            adjustment_id: row.adjustment_id || null,
            adjustment_type: row.adjustment_type || null,
            reassignment_time: row.reassignment_time || null,
            covering_employee_id: row.covering_employee_id || null,
            covering_emp_code: row.covering_emp_code || null,
            covering_emp_name: row.covering_emp_name || null,
            covering_from_ws: row.covering_from_ws || null
        }));
        res.json({ success: true, data: { workstations, date } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /supervisor/worker-departure — log employee departure
router.post('/supervisor/worker-departure', async (req, res) => {
    const { line_id, work_date, employee_id, workstation_code, departure_time, departure_reason, notes } = req.body;
    if (!line_id || !employee_id || !workstation_code || !departure_reason) {
        return res.status(400).json({ success: false, error: 'line_id, employee_id, workstation_code and departure_reason are required' });
    }
    const validReasons = ['sick', 'personal', 'operational', 'other'];
    if (!validReasons.includes(departure_reason)) {
        return res.status(400).json({ success: false, error: 'Invalid departure_reason' });
    }
    const date = work_date || new Date().toISOString().slice(0, 10);
    const deptTime = departure_time || new Date().toISOString();
    try {
        // Verify employee is assigned to this workstation
        const assignCheck = await pool.query(
            `SELECT id FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND employee_id = $4 AND is_overtime = false`,
            [line_id, date, workstation_code, employee_id]
        );
        if (!assignCheck.rows[0]) {
            return res.status(400).json({ success: false, error: 'Employee is not assigned to this workstation today' });
        }
        const result = await pool.query(
            `INSERT INTO worker_departures (line_id, work_date, employee_id, workstation_code, departure_time, departure_reason, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, departure_time`,
            [line_id, date, employee_id, workstation_code, deptTime, departure_reason, notes || null]
        );
        const row = result.rows[0];
        const empResult = await pool.query(`SELECT emp_code, emp_name FROM employees WHERE id = $1`, [employee_id]);
        const emp = empResult.rows[0];
        realtime.broadcast('data_change', { entity: 'worker_departure', action: 'created', line_id, work_date: date });
        res.json({ success: true, data: { departure_id: row.id, departure_time: row.departure_time, emp_code: emp?.emp_code, emp_name: emp?.emp_name, workstation_code } });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: 'Departure already recorded for this employee and workstation today' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /supervisor/worker-adjustment — assign or combine after a departure
router.post('/supervisor/worker-adjustment', async (req, res) => {
    const { line_id, work_date, departure_id, vacant_workstation_code, from_employee_id, from_workstation_code, adjustment_type, reassignment_time } = req.body;
    if (!line_id || !departure_id || !vacant_workstation_code || !from_employee_id || !from_workstation_code || !adjustment_type) {
        return res.status(400).json({ success: false, error: 'line_id, departure_id, vacant_workstation_code, from_employee_id, from_workstation_code and adjustment_type are required' });
    }
    if (!['assign', 'combine'].includes(adjustment_type)) {
        return res.status(400).json({ success: false, error: 'adjustment_type must be assign or combine' });
    }
    const date = work_date || new Date().toISOString().slice(0, 10);
    const rTime = reassignment_time || new Date().toISOString();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Validate departure exists and belongs to this line/date
        const deptCheck = await client.query(
            `SELECT id FROM worker_departures WHERE id = $1 AND line_id = $2 AND work_date = $3`,
            [departure_id, line_id, date]
        );
        if (!deptCheck.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Departure record not found for this line/date' });
        }
        // Check not already adjusted
        const adjCheck = await client.query(`SELECT id FROM worker_adjustments WHERE departure_id = $1`, [departure_id]);
        if (adjCheck.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'This departure has already been resolved with an adjustment' });
        }
        // Validate receiving employee is assigned to from_workstation_code
        const rcvCheck = await client.query(
            `SELECT id, line_plan_workstation_id FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND employee_id = $4 AND is_overtime = false`,
            [line_id, date, from_workstation_code, from_employee_id]
        );
        if (!rcvCheck.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Receiving employee is not assigned to the specified workstation' });
        }

        // Insert adjustment record
        const adjResult = await client.query(
            `INSERT INTO worker_adjustments (line_id, work_date, departure_id, vacant_workstation_code, from_employee_id, from_workstation_code, adjustment_type, reassignment_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [line_id, date, departure_id, vacant_workstation_code, from_employee_id, from_workstation_code, adjustment_type, rTime]
        );
        const adjustmentId = adjResult.rows[0].id;

        if (adjustment_type === 'assign') {
            // Lookup line_plan_workstation_id for vacant WS
            const vacantPlanWs = await client.query(
                `SELECT id FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3`,
                [line_id, date, vacant_workstation_code]
            );
            const vacantPlanWsId = vacantPlanWs.rows[0]?.id || null;
            // Remove receiver from their original WS
            await client.query(
                `DELETE FROM employee_workstation_assignments WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false`,
                [line_id, date, from_workstation_code]
            );
            // Assign receiver to vacant WS
            await clearEmployeeAssignmentConflicts(
                client,
                from_employee_id,
                date,
                false,
                line_id,
                vacant_workstation_code
            );
            await client.query(
                `INSERT INTO employee_workstation_assignments (line_id, work_date, workstation_code, employee_id, is_overtime, line_plan_workstation_id, assigned_at)
                 VALUES ($1, $2, $3, $4, false, $5, NOW())
                 ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                 DO UPDATE SET employee_id = EXCLUDED.employee_id, line_plan_workstation_id = EXCLUDED.line_plan_workstation_id, assigned_at = NOW()`,
                [line_id, date, vacant_workstation_code, from_employee_id, vacantPlanWsId]
            );
        }
        // For combine: no change to assignments — the adjustment record is the coverage

        await client.query('COMMIT');
        const empResult = await pool.query(`SELECT emp_code, emp_name FROM employees WHERE id = $1`, [from_employee_id]);
        const emp = empResult.rows[0];
        realtime.broadcast('data_change', { entity: 'worker_adjustment', action: 'created', line_id, work_date: date });
        res.json({ success: true, data: { adjustment_id: adjustmentId, adjustment_type, vacant_workstation_code, from_emp_code: emp?.emp_code, from_emp_name: emp?.emp_name } });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// GET /supervisor/worker-departures/:lineId — departure + adjustment history for the shift
router.get('/supervisor/worker-departures/:lineId', async (req, res) => {
    const { lineId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    try {
        const result = await pool.query(
            `SELECT
                wd.id AS departure_id, wd.workstation_code, wd.departure_time, wd.departure_reason, wd.notes,
                lpw.workstation_number,
                e_dep.emp_code AS dep_emp_code, e_dep.emp_name AS dep_emp_name,
                wa.id AS adjustment_id, wa.adjustment_type, wa.reassignment_time,
                wa.from_workstation_code AS covering_from_ws,
                e_cov.emp_code AS covering_emp_code, e_cov.emp_name AS covering_emp_name
             FROM worker_departures wd
             JOIN employees e_dep ON e_dep.id = wd.employee_id
             LEFT JOIN line_plan_workstations lpw
                ON lpw.line_id = wd.line_id AND lpw.work_date = wd.work_date
                AND lpw.workstation_code = wd.workstation_code
             LEFT JOIN worker_adjustments wa ON wa.departure_id = wd.id
             LEFT JOIN employees e_cov ON e_cov.id = wa.from_employee_id
             WHERE wd.line_id = $1 AND wd.work_date = $2
             ORDER BY COALESCE(lpw.workstation_number, 999999), wd.workstation_code, wd.departure_time DESC`,
            [lineId, date]
        );
        res.json({ success: true, data: result.rows });
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

router.post('/supervisor/mapping/unlink-workstation', async (req, res) => {
    const { lineId, date, workstationCode } = req.body;
    if (!lineId || !date || !workstationCode) return res.status(400).json({ success: false, error: 'lineId, date, and workstationCode required' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existingResult = await client.query(
            `SELECT employee_id, is_linked
             FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false
             LIMIT 1`,
            [lineId, date, workstationCode]
        );
        const existingRow = existingResult.rows[0];
        await client.query(
            `UPDATE employee_workstation_assignments
             SET is_linked = false
             WHERE line_id = $1 AND work_date = $2 AND workstation_code = $3 AND is_overtime = false`,
            [lineId, date, workstationCode]
        );
        if (existingRow?.employee_id && existingRow?.is_linked) {
            await closeAssignmentHistoryForEmployee(client, {
                employeeId: existingRow.employee_id,
                workDate: date,
                isOvertime: false
            });
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

router.post('/supervisor/mapping/unlink-all', async (req, res) => {
    const { lineId, date } = req.body;
    if (!lineId || !date) return res.status(400).json({ success: false, error: 'lineId and date required' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existingResult = await client.query(
            `SELECT employee_id
             FROM employee_workstation_assignments
             WHERE line_id = $1 AND work_date = $2 AND is_overtime = false AND is_linked = true AND employee_id IS NOT NULL`,
            [lineId, date]
        );
        await client.query(
            `UPDATE employee_workstation_assignments SET is_linked = false WHERE line_id = $1 AND work_date = $2 AND is_overtime = false`,
            [lineId, date]
        );
        for (const row of existingResult.rows) {
            await closeAssignmentHistoryForEmployee(client, {
                employeeId: row.employee_id,
                workDate: date,
                isOvertime: false
            });
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
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
    const adminOverride = req.user?.role === 'admin' && req.headers['x-worksync-admin-override'] === '1';
    if (!adminOverride && await isDayLocked(work_date)) {
        return res.status(403).json({ success: false, error: 'Production day is locked' });
    }
    if (!adminOverride && await isLineClosed(line_id, work_date)) {
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
            // Refresh group WIP for the group this workstation belongs to
            const wsGrpRes = await pool.query(
                `SELECT COALESCE(group_name, workstation_code) AS group_identifier
                 FROM line_plan_workstations WHERE id = $1`,
                [workstation_plan_id]
            );
            if (wsGrpRes.rows[0]?.group_identifier) {
                await refreshGroupWip(line_id, work_date, wsGrpRes.rows[0].group_identifier);
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
        // Refresh group WIP for the group this process belongs to
        const legacyGrpRes = await pool.query(
            `SELECT COALESCE(lpw.group_name, lpw.workstation_code) AS group_identifier
             FROM line_plan_workstations lpw
             JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
             WHERE lpwp.product_process_id = $1 AND lpw.line_id = $2 AND lpw.work_date = $3
             LIMIT 1`,
            [process_id, line_id, work_date]
        );
        if (legacyGrpRes.rows[0]?.group_identifier) {
            await refreshGroupWip(line_id, work_date, legacyGrpRes.rows[0].group_identifier);
        }
        realtime.broadcast('data_change', { entity: 'progress', action: 'update', line_id, process_id, work_date, hour_slot });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /supervisor/ws-employees?line_id=&work_date=&hour=
// Returns the employee active at each workstation for a specific hour (from assignment history).
router.get('/supervisor/ws-employees', async (req, res) => {
    const { line_id, work_date, hour } = req.query;
    if (!line_id || !work_date || hour === undefined) {
        return res.status(400).json({ success: false, error: 'line_id, work_date and hour are required' });
    }
    const hourInt = parseInt(hour, 10);
    if (!Number.isFinite(hourInt)) {
        return res.status(400).json({ success: false, error: 'hour must be a number' });
    }
    try {
        const result = await pool.query(
            `SELECT hist.workstation_code,
                    hist.effective_from_hour,
                    hist.id,
                    e.emp_code,
                    e.emp_name,
                    e.id AS employee_id
             FROM employee_workstation_assignment_history hist
             LEFT JOIN employees e ON e.id = hist.employee_id
             WHERE hist.line_id = $1
               AND hist.work_date = $2
               AND hist.is_overtime = false
               AND hist.effective_from_hour <= $3
               AND COALESCE(hist.effective_to_hour, 999) >= $3
             ORDER BY hist.effective_from_hour DESC, hist.id DESC`,
            [line_id, work_date, hourInt]
        );
        // Keep most recent per normalized workstation code
        const seen = new Set();
        const employees = [];
        for (const row of result.rows) {
            const nk = String(parseInt(String(row.workstation_code || '').replace(/[^0-9]/g, ''), 10) || row.workstation_code);
            if (seen.has(nk)) continue;
            seen.add(nk);
            employees.push({
                workstation_code: row.workstation_code,
                workstation_key: nk,
                employee_id: row.employee_id,
                emp_code: row.emp_code,
                emp_name: row.emp_name
            });
        }
        res.json({ success: true, data: employees });
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

router.post('/supervisor/ot-progress', async (req, res) => {
    const { line_id, work_date, ot_workstation_id, quantity, qa_rejection, remarks } = req.body;
    if (!line_id || !work_date || !ot_workstation_id || quantity === undefined) {
        return res.status(400).json({ success: false, error: 'line_id, work_date, ot_workstation_id, and quantity are required' });
    }
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 0) {
        return res.status(400).json({ success: false, error: 'quantity must be a non-negative integer' });
    }
    try {
        // Look up the workstation to get workstation_code for employee lookup
        const wsRes = await pool.query(
            `SELECT low.workstation_code,
                    regular_shift_wip_quantity,
                    source_hourly_target,
                    ot_minutes,
                    source_product_id,
                    lop.work_date,
                    lop.line_id
             FROM line_ot_workstations low
             JOIN line_ot_plans lop ON lop.id = low.ot_plan_id
             WHERE low.id=$1`,
            [ot_workstation_id]
        );
        if (!wsRes.rows[0]) {
            return res.status(404).json({ success: false, error: 'OT workstation not found' });
        }
        const wsCode = wsRes.rows[0].workstation_code;
        const openingWipQty = parseInt(wsRes.rows[0].regular_shift_wip_quantity || 0, 10) || 0;
        let hourlyTarget = parseFloat(wsRes.rows[0].source_hourly_target || 0) || 0;
        if (hourlyTarget <= 0) {
            const shiftWindow = await getShiftWindowDetails();
            const dailyPlanRes = await pool.query(
                `SELECT product_id, target_units, incoming_product_id, incoming_target_units
                 FROM line_daily_plans
                 WHERE line_id = $1 AND work_date = $2`,
                [line_id, work_date]
            );
            const dailyPlan = dailyPlanRes.rows[0] || {};
            const sourceProductId = parseInt(wsRes.rows[0].source_product_id || 0, 10) || 0;
            const sourceTargetUnits = sourceProductId && sourceProductId === parseInt(dailyPlan.incoming_product_id || 0, 10)
                ? (parseInt(dailyPlan.incoming_target_units || 0, 10) || 0)
                : (parseInt(dailyPlan.target_units || 0, 10) || 0);
            hourlyTarget = shiftWindow.workingHours > 0 ? (sourceTargetUnits / shiftWindow.workingHours) : 0;
        }
        const otMinutes = parseInt(wsRes.rows[0].ot_minutes || 0, 10) || 0;
        const otTargetUnits = Math.round((hourlyTarget * otMinutes) / 60);
        const balanceQty = Math.max(0, otTargetUnits - qty);
        const closingWipQty = Math.max(0, openingWipQty - qty);

        // Look up assigned OT employee
        const empRes = await pool.query(
            `SELECT employee_id FROM employee_workstation_assignments
             WHERE line_id=$1 AND work_date=$2 AND workstation_code=$3 AND is_overtime=true`,
            [line_id, work_date, wsCode]
        );
        const employeeId = empRes.rows[0]?.employee_id || null;

        await pool.query(
            `INSERT INTO line_ot_progress
               (line_id, ot_workstation_id, work_date, quantity, qa_rejection, remarks, employee_id,
                opening_wip_quantity, ot_target_units, balance_quantity, closing_wip_quantity)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (ot_workstation_id, work_date)
             DO UPDATE SET quantity=EXCLUDED.quantity, qa_rejection=EXCLUDED.qa_rejection,
                           remarks=EXCLUDED.remarks, employee_id=EXCLUDED.employee_id,
                           opening_wip_quantity = EXCLUDED.opening_wip_quantity,
                           ot_target_units = EXCLUDED.ot_target_units,
                           balance_quantity = EXCLUDED.balance_quantity,
                           closing_wip_quantity = EXCLUDED.closing_wip_quantity,
                           updated_at=NOW()`,
            [line_id, ot_workstation_id, work_date, qty,
             parseInt(qa_rejection || 0, 10), remarks || null, employeeId,
             openingWipQty, otTargetUnits, balanceQty, closingWipQty]
        );
        realtime.broadcast('line_' + line_id, { entity: 'ot_progress', action: 'update', work_date, line_id });
        res.json({
            success: true,
            data: {
                ot_workstation_id,
                quantity: qty,
                opening_wip_quantity: openingWipQty,
                ot_target_units: otTargetUnits,
                balance_quantity: balanceQty,
                closing_wip_quantity: closingWipQty
            }
        });
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
        const data = await getHourlyEmployeeProgress(pool, line_id, date, hourValue, false);
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
        const effectiveProcesses = await getEffectiveRegularSourceProcesses(pool, line_id, date);
        const processMap = new Map();
        for (const proc of effectiveProcesses) {
            if (!proc?.process_id || processMap.has(proc.process_id)) continue;
            processMap.set(proc.process_id, proc);
        }
        const processRows = Array.from(processMap.values()).sort((a, b) => {
            const wsDiff = (a.workstation_number || 0) - (b.workstation_number || 0);
            if (wsDiff !== 0) return wsDiff;
            return (a.sequence_number || 0) - (b.sequence_number || 0);
        });

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
                wip_by_process: processRows.map(proc => ({
                    process_id: proc.process_id,
                    sequence_number: proc.sequence_number,
                    operation_code: proc.operation_code,
                    operation_name: proc.operation_name,
                    source_product_id: proc.source_product_id || null,
                    source_mode: proc.source_mode || 'primary',
                    is_changeover: !!proc.is_changeover,
                    materials_in: wipMap.get(String(proc.process_id))?.materials_in || 0,
                    materials_out: wipMap.get(String(proc.process_id))?.materials_out || 0,
                    wip_quantity: wipMap.get(String(proc.process_id))?.wip_quantity || 0
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
        const effectiveProcesses = await getEffectiveRegularSourceProcesses(pool, lineId, workDate);
        const processMap = new Map();
        for (const proc of effectiveProcesses) {
            if (!proc?.process_id || processMap.has(proc.process_id)) continue;
            processMap.set(proc.process_id, {
                id: proc.process_id,
                sequence_number: proc.sequence_number,
                operation_code: proc.operation_code,
                operation_name: proc.operation_name,
                source_product_id: proc.source_product_id || null,
                source_mode: proc.source_mode || 'primary',
                is_changeover: !!proc.is_changeover
            });
        }
        const data = Array.from(processMap.values()).sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
        res.json({ success: true, data });
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
        const lunchMins = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10) || 0;
        const workingHours = getNetWorkingMinutes(inTime, outTime, lunchMins) / 60;
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
                const diff = getNetWorkingMinutes(row.in_time, row.out_time, lunchMins) / 60;
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
    }
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
// OSM REPORT — Per-process OSM observation points with cross-date cumulative output
// Params: line_id, to_date (or date for backward compat), from_date (optional, defaults to product start date)
// Only processes with osm_checked=true appear; numbered OSM1, OSM2, ... in sequence order.
// ============================================================================
router.get('/osm-report', async (req, res) => {
    const { line_id } = req.query;
    // Support both old ?date= and new ?from_date=&to_date= params
    const toDate   = req.query.to_date   || req.query.date || new Date().toISOString().slice(0, 10);
    if (!line_id || !toDate) {
        return res.status(400).json({ success: false, error: 'line_id and to_date (or date) are required' });
    }
    try {
        const inTime  = await getSettingValue('default_in_time',  '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const lunchMinsOsm = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10);
        const [inH, inM]   = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingSeconds = (outH * 3600 + outM * 60) - (inH * 3600 + inM * 60) - lunchMinsOsm * 60;
        const workingHours   = workingSeconds / 3600;

        const lineResult = await pool.query(`
            SELECT pl.line_name, pl.line_code,
                   ldp.target_units, ldp.product_id,
                   ldp.incoming_target_units, ldp.incoming_product_id,
                   p.product_code, p.product_name, COALESCE(p.target_qty, 0) AS total_target,
                   COALESCE(p.buyer_name, '') AS buyer_name,
                   ip.product_code AS incoming_product_code,
                   ip.product_name AS incoming_product_name,
                   COALESCE(ip.target_qty, 0) AS incoming_total_target,
                   COALESCE(ip.buyer_name, '') AS incoming_buyer_name
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $2
            LEFT JOIN products p ON p.id = ldp.product_id
            LEFT JOIN products ip ON ip.id = ldp.incoming_product_id
            WHERE pl.id = $1
        `, [line_id, toDate]);

        if (!lineResult.rows[0]) {
            return res.status(404).json({ success: false, error: 'Line not found' });
        }
        const line = lineResult.rows[0];

        if (!line.product_id && !line.incoming_product_id) {
            return res.json({
                success: true,
                line_name: line.line_name, line_code: line.line_code,
                product_code: '', product_name: '', buyer_name: '', to_date: toDate, date: toDate,
                target_units: 0, total_target: 0, in_time: inTime, out_time: outTime,
                working_hours: workingHours, osm_points: [], changeover: null
            });
        }
        const buildDailyOsmData = async ({
            productId,
            productCode,
            productName,
            buyerName,
            targetUnits,
            totalTarget
        }) => {
            if (!productId) return null;
            const normalizedTarget = parseInt(targetUnits || 0, 10) || 0;
            const normalizedTotalTarget = parseInt(totalTarget || 0, 10) || 0;

            let fromDate = req.query.from_date || null;
            if (!fromDate) {
                const firstDateRes = await pool.query(
                    `SELECT MIN(work_date)::text AS first_date
                     FROM line_daily_plans
                     WHERE line_id = $1
                       AND work_date <= $3
                       AND (product_id = $2 OR incoming_product_id = $2)`,
                    [line_id, productId, toDate]
                );
                fromDate = firstDateRes.rows[0]?.first_date || toDate;
            }

            const osmResult = await pool.query(`
                SELECT lpwp.id AS lpwp_id,
                       lpw.workstation_code,
                       lpw.workstation_number,
                       pp.id AS process_id,
                       pp.sequence_number,
                       o.operation_code,
                       o.operation_name
                FROM line_plan_workstations lpw
                JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
                JOIN product_processes pp ON lpwp.product_process_id = pp.id
                JOIN operations o ON pp.operation_id = o.id
                WHERE lpw.line_id = $1 AND lpw.work_date = $2 AND lpw.product_id = $3
                  AND lpwp.osm_checked = true
                ORDER BY pp.sequence_number, lpwp.sequence_in_workstation
            `, [line_id, toDate, productId]);

            if (!osmResult.rows.length) {
                return {
                    product_id: productId,
                    product_code: productCode || '',
                    product_name: productName || '',
                    buyer_name: buyerName || '',
                    from_date: fromDate,
                    to_date: toDate,
                    target_units: normalizedTarget,
                    total_target: normalizedTotalTarget,
                    osm_points: []
                };
            }

            const processIds = osmResult.rows.map(r => r.process_id);
            const hourlyResult = await pool.query(`
                SELECT lph.process_id, lph.hour_slot,
                       MAX(lph.quantity) as quantity,
                       string_agg(DISTINCT lph.shortfall_reason, '; ')
                           FILTER (WHERE lph.shortfall_reason IS NOT NULL AND lph.shortfall_reason <> '')
                           as shortfall_reason
                FROM line_process_hourly_progress lph
                WHERE lph.process_id = ANY($1::int[])
                  AND lph.line_id = $2 AND lph.work_date = $3
                GROUP BY lph.process_id, lph.hour_slot
                ORDER BY lph.process_id, lph.hour_slot
            `, [processIds, line_id, toDate]);

            const cumulativeResult = await pool.query(`
                SELECT process_id,
                       COALESCE(SUM(max_qty), 0) AS cumulative_output
                FROM (
                    SELECT process_id, work_date, hour_slot, MAX(quantity) AS max_qty
                    FROM line_process_hourly_progress
                    WHERE process_id = ANY($1::int[])
                      AND line_id = $2
                      AND work_date <= $3
                    GROUP BY process_id, work_date, hour_slot
                ) per_slot
                GROUP BY process_id
            `, [processIds, line_id, toDate]);

            const hourlyMap = {};
            for (const row of hourlyResult.rows) {
                if (!hourlyMap[row.process_id]) hourlyMap[row.process_id] = {};
                hourlyMap[row.process_id][row.hour_slot] = {
                    quantity: parseInt(row.quantity || 0, 10) || 0,
                    shortfall_reason: row.shortfall_reason || null
                };
            }
            const cumulativeMap = {};
            for (const row of cumulativeResult.rows) {
                cumulativeMap[row.process_id] = parseInt(row.cumulative_output || 0, 10) || 0;
            }

            const osmPoints = osmResult.rows.map((row, idx) => ({
                osm_number: idx + 1,
                osm_label: `OSM${idx + 1}`,
                lpwp_id: row.lpwp_id,
                process_id: row.process_id,
                workstation_code: row.workstation_code,
                operation_code: row.operation_code,
                operation_name: row.operation_name,
                sequence_number: row.sequence_number,
                hourly: hourlyMap[row.process_id] || {},
                cumulative_output: cumulativeMap[row.process_id] || 0
            }));

            return {
                product_id: productId,
                product_code: productCode || '',
                product_name: productName || '',
                buyer_name: buyerName || '',
                from_date: fromDate,
                to_date: toDate,
                target_units: normalizedTarget,
                total_target: normalizedTotalTarget,
                osm_points: osmPoints
            };
        };

        const primaryData = await buildDailyOsmData({
            productId: line.product_id,
            productCode: line.product_code,
            productName: line.product_name,
            buyerName: line.buyer_name,
            targetUnits: line.target_units,
            totalTarget: line.total_target
        });

        const shouldLoadChangeover = !!line.incoming_product_id && String(line.incoming_product_id) !== String(line.product_id || '');
        const changeoverData = shouldLoadChangeover
            ? await buildDailyOsmData({
                productId: line.incoming_product_id,
                productCode: line.incoming_product_code,
                productName: line.incoming_product_name,
                buyerName: line.incoming_buyer_name,
                targetUnits: line.incoming_target_units,
                totalTarget: line.incoming_total_target
            })
            : null;

        const primaryPoints = primaryData?.osm_points || [];
        const changeoverPoints = changeoverData?.osm_points || [];
        const noOsmPoints = !primaryPoints.length && !changeoverPoints.length;

        res.json({
            success: true,
            line_name: line.line_name,
            line_code: line.line_code,
            product_code: primaryData?.product_code || '',
            product_name: primaryData?.product_name || '',
            buyer_name: primaryData?.buyer_name || '',
            to_date: toDate,
            from_date: primaryData?.from_date || toDate,
            date: toDate,
            target_units: primaryData?.target_units || 0,
            total_target: primaryData?.total_target || 0,
            in_time: inTime,
            out_time: outTime,
            working_hours: workingHours,
            osm_points: primaryPoints,
            changeover: changeoverData,
            no_osm_points: noOsmPoints
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/osm-report-range — date-range aggregated OSM (no hourly breakdown)
router.get('/osm-report-range', async (req, res) => {
    const { line_id, from_date, to_date } = req.query;
    if (!line_id || !from_date || !to_date) {
        return res.status(400).json({ success: false, error: 'line_id, from_date and to_date are required' });
    }
    try {
        const lineResult = await pool.query(`
            SELECT pl.line_name, pl.line_code,
                   ldp.target_units, ldp.product_id,
                   ldp.incoming_target_units, ldp.incoming_product_id,
                   p.product_code, p.product_name,
                   COALESCE(p.buyer_name, '') AS buyer_name,
                   COALESCE(p.target_qty, 0) AS total_target,
                   ip.product_code AS incoming_product_code,
                   ip.product_name AS incoming_product_name,
                   COALESCE(ip.buyer_name, '') AS incoming_buyer_name,
                   COALESCE(ip.target_qty, 0) AS incoming_total_target
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $2
            LEFT JOIN products p ON p.id = ldp.product_id
            LEFT JOIN products ip ON ip.id = ldp.incoming_product_id
            WHERE pl.id = $1
        `, [line_id, to_date]);

        const line = lineResult.rows[0];
        if (!line) return res.status(404).json({ success: false, error: 'Line not found' });
        if (!line.product_id && !line.incoming_product_id) {
            return res.json({ success: true, line_name: line.line_name, line_code: line.line_code, osm_points: [], no_plan: true });
        }
        const buildRangeOsmData = async ({
            productId,
            productCode,
            productName,
            buyerName,
            targetUnits,
            totalTarget
        }) => {
            if (!productId) return null;
            const normalizedTarget = parseInt(targetUnits || 0, 10) || 0;
            const normalizedTotalTarget = parseInt(totalTarget || 0, 10) || 0;

            const osmResult = await pool.query(`
                SELECT lpwp.id AS lpwp_id,
                       lpw.workstation_code, lpw.workstation_number,
                       pp.id AS process_id, pp.sequence_number,
                       o.operation_code, o.operation_name
                FROM line_plan_workstations lpw
                JOIN line_plan_workstation_processes lpwp ON lpwp.workstation_id = lpw.id
                JOIN product_processes pp ON lpwp.product_process_id = pp.id
                JOIN operations o ON pp.operation_id = o.id
                WHERE lpw.line_id = $1 AND lpw.work_date = $2 AND lpw.product_id = $3
                  AND lpwp.osm_checked = true
                ORDER BY pp.sequence_number, lpwp.sequence_in_workstation
            `, [line_id, to_date, productId]);

            if (!osmResult.rows.length) {
                return {
                    product_id: productId,
                    product_code: productCode || '',
                    product_name: productName || '',
                    buyer_name: buyerName || '',
                    from_date,
                    to_date,
                    target_units: normalizedTarget,
                    total_target: normalizedTotalTarget,
                    day_count: 0,
                    range_target: 0,
                    osm_points: []
                };
            }

            const processIds = osmResult.rows.map(r => r.process_id);
            const daysResult = await pool.query(`
                SELECT COUNT(DISTINCT work_date) AS day_count
                FROM line_process_hourly_progress
                WHERE line_id = $1
                  AND process_id = ANY($2::int[])
                  AND work_date BETWEEN $3 AND $4
            `, [line_id, processIds, from_date, to_date]);
            const dayCount = parseInt(daysResult.rows[0]?.day_count || 0, 10) || 0;
            const rangeTarget = dayCount * normalizedTarget;

            const aggResult = await pool.query(`
                SELECT process_id,
                       SUM(ph.qty) AS total_output,
                       string_agg(
                           CASE WHEN ph.reason IS NOT NULL AND ph.reason <> ''
                                THEN TO_CHAR(ph.work_date, 'DD/MM/YY') || ': ' || ph.reason END,
                           '; ' ORDER BY ph.work_date
                       ) FILTER (WHERE ph.reason IS NOT NULL AND ph.reason <> '') AS reasons
                FROM (
                    SELECT process_id, work_date, hour_slot,
                           MAX(quantity) AS qty,
                           string_agg(DISTINCT shortfall_reason, '; ')
                               FILTER (WHERE shortfall_reason IS NOT NULL AND shortfall_reason <> '') AS reason
                    FROM line_process_hourly_progress
                    WHERE process_id = ANY($1::int[]) AND line_id = $2
                      AND work_date BETWEEN $3 AND $4
                    GROUP BY process_id, work_date, hour_slot
                ) ph
                GROUP BY process_id
            `, [processIds, line_id, from_date, to_date]);

            const aggMap = {};
            for (const row of aggResult.rows) {
                aggMap[row.process_id] = {
                    total_output: parseInt(row.total_output || 0, 10) || 0,
                    reasons: row.reasons || ''
                };
            }

            const osmPoints = osmResult.rows.map((row, idx) => {
                const agg = aggMap[row.process_id] || { total_output: 0, reasons: '' };
                const blog = agg.total_output - rangeTarget;
                return {
                    osm_number: idx + 1,
                    osm_label: `OSM${idx + 1}`,
                    workstation_number: row.workstation_number,
                    workstation_code: row.workstation_code,
                    operation_code: row.operation_code,
                    operation_name: row.operation_name,
                    total_output: agg.total_output,
                    blog: blog < 0 ? blog : 0,
                    extra: blog > 0 ? blog : 0,
                    reasons: agg.reasons
                };
            });

            return {
                product_id: productId,
                product_code: productCode || '',
                product_name: productName || '',
                buyer_name: buyerName || '',
                from_date,
                to_date,
                target_units: normalizedTarget,
                total_target: normalizedTotalTarget,
                day_count: dayCount,
                range_target: rangeTarget,
                osm_points: osmPoints
            };
        };

        const primaryData = await buildRangeOsmData({
            productId: line.product_id,
            productCode: line.product_code,
            productName: line.product_name,
            buyerName: line.buyer_name,
            targetUnits: line.target_units,
            totalTarget: line.total_target
        });

        const shouldLoadChangeover = !!line.incoming_product_id && String(line.incoming_product_id) !== String(line.product_id || '');
        const changeoverData = shouldLoadChangeover
            ? await buildRangeOsmData({
                productId: line.incoming_product_id,
                productCode: line.incoming_product_code,
                productName: line.incoming_product_name,
                buyerName: line.incoming_buyer_name,
                targetUnits: line.incoming_target_units,
                totalTarget: line.incoming_total_target
            })
            : null;

        const primaryPoints = primaryData?.osm_points || [];
        const changeoverPoints = changeoverData?.osm_points || [];

        res.json({
            success: true,
            line_name: line.line_name,
            line_code: line.line_code,
            product_code: primaryData?.product_code || '',
            product_name: primaryData?.product_name || '',
            buyer_name: primaryData?.buyer_name || '',
            from_date,
            to_date,
            target_units: primaryData?.target_units || 0,
            total_target: primaryData?.total_target || 0,
            range_target: primaryData?.range_target || 0,
            day_count: primaryData?.day_count || 0,
            osm_points: primaryPoints,
            changeover: changeoverData,
            no_osm_points: !primaryPoints.length && !changeoverPoints.length
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/efficiency-report?line_id=&date=
// Returns Line Efficiency and per-workstation Worker Efficiency for a given line and date
router.get('/efficiency-report', async (req, res) => {
    const { line_id, date } = req.query;
    const hourValue = req.query.hour !== undefined ? parseInt(req.query.hour, 10) : null;
    if (!line_id || !date) {
        return res.status(400).json({ success: false, error: 'line_id and date are required' });
    }
    if (hourValue !== null && (!Number.isFinite(hourValue) || hourValue < 8 || hourValue > 19)) {
        return res.status(400).json({ success: false, error: 'hour must be between 8 and 19' });
    }
    try {
        // 1. Line info + daily plan
        const lineResult = await pool.query(`
            SELECT pl.id, pl.line_code, pl.line_name,
                   ldp.target_units, ldp.product_id, ldp.ot_enabled,
                   ldp.incoming_product_id,
                   p.product_code, p.product_name,
                   ip.product_code AS incoming_product_code,
                   ip.product_name AS incoming_product_name
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $2
            LEFT JOIN products p ON p.id = ldp.product_id
            LEFT JOIN products ip ON ip.id = ldp.incoming_product_id
            WHERE pl.id = $1
        `, [line_id, date]);

        if (lineResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Line not found' });
        }
        const line = lineResult.rows[0];
        const productId = line.product_id;
        const targetUnits = parseInt(line.target_units || 0);

        if (!productId) {
            return res.json({ success: true, data: null, message: 'No plan for this line on the selected date' });
        }

        // 2. Style SAH (total hours per finished piece for the product)
        const sahResult = await pool.query(`
            SELECT COALESCE(SUM(operation_sah), 0) as style_sah
            FROM product_processes WHERE product_id = $1 AND is_active = true
        `, [productId]);
        const styleSAH = parseFloat(sahResult.rows[0].style_sah) || 0;

        // 3. Working hours (subtract lunch break)
        const inTime = await getSettingValue('default_in_time', '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const lunchMinsEffRpt = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10);
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        const workingHours = (outH + outM / 60) - (inH + inM / 60) - lunchMinsEffRpt / 60;
        const workingSeconds = workingHours * 3600;

        // 4. Effective regular workstations: only the workstations already switched to CO
        // should use the incoming product plan. Everything else stays on the primary plan.
        const effectiveWsState = await getEffectiveRegularSourceWorkstations(pool, line_id, date);
        const workstations = effectiveWsState?.workstations || [];

        const reportHour = hourValue;
        const hourLabel = reportHour !== null ? formatHourRangeLabel(reportHour) : null;

        const historyDisplayHour = Number.isFinite(reportHour)
            ? reportHour
            : (REPORT_WORK_HOURS[REPORT_WORK_HOURS.length - 1] || 16);
        const activeAssignmentResult = await pool.query(
            `SELECT hist.employee_id,
                    hist.workstation_code,
                    hist.effective_from_hour,
                    e.emp_code,
                    e.emp_name
             FROM employee_workstation_assignment_history hist
             LEFT JOIN employees e ON e.id = hist.employee_id
             WHERE hist.line_id = $1
               AND hist.work_date = $2
               AND hist.is_overtime = false
               AND hist.effective_from_hour <= $3
               AND COALESCE(hist.effective_to_hour, 999) >= $3
             ORDER BY hist.effective_from_hour DESC, hist.id DESC`,
            [line_id, date, historyDisplayHour]
        );
        // Key by normalized WS code; first row wins (most recent effective_from_hour)
        // so W01→VASANTHI(from 16) beats WS01→FAIZULLAH(from 8) at the same workstation
        const activeAssignmentMap = new Map();
        for (const row of activeAssignmentResult.rows) {
            const nk = normalizeWsCode(row.workstation_code);
            if (!activeAssignmentMap.has(nk)) activeAssignmentMap.set(nk, row);
        }
        const manpower = activeAssignmentMap.size;

        // 7. OT workstations (if OT is enabled for this line+date)
        let otWorkstations = [];
        let otTargetUnits = 0;
        if (line.ot_enabled) {
            const otResult = await pool.query(`
                SELECT lotw.id, lotw.workstation_code, lotw.workstation_number,
                       lotw.is_active, lotw.ot_minutes, lotw.actual_sam_seconds,
                       lop.global_ot_minutes, lop.ot_target_units,
                       lotp.quantity as ot_output,
                       ewa.employee_id, e.emp_code as ot_emp_code, e.emp_name as ot_emp_name
                FROM line_ot_workstations lotw
                JOIN line_ot_plans lop ON lop.id = lotw.ot_plan_id
                    AND lop.line_id = $1 AND lop.work_date = $2
                LEFT JOIN line_ot_progress lotp
                    ON lotp.ot_workstation_id = lotw.id AND lotp.work_date = $2
                LEFT JOIN employee_workstation_assignments ewa
                    ON ewa.line_id = $1 AND ewa.work_date = $2
                    AND ewa.workstation_code = lotw.workstation_code AND ewa.is_overtime = true
                LEFT JOIN employees e ON e.id = ewa.employee_id
                ORDER BY lotw.workstation_number
            `, [line_id, date]);
            otWorkstations = otResult.rows;
            otTargetUnits = parseInt(otWorkstations[0]?.ot_target_units || 0);
        }

        // 8. Build OT lookup by workstation_code
        const otMap = {};
        otWorkstations.forEach(w => { otMap[w.workstation_code] = w; });

        // Include both primary and CO plan WS IDs so output can be looked up for any hour
        const wsIdSet = new Set();
        workstations.forEach(w => {
            if (Number.isFinite(w.source_line_plan_workstation_id)) wsIdSet.add(w.source_line_plan_workstation_id);
            if (Number.isFinite(w.primary_source_plan_workstation_id)) wsIdSet.add(w.primary_source_plan_workstation_id);
        });
        const wsIds = [...wsIdSet];
        const hourlyOutputMap = Number.isFinite(reportHour)
            ? await getWorkstationOutputMap(pool, line_id, date, wsIds, { exactHour: reportHour })
            : {};
        const liveOutputMap = Number.isFinite(reportHour)
            ? await getWorkstationOutputMap(pool, line_id, date, wsIds, { endHour: reportHour })
            : await getWorkstationOutputMap(pool, line_id, date, wsIds, {});

        const hourlyEmployeeProgress = Number.isFinite(reportHour)
            ? await getHourlyEmployeeProgress(pool, line_id, date, reportHour, false)
            : [];

        // Build per-employee average hourly efficiency up to the live hour
        const hoursForAvg = Number.isFinite(reportHour)
            ? REPORT_WORK_HOURS.filter(h => h <= reportHour)
            : REPORT_WORK_HOURS.slice();
        const hourlyEffByHour = new Map(); // hour -> Map(empId -> eff)
        if (hoursForAvg.length) {
            const perHourSets = await Promise.all(
                hoursForAvg.map(h => getHourlyEmployeeProgress(pool, line_id, date, h, false))
            );
            perHourSets.forEach((rows, idx) => {
                const hour = hoursForAvg[idx];
                const map = new Map();
                rows.forEach(r => map.set(String(r.id), r.efficiency_percent || 0));
                hourlyEffByHour.set(hour, map);
            });
        }

        // 9. Per-workstation calculations
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const liveHoursRaw = Number.isFinite(reportHour)
            ? Math.max(1, REPORT_WORK_HOURS.filter(h => h <= reportHour).length)
            : workingHours;
        const liveHours = clamp(liveHoursRaw, 1, 8);
        const liveHoursDenom = Number.isFinite(reportHour) ? liveHours : Math.min(8, workingHours);
        const liveEmployeeProgress = Number.isFinite(reportHour)
            ? await getCumulativeEmployeeProgress(pool, line_id, date, reportHour, false, liveHoursDenom)
            : await getCumulativeEmployeeProgress(pool, line_id, date, null, false, liveHoursDenom);
        const hourlyWorkstationProgress = Number.isFinite(reportHour)
            ? await getWorkstationProgressForWindow(pool, line_id, date, { exactHour: reportHour, isOvertime: false, hoursDenom: 1 })
            : [];
        const liveWorkstationProgress = Number.isFinite(reportHour)
            ? await getWorkstationProgressForWindow(pool, line_id, date, { endHour: reportHour, isOvertime: false, hoursDenom: liveHoursDenom })
            : await getWorkstationProgressForWindow(pool, line_id, date, { isOvertime: false, hoursDenom: liveHoursDenom });
        const hourlyWorkstationProgressBySource = Number.isFinite(reportHour)
            ? await getWorkstationProgressForWindow(pool, line_id, date, { exactHour: reportHour, isOvertime: false, hoursDenom: 1, splitBySource: true })
            : [];
        const liveWorkstationProgressBySource = Number.isFinite(reportHour)
            ? await getWorkstationProgressForWindow(pool, line_id, date, { endHour: reportHour, isOvertime: false, hoursDenom: liveHoursDenom, splitBySource: true })
            : await getWorkstationProgressForWindow(pool, line_id, date, { isOvertime: false, hoursDenom: liveHoursDenom, splitBySource: true });
        const hourlyEmployeeMap = new Map(hourlyEmployeeProgress.map(emp => [String(emp.id), emp]));
        const makeWorkstationTrackKey = (workstationCode, sourceMode) => `${normalizeWsCode(workstationCode)}::${sourceMode}`;
        const liveWorkstationTrackMap = new Map(
            liveWorkstationProgressBySource.map(ws => [makeWorkstationTrackKey(ws.workstation_code, ws.source_mode), ws])
        );
        const hourlyWorkstationTrackMap = new Map(
            hourlyWorkstationProgressBySource.map(ws => [makeWorkstationTrackKey(ws.workstation_code, ws.source_mode), ws])
        );
        const wsData = workstations.map(ws => {
            // Determine if CO was active during the selected hour
            // ws_changeover_started_at is the timestamp CO started; map to a REPORT_WORK_HOURS slot
            let coActiveAtHour = ws.is_changeover; // default: CO active (for no-hour / live view)
            let coStartHour = null;
            if (ws.is_changeover && ws.ws_changeover_started_at) {
                const coH = new Date(ws.ws_changeover_started_at).getHours();
                coStartHour = REPORT_WORK_HOURS.find(h => h >= coH) ?? REPORT_WORK_HOURS[REPORT_WORK_HOURS.length - 1];
                if (Number.isFinite(reportHour)) {
                    coActiveAtHour = reportHour >= coStartHour;
                }
            }

            // Pick the right plan WS ID and SAM based on whether CO was active at this hour
            const effectiveSam = coActiveAtHour
                ? parseFloat(ws.actual_sam_seconds || 0)
                : parseFloat(ws.primary_actual_sam_seconds || 0);
            const effectiveTakt = coActiveAtHour
                ? parseFloat(ws.takt_time_seconds || 0)
                : parseFloat(ws.primary_takt_time_seconds || 0);
            const effectiveWorkload = coActiveAtHour
                ? parseFloat(ws.workload_pct || 0)
                : parseFloat(ws.primary_workload_pct || 0);

            const cycleTimeHours = effectiveSam / 3600;
            const otWs = otMap[ws.workstation_code];
            const wsOtHours = (otWs && otWs.is_active && otWs.employee_id)
                ? (parseInt(otWs.ot_minutes) || parseInt(otWs.global_ot_minutes) || 0) / 60
                : 0;
            const primaryTrackKey = makeWorkstationTrackKey(ws.workstation_code, 'primary');
            const coTrackKey = makeWorkstationTrackKey(ws.workstation_code, 'changeover');
            const livePrimaryProgress = liveWorkstationTrackMap.get(primaryTrackKey);
            const hourlyPrimaryProgress = hourlyWorkstationTrackMap.get(primaryTrackKey);
            const liveCoProgress = liveWorkstationTrackMap.get(coTrackKey);
            const hourlyCoProgress = hourlyWorkstationTrackMap.get(coTrackKey);
            const primaryHourlyOutput = hourlyPrimaryProgress?.total_output ?? (hourlyOutputMap[ws.primary_source_plan_workstation_id] || 0);
            const primaryLiveOutput = livePrimaryProgress?.total_output ?? (liveOutputMap[ws.primary_source_plan_workstation_id] || 0);
            const coHourlyOutputValue = ws.co_source_plan_workstation_id
                ? (hourlyCoProgress?.total_output ?? (hourlyOutputMap[ws.co_source_plan_workstation_id] || 0))
                : null;
            const coLiveOutputValue = ws.co_source_plan_workstation_id
                ? (liveCoProgress?.total_output ?? (liveOutputMap[ws.co_source_plan_workstation_id] || 0))
                : null;
            const coHourlyOutput = coHourlyOutputValue ?? 0;
            const coLiveOutput = coLiveOutputValue ?? 0;
            const hourlyOutput = primaryHourlyOutput + coHourlyOutput;
            // For live output when CO is active: include both primary and CO hours' output
            const liveOutput = primaryLiveOutput + coLiveOutput;
            const getEfficiency = (progress, output, samSeconds, denom) => {
                if (progress) return progress.efficiency_percent;
                const cycleHours = parseFloat(samSeconds || 0) / 3600;
                if (!(cycleHours > 0) || !(denom > 0)) return null;
                return Math.round(output * cycleHours / denom * 10000) / 100;
            };
            const getEarnedHours = (progress, output, samSeconds) => {
                if (progress) return parseFloat(progress.total_sah_hours || 0);
                return (parseFloat(output || 0) * parseFloat(samSeconds || 0)) / 3600;
            };
            const hourlyDenominator = 1;
            const liveDenominator = Number.isFinite(reportHour) ? liveHours : Math.min(8, workingHours + wsOtHours);
            const primaryHourlyEfficiency = getEfficiency(hourlyPrimaryProgress, primaryHourlyOutput, ws.primary_actual_sam_seconds, hourlyDenominator);
            const primaryLiveEfficiency = getEfficiency(livePrimaryProgress, primaryLiveOutput, ws.primary_actual_sam_seconds, liveDenominator);
            const coHourlyEfficiency = getEfficiency(hourlyCoProgress, coHourlyOutput, ws.co_actual_sam_seconds, hourlyDenominator);
            const coLiveEfficiency = getEfficiency(liveCoProgress, coLiveOutput, ws.co_actual_sam_seconds, liveDenominator);
            const combinedHourlyEarnedHours = getEarnedHours(hourlyPrimaryProgress, primaryHourlyOutput, ws.primary_actual_sam_seconds)
                + getEarnedHours(hourlyCoProgress, coHourlyOutput, ws.co_actual_sam_seconds);
            const combinedLiveEarnedHours = getEarnedHours(livePrimaryProgress, primaryLiveOutput, ws.primary_actual_sam_seconds)
                + getEarnedHours(liveCoProgress, coLiveOutput, ws.co_actual_sam_seconds);
            const hourlyEfficiency = hourlyDenominator > 0
                ? Math.round(combinedHourlyEarnedHours / hourlyDenominator * 10000) / 100
                : null;
            const liveEfficiency = liveDenominator > 0
                ? Math.round(combinedLiveEarnedHours / liveDenominator * 10000) / 100
                : null;
            return {
                workstation_number: parseInt(ws.workstation_number),
                workstation_code: ws.workstation_code,
                group_name: ws.group_name || '',
                source_product_id: coActiveAtHour ? ws.source_product_id : (effectiveWsState.primary_product_id || ws.source_product_id),
                source_mode: coActiveAtHour ? 'changeover' : 'primary',
                is_changeover: coActiveAtHour,
                actual_sam_seconds: effectiveSam,
                takt_time_seconds: effectiveTakt,
                workload_pct: effectiveWorkload,
                primary_group_name: ws.primary_group_name || ws.group_name || '',
                primary_actual_sam_seconds: ws.primary_actual_sam_seconds,
                primary_takt_time_seconds: ws.primary_takt_time_seconds,
                primary_workload_pct: ws.primary_workload_pct,
                co_group_name: ws.co_group_name || '',
                co_actual_sam_seconds: ws.co_actual_sam_seconds,
                co_takt_time_seconds: ws.co_takt_time_seconds,
                co_workload_pct: ws.co_workload_pct,
                employee_code: activeAssignmentMap.get(normalizeWsCode(ws.workstation_code))?.emp_code || null,
                employee_name: activeAssignmentMap.get(normalizeWsCode(ws.workstation_code))?.emp_name || null,
                live_output: liveOutput,
                hourly_output: hourlyOutput,
                live_efficiency_pct: liveEfficiency,
                hourly_efficiency_pct: hourlyEfficiency,
                primary_hourly_output: primaryHourlyOutput,
                primary_hourly_efficiency_pct: primaryHourlyEfficiency,
                primary_live_output: primaryLiveOutput,
                primary_live_efficiency_pct: primaryLiveEfficiency,
                co_hourly_output: coHourlyOutputValue,
                co_hourly_efficiency_pct: coHourlyEfficiency,
                co_live_output: coLiveOutputValue,
                co_live_efficiency_pct: coLiveEfficiency,
                combined_hourly_output: hourlyOutput,
                combined_hourly_efficiency_pct: hourlyEfficiency,
                combined_live_output: liveOutput,
                combined_live_efficiency_pct: liveEfficiency,
                combined_hourly_earned_hours: combinedHourlyEarnedHours,
                combined_live_earned_hours: combinedLiveEarnedHours
            };
        });

        // 10. Line Efficiency
        // For mixed primary + CO days, combine earned hours from each effective workstation.
        // For normal days, keep the existing finished-goods style-SAH calculation.
        const hasActiveChangeoverWs = wsData.some(ws => ws.is_changeover);
        const hourlyEarnedHours = wsData.reduce((sum, ws) => (
            sum + parseFloat(ws.combined_hourly_earned_hours || 0)
        ), 0);
        const liveEarnedHours = wsData.reduce((sum, ws) => (
            sum + parseFloat(ws.combined_live_earned_hours || 0)
        ), 0);

        let liveLineOutput = 0;
        let hourlyLineOutput = 0;
        let liveLineEfficiency = null;
        let hourlyLineEfficiency = null;

        if (hasActiveChangeoverWs) {
            liveLineOutput = wsData.reduce((sum, ws) => sum + (parseInt(ws.live_output || 0, 10) || 0), 0);
            hourlyLineOutput = wsData.reduce((sum, ws) => sum + (parseInt(ws.hourly_output || 0, 10) || 0), 0);
            const liveAvailableHours = manpower * liveHoursDenom;
            liveLineEfficiency = liveAvailableHours > 0
                ? Math.round((liveEarnedHours / liveAvailableHours) * 10000) / 100
                : null;
            hourlyLineEfficiency = Number.isFinite(reportHour) && manpower > 0
                ? Math.round((hourlyEarnedHours / manpower) * 10000) / 100
                : null;
        } else {
            const lastWs = workstations[workstations.length - 1];
            liveLineOutput = lastWs ? (liveOutputMap[lastWs.source_line_plan_workstation_id] || 0) : 0;
            hourlyLineOutput = lastWs ? (hourlyOutputMap[lastWs.source_line_plan_workstation_id] || 0) : 0;
            const liveDenomLine = Number.isFinite(reportHour) ? manpower * liveHours : manpower * Math.min(8, workingHours);
            liveLineEfficiency = (liveDenomLine > 0 && styleSAH > 0)
                ? Math.round(liveLineOutput * styleSAH / liveDenomLine * 10000) / 100
                : null;
            hourlyLineEfficiency = (Number.isFinite(reportHour) && styleSAH > 0)
                ? Math.round(hourlyLineOutput * styleSAH * 10000) / 100
                : null;
        }

        // 11. Takt time
        const taktTimeSeconds = targetUnits > 0 ? Math.round(workingSeconds / targetUnits) : 0;

        const flowWindowEndHour = Number.isFinite(reportHour)
            ? reportHour
            : (REPORT_WORK_HOURS[REPORT_WORK_HOURS.length - 1] || 16);
        const employeeFlowResult = await pool.query(
            `WITH flow_rows AS (
                 SELECT hist.id,
                        hist.employee_id,
                        e.emp_code,
                        e.emp_name,
                        hist.workstation_code,
                        hist.effective_from_hour,
                        LEAST(COALESCE(hist.effective_to_hour, $3), $3) AS effective_to_hour
                 FROM employee_workstation_assignment_history hist
                 LEFT JOIN employees e ON e.id = hist.employee_id
                 WHERE hist.line_id = $1
                   AND hist.work_date = $2
                   AND hist.is_overtime = false
                   AND hist.employee_id IS NOT NULL
                   AND hist.effective_from_hour <= $3
             )
             SELECT employee_id,
                    COALESCE(MAX(emp_code), '') AS emp_code,
                    COALESCE(MAX(emp_name), '') AS emp_name,
                    COUNT(*)::int AS segments_count,
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'history_id', id,
                            'workstation_code', workstation_code,
                            'from_hour', effective_from_hour,
                            'to_hour', effective_to_hour
                        )
                        ORDER BY effective_from_hour, id
                    ) AS segments
             FROM flow_rows
             GROUP BY employee_id
             ORDER BY MAX(emp_code), employee_id`,
            [line_id, date, flowWindowEndHour]
        );
        const employeeFlow = employeeFlowResult.rows.map(row => ({
            id: parseInt(row.employee_id, 10),
            emp_code: row.emp_code || '',
            emp_name: row.emp_name || '',
            segments_count: parseInt(row.segments_count || 0, 10),
            segments: Array.isArray(row.segments) ? row.segments : []
        }));
        const employeeFlowMap = new Map(employeeFlow.map(row => [String(row.id), row]));

        const employeeProgress = liveEmployeeProgress.map(emp => {
            const hourly = hourlyEmployeeMap.get(String(emp.id));
            const empIdStr = String(emp.id);
            const flow = employeeFlowMap.get(empIdStr);
            const effSum = hoursForAvg.reduce((sum, h) => {
                const map = hourlyEffByHour.get(h);
                const val = map ? (map.get(empIdStr) || 0) : 0;
                return sum + val;
            }, 0);
            const avgEff = hoursForAvg.length ? (effSum / hoursForAvg.length) : 0;
            return {
                id: emp.id,
                emp_code: emp.emp_code,
                emp_name: emp.emp_name,
                workstation_code: emp.workstation_code,
                workstation_number: emp.workstation_number,
                group_name: emp.group_name,
                source_product_id: emp.source_product_id,
                source_mode: emp.source_mode,
                is_changeover: !!emp.is_changeover,
                live_output: emp.total_output || 0,
                live_rejection: emp.total_rejection || 0,
                live_efficiency_percent: emp.efficiency_percent || 0,
                hourly_output: hourly?.total_output || 0,
                hourly_rejection: hourly?.total_rejection || 0,
                hourly_efficiency_percent: hourly?.efficiency_percent || 0,
                hourly_efficiency_avg: Math.round(avgEff * 100) / 100,
                hourly_not_entered: !hourly && Number.isFinite(reportHour),
                flow_segments_count: flow?.segments_count || 0,
                flow_segments: flow?.segments || [],
                last_updated: hourly?.last_updated || emp.last_updated || null
            };
        });

        res.json({
            success: true,
            data: {
                line: { id: parseInt(line.id), line_code: line.line_code, line_name: line.line_name },
                plan: {
                    target_units: targetUnits,
                    product_code: line.product_code || '',
                    product_name: line.product_name || '',
                    style_sah: styleSAH,
                    working_hours: workingHours,
                    report_hour: reportHour,
                    report_hour_label: hourLabel,
                    live_hours: liveHours,
                    hourly_target_units: workingHours > 0 && targetUnits > 0
                        ? Math.ceil(targetUnits / workingHours)
                        : 0,
                    takt_time_seconds: taktTimeSeconds,
                    in_time: inTime,
                    out_time: outTime,
                    co_workstations: wsData.filter(ws => ws.is_changeover).map(ws => ws.workstation_code)
                },
                summary: {
                    manpower,
                    live_output: liveLineOutput,
                    live_efficiency_pct: liveLineEfficiency,
                    hourly_output: hourlyLineOutput,
                    hourly_efficiency_pct: hourlyLineEfficiency,
                    combined_changeover_efficiency: hasActiveChangeoverWs
                },
                workstations: wsData,
                employee_progress: employeeProgress,
                employee_flow: employeeFlow
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/worker-individual-efficiency?from_date=&to_date=&line_id=&date=
// Returns per-workstation per-employee efficiency grid across a date range for ALL active lines,
// handling mid-day departures (DEP), assign (PRE/POST), and combine (COMB) adjustments.
router.get('/worker-individual-efficiency', async (req, res) => {
    const { from_date, to_date } = req.query;
    const exactDate = typeof req.query.date === 'string' && req.query.date ? req.query.date : null;
    const lineIdFilter = req.query.line_id ? parseInt(req.query.line_id, 10) : null;
    if (!from_date || !to_date) {
        return res.status(400).json({ success: false, error: 'from_date and to_date are required' });
    }
    if (req.query.line_id && !Number.isFinite(lineIdFilter)) {
        return res.status(400).json({ success: false, error: 'line_id must be a number' });
    }
    try {
        const effectiveFrom = exactDate || from_date;
        const effectiveTo = exactDate || to_date;
        const buildDateTime = (date, rawTime, fallbackTime) => {
            const timeText = String(rawTime || fallbackTime || '').slice(0, 5) || fallbackTime;
            return new Date(`${date}T${timeText}:00`);
        };

        // Historical efficiency must survive master-data deletes, so iterate saved workstation plans.
        const planDatesResult = await pool.query(
            `SELECT DISTINCT
                    lpw.line_id,
                    lpw.work_date::text AS work_date,
                    COALESCE(pl.line_code, 'LINE-' || lpw.line_id::text) AS line_code,
                    COALESCE(pl.line_name, 'Line ' || lpw.line_id::text) AS line_name
             FROM line_plan_workstations lpw
             LEFT JOIN production_lines pl ON pl.id = lpw.line_id
             WHERE lpw.work_date BETWEEN $1 AND $2
               AND ($3::int IS NULL OR lpw.line_id = $3)
             ORDER BY line_code, line_name, work_date, line_id`,
            [effectiveFrom, effectiveTo, lineIdFilter]
        );
        const planDates = planDatesResult.rows;
        const activeEmployees = (!lineIdFilter && !exactDate)
            ? (await pool.query(
                `SELECT id, emp_code, emp_name FROM employees WHERE is_active = true ORDER BY emp_code, emp_name`
            )).rows
            : [];

        const inTime  = await getSettingValue('default_in_time',  '08:00');
        const outTime = await getSettingValue('default_out_time', '17:00');
        const lunchMins = parseInt(await getSettingValue('lunch_break_minutes', '60'), 10) || 0;
        const shiftHours = getNetWorkingMinutes(inTime, outTime, lunchMins) / 60;

        // Build date array (inclusive), use T12:00:00 to avoid UTC offset issues
        const dates = [];
        let cur = new Date(effectiveFrom + 'T12:00:00');
        const endDate = new Date(effectiveTo + 'T12:00:00');
        while (cur <= endDate) {
            const y = cur.getFullYear();
            const m = String(cur.getMonth() + 1).padStart(2, '0');
            const d = String(cur.getDate()).padStart(2, '0');
            dates.push(`${y}-${m}-${d}`);
            cur.setDate(cur.getDate() + 1);
            if (dates.length > 365) break;
        }

        // rowMap key = `${line_id}|${workstation_code}|${employee_id}`
        const rowMap = {};
        function getRow(lineId, lineCode, lineName, wsCode, wsNum, grp, samSec, empId, empCode, empName) {
            const key = `${lineId}|${wsCode}|${empId}`;
            if (!rowMap[key]) {
                rowMap[key] = {
                    line_id: lineId,
                    line_code: lineCode,
                    line_name: lineName,
                    workstation_code: wsCode,
                    workstation_number: parseInt(wsNum),
                    group_name: grp || '',
                    actual_sam_seconds: parseFloat(samSec || 0),
                    employee_id: empId,
                    emp_code: empCode,
                    emp_name: empName,
                    dates: {}
                };
            }
            return rowMap[key];
        }

        for (const plan of planDates) {
            const lid = parseInt(plan.line_id, 10);
            const date = plan.work_date;
                const planRes = await pool.query(`
                    SELECT
                        lpw.id            AS ws_id,
                        lpw.workstation_number,
                        lpw.workstation_code,
                        lpw.group_name,
                        lpw.actual_sam_seconds,
                        COALESCE(ldp.target_units, 0) AS target_units,
                        ewa.employee_id,
                        ewa.linked_at,
                        ewa.attendance_start,
                        e.emp_code,
                        e.emp_name,
                        wd.id             AS dep_id,
                        wd.departure_time,
                        wa.id             AS wa_id,
                        wa.adjustment_type,
                        wa.reassignment_time,
                        wa.vacant_workstation_code,
                        lpw_vac.workstation_number  AS vac_ws_number,
                        lpw_vac.group_name          AS vac_group_name,
                        lpw_vac.actual_sam_seconds  AS vac_sam_seconds,
                        att.status                  AS attendance_status,
                        att.in_time                 AS attendance_in_time,
                        att.out_time                AS attendance_out_time
                    FROM line_plan_workstations lpw
                    LEFT JOIN line_daily_plans ldp
                        ON ldp.line_id = lpw.line_id AND ldp.work_date = lpw.work_date
                    LEFT JOIN employee_workstation_assignments ewa
                        ON ewa.line_id = $1 AND ewa.work_date = $2
                        AND ewa.workstation_code = lpw.workstation_code
                        AND ewa.is_overtime = false
                    LEFT JOIN employees e ON e.id = ewa.employee_id
                    LEFT JOIN employee_attendance att
                        ON att.employee_id = ewa.employee_id
                        AND att.attendance_date = $2
                    LEFT JOIN worker_departures wd
                        ON wd.line_id = $1 AND wd.work_date = $2
                        AND wd.employee_id = ewa.employee_id
                        AND wd.workstation_code = lpw.workstation_code
                    LEFT JOIN worker_adjustments wa
                        ON wa.line_id = $1 AND wa.work_date = $2
                        AND wa.from_employee_id = ewa.employee_id
                        AND wa.from_workstation_code = lpw.workstation_code
                    LEFT JOIN line_plan_workstations lpw_vac
                        ON lpw_vac.line_id = $1 AND lpw_vac.work_date = $2
                        AND lpw_vac.workstation_code = wa.vacant_workstation_code
                    WHERE lpw.line_id = $1 AND lpw.work_date = $2
                    ORDER BY lpw.workstation_number
                `, [lid, date]);

                const wsRows = planRes.rows;
                if (wsRows.length === 0) continue;

                const targetUnits = parseInt(wsRows[0]?.target_units || 0);
                const wsIds = wsRows.map(r => r.ws_id).filter(Boolean);

                const hourlyMap = {};
                if (wsIds.length > 0) {
                    const hourRes = await pool.query(`
                        SELECT lpwp.workstation_id, lph.hour_slot, MAX(lph.quantity) AS qty
                        FROM line_plan_workstation_processes lpwp
                        JOIN line_process_hourly_progress lph
                            ON lph.process_id = lpwp.product_process_id
                            AND lph.line_id = $1 AND lph.work_date = $2
                        WHERE lpwp.workstation_id = ANY($3::int[])
                        GROUP BY lpwp.workstation_id, lph.hour_slot
                    `, [lid, date, wsIds]);
                    hourRes.rows.forEach(r => {
                        if (!hourlyMap[r.workstation_id]) hourlyMap[r.workstation_id] = {};
                        hourlyMap[r.workstation_id][r.hour_slot] = parseInt(r.qty || 0);
                    });
                }

                const wsIdByCode = {};
                wsRows.forEach(r => { if (r.workstation_code) wsIdByCode[r.workstation_code] = r.ws_id; });

                for (const ws of wsRows) {
                    if (!ws.employee_id) continue;
                    // Absent if: explicit attendance record says absent, OR never linked by supervisor
                    if (String(ws.attendance_status || '').toLowerCase() === 'absent') continue;
                    if (!ws.linked_at) continue; // not linked = absent, no efficiency entry

                    const samH    = parseFloat(ws.actual_sam_seconds || 0) / 3600;
                    const wsHours = hourlyMap[ws.ws_id] || {};
                    // attendance_start from link rules takes precedence over legacy attendance record
                    const shiftStart = ws.attendance_start
                        ? new Date(ws.attendance_start)
                        : buildDateTime(date, ws.attendance_in_time, inTime);
                    const shiftEnd = buildDateTime(date, ws.attendance_out_time, outTime);
                    const attendedHours = Math.max(0, (shiftEnd - shiftStart) / 3600000);
                    const effectiveShiftHours = attendedHours > 0 ? attendedHours : shiftHours;
                    // Only count output from hours the employee was actually present
                    const startHour = shiftStart.getHours();

                    if (ws.dep_id) {
                        const depTime    = new Date(ws.departure_time);
                        const hoursWorked = Math.max(0.001, (depTime - shiftStart) / 3600000);
                        const depHour    = depTime.getHours();
                        const depHHMM    = depTime.toTimeString().slice(0, 5);
                        const output = Object.entries(wsHours)
                            .filter(([h]) => parseInt(h) >= startHour && parseInt(h) <= depHour)
                            .reduce((s, [, q]) => s + q, 0);
                        const wip = Math.round(targetUnits * hoursWorked / shiftHours);
                        const eff = samH > 0 ? Math.round(output * samH / hoursWorked * 10000) / 100 : null;
                        const row = getRow(lid, plan.line_code, plan.line_name,
                            ws.workstation_code, ws.workstation_number, ws.group_name,
                            ws.actual_sam_seconds, ws.employee_id, ws.emp_code, ws.emp_name);
                        row.dates[date] = { wip, output, eff, tag: `DEP ${depHHMM}`, hours_worked: hoursWorked };

                    } else if (ws.wa_id && ws.adjustment_type === 'assign') {
                        const reassignTime = new Date(ws.reassignment_time);
                        const reassignHour = reassignTime.getHours();
                        const preHours  = Math.max(0.001, (reassignTime - shiftStart) / 3600000);
                        const postHours = Math.max(0.001, (shiftEnd - reassignTime) / 3600000);

                        const preOutput = Object.entries(wsHours)
                            .filter(([h]) => parseInt(h) >= startHour && parseInt(h) <= reassignHour)
                            .reduce((s, [, q]) => s + q, 0);
                        const preWip = Math.round(targetUnits * preHours / shiftHours);
                        const preEff = samH > 0 ? Math.round(preOutput * samH / preHours * 10000) / 100 : null;
                        const rowPre = getRow(lid, plan.line_code, plan.line_name,
                            ws.workstation_code, ws.workstation_number, ws.group_name,
                            ws.actual_sam_seconds, ws.employee_id, ws.emp_code, ws.emp_name);
                        rowPre.dates[date] = { wip: preWip, output: preOutput, eff: preEff, tag: 'PRE', hours_worked: preHours };

                        const vacWsId  = wsIdByCode[ws.vacant_workstation_code];
                        const vacHours = vacWsId ? (hourlyMap[vacWsId] || {}) : {};
                        const vacSamH  = parseFloat(ws.vac_sam_seconds || 0) / 3600;
                        const postOutput = Object.entries(vacHours)
                            .filter(([h]) => parseInt(h) > reassignHour)
                            .reduce((s, [, q]) => s + q, 0);
                        const postWip = Math.round(targetUnits * postHours / shiftHours);
                        const postEff = vacSamH > 0 ? Math.round(postOutput * vacSamH / postHours * 10000) / 100 : null;
                        const rowPost = getRow(lid, plan.line_code, plan.line_name,
                            ws.vacant_workstation_code, ws.vac_ws_number, ws.vac_group_name,
                            ws.vac_sam_seconds, ws.employee_id, ws.emp_code, ws.emp_name);
                        rowPost.dates[date] = { wip: postWip, output: postOutput, eff: postEff, tag: 'POST', hours_worked: postHours };

                    } else if (ws.wa_id && ws.adjustment_type === 'combine') {
                        const reassignTime = new Date(ws.reassignment_time);
                        const reassignHour = reassignTime.getHours();
                        const vacSamH      = parseFloat(ws.vac_sam_seconds || 0) / 3600;
                        const preOutput = Object.entries(wsHours)
                            .filter(([h]) => parseInt(h) <= reassignHour)
                            .reduce((s, [, q]) => s + q, 0);
                        const postOutput = Object.entries(wsHours)
                            .filter(([h]) => parseInt(h) > reassignHour)
                            .reduce((s, [, q]) => s + q, 0);
                        const totalSAHEarned = preOutput * samH + postOutput * (samH + vacSamH);
                        const eff = effectiveShiftHours > 0 ? Math.round(totalSAHEarned / effectiveShiftHours * 10000) / 100 : null;
                        const row = getRow(lid, plan.line_code, plan.line_name,
                            ws.workstation_code, ws.workstation_number, ws.group_name,
                            ws.actual_sam_seconds, ws.employee_id, ws.emp_code, ws.emp_name);
                        row.dates[date] = { wip: targetUnits, output: preOutput + postOutput, eff, tag: 'COMB', hours_worked: effectiveShiftHours, vac_ws_code: ws.vacant_workstation_code };

                    } else {
                        const totalOutput = Object.entries(wsHours)
                            .filter(([h]) => parseInt(h) >= startHour)
                            .reduce((s, [, q]) => s + q, 0);
                        const eff = (effectiveShiftHours > 0 && samH > 0)
                            ? Math.round(totalOutput * samH / effectiveShiftHours * 10000) / 100 : null;
                        const row = getRow(lid, plan.line_code, plan.line_name,
                            ws.workstation_code, ws.workstation_number, ws.group_name,
                            ws.actual_sam_seconds, ws.employee_id, ws.emp_code, ws.emp_name);
                        row.dates[date] = { wip: targetUnits, output: totalOutput, eff, tag: null, hours_worked: effectiveShiftHours };
                    }
                }
        }

        const existingEmployeeIds = new Set(
            Object.values(rowMap)
                .map(row => parseInt(row.employee_id, 10))
                .filter(Number.isFinite)
        );
        for (const emp of activeEmployees) {
            const empId = parseInt(emp.id, 10);
            if (existingEmployeeIds.has(empId)) continue;
            rowMap[`emp|${empId}`] = {
                line_id: null,
                line_code: '',
                line_name: '',
                workstation_code: '',
                workstation_number: Number.MAX_SAFE_INTEGER,
                group_name: '',
                actual_sam_seconds: 0,
                employee_id: empId,
                emp_code: emp.emp_code,
                emp_name: emp.emp_name,
                dates: {}
            };
        }

        // Sort: emp_code → emp_name → line_code → workstation_number
        const rows = Object.values(rowMap).sort((a, b) => {
            const ec = (a.emp_code || '').localeCompare(b.emp_code || '');
            if (ec !== 0) return ec;
            const en = (a.emp_name || '').localeCompare(b.emp_name || '');
            if (en !== 0) return en;
            const lc = (a.line_code || '').localeCompare(b.line_code || '');
            if (lc !== 0) return lc;
            if (a.workstation_number !== b.workstation_number) return a.workstation_number - b.workstation_number;
            return (a.workstation_code || '').localeCompare(b.workstation_code || '');
        });

        rows.forEach(row => {
            let totalOutput = 0, totalSAHEarned = 0, totalHoursWorked = 0;
            const samH = row.actual_sam_seconds / 3600;
            for (const d of dates) {
                if (!row.dates[d]) {
                    row.dates[d] = { wip: 0, output: 0, eff: 0, tag: null, hours_worked: 0 };
                }
                const cell = row.dates[d];
                totalOutput      += cell.output || 0;
                if (cell.tag === 'COMB' && cell.eff !== null) {
                    totalSAHEarned += cell.eff * (cell.hours_worked || 0) / 100;
                } else {
                    totalSAHEarned += (cell.output || 0) * samH;
                }
                totalHoursWorked += cell.hours_worked || 0;
            }
            row.total_output = totalOutput;
            row.overall_eff  = totalHoursWorked > 0
                ? Math.round(totalSAHEarned / totalHoursWorked * 10000) / 100 : 0;
        });

        res.json({ success: true, data: { dates, rows, shift_hours: shiftHours } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// WiFi Management (admin only)
// ============================================================

function parseNmcliWifiLine(line) {
    const parts = [];
    let current = '';
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\' && i + 1 < line.length && line[i + 1] === ':') {
            current += ':';
            i++;
        } else if (line[i] === ':') {
            parts.push(current);
            current = '';
        } else {
            current += line[i];
        }
    }
    parts.push(current);
    return parts;
}

async function getWifiNetworks() {
    const { stdout } = await execFileAsync('nmcli', ['-t', '-f', 'SSID,BSSID,SIGNAL,SECURITY,IN-USE', 'device', 'wifi', 'list']);
    const networks = [];
    for (const line of stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        const parts = parseNmcliWifiLine(line);
        const ssid = parts[0]?.trim();
        if (!ssid) continue;
        networks.push({
            ssid,
            bssid: parts[1]?.trim() || null,
            signal: parseInt(parts[2], 10) || 0,
            security: parts[3]?.trim() || 'Open',
            in_use: parts[4]?.trim() === '*'
        });
    }
    return networks;
}

async function getWifiProfilesBySsid(ssid) {
    const { stdout } = await execFileAsync('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show']);
    const profiles = [];
    for (const line of stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        const parts = parseNmcliWifiLine(line);
        const name = parts[0]?.trim();
        const type = parts[1]?.trim();
        if (type !== '802-11-wireless' || !name) continue;
        try {
            const { stdout: ssidOut } = await execFileAsync('nmcli', ['-g', '802-11-wireless.ssid', 'connection', 'show', name]);
            const profileSsid = ssidOut.trim();
            if (profileSsid === ssid) {
                profiles.push(name);
            }
        } catch (err) {
            // Ignore profiles that cannot be inspected and continue scanning.
        }
    }
    return profiles;
}

router.get('/admin/wifi/status', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
    try {
        const [ipOut, wifiOut] = await Promise.all([
            execFileAsync('hostname', ['-I']),
            execFileAsync('nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL,DEVICE', 'device', 'wifi'])
        ]);
        const ips = ipOut.stdout.trim().split(/\s+/).filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
        let currentSsid = null;
        for (const line of wifiOut.stdout.trim().split('\n')) {
            const parts = parseNmcliWifiLine(line);
            if (parts[0] === 'yes') { currentSsid = parts[1] || null; break; }
        }
        res.json({ success: true, ips, current_ssid: currentSsid });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/admin/wifi/networks', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
    try {
        // Trigger rescan (best-effort, don't block on it)
        execFile('sudo', ['nmcli', 'device', 'wifi', 'rescan'], () => {});
        await new Promise(r => setTimeout(r, 2500));
        const rawNetworks = await getWifiNetworks();
        const networks = [];
        const seen = new Set();
        for (const network of rawNetworks) {
            const { ssid, bssid, signal, security, in_use: inUse } = network;
            if (!ssid) continue;
            if (seen.has(ssid)) {
                // Keep the connected or strongest BSSID for duplicate SSIDs.
                const existing = networks.find(n => n.ssid === ssid);
                if (existing && (inUse || (!existing.in_use && signal > existing.signal))) {
                    existing.in_use = inUse;
                    existing.signal = signal;
                    existing.security = security;
                    existing.bssid = bssid || existing.bssid;
                }
                continue;
            }
            seen.add(ssid);
            networks.push({ ssid, bssid, signal, security, in_use: inUse });
        }
        networks.sort((a, b) => (b.in_use ? 1 : 0) - (a.in_use ? 1 : 0) || b.signal - a.signal);
        res.json({ success: true, networks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/admin/wifi/connect', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
    const { ssid, password, bssid } = req.body;
    if (!ssid || typeof ssid !== 'string' || ssid.length > 128) {
        return res.status(400).json({ success: false, error: 'Invalid SSID' });
    }
    try {
        await execFileAsync('sudo', ['nmcli', 'device', 'wifi', 'rescan']).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
        const networks = await getWifiNetworks();
        const matching = networks
            .filter(n => n.ssid === ssid)
            .sort((a, b) => b.signal - a.signal);
        const selected = (bssid ? matching.find(n => n.bssid === bssid) : null) || matching[0] || null;
        const savedProfiles = await getWifiProfilesBySsid(ssid);
        const isSecured = selected ? (selected.security && selected.security !== 'Open' && selected.security !== '--') : Boolean(password);
        const trimmedPassword = typeof password === 'string' ? password.trim() : '';

        if (isSecured && !trimmedPassword) {
            return res.status(400).json({ success: false, error: 'Password is required for this WiFi network.' });
        }

        let runConnect;
        if (selected) {
            const connectArgs = ['nmcli', 'device', 'wifi', 'connect', ssid, 'ifname', 'wlan0'];
            if (selected.bssid) {
                connectArgs.push('bssid', selected.bssid);
            }
            if (trimmedPassword) {
                connectArgs.push('password', trimmedPassword);
            }
            runConnect = () => execFileAsync('sudo', connectArgs, { timeout: 30000 });
        } else if (savedProfiles.length) {
            const profileName = savedProfiles[0];
            runConnect = async () => {
                if (trimmedPassword) {
                    await execFileAsync('sudo', [
                        'nmcli', 'connection', 'modify', profileName,
                        '802-11-wireless-security.key-mgmt', 'wpa-psk',
                        '802-11-wireless-security.psk', trimmedPassword
                    ], { timeout: 30000 });
                }
                return execFileAsync('sudo', ['nmcli', 'connection', 'up', profileName, 'ifname', 'wlan0'], { timeout: 30000 });
            };
        } else {
            return res.status(404).json({ success: false, error: `No network or saved profile found for SSID '${ssid}'.` });
        }

        try {
            await runConnect();
        } catch (err) {
            const msg = (err.stderr || err.message || '').toString();
            if (/key-mgmt: property is missing/i.test(msg)) {
                for (const profileName of savedProfiles) {
                    await execFileAsync('sudo', ['nmcli', 'connection', 'delete', profileName]).catch(() => {});
                }
                if (!selected) throw err;
                await runConnect();
            } else {
                throw err;
            }
        }

        const { stdout: ipOut } = await execFileAsync('hostname', ['-I']);
        const ips = ipOut.trim().split(/\s+/).filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
        res.json({ success: true, ips, ssid });
    } catch (err) {
        const msg = (err.stderr || err.message || 'Connection failed').toString().trim();
        res.status(500).json({ success: false, error: msg });
    }
});

// GET /material-tracking?line_id=X&date=YYYY-MM-DD
// Returns groups with feed, per-workstation hourly output, group output (last WS), and WIP.
router.get('/material-tracking', async (req, res) => {
    const { line_id, date } = req.query;
    if (!line_id || !date) return res.status(400).json({ success: false, error: 'line_id and date required' });

    try {
        // Line info
        const lineResult = await pool.query(
            `SELECT pl.id, pl.line_name, pl.line_code,
                    ldp.target_units, p.product_name, p.product_code
             FROM production_lines pl
             LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $2
             LEFT JOIN products p ON p.id = ldp.product_id
             WHERE pl.id = $1`,
            [line_id, date]
        );
        if (!lineResult.rows[0]) return res.status(404).json({ success: false, error: 'Line not found' });
        const line = lineResult.rows[0];

        // All workstations for this line+date, ordered by group then workstation_number
        const wsResult = await pool.query(
            `SELECT lpw.id,
                    lpw.workstation_code,
                    lpw.workstation_number,
                    COALESCE(lpw.group_name, lpw.workstation_code) AS group_identifier,
                    lpw.group_name,
                    lpw.actual_sam_seconds,
                    COALESCE(ewa.material_provided, 0) AS material_provided,
                    ewa.employee_id,
                    e.emp_code,
                    e.emp_name
             FROM line_plan_workstations lpw
             LEFT JOIN employee_workstation_assignments ewa
               ON ewa.line_id = lpw.line_id AND ewa.work_date = lpw.work_date
              AND ewa.workstation_code = lpw.workstation_code AND ewa.is_overtime = false
             LEFT JOIN employees e ON e.id = ewa.employee_id
             WHERE lpw.line_id = $1 AND lpw.work_date = $2
             ORDER BY lpw.group_name NULLS LAST, lpw.workstation_number ASC NULLS LAST`,
            [line_id, date]
        );
        const workstations = wsResult.rows;

        if (!workstations.length) {
            return res.json({ success: true, data: { line, date, groups: [] } });
        }

        // Hourly output per workstation — deduplicate multi-process fan-out with MAX per hour_slot
        const wsIds = workstations.map(w => w.id);
        const hourlyResult = await pool.query(
            `SELECT lpwp.workstation_id, lphp.hour_slot, MAX(lphp.quantity) AS qty
             FROM line_plan_workstation_processes lpwp
             JOIN line_process_hourly_progress lphp
               ON lphp.process_id = lpwp.product_process_id
              AND lphp.line_id = $1 AND lphp.work_date = $2
             WHERE lpwp.workstation_id = ANY($3::int[])
             GROUP BY lpwp.workstation_id, lphp.hour_slot
             ORDER BY lphp.hour_slot`,
            [line_id, date, wsIds]
        );

        // Index hourly data: wsId → { hour_slot → qty }
        const hourlyByWs = new Map();
        for (const row of hourlyResult.rows) {
            if (!hourlyByWs.has(row.workstation_id)) hourlyByWs.set(row.workstation_id, {});
            hourlyByWs.get(row.workstation_id)[row.hour_slot] = parseInt(row.qty, 10);
        }

        // Group WIP data
        const groupWipResult = await pool.query(
            `SELECT group_name, materials_in, output_qty, wip_quantity
             FROM group_wip WHERE line_id = $1 AND work_date = $2`,
            [line_id, date]
        );
        const groupWipMap = new Map(groupWipResult.rows.map(r => [r.group_name ?? r.group_name, r]));

        // Build groups
        const groupMap = new Map();
        for (const ws of workstations) {
            const gKey = ws.group_identifier;
            if (!groupMap.has(gKey)) {
                groupMap.set(gKey, {
                    group_name: ws.group_name,
                    group_identifier: gKey,
                    feed: 0,
                    workstations: [],
                    is_last_ws_id: null,
                });
            }
            const group = groupMap.get(gKey);

            const hourly = hourlyByWs.get(ws.id) ?? {};
            const cumulative_output = Object.values(hourly).reduce((s, v) => s + v, 0);

            group.workstations.push({
                id: ws.id,
                workstation_code: ws.workstation_code,
                workstation_number: ws.workstation_number != null ? parseInt(ws.workstation_number, 10) : null,
                emp_code: ws.emp_code ?? null,
                emp_name: ws.emp_name ?? null,
                actual_sam_seconds: parseFloat(ws.actual_sam_seconds ?? 0),
                hourly,
                cumulative_output,
            });

            // Same-day changeover can inject feed at any workstation, so group feed is cumulative.
            group.feed += parseInt(ws.material_provided || 0, 10);
        }

        // Resolve output (last WS) + WIP for each group
        const groups = [];
        for (const [gKey, group] of groupMap) {
            const sorted = group.workstations.sort((a, b) =>
                (a.workstation_number ?? 9999) - (b.workstation_number ?? 9999)
            );
            const lastWs = sorted[sorted.length - 1];
            const group_output = lastWs?.cumulative_output ?? 0;

            // Prefer pre-computed group_wip row; fall back to live calc
            const wipRow = groupWipMap.get(gKey) ?? groupWipMap.get(group.group_name);
            const feed = wipRow ? parseInt(wipRow.materials_in, 10) : group.feed;
            const wip = Math.max(0, feed - group_output);

            groups.push({
                group_name: group.group_name,
                group_identifier: gKey,
                feed,
                group_output,
                wip,
                workstations: sorted,
            });
        }

        res.json({ success: true, data: { line, date, groups } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
