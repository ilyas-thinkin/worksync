#!/usr/bin/env node

const path = require('path');
const fs = require('fs/promises');

require('../backend/node_modules/dotenv').config({
    path: path.join(__dirname, '..', 'backend', '.env')
});

const ExcelJS = require('../backend/node_modules/exceljs');
const pool = require('../backend/src/config/db.config');
const qr = require('../backend/src/utils/qr');

const ROOT_DIR = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT_DIR, 'Data_given', 'LPD - Attendance Details.xlsx');
const EMPLOYEE_QR_DIR = path.join(ROOT_DIR, 'qrcodes', 'employees');

const TEMPLATE_FILES = [
    path.join(ROOT_DIR, 'Data_given', 'line_plan_template (14).xlsx'),
    path.join(ROOT_DIR, 'Data_given', 'KN754_upload_ready_latest_template.xlsx')
];

function cellToString(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
        if (value.richText) {
            return value.richText.map((part) => part.text || '').join('').trim();
        }
        if (value.text) return String(value.text).trim();
        if (value.result !== undefined && value.result !== null) return String(value.result).trim();
        if (value.formula) return '';
    }
    return String(value).trim();
}

async function loadEmployeesFromAttendance(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet = workbook.getWorksheet('Report');
    if (!sheet) {
        throw new Error(`Worksheet "Report" not found in ${filePath}`);
    }

    const employees = [];
    const seenCodes = new Set();

    for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const empCode = cellToString(row.getCell(2).value).toUpperCase();
        const empName = cellToString(row.getCell(3).value);
        const designation = cellToString(row.getCell(9).value);

        if (!empCode && !empName && !designation) continue;
        if (!empCode || !empName) {
            throw new Error(`Blank employee code/name at source row ${rowNumber}`);
        }
        if (seenCodes.has(empCode)) {
            throw new Error(`Duplicate employee code ${empCode} at source row ${rowNumber}`);
        }

        seenCodes.add(empCode);
        employees.push({
            emp_code: empCode,
            emp_name: empName,
            designation: designation || null
        });
    }

    if (!employees.length) {
        throw new Error(`No employees found in ${filePath}`);
    }

    return employees;
}

async function replaceEmployeesInDatabase(employees) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM employees');
        await client.query('ALTER SEQUENCE employees_id_seq RESTART WITH 1');

        const values = [];
        const params = [];

        employees.forEach((employee, index) => {
            const base = index * 3;
            values.push(`($${base + 1}, $${base + 2}, $${base + 3}, NULL, 1, true)`);
            params.push(employee.emp_code, employee.emp_name, employee.designation);
        });

        await client.query(
            `INSERT INTO employees (
                emp_code,
                emp_name,
                designation,
                default_line_id,
                manpower_factor,
                is_active
            ) VALUES ${values.join(', ')}`,
            params
        );

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function regenerateEmployeeQrs() {
    await fs.rm(EMPLOYEE_QR_DIR, { recursive: true, force: true });
    await fs.mkdir(EMPLOYEE_QR_DIR, { recursive: true });

    const result = await pool.query('SELECT id FROM employees ORDER BY id');
    for (const row of result.rows) {
        await qr.generateEmployeeQrById(row.id);
    }

    return result.rowCount;
}

async function updateLinePlanTemplate(filePath, employees) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const listsSheet = workbook.getWorksheet('Lists');
    const linePlanSheet = workbook.getWorksheet('Line Plan');

    if (!listsSheet || !linePlanSheet) {
        throw new Error(`Expected "Lists" and "Line Plan" sheets in ${filePath}`);
    }

    const startRow = 2;
    const endRow = Math.max(listsSheet.rowCount, employees.length + 1);

    for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
        const employee = employees[rowNumber - startRow];
        listsSheet.getCell(`C${rowNumber}`).value = employee ? employee.emp_code : null;
        listsSheet.getCell(`D${rowNumber}`).value = employee ? employee.emp_name : null;
    }

    const employeeListFormula = `Lists!$D$2:$D$${employees.length + 1}`;
    for (let rowNumber = 16; rowNumber <= 501; rowNumber += 1) {
        linePlanSheet.getCell(`J${rowNumber}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [employeeListFormula]
        };
    }

    await workbook.xlsx.writeFile(filePath);
}

async function updateUploadReadyTemplate(filePath, employees) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const configSheet = workbook.getWorksheet('Config');
    const linePlanSheet = workbook.getWorksheet('Line Plan');

    if (!configSheet || !linePlanSheet) {
        throw new Error(`Expected "Config" and "Line Plan" sheets in ${filePath}`);
    }

    const endRow = Math.max(configSheet.rowCount, employees.length);
    for (let rowNumber = 1; rowNumber <= endRow; rowNumber += 1) {
        const employee = employees[rowNumber - 1];
        configSheet.getCell(`F${rowNumber}`).value = employee ? employee.emp_code : null;
        configSheet.getCell(`G${rowNumber}`).value = employee ? employee.emp_name : null;
        configSheet.getCell(`H${rowNumber}`).value = employee ? `${employee.emp_code} | ${employee.emp_name}` : null;
    }

    const employeeListFormula = `Config!$H$1:$H$${employees.length}`;
    for (let rowNumber = 17; rowNumber <= 502; rowNumber += 1) {
        linePlanSheet.getCell(`L${rowNumber}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [employeeListFormula]
        };
    }

    await workbook.xlsx.writeFile(filePath);
}

async function getCounts() {
    const dbCounts = await pool.query(
        `SELECT
            (SELECT COUNT(*) FROM employees) AS employees_count,
            (SELECT COUNT(*) FROM employees WHERE qr_code_path IS NOT NULL) AS employees_with_qr_count`
    );

    const qrFiles = await fs.readdir(EMPLOYEE_QR_DIR);

    return {
        employees_count: Number(dbCounts.rows[0].employees_count),
        employees_with_qr_count: Number(dbCounts.rows[0].employees_with_qr_count),
        qr_files_count: qrFiles.filter((fileName) => fileName.endsWith('.svg')).length
    };
}

async function main() {
    const employees = await loadEmployeesFromAttendance(SOURCE_FILE);
    console.log(`Loaded ${employees.length} employees from ${path.basename(SOURCE_FILE)}`);

    await replaceEmployeesInDatabase(employees);
    console.log('Replaced employee records in PostgreSQL');

    const qrCount = await regenerateEmployeeQrs();
    console.log(`Regenerated ${qrCount} employee QR files`);

    await updateLinePlanTemplate(TEMPLATE_FILES[0], employees);
    console.log(`Updated template: ${path.basename(TEMPLATE_FILES[0])}`);

    await updateUploadReadyTemplate(TEMPLATE_FILES[1], employees);
    console.log(`Updated template: ${path.basename(TEMPLATE_FILES[1])}`);

    const counts = await getCounts();
    console.log(`Verification: ${counts.employees_count} employees, ${counts.employees_with_qr_count} QR paths, ${counts.qr_files_count} QR files`);
}

main()
    .catch(async (error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
