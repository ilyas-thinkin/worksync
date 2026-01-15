const path = require('path');
const fs = require('fs/promises');
const modulePath = path.join(__dirname, '..', 'backend', 'node_modules');
process.env.NODE_PATH = modulePath;
require('module').Module._initPaths();
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const pool = require('../backend/src/config/db.config');
const qr = require('../backend/src/utils/qr');

const baseDir = process.env.QRCODES_DIR || path.join(__dirname, '..', 'qrcodes');
const dirs = {
    employees: path.join(baseDir, 'employees'),
    lines: path.join(baseDir, 'lines'),
    processes: path.join(baseDir, 'processes'),
    operations: path.join(baseDir, 'operations')
};

async function clearDir(dir) {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    await Promise.all(files.map((file) => fs.unlink(path.join(dir, file))));
}

async function regenerateEmployees() {
    await clearDir(dirs.employees);
    const result = await pool.query('SELECT id FROM employees ORDER BY id');
    for (const row of result.rows) {
        await qr.generateEmployeeQrById(row.id);
    }
}

async function regenerateLines() {
    await clearDir(dirs.lines);
    const result = await pool.query('SELECT id FROM production_lines ORDER BY id');
    for (const row of result.rows) {
        await qr.generateLineQrById(row.id);
    }
}

async function regenerateProcesses() {
    await clearDir(dirs.processes);
    const result = await pool.query('SELECT id FROM product_processes ORDER BY id');
    for (const row of result.rows) {
        await qr.generateProcessQrById(row.id);
    }
}

async function regenerateOperations() {
    await clearDir(dirs.operations);
    const result = await pool.query('SELECT id FROM operations ORDER BY id');
    for (const row of result.rows) {
        await qr.generateOperationQrById(row.id);
    }
}

async function main() {
    try {
        await regenerateEmployees();
        await regenerateLines();
        await regenerateProcesses();
        await regenerateOperations();
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
