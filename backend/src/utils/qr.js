const path = require('path');
const fs = require('fs/promises');
const QRCode = require('qrcode');
const pool = require('../config/db.config');

const baseDir = process.env.QRCODES_DIR || path.join(__dirname, '..', '..', 'qrcodes');
const dirs = {
    employees: path.join(baseDir, 'employees'),
    lines: path.join(baseDir, 'lines'),
    workstations: path.join(baseDir, 'workstations')
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


async function generateWorkstationQrForLine(lineId) {
    const lineResult = await pool.query(
        'SELECT id, line_code, line_name FROM production_lines WHERE id = $1',
        [lineId]
    );
    const line = lineResult.rows[0];
    if (!line) return [];

    const wsDir = path.join(dirs.workstations, line.line_code);
    await ensureDir(wsDir);

    const results = [];
    for (let i = 1; i <= 100; i++) {
        const wsCode = 'W' + String(i).padStart(2, '0');
        const filename = `ws_${line.line_code}_${wsCode}.png`;
        const fullPath = path.join(wsDir, filename);
        const relativePath = `qrcodes/workstations/${line.line_code}/${filename}`;

        const payload = {
            type: 'workstation',
            line_id: line.id,
            line_code: line.line_code,
            workstation_code: wsCode,
            workstation_number: i
        };

        await writeQr(fullPath, payload);

        const wsResult = await pool.query(
            `INSERT INTO line_workstations (line_id, workstation_number, workstation_code, qr_code_path)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (line_id, workstation_code) DO UPDATE SET qr_code_path = EXCLUDED.qr_code_path
             RETURNING id`,
            [line.id, i, wsCode, relativePath]
        );
        results.push({ id: wsResult.rows[0].id, workstation_number: i, workstation_code: wsCode, qr_code_path: relativePath });
    }
    return results;
}

module.exports = {
    generateEmployeeQrById,
    generateLineQrById,
    generateWorkstationQrForLine
};
