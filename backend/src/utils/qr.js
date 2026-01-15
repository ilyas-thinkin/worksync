const path = require('path');
const fs = require('fs/promises');
const QRCode = require('qrcode');
const pool = require('../config/db.config');

const baseDir = process.env.QRCODES_DIR || path.join(__dirname, '..', '..', 'qrcodes');
const dirs = {
    employees: path.join(baseDir, 'employees'),
    lines: path.join(baseDir, 'lines'),
    processes: path.join(baseDir, 'processes')
};

async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}

async function writeQr(filePath, payload) {
    await ensureDir(path.dirname(filePath));
    await QRCode.toFile(filePath, JSON.stringify(payload));
}

async function generateEmployeeQrById(id) {
    const result = await pool.query(
        'SELECT id, emp_code, emp_name FROM employees WHERE id = $1',
        [id]
    );
    const employee = result.rows[0];
    if (!employee) return null;

    const filename = `employee_${employee.id}.png`;
    const relativePath = `qrcodes/employees/${filename}`;
    const fullPath = path.join(dirs.employees, filename);
    const payload = {
        type: 'employee',
        id: employee.id,
        code: employee.emp_code,
        name: employee.emp_name
    };

    await writeQr(fullPath, payload);
    await pool.query('UPDATE employees SET qr_code_path = $1 WHERE id = $2', [relativePath, employee.id]);
    return relativePath;
}

async function generateLineQrById(id) {
    const result = await pool.query(
        'SELECT id, line_code, line_name FROM production_lines WHERE id = $1',
        [id]
    );
    const line = result.rows[0];
    if (!line) return null;

    const filename = `line_${line.id}.png`;
    const relativePath = `qrcodes/lines/${filename}`;
    const fullPath = path.join(dirs.lines, filename);
    const payload = {
        type: 'line',
        id: line.id,
        code: line.line_code,
        name: line.line_name
    };

    await writeQr(fullPath, payload);
    await pool.query('UPDATE production_lines SET qr_code_path = $1 WHERE id = $2', [relativePath, line.id]);
    return relativePath;
}

async function generateProcessQrById(id) {
    const result = await pool.query(
        `SELECT pp.id, pp.sequence_number, o.operation_name
         FROM product_processes pp
         JOIN operations o ON pp.operation_id = o.id
         WHERE pp.id = $1`,
        [id]
    );
    const process = result.rows[0];
    if (!process) return null;

    const filename = `process_${process.id}.png`;
    const relativePath = `qrcodes/processes/${filename}`;
    const fullPath = path.join(dirs.processes, filename);
    const payload = {
        type: 'process',
        id: process.id,
        name: process.operation_name
    };

    await writeQr(fullPath, payload);
    await pool.query('UPDATE product_processes SET qr_code_path = $1 WHERE id = $2', [relativePath, process.id]);
    return relativePath;
}

async function generateOperationQrById(id) {
    const result = await pool.query(
        'SELECT id, operation_code, operation_name FROM operations WHERE id = $1',
        [id]
    );
    const operation = result.rows[0];
    if (!operation) return null;

    const filename = `operation_${operation.id}.png`;
    const relativePath = `qrcodes/operations/${filename}`;
    const fullPath = path.join(baseDir, 'operations', filename);
    const payload = {
        type: 'operation',
        id: operation.id,
        code: operation.operation_code,
        name: operation.operation_name
    };

    await writeQr(fullPath, payload);
    await pool.query('UPDATE operations SET qr_code_path = $1 WHERE id = $2', [relativePath, operation.id]);
    return relativePath;
}

module.exports = {
    generateEmployeeQrById,
    generateLineQrById,
    generateProcessQrById,
    generateOperationQrById
};
