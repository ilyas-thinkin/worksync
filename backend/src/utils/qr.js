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

function escXml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function writeQrWithLabel(filePath, payload, label1, label2) {
    await ensureDir(path.dirname(filePath));

    const svgString = await QRCode.toString(JSON.stringify(payload), {
        type: 'svg',
        margin: 2
    });

    // Extract viewBox dimensions (e.g. "0 0 33 33")
    const vbMatch = svgString.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
    const vbW = vbMatch ? parseFloat(vbMatch[1]) : 33;
    const vbH = vbMatch ? parseFloat(vbMatch[2]) : 33;

    // Label area dimensions in viewBox units
    const padTop = 0.8;
    const fs1 = vbW * 0.082;   // bold name — ~16px at 200px display width
    const fs2 = vbW * 0.068;   // code — ~13px at 200px display width
    const lineGap = vbW * 0.03;
    const padBot = 1.0;
    const labelH = padTop + fs1 + lineGap + fs2 + padBot;
    const totalH = vbH + labelH;

    // Text positions
    const cx = vbW / 2;
    const y1 = vbH + padTop + fs1;
    const y2 = y1 + lineGap + fs2;

    // Display size: 200px wide, height proportional
    const dispW = 200;
    const dispH = Math.round(dispW * totalH / vbW);

    const labelSvg = [
        `<rect x="0" y="${vbH.toFixed(2)}" width="${vbW.toFixed(2)}" height="${labelH.toFixed(2)}" fill="#ffffff"/>`,
        `<text x="${cx.toFixed(2)}" y="${y1.toFixed(2)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${fs1.toFixed(2)}" font-weight="bold" fill="#111111">${escXml(label1)}</text>`,
        `<text x="${cx.toFixed(2)}" y="${y2.toFixed(2)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${fs2.toFixed(2)}" font-weight="normal" fill="#555555">${escXml(label2)}</text>`
    ].join('\n  ');

    const finalSvg = svgString
        .replace(/<svg /, `<svg width="${dispW}" height="${dispH}" `)
        .replace(/viewBox="0 0 [^"]+"/, `viewBox="0 0 ${vbW.toFixed(2)} ${totalH.toFixed(2)}"`)
        .replace(/<\/svg>/, `  ${labelSvg}\n</svg>`);

    await fs.writeFile(filePath, finalSvg, 'utf8');
}

async function generateEmployeeQrById(id) {
    const result = await pool.query(
        'SELECT id, emp_code, emp_name FROM employees WHERE id = $1',
        [id]
    );
    const employee = result.rows[0];
    if (!employee) return null;

    const filename = `${employee.id}.svg`;
    const relativePath = `qrcodes/employees/${filename}`;
    const fullPath = path.join(dirs.employees, filename);
    const payload = {
        type: 'employee',
        id: employee.id,
        code: employee.emp_code,
        name: employee.emp_name
    };

    await writeQrWithLabel(fullPath, payload, employee.emp_name, employee.emp_code);
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

    const filename = `line_${line.id}.svg`;
    const relativePath = `qrcodes/lines/${filename}`;
    const fullPath = path.join(dirs.lines, filename);
    const payload = {
        type: 'line',
        id: line.id,
        code: line.line_code,
        name: line.line_name
    };

    await writeQrWithLabel(fullPath, payload, line.line_name, line.line_code);
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
        const filename = `ws_${line.line_code}_${wsCode}.svg`;
        const fullPath = path.join(wsDir, filename);
        const relativePath = `qrcodes/workstations/${line.line_code}/${filename}`;

        const payload = {
            type: 'workstation',
            line_id: line.id,
            line_code: line.line_code,
            workstation_code: wsCode,
            workstation_number: i
        };

        await writeQrWithLabel(fullPath, payload, line.line_code, wsCode);

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
