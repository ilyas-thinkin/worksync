const ExcelJS = require('./backend/node_modules/exceljs');
const { Pool } = require('./backend/node_modules/pg');
const pool = new Pool({ host:'127.0.0.1', user:'worksync_user', password:'worksync_secure_2026', database:'worksync_db' });

async function run() {
    const { rows: allEmps } = await pool.query('SELECT emp_code, emp_name FROM employees WHERE is_active=true ORDER BY emp_name');
    const nameToCode = {};
    allEmps.forEach(e => { nameToCode[e.emp_name] = e.emp_code; });

    const draftWb = new ExcelJS.Workbook();
    await draftWb.xlsx.readFile('Data_given/KN754_line_plan_draft.xlsx');
    const draftWs = draftWb.getWorksheet('Line Plan');

    const allData = [];
    draftWs.eachRow({ includeEmpty: false }, (row, rn) => {
        if (rn < 16) return;
        const wsCode = String(row.getCell(3).value || '').trim();
        if (!wsCode || !/^W\d/i.test(wsCode)) return;
        const timeSec = row.getCell(6).value;
        if (!timeSec && timeSec !== 0) return;
        const jVal = row.getCell(10).value;
        const empName = (jVal && typeof jVal === 'object' && jVal.formula)
            ? (jVal.result || '')
            : String(jVal || '').trim();
        allData.push({
            rn, ws: wsCode,
            group:   String(row.getCell(1).value||'').trim(),
            osm:     String(row.getCell(2).value||'').trim(),
            opName:  String(row.getCell(5).value||'').trim(),
            timeSec: typeof timeSec === 'number' ? timeSec : null,
            empName: String(empName||'').trim(),
        });
    });

    const wsFirstRow = {};
    allData.forEach(d => { if (!(d.ws in wsFirstRow)) wsFirstRow[d.ws] = d.rn; });

    // Build new workbook with fullCalcOnLoad so formulas evaluate on open
    const outWb = new ExcelJS.Workbook();
    outWb.calcProperties = { fullCalcOnLoad: true };

    const outWs = outWb.addWorksheet('Line Plan');
    outWs.columns = [{width:12},{width:8},{width:14},{width:16},{width:50},{width:16},{width:14},{width:10},{width:16},{width:24}];

    // Copy header rows 1-14
    for (let r = 1; r <= 14; r++) {
        const src = draftWs.getRow(r), dst = outWs.getRow(r);
        dst.height = src.height;
        src.eachCell({ includeEmpty:true }, (cell, cn) => {
            if (cn > 10) return;
            const d = dst.getCell(cn);
            d.value = cell.value;
            d.style = JSON.parse(JSON.stringify(cell.style));
        });
    }
    [[1,1,10],[3,3,10],[4,4,10],[5,5,10],[6,6,10],[7,7,10],[8,8,10],[9,9,10],[10,10,10],[11,11,10],[12,12,10],[13,13,10]]
        .forEach(([r,c1,c2]) => { try { outWs.mergeCells(r,c1,r,c2); } catch(e){} });

    // Styles
    const greenFill   = { type:'pattern',pattern:'solid',fgColor:{argb:'FF1D6F42'} };
    const blueFill    = { type:'pattern',pattern:'solid',fgColor:{argb:'FF1E40AF'} };
    const inputFill   = { type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFFFF'} };
    const displayFill = { type:'pattern',pattern:'solid',fgColor:{argb:'FFEBEBEB'} };
    const linkFill    = { type:'pattern',pattern:'solid',fgColor:{argb:'FFE8F5E9'} };
    const warnFill    = { type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF3CD'} };
    const borderAll   = { top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'} };

    // Row 15 headers
    ['GROUP','OSM','WORKSTATION','OPERATION CODE','OPERATION NAME','PROCESS TIME (s)','CYCLE TIME (s)','SAH','EMP CODE (auto)','SELECT EMPLOYEE ▼']
        .forEach((h, i) => {
            const c = outWs.getRow(15).getCell(i+1);
            c.value = h;
            c.font  = { bold:true, size:11, color:{argb:'FFFFFFFF'} };
            c.fill  = i === 9 ? blueFill : greenFill;
            c.border = borderAll;
            c.alignment = { horizontal:'center', vertical:'middle' };
        });
    outWs.getRow(15).height = 22;

    // Lists sheet
    const lists = outWb.addWorksheet('Lists');
    lists.state = 'veryHidden';
    ['OPERATION CODE','OPERATION NAME','EMPLOYEE CODE','EMPLOYEE NAME'].forEach((h,i) => lists.getCell(1,i+1).value = h);
    allEmps.forEach((e,i) => {
        lists.getCell(i+2, 3).value = e.emp_code;
        lists.getCell(i+2, 4).value = e.emp_name;
    });

    // Data rows
    const noEmpWS = [];
    allData.forEach(d => {
        const rowNum   = d.rn;
        const firstRow = wsFirstRow[d.ws];
        const isFirst  = rowNum === firstRow;

        const row = outWs.getRow(rowNum);
        row.height = 18;

        const set = (col, val, fill, fmt, align) => {
            const c = row.getCell(col);
            c.value = (val !== null && val !== undefined) ? val : '';
            c.fill  = fill || inputFill;
            c.border = borderAll;
            c.alignment = align || { horizontal:'center', vertical:'middle' };
            if (fmt) c.numFmt = fmt;
        };

        set(1, d.group, inputFill);
        set(2, d.osm,   inputFill);
        set(3, d.ws,    inputFill);
        set(4, '',      inputFill);
        set(5, d.opName, inputFill, null, { horizontal:'left', vertical:'middle', wrapText:true });
        set(6, d.timeSec, inputFill, '0.00');

        // G: Cycle time
        const gc = row.getCell(7);
        gc.value = { formula: `SUMIF($C$16:$C$501,C${rowNum},$F$16:$F$501)`, result: 0 };
        gc.fill = displayFill; gc.border = borderAll; gc.numFmt = '0.00';
        gc.alignment = { horizontal:'center', vertical:'middle' };

        // H: SAH — pre-cache the result
        const hc = row.getCell(8);
        const sahResult = d.timeSec ? +(d.timeSec / 3600).toFixed(6) : 0;
        hc.value = { formula: `F${rowNum}/3600`, result: sahResult };
        hc.fill = displayFill; hc.border = borderAll; hc.numFmt = '0.0000';
        hc.alignment = { horizontal:'center', vertical:'middle' };

        // J: Employee name (first row = static value; others = formula with pre-cached result)
        const jc = row.getCell(10);
        if (isFirst) {
            jc.value = d.empName || '';
            jc.fill  = d.empName ? inputFill : warnFill;
            if (!d.empName && !noEmpWS.includes(d.ws)) noEmpWS.push(d.ws);
        } else {
            const firstEmpName = allData.find(x => x.rn === firstRow)?.empName || '';
            jc.value = { formula: `J${firstRow}`, result: firstEmpName };
            jc.fill  = linkFill;
            jc.font  = { italic:true, color:{argb:'FF374151'} };
        }
        jc.border = borderAll; jc.alignment = { horizontal:'left', vertical:'middle' };

        // I: EMP CODE — formula with pre-cached result
        const ic = row.getCell(9);
        const jEmpName = isFirst ? d.empName : (allData.find(x => x.rn === firstRow)?.empName || '');
        const preCode  = nameToCode[jEmpName] || '';
        ic.value = {
            formula: `IFERROR(INDEX(Lists!$C:$C,MATCH(J${rowNum},Lists!$D:$D,0)),"")`,
            result:  preCode
        };
        ic.fill = displayFill; ic.border = borderAll;
        ic.alignment = { horizontal:'center', vertical:'middle' };
    });

    // Dropdowns on first-row J cells only
    const empCount = allEmps.length;
    Object.values(wsFirstRow).forEach(fr => {
        outWs.dataValidations.add(`J${fr}`, {
            type: 'list', allowBlank: true, showErrorMessage: false,
            formulae: [`Lists!$D$2:$D$${empCount + 1}`]
        });
    });

    // Note row
    const noteRn = Math.max(...allData.map(d => d.rn)) + 2;
    outWs.mergeCells(noteRn, 1, noteRn, 10);
    const nc = outWs.getCell(noteRn, 1);
    nc.value = noEmpWS.length
        ? `White cell = first row of each WS (pick employee → all rows auto-fill, EMP CODE auto-fills). ⚠️ Still needs employee: ${noEmpWS.join(', ')}`
        : '✅ All workstations assigned. Fill LINE CODE, HALL NAME, LINE LEADER before uploading. Product Description: MEDIUM COMPACT BIFOLD WALLET';
    nc.font  = { size:10, italic:true, color:{ argb: noEmpWS.length ? 'FF92400E' : 'FF166534' } };
    nc.fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: noEmpWS.length ? 'FFFFF3CD' : 'FFD1FAE5' } };
    nc.alignment = { wrapText:true };
    outWs.getRow(noteRn).height = 30;

    await outWb.xlsx.writeFile('Data_given/KN754_line_plan_draft.xlsx');
    console.log('Done. Rows:', allData.length, '| No employee:', noEmpWS.length ? noEmpWS.join(', ') : 'None ✅');
    await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
