// convert_kn754.js — reads KN754_line_plan_draft.xlsx and outputs KN754_upload_ready.xlsx
// in the exact WorkSync upload template format.
const ExcelJS = require('../backend/node_modules/exceljs');
const { Pool }  = require('../backend/node_modules/pg');
const pool = new Pool({ host:'127.0.0.1', user:'worksync_user', password:'worksync_secure_2026', database:'worksync_db' });

async function run() {
    // ── 1. Load draft ──────────────────────────────────────────────────────────
    const draftWb = new ExcelJS.Workbook();
    await draftWb.xlsx.readFile('Data_given/KN754_line_plan_draft.xlsx');
    const draftWs = draftWb.getWorksheet('Line Plan');

    const getCellStr = (row, col) => {
        const v = row.getCell(col).value;
        if (!v && v !== 0) return '';
        if (typeof v === 'object' && v !== null) {
            if (v.richText)           return v.richText.map(t => t.text).join('').trim();
            if (v instanceof Date)    return v.toISOString().slice(0, 10);
            if (v.result !== undefined) return String(v.result).trim();
            if (v.formula)            return '';   // formula with no cached result
        }
        return String(v).trim();
    };
    const getCellNum = (row, col) => {
        const raw = row.getCell(col).value;
        if (raw === null || raw === undefined || raw === '') return 0;
        if (typeof raw === 'object' && raw.result !== undefined) return parseFloat(raw.result) || 0;
        return parseFloat(String(raw).replace(/,/g, '')) || 0;
    };

    // ── 2. Read header values from draft ──────────────────────────────────────
    const lineCode    = getCellStr(draftWs.getRow(3),  2) || 'RUMIYA_LINE';
    const hallName    = getCellStr(draftWs.getRow(4),  2) || 'Hall B';
    const workDate    = getCellStr(draftWs.getRow(5),  2) || new Date().toISOString().slice(0,10);
    const productCode = getCellStr(draftWs.getRow(6),  2) || 'KN754';
    const productName = getCellStr(draftWs.getRow(7),  2) || 'KATESPADE';
    const buyerName   = getCellStr(draftWs.getRow(8),  2) || '';
    const planMonth   = getCellStr(draftWs.getRow(9),  2) || '';
    const targetUnits = getCellNum(draftWs.getRow(10), 2) || 350;
    const lineLeader  = getCellStr(draftWs.getRow(13), 2) || '';

    // ── 3. Read data rows ──────────────────────────────────────────────────────
    const dataRows = [];
    draftWs.eachRow({ includeEmpty: false }, (row, rn) => {
        if (rn < 16) return;
        const wsCode = getCellStr(row, 3);
        if (!wsCode || /^White cell/i.test(wsCode)) return;  // skip note row
        const opName = getCellStr(row, 5);
        if (!opName) return;
        const pt = getCellNum(row, 6);
        if (!pt || pt <= 0) return;
        // Employee: col 10 (J) — first row of each WS has the name; subsequent rows have formulas
        const jVal = row.getCell(10).value;
        let empName = '';
        if (jVal && typeof jVal === 'object') {
            if (jVal.result !== undefined) empName = String(jVal.result || '').trim();
            else if (jVal.richText)        empName = jVal.richText.map(t => t.text).join('').trim();
        } else if (jVal) {
            empName = String(jVal).trim();
        }
        dataRows.push({
            rn,
            group:   getCellStr(row, 1),
            osm:     getCellStr(row, 2),
            wsCode:  wsCode.toUpperCase(),
            opName,
            pt,
            empName,
        });
    });
    console.log(`Read ${dataRows.length} data rows from draft.`);

    // For rows where empName is empty (formula linked), carry forward from the first row of same WS
    const wsEmployee = {};
    dataRows.forEach(d => {
        if (d.empName) wsEmployee[d.wsCode] = d.empName;
        else if (wsEmployee[d.wsCode]) d.empName = wsEmployee[d.wsCode];
    });

    // ── 4. Fetch operations and employees from DB ─────────────────────────────
    const [opsResult, empsResult] = await Promise.all([
        pool.query(`SELECT operation_code, operation_name FROM operations WHERE is_active = true ORDER BY operation_code`),
        pool.query(`SELECT emp_code, emp_name FROM employees WHERE is_active = true ORDER BY emp_name`)
    ]);
    const operations = opsResult.rows;
    const employees  = empsResult.rows;
    const opCount    = Math.max(operations.length, 1);
    const empCount   = Math.max(employees.length, 1);

    // Build lookup maps
    const opNameToCode = {};
    operations.forEach(op => { opNameToCode[op.operation_name.toUpperCase().trim()] = op.operation_code; });
    const empNameToCode = {};
    employees.forEach(e => { empNameToCode[e.emp_name.toUpperCase().trim()] = e.emp_code; });

    // ── 5. Build output workbook ───────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.calcProperties = { fullCalcOnLoad: true };
    const ws = wb.addWorksheet('Line Plan');
    ws.columns = [
        { width: 14 }, // A: GROUP
        { width: 10 }, // B: OSM
        { width: 16 }, // C: WORKSTATION
        { width: 18 }, // D: OP CODE (auto)
        { width: 36 }, // E: SELECT OPERATION
        { width: 16 }, // F: PROCESS TIME (s)
        { width: 16 }, // G: CYCLE TIME (s)
        { width: 12 }, // H: SAH
        { width: 18 }, // I: EMP CODE (auto)
        { width: 28 }, // J: SELECT EMPLOYEE
    ];

    // Styles
    const greenHdr  = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1D6F42'} };
    const blueHdr   = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1E40AF'} };
    const inputFill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFFFFF'} };
    const autoFill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEBEBEB'} };
    const linkFill  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE8F5E9'} };
    const labelFill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF2F2F2'} };
    const borderAll = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
    const boldFont  = { bold:true, size:11 };

    // Row 1: Title
    ws.mergeCells('A1:J1');
    const tc = ws.getCell('A1');
    tc.value = 'LINE PLAN UPLOAD';
    tc.font  = { bold:true, size:14, color:{argb:'FFFFFFFF'} };
    tc.fill  = greenHdr;
    tc.alignment = { horizontal:'center', vertical:'middle' };
    ws.getRow(1).height = 30;
    ws.getRow(2).height = 6;

    // Rows 3-13: Header fields
    const hdrRows = [
        { row:3,  label:'LINE CODE',      value:lineCode    },
        { row:4,  label:'HALL NAME',       value:hallName    },
        { row:5,  label:'DATE',            value:workDate    },
        { row:6,  label:'PRODUCT CODE',    value:productCode },
        { row:7,  label:'PRODUCT NAME',    value:productName },
        { row:8,  label:'BUYER NAME',      value:buyerName   },
        { row:9,  label:'PLAN MONTH',      value:planMonth   },
        { row:10, label:'TARGET UNITS',    value:targetUnits },
        { row:11, label:'CO PRODUCT CODE', value:''          },
        { row:12, label:'CO TARGET',       value:''          },
        { row:13, label:'LINE LEADER',     value:lineLeader  },
    ];
    const notes = {
        3:  'Production line code. Auto-created if not in system.',
        4:  'Hall/area name.',
        5:  'Work date — YYYY-MM-DD format.',
        6:  'Style/product code. Auto-created if new.',
        7:  'Full product name.',
        8:  'Buyer / brand name. Optional.',
        9:  'Plan month (e.g. 2026-04). Optional.',
        10: 'Daily target for this line. Required.',
        11: 'Optional — changeover product code.',
        12: 'Optional — changeover target units.',
        13: 'Line leader name.',
    };
    const leaderFill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD1FAE5'} };
    hdrRows.forEach(({ row, label, value }) => {
        const isLeader = label === 'LINE LEADER';
        const lc = ws.getCell(row, 1);
        lc.value = label; lc.font = boldFont; lc.fill = labelFill;
        lc.border = borderAll; lc.alignment = { horizontal:'left', vertical:'middle' };
        const vc = ws.getCell(row, 2);
        vc.value = value;
        vc.font  = isLeader ? { bold:true, size:11, color:{argb:'FF1D6F42'} } : { size:11 };
        vc.fill  = isLeader ? leaderFill : { type:'pattern', pattern:'none' };
        vc.border = borderAll; vc.alignment = { horizontal:'left', vertical:'middle' };
        ws.mergeCells(row, 3, row, 10);
        const nc = ws.getCell(row, 3);
        nc.value = notes[row] || '';
        nc.font  = { size:10, italic:true, color:{argb:'FF6B7280'} };
        nc.alignment = { horizontal:'left', vertical:'middle' };
    });

    ws.getRow(14).height = 8;

    // Row 15: Column headers
    const colHeaders = [
        { h:'GROUP',              blue:true  },
        { h:'OSM',                blue:true  },
        { h:'WORKSTATION ▼',      blue:true  },
        { h:'OP CODE (auto)',      blue:false },
        { h:'SELECT OPERATION ▼', blue:true  },
        { h:'PROCESS TIME (s)',    blue:true  },
        { h:'CYCLE TIME (s)',      blue:false },
        { h:'SAH',                blue:false },
        { h:'EMP CODE (auto)',     blue:false },
        { h:'SELECT EMPLOYEE ▼',  blue:true  },
    ];
    const hRow = ws.getRow(15);
    hRow.height = 22;
    colHeaders.forEach(({ h, blue }, i) => {
        const cell = hRow.getCell(i + 1);
        cell.value = h;
        cell.font  = { bold:true, size:11, color:{argb:'FFFFFFFF'} };
        cell.fill  = blue ? blueHdr : greenHdr;
        cell.border = borderAll;
        cell.alignment = { horizontal:'center', vertical:'middle' };
    });

    // Config sheet (hidden)
    const cfg = wb.addWorksheet('Config');
    cfg.state = 'hidden';
    for (let w = 1; w <= 100; w++) cfg.getCell(w, 1).value = `WS${String(w).padStart(2,'0')}`;
    for (let g = 1; g <= 50;  g++) cfg.getCell(g, 2).value = `G${g}`;
    operations.forEach((op, i) => {
        cfg.getCell(i+1, 3).value = op.operation_code;
        cfg.getCell(i+1, 4).value = op.operation_name;
        cfg.getCell(i+1, 5).value = `${op.operation_code} | ${op.operation_name}`;
    });
    employees.forEach((e, i) => {
        cfg.getCell(i+1, 6).value = e.emp_code;
        cfg.getCell(i+1, 7).value = e.emp_name;
        cfg.getCell(i+1, 8).value = `${e.emp_code} | ${e.emp_name}`;
    });

    // Data rows — write into rows 16 .. 15+dataRows.length
    const wsFirstOutputRow = {};   // wsCode → first output row number (for backward formula)
    const noEmpWS = [];

    dataRows.forEach((d, idx) => {
        const rowNum = 16 + idx;
        if (!(d.wsCode in wsFirstOutputRow)) wsFirstOutputRow[d.wsCode] = rowNum;
        const isFirst = rowNum === wsFirstOutputRow[d.wsCode];

        const row = ws.getRow(rowNum);
        row.height = 18;

        const setCell = (col, value, fill, numFmt, alignH) => {
            const c = row.getCell(col);
            c.value  = value !== undefined ? value : '';
            c.fill   = fill || inputFill;
            c.border = borderAll;
            c.alignment = { horizontal: alignH || 'center', vertical:'middle' };
            if (numFmt) c.numFmt = numFmt;
            return c;
        };

        setCell(1, d.group, inputFill);
        setCell(2, d.osm || '', inputFill);
        setCell(3, d.wsCode, inputFill);

        // D: OP CODE — formula auto-extracts from E
        const dc = setCell(4, undefined, autoFill);
        dc.value = { formula:
            `=IF(E${rowNum}="","",IF(ISNUMBER(FIND("|",E${rowNum})),` +
              `TRIM(LEFT(E${rowNum},FIND("|",E${rowNum})-1)),` +
              `IF(ISNUMBER(MATCH(E${rowNum},Config!$C$1:$C$${opCount},0)),E${rowNum},` +
                `IFERROR(INDEX(Config!$C$1:$C$${opCount},MATCH(E${rowNum},Config!$D$1:$D$${opCount},0)),"")` +
              `)))`,
            result: opNameToCode[d.opName.toUpperCase().trim()] || ''
        };

        // E: Operation name — just the plain name (upload parser strips combined prefix)
        setCell(5, d.opName, inputFill, null, 'left');

        // F: Process time
        setCell(6, d.pt, inputFill, '0.00');

        // G: Cycle time — SUMIF by WS
        const gc = setCell(7, undefined, autoFill, '0.00');
        gc.value = { formula: `=SUMIF($C$16:$C$${15+dataRows.length},C${rowNum},$F$16:$F$${15+dataRows.length})`, result: 0 };

        // H: SAH
        const hc = setCell(8, undefined, autoFill, '0.0000');
        const sahResult = d.pt ? +(d.pt / 3600).toFixed(6) : 0;
        hc.value = { formula: `=F${rowNum}/3600`, result: sahResult };

        // I: EMP CODE — formula auto-extracts from J
        const ic = setCell(9, undefined, autoFill);
        const preCode = d.empName ? (empNameToCode[d.empName.toUpperCase().trim()] || '') : '';
        ic.value = { formula:
            `=IF(J${rowNum}="","",IF(ISNUMBER(FIND("|",J${rowNum})),` +
              `TRIM(LEFT(J${rowNum},FIND("|",J${rowNum})-1)),` +
              `IF(ISNUMBER(MATCH(J${rowNum},Config!$F$1:$F$${empCount},0)),J${rowNum},` +
                `IFERROR(INDEX(Config!$F$1:$F$${empCount},MATCH(J${rowNum},Config!$G$1:$G$${empCount},0)),"")` +
              `)))`,
            result: preCode
        };

        // J: Employee — first row of each WS = plain name; subsequent = backward formula
        const jc = row.getCell(10);
        jc.border = borderAll;
        jc.alignment = { horizontal:'left', vertical:'middle' };
        if (isFirst) {
            jc.value = d.empName || '';
            jc.fill  = d.empName ? inputFill : { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFF3CD'} };
            if (!d.empName && !noEmpWS.includes(d.wsCode)) noEmpWS.push(d.wsCode);
        } else {
            const firstRowNum = wsFirstOutputRow[d.wsCode];
            jc.value = { formula: `=IFERROR(INDEX($J$16:J${rowNum-1},MATCH(C${rowNum},$C$16:C${rowNum-1},0)),"")`, result: d.empName || '' };
            jc.fill  = linkFill;
            jc.font  = { italic:true, color:{argb:'FF374151'} };
        }
    });

    // Data validations
    const dataEnd = 15 + dataRows.length;
    [
        { range: `A16:A${dataEnd}`, src: `Config!$B$1:$B$50`         },
        { range: `C16:C${dataEnd}`, src: `Config!$A$1:$A$100`        },
        { range: `E16:E${dataEnd}`, src: `Config!$E$1:$E$${opCount}` },
        { range: `J16:J${dataEnd}`, src: `Config!$H$1:$H$${empCount}`},
    ].forEach(({ range, src }) => {
        ws.dataValidations.add(range, { type:'list', allowBlank:true, showErrorMessage:false, formulae:[src] });
    });

    // Note row
    const noteRn = dataEnd + 2;
    ws.mergeCells(noteRn, 1, noteRn, 10);
    const nc = ws.getCell(noteRn, 1);
    nc.value = noEmpWS.length
        ? `⚠️ Workstations still need an employee assigned (yellow cells): ${noEmpWS.join(', ')}`
        : `✅ All ${dataRows.length} rows ready. Review header fields (rows 3-13) then upload.`;
    nc.font  = { size:10, italic:true, color:{ argb: noEmpWS.length ? 'FF92400E' : 'FF166534' } };
    nc.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: noEmpWS.length ? 'FFFFF3CD' : 'FFD1FAE5' } };
    nc.alignment = { wrapText:true };
    ws.getRow(noteRn).height = 30;

    // ── 6. Save ────────────────────────────────────────────────────────────────
    const outPath = 'Data_given/KN754_upload_ready.xlsx';
    await wb.xlsx.writeFile(outPath);
    console.log(`\n✅ Saved: ${outPath}`);
    console.log(`   Rows: ${dataRows.length} | WS: ${Object.keys(wsFirstOutputRow).length} | No employee: ${noEmpWS.length ? noEmpWS.join(', ') : 'None'}`);
    if (noEmpWS.length) console.log(`   ⚠️  Assign employees to yellow cells before uploading.`);
    await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
