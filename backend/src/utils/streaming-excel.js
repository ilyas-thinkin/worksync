/**
 * WorkSync Streaming Excel Export Utility
 * Handles large dataset exports without memory overflow
 */

const ExcelJS = require('exceljs');
const pool = require('../config/db.config');

/**
 * Create a streaming Excel workbook
 * @param {Object} res - Express response object
 * @param {string} filename - Output filename
 * @returns {Object} - Workbook and stream
 */
function createStreamingWorkbook(res, filename) {
    // Set response headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Create streaming workbook
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: res,
        useStyles: true,
        useSharedStrings: false
    });

    return workbook;
}

/**
 * Style definitions for Excel
 */
const STYLES = {
    header: {
        font: { bold: true, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        }
    },
    cell: {
        border: {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
    },
    number: {
        alignment: { horizontal: 'right' }
    },
    date: {
        numFmt: 'yyyy-mm-dd'
    },
    percent: {
        numFmt: '0.00%'
    }
};

/**
 * Add a worksheet with streaming data from database cursor
 * @param {Object} workbook - ExcelJS workbook
 * @param {string} sheetName - Worksheet name
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @param {Object} options - Column options
 */
async function addStreamingSheet(workbook, sheetName, query, params = [], options = {}) {
    const {
        columns = [],
        transformRow = (row) => row,
        batchSize = 1000
    } = options;

    const sheet = workbook.addWorksheet(sheetName);

    // Add columns
    if (columns.length > 0) {
        sheet.columns = columns;

        // Style header row
        const headerRow = sheet.getRow(1);
        headerRow.font = STYLES.header.font;
        headerRow.fill = STYLES.header.fill;
        headerRow.alignment = STYLES.header.alignment;
        headerRow.commit();
    }

    // Use database cursor for streaming
    const client = await pool.connect();

    try {
        // Create cursor
        const cursorName = `export_cursor_${Date.now()}`;
        await client.query('BEGIN');
        await client.query(`DECLARE ${cursorName} CURSOR FOR ${query}`, params);

        let hasMore = true;
        let rowCount = 0;

        while (hasMore) {
            const result = await client.query(`FETCH ${batchSize} FROM ${cursorName}`);

            if (result.rows.length === 0) {
                hasMore = false;
            } else {
                for (const row of result.rows) {
                    const transformedRow = transformRow(row);
                    const dataRow = sheet.addRow(
                        columns.length > 0
                            ? columns.map(col => transformedRow[col.key])
                            : Object.values(transformedRow)
                    );

                    // Apply cell styles
                    dataRow.eachCell((cell, colNumber) => {
                        cell.border = STYLES.cell.border;
                        if (typeof cell.value === 'number') {
                            cell.alignment = STYLES.number.alignment;
                        }
                    });

                    dataRow.commit();
                    rowCount++;
                }
            }
        }

        await client.query(`CLOSE ${cursorName}`);
        await client.query('COMMIT');

        // Commit worksheet
        await sheet.commit();

        return rowCount;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Export daily report with streaming
 * @param {Object} res - Express response
 * @param {string} date - Work date
 */
async function exportDailyReportStreaming(res, date) {
    const filename = `WorkSync_Daily_Report_${date}.xlsx`;
    const workbook = createStreamingWorkbook(res, filename);

    try {
        // Line Summary Sheet
        await addStreamingSheet(workbook, 'Line Summary',
            `SELECT
                pl.line_code,
                pl.line_name,
                p.product_code,
                p.product_name,
                ldp.target_quantity as target,
                COALESCE(ldm.qa_output, 0) as qa_output,
                COALESCE((
                    SELECT SUM(quantity) FROM line_process_hourly_progress
                    WHERE line_id = pl.id AND work_date = $1
                ), 0) as hourly_output
            FROM production_lines pl
            LEFT JOIN line_daily_plans ldp ON ldp.line_id = pl.id AND ldp.work_date = $1
            LEFT JOIN products p ON p.id = ldp.product_id
            LEFT JOIN line_daily_metrics ldm ON ldm.line_id = pl.id AND ldm.work_date = $1
            WHERE pl.is_active = true
            ORDER BY pl.line_code`,
            [date],
            {
                columns: [
                    { header: 'Line Code', key: 'line_code', width: 15 },
                    { header: 'Line Name', key: 'line_name', width: 25 },
                    { header: 'Product Code', key: 'product_code', width: 15 },
                    { header: 'Product Name', key: 'product_name', width: 30 },
                    { header: 'Target', key: 'target', width: 10 },
                    { header: 'QA Output', key: 'qa_output', width: 12 },
                    { header: 'Hourly Output', key: 'hourly_output', width: 15 }
                ]
            }
        );

        // Employee Efficiency Sheet
        await addStreamingSheet(workbook, 'Employee Efficiency',
            `SELECT
                e.emp_code,
                e.emp_name,
                pl.line_name,
                o.operation_code,
                o.operation_name,
                SUM(pah.quantity_completed) as total_output,
                pp.operation_sah
            FROM process_assignment_history pah
            JOIN employees e ON pah.employee_id = e.id
            JOIN production_lines pl ON pah.line_id = pl.id
            JOIN product_processes pp ON pah.process_id = pp.id
            JOIN operations o ON pp.operation_id = o.id
            WHERE DATE(pah.start_time) = $1
            GROUP BY e.emp_code, e.emp_name, pl.line_name, o.operation_code, o.operation_name, pp.operation_sah
            ORDER BY e.emp_code`,
            [date],
            {
                columns: [
                    { header: 'Emp Code', key: 'emp_code', width: 12 },
                    { header: 'Emp Name', key: 'emp_name', width: 25 },
                    { header: 'Line', key: 'line_name', width: 20 },
                    { header: 'Operation Code', key: 'operation_code', width: 15 },
                    { header: 'Operation', key: 'operation_name', width: 30 },
                    { header: 'Output', key: 'total_output', width: 10 },
                    { header: 'SAH', key: 'operation_sah', width: 10 }
                ]
            }
        );

        // Defects Sheet (if data exists)
        await addStreamingSheet(workbook, 'Defects',
            `SELECT
                pl.line_name,
                dt.defect_code,
                dt.defect_name,
                dt.severity,
                dl.quantity,
                dl.status,
                e.emp_name as detected_employee,
                dl.notes
            FROM defect_log dl
            JOIN production_lines pl ON dl.line_id = pl.id
            JOIN defect_types dt ON dl.defect_type_id = dt.id
            LEFT JOIN employees e ON dl.employee_id = e.id
            WHERE dl.work_date = $1
            ORDER BY pl.line_name, dl.created_at`,
            [date],
            {
                columns: [
                    { header: 'Line', key: 'line_name', width: 20 },
                    { header: 'Defect Code', key: 'defect_code', width: 12 },
                    { header: 'Defect Name', key: 'defect_name', width: 25 },
                    { header: 'Severity', key: 'severity', width: 10 },
                    { header: 'Quantity', key: 'quantity', width: 10 },
                    { header: 'Status', key: 'status', width: 12 },
                    { header: 'Employee', key: 'detected_employee', width: 20 },
                    { header: 'Notes', key: 'notes', width: 30 }
                ]
            }
        );

        // Downtime Sheet
        await addStreamingSheet(workbook, 'Downtime',
            `SELECT
                pl.line_name,
                dr.reason_code,
                dr.reason_name,
                dr.reason_category,
                dl.start_time,
                dl.end_time,
                COALESCE(dl.duration_minutes,
                    EXTRACT(EPOCH FROM (COALESCE(dl.end_time, NOW()) - dl.start_time))/60
                )::int as duration_minutes,
                dl.notes
            FROM downtime_log dl
            JOIN production_lines pl ON dl.line_id = pl.id
            JOIN downtime_reasons dr ON dl.reason_id = dr.id
            WHERE dl.work_date = $1
            ORDER BY pl.line_name, dl.start_time`,
            [date],
            {
                columns: [
                    { header: 'Line', key: 'line_name', width: 20 },
                    { header: 'Reason Code', key: 'reason_code', width: 12 },
                    { header: 'Reason', key: 'reason_name', width: 25 },
                    { header: 'Category', key: 'reason_category', width: 15 },
                    { header: 'Start Time', key: 'start_time', width: 18 },
                    { header: 'End Time', key: 'end_time', width: 18 },
                    { header: 'Duration (min)', key: 'duration_minutes', width: 15 },
                    { header: 'Notes', key: 'notes', width: 30 }
                ]
            }
        );

        // Commit workbook
        await workbook.commit();
    } catch (error) {
        console.error('Streaming export error:', error);
        throw error;
    }
}

/**
 * Export range report with streaming
 * @param {Object} res - Express response
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 */
async function exportRangeReportStreaming(res, startDate, endDate) {
    const filename = `WorkSync_Report_${startDate}_to_${endDate}.xlsx`;
    const workbook = createStreamingWorkbook(res, filename);

    try {
        // Line Summary Sheet
        await addStreamingSheet(workbook, 'Line Summary',
            `SELECT
                ldp.work_date,
                pl.line_code,
                pl.line_name,
                p.product_code,
                ldp.target_quantity as target,
                COALESCE(ldm.qa_output, 0) as qa_output
            FROM line_daily_plans ldp
            JOIN production_lines pl ON ldp.line_id = pl.id
            LEFT JOIN products p ON p.id = ldp.product_id
            LEFT JOIN line_daily_metrics ldm ON ldm.line_id = ldp.line_id AND ldm.work_date = ldp.work_date
            WHERE ldp.work_date BETWEEN $1 AND $2
            ORDER BY ldp.work_date, pl.line_code`,
            [startDate, endDate],
            {
                columns: [
                    { header: 'Date', key: 'work_date', width: 12 },
                    { header: 'Line Code', key: 'line_code', width: 15 },
                    { header: 'Line Name', key: 'line_name', width: 25 },
                    { header: 'Product', key: 'product_code', width: 15 },
                    { header: 'Target', key: 'target', width: 10 },
                    { header: 'QA Output', key: 'qa_output', width: 12 }
                ]
            }
        );

        // Defect Summary Sheet
        await addStreamingSheet(workbook, 'Defect Summary',
            `SELECT * FROM v_daily_defect_summary
             WHERE work_date BETWEEN $1 AND $2
             ORDER BY work_date, line_name`,
            [startDate, endDate],
            {
                columns: [
                    { header: 'Date', key: 'work_date', width: 12 },
                    { header: 'Line', key: 'line_name', width: 20 },
                    { header: 'Category', key: 'defect_category', width: 15 },
                    { header: 'Defect', key: 'defect_name', width: 25 },
                    { header: 'Severity', key: 'severity', width: 10 },
                    { header: 'Count', key: 'defect_count', width: 10 },
                    { header: 'Total Qty', key: 'total_quantity', width: 12 },
                    { header: 'Reworked', key: 'reworked_quantity', width: 12 },
                    { header: 'Rejected', key: 'rejected_quantity', width: 12 }
                ]
            }
        );

        // Downtime Summary Sheet
        await addStreamingSheet(workbook, 'Downtime Summary',
            `SELECT * FROM v_daily_downtime_summary
             WHERE work_date BETWEEN $1 AND $2
             ORDER BY work_date, line_name`,
            [startDate, endDate],
            {
                columns: [
                    { header: 'Date', key: 'work_date', width: 12 },
                    { header: 'Line', key: 'line_name', width: 20 },
                    { header: 'Category', key: 'reason_category', width: 15 },
                    { header: 'Reason', key: 'reason_name', width: 25 },
                    { header: 'Planned', key: 'is_planned', width: 10 },
                    { header: 'Incidents', key: 'incident_count', width: 12 },
                    { header: 'Total Minutes', key: 'total_minutes', width: 15 }
                ]
            }
        );

        await workbook.commit();
    } catch (error) {
        console.error('Streaming range export error:', error);
        throw error;
    }
}

module.exports = {
    createStreamingWorkbook,
    addStreamingSheet,
    exportDailyReportStreaming,
    exportRangeReportStreaming,
    STYLES
};
