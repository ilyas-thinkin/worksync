// insert_kn754_plan.js
// Phase 1: Insert all KN754 operations with codes OP-0014+
// Phase 2: Insert full line plan (line, product, daily plan, workstation plan, employee assignments)
const ExcelJS = require('../backend/node_modules/exceljs');
const { Pool } = require('../backend/node_modules/pg');
const pool = new Pool({ host:'127.0.0.1', user:'worksync_user', password:'worksync_secure_2026', database:'worksync_db' });

async function run() {
    // ── Read Excel ────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile('Data_given/KN754_upload_ready.xlsx');
    const sheet = wb.getWorksheet('Line Plan') || wb.worksheets[0];
    if (!sheet) throw new Error('Sheet "Line Plan" not found');

    const getCellStr = (r, c) => {
        const v = sheet.getRow(r).getCell(c).value;
        if (!v && v !== 0) return '';
        if (typeof v === 'object' && v !== null) {
            if (v.richText)             return v.richText.map(t=>t.text).join('').trim();
            if (v instanceof Date)      return v.toISOString().slice(0,10);
            if (v.result !== undefined) return String(v.result).trim();
        }
        return String(v).trim();
    };
    const getCellNum = (r, c) => {
        const raw = sheet.getRow(r).getCell(c).value;
        if (raw === null || raw === undefined || raw === '') return 0;
        if (typeof raw === 'object' && raw.result !== undefined) return parseFloat(raw.result) || 0;
        return parseFloat(String(raw).replace(/,/g,'')) || 0;
    };

    // Header fields
    const lineCode    = getCellStr(3,  2);
    const hallName    = getCellStr(4,  2);
    const workDate    = getCellStr(5,  2);
    const productCode = getCellStr(6,  2);
    const productName = getCellStr(7,  2);
    const buyerName   = getCellStr(8,  2) || null;
    const planMonth   = getCellStr(9,  2) || null;
    const targetUnits = Math.round(getCellNum(10, 2));
    const lineLeader  = getCellStr(13, 2) || null;

    if (!lineCode)    throw new Error('LINE CODE missing (row 3)');
    if (!workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw new Error('DATE invalid (row 5)');
    if (!productCode) throw new Error('PRODUCT CODE missing (row 6)');
    if (!targetUnits) throw new Error('TARGET UNITS missing (row 10)');

    console.log(`\nLine: ${lineCode} | Product: ${productCode} (${productName}) | Date: ${workDate} | Target: ${targetUnits}`);

    // Data rows
    const dataRows = [];
    let autoSeq = 1;
    for (let rn = 16; rn <= 3000; rn++) {
        const wsCode = getCellStr(rn, 3);
        let   opName = getCellStr(rn, 5);
        if (!wsCode && !opName) break;
        if (!wsCode || /^[⚠✅]/.test(wsCode)) continue;  // skip note rows
        const opPipe = opName.indexOf(' | ');
        if (opPipe !== -1) opName = opName.slice(opPipe + 3).trim();
        if (!opName) continue;
        const sah = getCellNum(rn, 8);
        if (!sah || sah <= 0) continue;
        let empName = getCellStr(rn, 10);
        const empPipe = empName.indexOf(' | ');
        if (empPipe !== -1) empName = empName.slice(empPipe + 3).trim();
        dataRows.push({
            seq:    autoSeq++,
            group:  getCellStr(rn, 1),
            osm:    getCellStr(rn, 2) || null,
            wsCode: wsCode.toUpperCase(),
            opCode: getCellStr(rn, 4).toUpperCase() || '',
            opName,
            sah,
            empCode: getCellStr(rn, 9),
            empName,
        });
    }
    if (!dataRows.length) throw new Error('No data rows found');
    console.log(`Read ${dataRows.length} data rows, ${new Set(dataRows.map(r=>r.wsCode)).size} workstations`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ── Working hours ─────────────────────────────────────────────────────
        const settRes = await client.query(
            `SELECT key, value FROM app_settings WHERE key IN ('default_in_time','default_out_time')`
        );
        const sm = {};
        settRes.rows.forEach(r => { sm[r.key] = r.value; });
        let workingSecs = 8 * 3600;
        if (sm.default_in_time && sm.default_out_time) {
            const [inH,inM]   = sm.default_in_time.split(':').map(Number);
            const [outH,outM] = sm.default_out_time.split(':').map(Number);
            workingSecs = Math.max(0, ((outH*60+outM)-(inH*60+inM))*60);
        }
        const taktTimeSecs = targetUnits > 0 ? workingSecs / targetUnits : 0;
        console.log(`Working seconds: ${workingSecs} | Takt time: ${taktTimeSecs.toFixed(2)}s`);

        // ── Phase 1: Insert all operations ────────────────────────────────────
        console.log('\n── PHASE 1: Operations ──');

        // Fetch existing ops (code + name, for matching)
        const existingOps = await client.query(
            `SELECT id, operation_code, UPPER(TRIM(operation_name)) AS uname FROM operations WHERE is_active = true`
        );
        const codeToId   = {};   // op_code → id
        const nameToId   = {};   // upper(name) → id
        const nameToCode = {};   // upper(name) → code
        existingOps.rows.forEach(r => {
            codeToId[r.operation_code.toUpperCase()] = r.id;
            nameToId[r.uname]  = r.id;
            nameToCode[r.uname] = r.operation_code;
        });

        // Get next OP-NNNN number
        const maxRes = await client.query(
            `SELECT MAX(CASE WHEN operation_code ~ '^OP-[0-9]+$' THEN CAST(substring(operation_code FROM 4) AS INTEGER) ELSE 0 END) AS mx FROM operations`
        );
        let nextOpNum = (maxRes.rows[0].mx || 0) + 1;

        // Collect unique op names that need to be inserted
        const uniqueNames = [...new Set(dataRows.map(r => r.opName))];
        let inserted = 0, matched = 0;

        for (const opName of uniqueNames) {
            const uName = opName.toUpperCase().trim();
            if (nameToId[uName]) {
                matched++;
                continue;  // already exists
            }
            // Not in DB — assign new code
            const newCode = 'OP-' + String(nextOpNum).padStart(4, '0');
            nextOpNum++;
            const ins = await client.query(
                `INSERT INTO operations (operation_code, operation_name, is_active)
                 VALUES ($1, $2, true)
                 ON CONFLICT (operation_code) DO UPDATE SET operation_name = EXCLUDED.operation_name
                 RETURNING id, operation_code`,
                [newCode, opName]
            );
            const newId = ins.rows[0].id;
            codeToId[newCode.toUpperCase()] = newId;
            nameToId[uName]  = newId;
            nameToCode[uName] = newCode;
            console.log(`  [NEW] ${newCode} → ${opName}`);
            inserted++;
        }
        console.log(`  ✅ ${inserted} new operations inserted, ${matched} existing matched`);

        // Resolve opId and opCode for every data row
        dataRows.forEach(r => {
            const uName = r.opName.toUpperCase().trim();
            r.opId   = nameToId[uName];
            r.opCode = nameToCode[uName] || r.opCode;
            if (!r.opId) throw new Error(`Could not resolve operation: "${r.opName}"`);
        });

        // ── Phase 2: Line + Product ───────────────────────────────────────────
        console.log('\n── PHASE 2: Line & Product ──');

        // Find or create line
        let lineId, lineCreated = false;
        const existLine = await client.query(
            `SELECT id FROM production_lines WHERE line_code = $1 LIMIT 1`, [lineCode]
        );
        if (existLine.rows[0]) {
            lineId = existLine.rows[0].id;
            if (lineLeader) {
                await client.query(
                    `UPDATE production_lines SET line_leader = $1 WHERE id = $2`, [lineLeader, lineId]
                );
            }
            console.log(`  Line "${lineCode}" already exists (id=${lineId})`);
        } else {
            const ins = await client.query(
                `INSERT INTO production_lines (line_code, line_name, hall_location, line_leader, is_active)
                 VALUES ($1, $2, $3, $4, true) RETURNING id`,
                [lineCode, hallName, hallName, lineLeader]
            );
            lineId = ins.rows[0].id;
            lineCreated = true;
            console.log(`  Line "${lineCode}" created (id=${lineId})`);
        }

        // Find or create product
        const prodRes = await client.query(
            `INSERT INTO products (product_code, product_name, buyer_name, plan_month, is_active)
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (product_code) DO UPDATE
               SET product_name = EXCLUDED.product_name,
                   buyer_name   = COALESCE(EXCLUDED.buyer_name, products.buyer_name),
                   plan_month   = COALESCE(EXCLUDED.plan_month, products.plan_month)
             RETURNING id`,
            [productCode, productName, buyerName, planMonth]
        );
        const productId = prodRes.rows[0].id;
        console.log(`  Product "${productCode}" upserted (id=${productId})`);

        // ── Phase 3: product_processes ────────────────────────────────────────
        console.log('\n── PHASE 3: Product processes ──');

        // Deactivate all existing, shift sequences
        await client.query(
            `UPDATE product_processes SET is_active = false WHERE product_id = $1`, [productId]
        );
        await client.query(
            `UPDATE product_processes SET sequence_number = sequence_number + 1000000 WHERE product_id = $1`, [productId]
        );

        for (const row of dataRows) {
            row.osmChecked = row.osm !== null && row.osm !== '';
            const ppCheck = await client.query(
                `SELECT id FROM product_processes WHERE product_id = $1 AND operation_id = $2 LIMIT 1`,
                [productId, row.opId]
            );
            if (ppCheck.rows[0]) {
                await client.query(
                    `UPDATE product_processes
                     SET operation_sah = $1, cycle_time_seconds = $2, osm_checked = $3, is_active = true
                     WHERE id = $4`,
                    [row.sah, Math.round(row.sah * 3600), row.osmChecked, ppCheck.rows[0].id]
                );
                row.ppId = ppCheck.rows[0].id;
            } else {
                const ppIns = await client.query(
                    `INSERT INTO product_processes
                       (product_id, operation_id, sequence_number, operation_sah, cycle_time_seconds, manpower_required, is_active, osm_checked)
                     VALUES ($1, $2, $3, $4, $5, 1, true, $6) RETURNING id`,
                    [productId, row.opId, row.seq, row.sah, Math.round(row.sah * 3600), row.osmChecked]
                );
                row.ppId = ppIns.rows[0].id;
            }
        }

        // Batch-update sequences — deduplicate by ppId (same op in multiple WS = one product_process row)
        const seenPpIds = new Set();
        const seqVals = dataRows
            .filter(r => { if (seenPpIds.has(r.ppId)) return false; seenPpIds.add(r.ppId); return true; })
            .map(r => `(${r.ppId}, ${r.seq})`).join(', ');
        await client.query(
            `UPDATE product_processes AS pp SET sequence_number = v.seq
             FROM (VALUES ${seqVals}) AS v(id, seq)
             WHERE pp.id = v.id`
        );
        // Restore old processes not in this upload (subtract 1000000)
        await client.query(
            `UPDATE product_processes SET sequence_number = sequence_number - 1000000
             WHERE product_id = $1 AND sequence_number > 999999`, [productId]
        );
        console.log(`  ✅ ${dataRows.length} product_processes upserted`);

        // ── Phase 4: Daily plan ───────────────────────────────────────────────
        console.log('\n── PHASE 4: Daily plan ──');
        await client.query(
            `INSERT INTO line_daily_plans
               (line_id, product_id, work_date, target_units, changeover_sequence, created_by, updated_by)
             VALUES ($1, $2, $3, $4, 0, NULL, NULL)
             ON CONFLICT (line_id, work_date) DO UPDATE
               SET product_id           = EXCLUDED.product_id,
                   target_units         = EXCLUDED.target_units,
                   changeover_sequence  = EXCLUDED.changeover_sequence,
                   changeover_started_at = NULL,
                   updated_at           = NOW()`,
            [lineId, productId, workDate, targetUnits]
        );
        console.log(`  ✅ Daily plan upserted for ${workDate}`);

        // ── Phase 5: Workstation plan ─────────────────────────────────────────
        console.log('\n── PHASE 5: Workstation plan ──');
        await client.query(
            `DELETE FROM line_plan_workstations WHERE line_id = $1 AND work_date = $2 AND product_id = $3`,
            [lineId, workDate, productId]
        );

        // Resolve employee codes for rows where empCode is empty
        const unmatchedEmpNames = [...new Set(dataRows.filter(r => !r.empCode && r.empName).map(r => r.empName))];
        if (unmatchedEmpNames.length) {
            const empByNameRes = await client.query(
                `SELECT emp_code, emp_name FROM employees
                 WHERE UPPER(TRIM(emp_name)) = ANY(SELECT UPPER(TRIM(unnest($1::text[]))))
                   AND is_active = true`,
                [unmatchedEmpNames]
            );
            const nameMap = {};
            empByNameRes.rows.forEach(e => { nameMap[e.emp_name.toUpperCase().trim()] = e.emp_code; });
            dataRows.forEach(r => {
                if (!r.empCode && r.empName) {
                    r.empCode = nameMap[r.empName.toUpperCase().trim()] || '';
                }
            });
        }

        const wsGroupsMap = new Map();
        for (const row of dataRows) {
            if (!wsGroupsMap.has(row.wsCode)) wsGroupsMap.set(row.wsCode, []);
            wsGroupsMap.get(row.wsCode).push(row);
        }

        let wsNumber = 1, employeesAssigned = 0, noEmpWS = [];
        for (const [wsCode, processes] of wsGroupsMap) {
            const actualSam   = processes.reduce((s, p) => s + (p.sah * 3600), 0);
            const workloadPct = taktTimeSecs > 0 ? (actualSam / taktTimeSecs) * 100 : 0;
            const groupName   = processes.find(p => p.group)?.group || null;

            const wsIns = await client.query(
                `INSERT INTO line_plan_workstations
                   (line_id, work_date, product_id, workstation_number, workstation_code,
                    takt_time_seconds, actual_sam_seconds, workload_pct, group_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                [lineId, workDate, productId, wsNumber, wsCode,
                 Math.round(taktTimeSecs * 100) / 100,
                 Math.round(actualSam * 100) / 100,
                 Math.round(workloadPct * 100) / 100,
                 groupName]
            );
            const wsId = wsIns.rows[0].id;

            // Insert processes (deduplicated by ppId)
            const seenPpIds = new Set();
            const unique = processes.filter(p => {
                if (seenPpIds.has(p.ppId)) return false;
                seenPpIds.add(p.ppId); return true;
            });
            for (let i = 0; i < unique.length; i++) {
                await client.query(
                    `INSERT INTO line_plan_workstation_processes
                       (workstation_id, product_process_id, sequence_in_workstation, osm_checked)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT ON CONSTRAINT line_plan_workstation_process_workstation_id_product_proces_key DO NOTHING`,
                    [wsId, unique[i].ppId, i+1, unique[i].osmChecked || false]
                );
            }

            // Assign employee
            const withEmp = processes.find(p => p.empCode);
            if (withEmp) {
                const empRow = await client.query(
                    `SELECT id FROM employees WHERE UPPER(emp_code) = UPPER($1) LIMIT 1`,
                    [withEmp.empCode]
                );
                if (empRow.rows[0]) {
                    const empId = empRow.rows[0].id;
                    const conflict = await client.query(
                        `SELECT 1 FROM employee_workstation_assignments
                         WHERE employee_id = $1 AND work_date = $2 AND is_overtime = false
                           AND NOT (line_id = $3 AND workstation_code = $4)
                         LIMIT 1`,
                        [empId, workDate, lineId, wsCode]
                    );
                    if (!conflict.rows[0]) {
                        await client.query(
                            `INSERT INTO employee_workstation_assignments
                               (line_id, work_date, workstation_code, employee_id, line_plan_workstation_id, is_overtime, is_linked)
                             VALUES ($1, $2, $3, $4, $5, false, false)
                             ON CONFLICT (line_id, work_date, workstation_code, is_overtime)
                             DO UPDATE SET employee_id = EXCLUDED.employee_id,
                                           line_plan_workstation_id = EXCLUDED.line_plan_workstation_id,
                                           is_linked = false, assigned_at = NOW()`,
                            [lineId, workDate, wsCode, empId, wsId]
                        );
                        employeesAssigned++;
                    }
                } else {
                    console.log(`  ⚠️  Employee code not found: "${withEmp.empCode}" (WS ${wsCode})`);
                }
            } else {
                noEmpWS.push(wsCode);
            }
            wsNumber++;
        }
        console.log(`  ✅ ${wsGroupsMap.size} workstations created, ${employeesAssigned} employees assigned`);
        if (noEmpWS.length) console.log(`  ⚠️  No employee for: ${noEmpWS.join(', ')}`);

        await client.query('COMMIT');

        console.log('\n✅ DONE');
        console.log(`   Operations inserted : ${inserted}`);
        console.log(`   Product processes   : ${dataRows.length}`);
        console.log(`   Workstations        : ${wsGroupsMap.size}`);
        console.log(`   Employees assigned  : ${employeesAssigned}`);
        console.log(`   Missing employees   : ${noEmpWS.length ? noEmpWS.join(', ') : 'None'}`);

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}
run().catch(e => { console.error('\n❌ Error:', e.message); process.exit(1); });
