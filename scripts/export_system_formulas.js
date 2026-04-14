const fs = require('fs');
const path = require('path');
const ExcelJS = require('../backend/node_modules/exceljs');

const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const OUTPUT_FILE = path.join(REPORTS_DIR, 'system_formulas_inventory_2026-04-09.xlsx');

const CODE_FORMULAS = [
    {
        category: 'Core Time',
        name: 'Working Hours',
        expression: '(outH + outM / 60) - (inH + inM / 60) - lunchMins / 60',
        plain_english: 'Shift working hours after subtracting lunch break.',
        locations: [
            'backend/src/routes/api.routes.js:1145-1151',
            'backend/src/routes/api.routes.js:1985-1991',
            'backend/src/routes/api.routes.js:2960-2977',
            'backend/src/routes/api.routes.js:9398-9414'
        ].join('\n')
    },
    {
        category: 'Core Time',
        name: 'Working Seconds',
        expression: 'workingHours * 3600',
        plain_english: 'Converts shift working hours into seconds.',
        locations: [
            'backend/src/routes/api.routes.js:1990-1991',
            'backend/src/routes/api.routes.js:2942-2943',
            'backend/src/routes/api.routes.js:10044',
            'backend/src/routes/api.routes.js:5107'
        ].join('\n')
    },
    {
        category: 'Targeting',
        name: 'Per Hour Target',
        expression: 'dailyTarget / workingHours',
        plain_english: 'Daily target distributed across available working hours.',
        locations: [
            'backend/src/routes/api.routes.js:1138-1151',
            'backend/src/routes/api.routes.js:7082-7094'
        ].join('\n')
    },
    {
        category: 'Targeting',
        name: 'Hourly Target Units For Efficiency View',
        expression: 'Math.ceil(targetUnits / workingHours)',
        plain_english: 'Rounded-up hourly target used in efficiency report summaries.',
        locations: 'backend/src/routes/api.routes.js:10199-10203'
    },
    {
        category: 'Balancing',
        name: 'Takt Time',
        expression: 'workingSeconds / targetUnits',
        plain_english: 'Available working time per target piece.',
        locations: [
            'backend/src/routes/api.routes.js:2000',
            'backend/src/routes/api.routes.js:2961',
            'backend/src/routes/api.routes.js:3077',
            'backend/src/routes/api.routes.js:9408'
        ].join('\n')
    },
    {
        category: 'Balancing',
        name: 'OT Takt Time',
        expression: '(globalOtMinutes * 60) / otTargetUnits',
        plain_english: 'Available overtime seconds per OT target piece.',
        locations: [
            'backend/src/routes/api.routes.js:1269-1272',
            'backend/src/public/js/supervisor.js:2633',
            'backend/src/public/js/admin.js:5714',
            'backend/src/public/js/admin.js:7016'
        ].join('\n')
    },
    {
        category: 'Balancing',
        name: 'Workstation SAM Seconds',
        expression: 'SUM(operation_sah * 3600)',
        plain_english: 'Cycle time of a workstation from all assigned process SAH values.',
        locations: [
            'backend/src/routes/api.routes.js:4513-4536',
            'backend/src/public/js/admin.js:4137-4152',
            'backend/src/public/js/admin.js:6840'
        ].join('\n')
    },
    {
        category: 'Balancing',
        name: 'Workload Percent',
        expression: '(actual_sam_seconds / takt_time_seconds) * 100',
        plain_english: 'Compares workstation cycle time against takt time.',
        locations: [
            'backend/src/routes/api.routes.js:4536',
            'backend/src/public/js/admin.js:4152',
            'backend/src/public/js/admin.js:5715-5716',
            'backend/src/public/js/admin.js:7017-7018'
        ].join('\n')
    },
    {
        category: 'Balancing',
        name: 'Workstation Split Rule',
        expression: 'Create new workstation when currentSam + processSam > taktTimeSeconds',
        plain_english: 'Greedy balancing rule used while auto-generating workstation plans.',
        locations: 'backend/src/routes/api.routes.js:4510-4521'
    },
    {
        category: 'Efficiency',
        name: 'Line Efficiency Percent',
        expression: '((actualOutput * totalSAH) / (manpower * workingHours)) * 100',
        plain_english: 'Standard line efficiency formula used across reports.',
        locations: [
            'backend/src/routes/api.routes.js:2001-2005',
            'backend/src/routes/api.routes.js:2287-2291',
            'backend/src/routes/api.routes.js:2963-2969',
            'backend/src/routes/api.routes.js:3079-3084',
            'backend/src/routes/api.routes.js:9410-9414'
        ].join('\n')
    },
    {
        category: 'Efficiency',
        name: 'Target Efficiency Percent',
        expression: '((targetUnits * totalSAH) / (manpower * workingHours)) * 100',
        plain_english: 'Expected efficiency if the line hits target output.',
        locations: 'backend/src/routes/api.routes.js:2972-2977'
    },
    {
        category: 'Efficiency',
        name: 'Completion Percent',
        expression: '(actualOutput / targetUnits) * 100',
        plain_english: 'Production completion against target.',
        locations: [
            'backend/src/routes/api.routes.js:2021',
            'backend/src/routes/api.routes.js:2307',
            'backend/src/routes/api.routes.js:3007',
            'backend/src/routes/api.routes.js:3104',
            'backend/src/routes/api.routes.js:9417'
        ].join('\n')
    },
    {
        category: 'Efficiency',
        name: 'Employee Efficiency Percent',
        expression: '((output * operationSAH) / (hoursWorked * manpowerFactor)) * 100',
        plain_english: 'Employee efficiency in employee-efficiency export views.',
        locations: [
            'backend/src/routes/api.routes.js:2103-2115',
            'backend/src/routes/api.routes.js:2368-2379'
        ].join('\n')
    },
    {
        category: 'Efficiency',
        name: 'Employee Progress Panel Efficiency',
        expression: '((output * workstationSahHours) / manpowerFactor) * 100',
        plain_english: 'Efficiency formula used in the hourly employee-progress panel.',
        locations: 'backend/src/routes/api.routes.js:208-224'
    },
    {
        category: 'Efficiency',
        name: 'Regular Workstation Efficiency',
        expression: '(workstationSamSeconds / regTaktSeconds) * 100',
        plain_english: 'Regular-shift workstation efficiency in line balancing UI.',
        locations: 'backend/src/public/js/admin.js:4412-4415'
    },
    {
        category: 'Efficiency',
        name: 'OT Workstation Efficiency',
        expression: '(workstationSamSeconds / otTaktSeconds) * 100',
        plain_english: 'Overtime workstation efficiency in line balancing UI.',
        locations: [
            'backend/src/public/js/admin.js:4412-4416',
            'backend/src/public/js/supervisor.js:2633-2635'
        ].join('\n')
    },
    {
        category: 'Efficiency',
        name: 'Combined WS Efficiency With OT',
        expression: '(workstationSamSeconds * (targetUnits + otTargetUnits)) / (regularWorkSeconds + workstationOtSeconds) * 100',
        plain_english: 'Combined regular + OT efficiency used in workstation summary rows.',
        locations: 'backend/src/public/js/admin.js:4413-4415'
    },
    {
        category: 'Efficiency',
        name: 'WS Hourly Efficiency Percent',
        expression: '(hourlyOutput * (actual_sam_seconds / 3600)) * 100',
        plain_english: 'Hourly workstation efficiency in the efficiency report.',
        locations: 'backend/src/routes/api.routes.js:10119-10130'
    },
    {
        category: 'Efficiency',
        name: 'WS Live Efficiency Percent',
        expression: '(liveOutput * (actual_sam_seconds / 3600) / liveDenominatorHours) * 100',
        plain_english: 'Live workstation efficiency using elapsed or total available hours.',
        locations: 'backend/src/routes/api.routes.js:10119-10133'
    },
    {
        category: 'Efficiency',
        name: 'Line Hourly Efficiency Percent',
        expression: '(lastWsHourlyOutput * styleSAH / manpower) * 100',
        plain_english: 'Hourly line efficiency based on finished-goods workstation output.',
        locations: 'backend/src/routes/api.routes.js:10153-10161'
    },
    {
        category: 'Efficiency',
        name: 'Line Live Efficiency Percent',
        expression: '(lastWsLiveOutput * styleSAH / (manpower * liveHours)) * 100',
        plain_english: 'Live line efficiency based on elapsed or shift hours.',
        locations: 'backend/src/routes/api.routes.js:10153-10161'
    },
    {
        category: 'OSM',
        name: 'Per Hour Target (OSM View)',
        expression: 'Math.round(target_units / working_hours)',
        plain_english: 'Rounded hourly target shown in the OSM report.',
        locations: 'backend/src/public/js/admin.js:7643-7644'
    },
    {
        category: 'OSM',
        name: 'Elapsed Target So Far',
        expression: 'elapsedHours * perHourTarget',
        plain_english: 'Target that should have been achieved by the latest entered hour.',
        locations: 'backend/src/public/js/admin.js:7646-7655'
    },
    {
        category: 'OSM',
        name: 'Backlog',
        expression: 'SUM(qty - perHourTarget for each elapsed hour where qty < perHourTarget)',
        plain_english: 'Cumulative shortfall versus hourly targets.',
        locations: 'backend/src/public/js/admin.js:7679-7684'
    },
    {
        category: 'OSM',
        name: 'Extra Output',
        expression: 'SUM(qty - perHourTarget for each elapsed hour where qty > perHourTarget)',
        plain_english: 'Cumulative overachievement versus hourly targets.',
        locations: 'backend/src/public/js/admin.js:7686-7691'
    },
    {
        category: 'OSM',
        name: 'Balance To Produce',
        expression: 'totalTargetSoFar - todayOutput',
        plain_english: 'How much output is still needed to stay on schedule.',
        locations: [
            'backend/src/public/js/admin.js:7693',
            'backend/src/public/js/admin.js:7793'
        ].join('\n')
    },
    {
        category: 'OSM',
        name: 'Order Balance To Produce',
        expression: 'totalTargetOrRangeTarget - cumulativeOutput',
        plain_english: 'Outstanding production balance against order or selected range target.',
        locations: [
            'backend/src/public/js/admin.js:7694',
            'backend/src/public/js/admin.js:7794'
        ].join('\n')
    },
    {
        category: 'OSM',
        name: 'Remaining Days',
        expression: 'Math.ceil(orderBalProd / target_units)',
        plain_english: 'Estimated number of production days remaining at the current daily target.',
        locations: [
            'backend/src/public/js/admin.js:7696-7697',
            'backend/src/public/js/admin.js:7795-7796'
        ].join('\n')
    },
    {
        category: 'Attendance Efficiency',
        name: 'Departure WIP',
        expression: 'Math.round(targetUnits * hoursWorked / shiftHours)',
        plain_english: 'WIP target credited up to departure time.',
        locations: 'backend/src/routes/api.routes.js:10392-10399'
    },
    {
        category: 'Attendance Efficiency',
        name: 'Departure Efficiency Percent',
        expression: '(output * samHours / hoursWorked) * 100',
        plain_english: 'Efficiency for an employee who departed before shift end.',
        locations: 'backend/src/routes/api.routes.js:10392-10399'
    },
    {
        category: 'Attendance Efficiency',
        name: 'Reassignment PRE WIP',
        expression: 'Math.round(targetUnits * preHours / shiftHours)',
        plain_english: 'Target share before reassignment.',
        locations: 'backend/src/routes/api.routes.js:10408-10419'
    },
    {
        category: 'Attendance Efficiency',
        name: 'Reassignment PRE Efficiency Percent',
        expression: '(preOutput * samHours / preHours) * 100',
        plain_english: 'Efficiency before reassignment to another workstation.',
        locations: 'backend/src/routes/api.routes.js:10408-10419'
    },
    {
        category: 'Attendance Efficiency',
        name: 'Reassignment POST WIP',
        expression: 'Math.round(targetUnits * postHours / shiftHours)',
        plain_english: 'Target share after reassignment to the vacant workstation.',
        locations: 'backend/src/routes/api.routes.js:10423-10432'
    },
    {
        category: 'Attendance Efficiency',
        name: 'Reassignment POST Efficiency Percent',
        expression: '(postOutput * vacantSamHours / postHours) * 100',
        plain_english: 'Efficiency after reassignment to the vacant workstation.',
        locations: 'backend/src/routes/api.routes.js:10423-10432'
    },
    {
        category: 'Attendance Efficiency',
        name: 'Combined Workstation SAH Earned',
        expression: '(preOutput * ownSamHours) + (postOutput * (ownSamHours + vacantSamHours))',
        plain_english: 'Earned SAH when an employee combines output from own and vacant workstation.',
        locations: 'backend/src/routes/api.routes.js:10437-10445'
    },
    {
        category: 'Attendance Efficiency',
        name: 'Combined Workstation Efficiency Percent',
        expression: '(totalSAHEarned / effectiveShiftHours) * 100',
        plain_english: 'Efficiency for a combine adjustment scenario.',
        locations: 'backend/src/routes/api.routes.js:10437-10445'
    },
    {
        category: 'Attendance Efficiency',
        name: 'Overall Worker Efficiency Across Dates',
        expression: '(totalSAHEarned / totalHoursWorked) * 100',
        plain_english: 'Overall efficiency rollup in the worker individual efficiency report.',
        locations: 'backend/src/routes/api.routes.js:10496-10515'
    },
    {
        category: 'Unit Conversion',
        name: 'SAM Seconds From SAH',
        expression: 'operation_sah * 3600',
        plain_english: 'Converts SAH hours into seconds.',
        locations: [
            'backend/src/routes/api.routes.js:3505',
            'backend/src/routes/api.routes.js:4081',
            'backend/src/public/js/admin.js:2291',
            'backend/src/public/js/supervisor.js:2648'
        ].join('\n')
    },
    {
        category: 'Unit Conversion',
        name: 'SAH From SAM Seconds',
        expression: 'sam_seconds / 3600',
        plain_english: 'Converts seconds into SAH hours.',
        locations: [
            'backend/src/routes/api.routes.js:3785',
            'backend/src/routes/api.routes.js:4082',
            'backend/src/public/js/admin.js:2574',
            'backend/src/public/js/admin.js:2646'
        ].join('\n')
    },
    {
        category: 'Excel Template',
        name: 'Line Plan Operation Code Extraction',
        expression: '=IF(Erow=\"\",\"\",IF(ISNUMBER(FIND(\"|\",Erow)),TRIM(LEFT(Erow,FIND(\"|\",Erow)-1)),IF(ISNUMBER(MATCH(Erow,Config!$C$1:$C$N,0)),Erow,IFERROR(INDEX(Config!$C$1:$C$N,MATCH(Erow,Config!$D$1:$D$N,0)),\"\"))))',
        plain_english: 'Derives operation code from selected operation code/name text.',
        locations: 'backend/src/routes/api.routes.js:5809-5819'
    },
    {
        category: 'Excel Template',
        name: 'Line Plan Cycle Time',
        expression: '=SUMIF($C$17:$C$502,Crow,$F$17:$F$502)',
        plain_english: 'Totals process times by workstation code.',
        locations: 'backend/src/routes/api.routes.js:5825-5826'
    },
    {
        category: 'Excel Template',
        name: 'Line Plan Takt Time',
        expression: '=IFERROR($B$14/$B$10,\"\")',
        plain_english: 'Uses working seconds header divided by target units header.',
        locations: 'backend/src/routes/api.routes.js:5828-5830'
    },
    {
        category: 'Excel Template',
        name: 'Line Plan Workload',
        expression: '=IFERROR(Grow/Hrow,\"\")',
        plain_english: 'Cycle time divided by takt time.',
        locations: 'backend/src/routes/api.routes.js:5832-5834'
    },
    {
        category: 'Excel Template',
        name: 'Line Plan SAH',
        expression: '=Frow/3600',
        plain_english: 'Process time in seconds converted to SAH.',
        locations: 'backend/src/routes/api.routes.js:5836-5838'
    },
    {
        category: 'Excel Template',
        name: 'Line Plan Employee Code Extraction',
        expression: '=IF(Lrow=\"\",\"\",IF(ISNUMBER(FIND(\"|\",Lrow)),TRIM(LEFT(Lrow,FIND(\"|\",Lrow)-1)),IF(ISNUMBER(MATCH(Lrow,Config!$F$1:$F$N,0)),Lrow,IFERROR(INDEX(Config!$F$1:$F$N,MATCH(Lrow,Config!$G$1:$G$N,0)),\"\"))))',
        plain_english: 'Derives employee code from selected employee code/name text.',
        locations: 'backend/src/routes/api.routes.js:5840-5849'
    },
    {
        category: 'Excel Template',
        name: 'Line Plan Employee Carry Forward',
        expression: '=IFERROR(INDEX($L$17:Lprev,MATCH(Crow,$C$17:Cprev,0)),\"\")',
        plain_english: 'Copies the employee from the first earlier row with the same workstation.',
        locations: 'backend/src/routes/api.routes.js:5851-5859'
    }
];

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function collectExcelFiles(dirPath) {
    const results = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectExcelFiles(fullPath));
            continue;
        }
        if (/\.(xlsx|xlsm)$/i.test(entry.name)) results.push(fullPath);
    }
    return results.sort();
}

async function scanWorkbook(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const rows = [];

    workbook.worksheets.forEach((sheet) => {
        sheet.eachRow({ includeEmpty: false }, (row) => {
            row.eachCell({ includeEmpty: false }, (cell) => {
                let formula = cell.formula || null;
                if (!formula && cell.value && typeof cell.value === 'object' && typeof cell.value.formula === 'string') {
                    formula = cell.value.formula;
                }
                if (!formula) return;
                rows.push({
                    workbook: path.relative(ROOT, filePath),
                    sheet: sheet.name,
                    cell: cell.address,
                    formula
                });
            });
        });
    });

    return rows;
}

function setHeader(sheet, headers) {
    sheet.columns = headers.map((h) => ({ header: h.header, key: h.key, width: h.width || 20 }));
    const row = sheet.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.height = 22;
}

function styleBody(sheet) {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        row.alignment = { vertical: 'top', wrapText: true };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
        from: 'A1',
        to: sheet.getRow(1).lastCell.address
    };
}

async function main() {
    ensureDir(REPORTS_DIR);

    const excelFiles = collectExcelFiles(ROOT);
    const allFormulaCells = [];
    const errors = [];

    for (const filePath of excelFiles) {
        try {
            const rows = await scanWorkbook(filePath);
            allFormulaCells.push(...rows);
        } catch (error) {
            errors.push({
                workbook: path.relative(ROOT, filePath),
                error: error.message
            });
        }
    }

    const uniqueMap = new Map();
    for (const row of allFormulaCells) {
        const key = `${row.workbook}|||${row.sheet}|||${row.formula}`;
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, {
                workbook: row.workbook,
                sheet: row.sheet,
                formula: row.formula,
                occurrences: 0,
                example_cells: []
            });
        }
        const item = uniqueMap.get(key);
        item.occurrences += 1;
        if (item.example_cells.length < 10) item.example_cells.push(row.cell);
    }
    const uniqueFormulaRows = Array.from(uniqueMap.values()).sort((a, b) => {
        if (a.workbook !== b.workbook) return a.workbook.localeCompare(b.workbook);
        if (a.sheet !== b.sheet) return a.sheet.localeCompare(b.sheet);
        return a.formula.localeCompare(b.formula);
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Codex';
    workbook.created = new Date();
    workbook.subject = 'System formula inventory';
    workbook.title = 'WorkSync Formula Inventory';

    const summarySheet = workbook.addWorksheet('Summary');
    setHeader(summarySheet, [
        { header: 'Metric', key: 'metric', width: 32 },
        { header: 'Value', key: 'value', width: 24 }
    ]);
    [
        ['Generated At', new Date().toISOString()],
        ['Project Root', ROOT],
        ['Code Formula Entries', CODE_FORMULAS.length],
        ['Excel Files Scanned', excelFiles.length],
        ['Excel Formula Cells Found', allFormulaCells.length],
        ['Unique Excel Formula Patterns', uniqueFormulaRows.length],
        ['Workbook Scan Errors', errors.length],
        ['Output File', OUTPUT_FILE]
    ].forEach(([metric, value]) => summarySheet.addRow({ metric, value }));
    styleBody(summarySheet);

    const codeSheet = workbook.addWorksheet('Code Formulas');
    setHeader(codeSheet, [
        { header: 'Category', key: 'category', width: 18 },
        { header: 'Formula Name', key: 'name', width: 34 },
        { header: 'Expression', key: 'expression', width: 72 },
        { header: 'Meaning', key: 'plain_english', width: 46 },
        { header: 'Source Locations', key: 'locations', width: 44 }
    ]);
    CODE_FORMULAS.forEach((row) => codeSheet.addRow(row));
    styleBody(codeSheet);

    const uniqueSheet = workbook.addWorksheet('Excel Unique Formulas');
    setHeader(uniqueSheet, [
        { header: 'Workbook', key: 'workbook', width: 38 },
        { header: 'Sheet', key: 'sheet', width: 24 },
        { header: 'Occurrences', key: 'occurrences', width: 14 },
        { header: 'Example Cells', key: 'example_cells', width: 28 },
        { header: 'Formula', key: 'formula', width: 80 }
    ]);
    uniqueFormulaRows.forEach((row) => {
        uniqueSheet.addRow({
            workbook: row.workbook,
            sheet: row.sheet,
            occurrences: row.occurrences,
            example_cells: row.example_cells.join(', '),
            formula: row.formula
        });
    });
    styleBody(uniqueSheet);

    const cellSheet = workbook.addWorksheet('Excel Formula Cells');
    setHeader(cellSheet, [
        { header: 'Workbook', key: 'workbook', width: 38 },
        { header: 'Sheet', key: 'sheet', width: 24 },
        { header: 'Cell', key: 'cell', width: 12 },
        { header: 'Formula', key: 'formula', width: 90 }
    ]);
    allFormulaCells.forEach((row) => cellSheet.addRow(row));
    styleBody(cellSheet);

    const errorsSheet = workbook.addWorksheet('Scan Errors');
    setHeader(errorsSheet, [
        { header: 'Workbook', key: 'workbook', width: 42 },
        { header: 'Error', key: 'error', width: 90 }
    ]);
    if (errors.length === 0) {
        errorsSheet.addRow({ workbook: '-', error: 'No workbook scan errors' });
    } else {
        errors.forEach((row) => errorsSheet.addRow(row));
    }
    styleBody(errorsSheet);

    await workbook.xlsx.writeFile(OUTPUT_FILE);

    console.log(JSON.stringify({
        output: OUTPUT_FILE,
        excel_files_scanned: excelFiles.length,
        formula_cells_found: allFormulaCells.length,
        unique_excel_formulas: uniqueFormulaRows.length,
        code_formula_entries: CODE_FORMULAS.length,
        scan_errors: errors.length
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = {
    CODE_FORMULAS,
    ROOT,
    REPORTS_DIR,
    OUTPUT_FILE
};
