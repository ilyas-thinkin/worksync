const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, PageBreak, convertInchesToTwip,
} = require('docx');
const fs = require('fs');

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  NAVY:   '1E3A5F',
  TEAL:   '0D7377',
  AMBER:  'F59E0B',
  LIGHT:  'E8F4F8',
  GRAY:   'F5F7FA',
  MGRAY:  'E5E7EB',
  DGRAY:  '6B7280',
  BLACK:  '1F2937',
  WHITE:  'FFFFFF',
  RED:    'DC2626',
  GREEN:  '16A34A',
};

// ─── Primitive helpers ────────────────────────────────────────────────────────

const pgBreak = () => new Paragraph({ children: [new PageBreak()] });

const spacer = (before = 0, after = 160) =>
  new Paragraph({ spacing: { before, after } });

function h1(text) {
  return new Paragraph({
    children: [new TextRun({ text, color: C.NAVY, bold: true, size: 36, font: 'Calibri' })],
    spacing: { before: 0, after: 240 },
    border: { bottom: { color: C.TEAL, size: 10, style: BorderStyle.SINGLE, space: 6 } },
  });
}

function h2(text) {
  return new Paragraph({
    children: [new TextRun({ text, color: C.NAVY, bold: true, size: 26, font: 'Calibri' })],
    spacing: { before: 280, after: 120 },
  });
}

function h3(text) {
  return new Paragraph({
    children: [new TextRun({ text, color: C.TEAL, bold: true, size: 22, font: 'Calibri' })],
    spacing: { before: 200, after: 80 },
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, color: C.BLACK, font: 'Calibri', ...opts })],
    spacing: { after: 100 },
  });
}

function bold(text) { return p(text, { bold: true }); }

function kv(key, val) {
  return new Paragraph({
    children: [
      new TextRun({ text: key + ': ', bold: true, size: 20, color: C.NAVY, font: 'Calibri' }),
      new TextRun({ text: val, size: 20, color: C.BLACK, font: 'Calibri' }),
    ],
    spacing: { after: 80 },
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, color: C.BLACK, font: 'Calibri' })],
    bullet: { level },
    spacing: { after: 80 },
  });
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function tHead(cells, fills) {
  return new TableRow({
    tableHeader: true,
    children: cells.map((c, i) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: c, bold: true, size: 18, color: C.WHITE, font: 'Calibri' })],
        alignment: AlignmentType.CENTER,
      })],
      shading: { type: ShadingType.CLEAR, fill: (fills && fills[i]) || C.NAVY },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    })),
  });
}

function tRow(cells, even = false) {
  return new TableRow({
    children: cells.map(c => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: String(c ?? ''), size: 18, color: C.BLACK, font: 'Calibri' })],
      })],
      shading: { type: ShadingType.CLEAR, fill: even ? C.GRAY : C.WHITE },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  });
}

function tbl(headers, rows, widths, headerFills) {
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [
      tHead(headers, headerFills),
      ...rows.map((r, i) => tRow(r, i % 2 === 1)),
    ],
  });
}

// ─── Highlight box (single-row coloured table used as callout) ────────────────
function callout(text, fill = C.LIGHT, textColor = C.NAVY) {
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [new TableRow({ children: [new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text, size: 20, color: textColor, font: 'Calibri', italics: true })],
      })],
      shading: { type: ShadingType.CLEAR, fill },
      margins: { top: 120, bottom: 120, left: 200, right: 200 },
      borders: {
        left: { color: C.TEAL, size: 16, style: BorderStyle.SINGLE },
        top:  { color: C.MGRAY, size: 4,  style: BorderStyle.SINGLE },
        right: { color: C.MGRAY, size: 4, style: BorderStyle.SINGLE },
        bottom: { color: C.MGRAY, size: 4, style: BorderStyle.SINGLE },
      },
    })]})],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT 1 — OPERATIONAL REFERENCE
// ══════════════════════════════════════════════════════════════════════════════

function buildOperationalDoc() {

  // Cover
  const cover = [
    spacer(2800),
    new Paragraph({
      children: [new TextRun({ text: 'WorkSync', color: C.NAVY, bold: true, size: 96, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Manufacturing Execution System', color: C.TEAL, size: 44, font: 'Calibri' })],
      alignment: AlignmentType.CENTER, spacing: { after: 120 },
    }),
    new Paragraph({
      border: { bottom: { color: C.TEAL, size: 12, style: BorderStyle.SINGLE } },
      spacing: { after: 320 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Operational Reference Guide', color: C.DGRAY, size: 28, font: 'Calibri' })],
      alignment: AlignmentType.CENTER, spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Version 1.0  ·  March 2026', color: C.DGRAY, size: 22, font: 'Calibri' })],
      alignment: AlignmentType.CENTER, spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Internal Use Only', color: C.RED, size: 20, bold: true, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
    }),
    pgBreak(),
  ];

  // ToC
  const toc = [
    h1('Contents'),
    ...[
      '1.   What Is WorkSync?',
      '2.   Who Uses WorkSync?',
      '3.   Key Screens & What They Do',
      '4.   Day-in-the-Life Workflows',
      '5.   Calculations & Metrics',
      '6.   Excel Plan Upload',
      '7.   QR Code Scanning',
      '8.   Offline & Real-Time Capabilities',
      '9.   Glossary',
    ].map(item => new Paragraph({
      children: [new TextRun({ text: item, size: 20, color: C.NAVY, font: 'Calibri' })],
      spacing: { after: 100 },
    })),
    pgBreak(),
  ];

  // 1 — What Is WorkSync
  const s1 = [
    h1('1. What Is WorkSync?'),
    p('WorkSync is a digital production management platform built for garment and assembly factories. It replaces paper-based tracking with a live, connected system that every role on the factory floor can use — from the Industrial Engineer setting the daily plan to the Line Leader recording hourly output at the workstation.'),
    spacer(0, 200),
    callout('WorkSync keeps every stakeholder — IE, Line Leaders, Administration, and Management — on the same page, in real time, from any device on the factory network.'),
    spacer(0, 200),
    h2('Core Capabilities'),
    tbl(
      ['Capability', 'What It Enables'],
      [
        ['Line Balancing', 'Automatically groups operations into workstations based on the daily production target — no manual calculation needed.'],
        ['Daily Plan Setup', 'IE sets the product, target, and working hours. Everything else flows from this single entry.'],
        ['Morning Procedure', 'Line Leader scans each worker\'s badge to assign them to their workstation at the start of shift.'],
        ['Feed Input', 'Records how much raw material was fed into the first workstation of each group at shift start.'],
        ['Hourly Output Tracking', 'Line Leader enters actual output per workstation each hour. Cumulative totals update instantly.'],
        ['Changeover Management', 'When the primary product target is reached, the Line Leader triggers a seamless switch to the next product.'],
        ['Overtime (OT) Management', 'IE plans OT duration and target; authorises the Line Leader to assign workers and record OT output.'],
        ['Worker Adjustments', 'Captures mid-shift worker departures and replacements with timestamps.'],
        ['Reports', 'OSM Report and Efficiency Report available to IE, Admin, and Management at any time.'],
        ['Excel Plan Upload', 'IE uploads a pre-filled spreadsheet to create an entire line plan — operations, workstations, and worker assignments — in seconds.'],
      ],
      [2800, 6200]
    ),
    pgBreak(),
  ];

  // 2 — Who Uses WorkSync
  const s2 = [
    h1('2. Who Uses WorkSync?'),
    p('WorkSync has four roles. Each role sees only the screens relevant to their responsibilities.'),
    spacer(0, 160),
    tbl(
      ['Role', 'Also Called', 'Primary Responsibilities'],
      [
        ['Administrator', 'Admin', 'Manages system users, global settings, views all reports, and can perform all IE actions.'],
        ['Industrial Engineer', 'IE', 'Creates and maintains line plans, generates workstation layouts, plans OT, views efficiency and OSM reports.'],
        ['Supervisor', 'Line Leader', 'Runs the morning procedure, records feed input and hourly output, manages OT on the floor, adjusts workers mid-shift.'],
        ['Management', '—', 'Read-only access to live production dashboard, OSM Report, and Efficiency Report.'],
      ],
      [1800, 1500, 5700]
    ),
    spacer(0, 200),
    h2('What Each Role Can Do'),
    tbl(
      ['Action', 'Admin', 'IE', 'Line Leader', 'Management'],
      [
        ['Create lines, products, operations', '✓', '✓', '—', '—'],
        ['Set daily plan & production target', '✓', '✓', '—', '—'],
        ['Upload Excel line plan', '✓', '✓', '—', '—'],
        ['Generate workstation layout', '✓', '✓', '—', '—'],
        ['Create & configure OT plan', '✓', '✓', '—', '—'],
        ['Authorise Line Leader for OT', '✓', '✓', '—', '—'],
        ['Run morning procedure (assign workers)', '—', '—', '✓', '—'],
        ['Enter feed material quantity', '—', '—', '✓', '—'],
        ['Enter hourly production output', '—', '—', '✓', '—'],
        ['Record worker departures / replacements', '—', '—', '✓', '—'],
        ['Trigger product changeover', '—', '—', '✓', '—'],
        ['View OSM Report', '✓', '✓', '—', '✓'],
        ['View Efficiency Report', '✓', '✓', '—', '✓'],
        ['Manage system users', '✓', '—', '—', '—'],
      ],
      [3600, 1100, 1100, 1600, 1600]
    ),
    pgBreak(),
  ];

  // 3 — Screens
  const s3 = [
    h1('3. Key Screens & What They Do'),

    h2('3.1 Administration / IE Panel'),
    tbl(
      ['Screen', 'Purpose'],
      [
        ['Dashboard', 'Live tiles showing every line\'s current output vs target, efficiency %, and shift status.'],
        ['Lines', 'View and manage production lines. Set the daily plan (product, target, date) and inspect the workstation layout.'],
        ['OT Management', 'Per-line card showing OT start/end times, duration (1–4 h), auto-calculated OT target, per-workstation active status, worker assignments, and the Authorise Supervisor button.'],
        ['Products', 'Manage the product catalogue and attach operations with their standard times (SAH).'],
        ['Employees', 'Manage the employee master list.'],
        ['Operations', 'Manage the shared operations library.'],
        ['OSM Report', 'Printable per-line, per-date output monitoring grid with back-log column (B.LOG) and balance-to-produce.'],
        ['Efficiency Report', 'Multi-line, multi-date efficiency summary (actual vs target %).'],
        ['Settings (Admin only)', 'Configure global working hours (shift start/end time).'],
        ['Users (Admin only)', 'Create and manage system user accounts and roles.'],
      ],
      [2400, 6600]
    ),
    spacer(0, 200),

    h2('3.2 Line Leader (Supervisor) Panel'),
    tbl(
      ['Screen', 'Purpose'],
      [
        ['Morning Procedure', 'Shows every workstation on the selected line. The Line Leader scans each worker\'s QR badge to link them to their workstation. Status updates to "Assigned" instantly.'],
        ['Feed Input', 'Displays only the first workstation of each group. Line Leader enters the material quantity fed in at shift start. Can be updated throughout the day.'],
        ['Hourly Procedure — Regular', 'Shows all workstations with cumulative output, current status, and an "Enter Output" button. Blocked with a clear message if no daily plan is set or no worker is assigned.'],
        ['Hourly Procedure — OT', 'Full OT management view: OT plan summary (times, target), workstation active/inactive toggles, worker assignment, per-WS OT duration, and output entry. Locked until IE authorises.'],
        ['Worker Adjustment', 'Records mid-shift worker changes. Line Leader selects or scans the departing worker and the replacement, logs the reason and time.'],
      ],
      [2400, 6600]
    ),
    spacer(0, 200),

    h2('3.3 Management Panel'),
    tbl(
      ['Screen', 'Purpose'],
      [
        ['Dashboard', 'Read-only live summary of all lines — output, target, efficiency, and shift status.'],
        ['OSM Report', 'Same OSM grid as Admin/IE — read-only.'],
        ['Efficiency Report', 'Same efficiency view as Admin/IE — read-only.'],
      ],
      [2400, 6600]
    ),
    pgBreak(),
  ];

  // 4 — Workflows
  const s4 = [
    h1('4. Day-in-the-Life Workflows'),

    h2('4.1 Start of Day — IE / Admin'),
    ...[
      'IE opens the Lines screen and selects today\'s date.',
      'Sets the daily plan: product, production target, and (optionally) a changeover product.',
      'Either clicks "Generate Workstations" for automatic line balancing, or uploads a pre-filled Excel plan.',
      'If OT is planned: creates the OT plan (duration, start time). Optionally authorises the Line Leader immediately.',
      'Line Leader and Management can now see the plan live.',
    ].map((t, i) => bullet(`${i + 1}.  ${t}`)),

    h2('4.2 Morning Procedure — Line Leader'),
    ...[
      'Line Leader opens Morning Procedure and selects their line.',
      'For each workstation: taps "Scan & Link" → camera opens → scans the worker\'s QR badge.',
      'The workstation status changes to "Assigned — [Worker Name]" immediately.',
      'Once all workstations are assigned, the morning procedure is complete.',
    ].map((t, i) => bullet(`${i + 1}.  ${t}`)),

    h2('4.3 Feed Input — Line Leader'),
    ...[
      'Line Leader opens Feed Input and selects their line.',
      'Only the first workstation of each group is shown.',
      'Enters the material quantity (number of pieces) fed in for each group.',
      'Taps Save — the quantity is recorded and can be updated at any time.',
    ].map((t, i) => bullet(`${i + 1}.  ${t}`)),

    h2('4.4 Hourly Output Entry — Line Leader'),
    ...[
      'Line Leader opens Hourly Procedure → Regular tab.',
      'For each workstation: taps "Enter Output" → types the count → taps Submit.',
      'Cumulative totals update on screen. All connected screens (Management dashboard, IE panel) update in real time.',
      'Workstations without a plan or without an assigned worker show a clear disabled label — no accidental input.',
    ].map((t, i) => bullet(`${i + 1}.  ${t}`)),

    h2('4.5 Product Changeover — Line Leader'),
    ...[
      'IE has set a changeover product on the daily plan.',
      'As hourly output accumulates and reaches 100% of the primary target, the "Start Changeover" button becomes active.',
      'Line Leader taps Start Changeover → system confirms and switches the active product.',
      'The same workstations and worker assignments carry over automatically — no new morning procedure.',
    ].map((t, i) => bullet(`${i + 1}.  ${t}`)),

    h2('4.6 Overtime Procedure'),
    ...[
      'IE creates an OT plan: duration (1, 2, 3, or 4 hours), start time. The OT target is calculated automatically.',
      'IE taps "Authorise Supervisor" to unlock OT editing for the Line Leader.',
      'Line Leader opens Hourly → OT tab: toggles which workstations are active, assigns OT workers via QR scan.',
      'Line Leader enters OT output per workstation — separate from regular shift output.',
    ].map((t, i) => bullet(`${i + 1}.  ${t}`)),

    h2('4.7 Worker Adjustment — Mid-Shift'),
    ...[
      'A worker needs to leave early or be replaced.',
      'Line Leader opens Worker Adjustment, scans or selects the departing worker and their workstation.',
      'Optionally scans or selects the replacement worker.',
      'Enters a reason — adjustment is logged with timestamp.',
    ].map((t, i) => bullet(`${i + 1}.  ${t}`)),

    pgBreak(),
  ];

  // 5 — Calculations
  const s5 = [
    h1('5. Calculations & Metrics'),
    p('WorkSync computes all key production metrics automatically. Below is a plain-language explanation of each.'),
    spacer(0, 160),

    tbl(
      ['Metric', 'How It Is Calculated', 'Where It Appears'],
      [
        ['Takt Time', 'Available working time ÷ daily target units. Represents how many seconds are available per unit produced.', 'Workstation plan generation'],
        ['Workload %', 'Total standard time for all operations in a workstation ÷ takt time × 100. Shows how loaded each workstation is relative to the target pace.', 'IE workstation plan view'],
        ['Per-Hour Target', 'Daily target units ÷ available working hours. Rounded to nearest whole unit.', 'OT planning, OSM Report'],
        ['OT Target', 'Per-hour target × OT duration (hours). Calculated automatically when IE selects the OT duration.', 'OT plan card, OT tab'],
        ['Efficiency %', 'Actual output ÷ daily target × 100. Can exceed 100% if output surpasses target.', 'Dashboard, Efficiency Report'],
        ['B.LOG (Back-Log)', 'Cumulative actual output − (elapsed hours × per-hour target). Positive = ahead of schedule (green); negative = behind (red).', 'OSM Report'],
        ['Balance to Produce', 'Daily target − cumulative actual output. Units still needed to meet today\'s target.', 'OSM Report'],
        ['Changeover Gate', 'Changeover can only be started once actual output ≥ primary target. System enforces this — button is locked until threshold is reached.', 'Hourly Procedure'],
      ],
      [2200, 4600, 2200]
    ),
    pgBreak(),
  ];

  // 6 — Excel Upload
  const s6 = [
    h1('6. Excel Plan Upload'),
    p('IE can create a complete line plan by uploading a single Excel file. This creates the line, product, all operations, the workstation layout, and the initial worker assignments in one action.'),
    spacer(0, 160),
    callout('Download the blank template from the "↑ Upload Plan" button in the Lines screen. Do not change the column order or the row positions of the header fields.'),
    spacer(0, 200),

    h2('Header Fields (Rows 3–10)'),
    tbl(
      ['Field', 'Description', 'Example'],
      [
        ['Line Code', 'Unique identifier for the production line.', 'LINE-01'],
        ['Product Code', 'Unique identifier for the product.', 'PROD-A'],
        ['Work Date', 'The date this plan applies to.', '2026-03-18'],
        ['Target Units', 'Daily production target.', '480'],
        ['Changeover Product Code', 'Optional. The next product to run after the primary target is reached.', 'PROD-B'],
      ],
      [2200, 4600, 2200]
    ),

    h2('Data Rows (Row 12 = Column Headers, Row 13 onwards = Data)'),
    tbl(
      ['Column', 'Field', 'Description'],
      [
        ['A', 'SEQ', 'Operation sequence number (determines order on the line).'],
        ['B', 'GROUP', 'Section or group name (e.g. "BODY", "SLEEVE"). Used for grouping on the OSM Report.'],
        ['C', 'WORKSTATION', 'Workstation code (e.g. "WS-01"). All rows with the same code belong to the same workstation.'],
        ['D', 'OPERATION CODE', 'Unique code for the operation. New operations are created automatically.'],
        ['E', 'OPERATION NAME', 'Display name for the operation.'],
        ['F', 'SAH', 'Standard Allowable Hours — the standard time for this operation (e.g. 0.0125).'],
        ['G', 'EMPLOYEE CODE', 'Optional. The worker\'s code. Automatically creates the morning assignment.'],
      ],
      [700, 2000, 6300]
    ),
    pgBreak(),
  ];

  // 7 — QR
  const s7 = [
    h1('7. QR Code Scanning'),
    p('WorkSync uses QR codes to speed up worker assignment. No typing required — the Line Leader simply points the device camera at the worker\'s badge.'),
    spacer(0, 160),
    tbl(
      ['Where QR Is Used', 'What Gets Scanned', 'What Happens'],
      [
        ['Morning Procedure', 'Worker\'s personal QR badge', 'Worker is linked to the selected workstation for the day.'],
        ['OT Tab — worker assignment', 'Worker\'s personal QR badge', 'Worker is assigned to a workstation for the OT session.'],
        ['Worker Adjustment', 'Worker\'s personal QR badge', 'Departing or replacement worker is identified quickly.'],
      ],
      [2400, 2400, 4200]
    ),
    spacer(0, 160),
    p('Each worker\'s QR badge encodes their unique employee code. The system looks this up and resolves it to the worker\'s full name automatically.'),
    pgBreak(),
  ];

  // 8 — Offline & Real-Time
  const s8 = [
    h1('8. Offline & Real-Time Capabilities'),

    h2('8.1 Real-Time Updates'),
    p('All screens update live as data is entered — no need to refresh the page. When a Line Leader records hourly output, the Management dashboard and IE panel reflect the change within seconds. This is powered by a persistent background connection between the browser and the server.'),

    h2('8.2 Offline Support'),
    p('WorkSync works even when the factory Wi-Fi is temporarily unavailable. Morning assignments and hourly output entries made while offline are stored on the device. As soon as connectivity is restored, they are automatically sent to the server in the order they were recorded.'),
    spacer(0, 160),
    tbl(
      ['Scenario', 'What WorkSync Does'],
      [
        ['Wi-Fi drops during morning procedure', 'Scan-and-link actions are stored locally. Synced automatically when connection returns.'],
        ['Wi-Fi drops during hourly entry', 'Output entries are queued on the device. Sent in order when reconnected.'],
        ['Page is closed and reopened offline', 'All static screens (HTML, CSS, scripts) load from the device cache.'],
      ],
      [3200, 5800]
    ),
    pgBreak(),
  ];

  // 9 — Glossary
  const s9 = [
    h1('9. Glossary'),
    tbl(
      ['Term', 'Definition'],
      [
        ['Takt Time', 'The available production time divided by the target quantity. The "beat" every workstation should match.'],
        ['SAH', 'Standard Allowable Hours. The official time standard for completing one operation on one unit.'],
        ['Workstation', 'A physical position on the production line where one or more operations are performed by one worker.'],
        ['Group', 'A named section of the line (e.g. "BODY", "SLEEVE"). Groups are used for OSM reporting and feed input.'],
        ['Morning Procedure', 'The start-of-shift step where the Line Leader links each worker to their workstation via QR scan.'],
        ['Feed Input', 'Recording the number of cut pieces (material) fed into the first workstation of each group at shift start.'],
        ['Changeover', 'Switching the active product on a line after the primary daily target is fully met.'],
        ['OT (Overtime)', 'Production activity beyond the regular shift. Planned by IE, executed by Line Leader.'],
        ['B.LOG', 'Back-Log. The difference between actual cumulative output and the expected cumulative output at the current hour.'],
        ['BAL TO PROD', 'Balance to Produce. Units remaining to reach today\'s target.'],
        ['OSM Report', 'Output Stitch Monitoring report. A grid showing hourly output per workstation vs target, with B.LOG and balance columns.'],
        ['Efficiency %', 'Actual output divided by target, expressed as a percentage.'],
        ['IE', 'Industrial Engineer. The role responsible for setting plans, standards, and analysing production efficiency.'],
        ['Line Leader', 'The supervisor on the factory floor responsible for running the shift procedures in WorkSync.'],
        ['Per-Hour Target', 'Daily target divided by available working hours. The number of units expected per hour.'],
      ],
      [2400, 6600]
    ),
  ];

  return new Document({
    creator: 'WorkSync',
    title: 'WorkSync Operational Reference Guide',
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children: [
        ...cover, ...toc,
        ...s1, ...s2, ...s3, ...s4,
        ...s5, ...s6, ...s7, ...s8, ...s9,
      ],
    }],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT 2 — PITCH DECK
// ══════════════════════════════════════════════════════════════════════════════

function buildPitchDeck() {

  // ── Slide-style sections: full-bleed heading rows ─────────────────────────

  function slide(title, subtitle, fill = C.NAVY, titleColor = C.WHITE, subColor = C.LIGHT) {
    return [
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        rows: [new TableRow({ children: [new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: title, color: titleColor, bold: true, size: 52, font: 'Calibri' })],
              alignment: AlignmentType.CENTER, spacing: { after: 80 },
            }),
            ...(subtitle ? [new Paragraph({
              children: [new TextRun({ text: subtitle, color: subColor, size: 26, font: 'Calibri' })],
              alignment: AlignmentType.CENTER,
            })] : []),
          ],
          shading: { type: ShadingType.CLEAR, fill },
          margins: { top: 600, bottom: 600, left: 400, right: 400 },
        })]})],
      }),
      spacer(0, 300),
    ];
  }

  function statCard(value, label, fill = C.NAVY) {
    return new TableCell({
      children: [
        new Paragraph({
          children: [new TextRun({ text: value, color: C.WHITE, bold: true, size: 60, font: 'Calibri' })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [new TextRun({ text: label, color: C.LIGHT, size: 18, font: 'Calibri' })],
          alignment: AlignmentType.CENTER,
        }),
      ],
      shading: { type: ShadingType.CLEAR, fill },
      margins: { top: 200, bottom: 200, left: 100, right: 100 },
    });
  }

  function statsRow(stats) {
    return new Table({
      width: { size: 9000, type: WidthType.DXA },
      rows: [new TableRow({
        children: stats.map((s, i) => statCard(s[0], s[1], [C.NAVY, C.TEAL, '7C3AED', C.GREEN][i % 4])),
      })],
    });
  }

  function featureRow(icon, title, desc) {
    return new Table({
      width: { size: 9000, type: WidthType.DXA },
      rows: [new TableRow({ children: [
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: icon, size: 40 })],
            alignment: AlignmentType.CENTER,
          })],
          shading: { type: ShadingType.CLEAR, fill: C.LIGHT },
          margins: { top: 120, bottom: 120, left: 200, right: 200 },
          width: { size: 1200, type: WidthType.DXA },
        }),
        new TableCell({
          children: [
            new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 22, color: C.NAVY, font: 'Calibri' })] }),
            new Paragraph({ children: [new TextRun({ text: desc, size: 20, color: C.BLACK, font: 'Calibri' })], spacing: { after: 0 } }),
          ],
          shading: { type: ShadingType.CLEAR, fill: C.WHITE },
          margins: { top: 120, bottom: 120, left: 200, right: 200 },
        }),
      ]})],
    });
  }

  // ── Cover Slide ────────────────────────────────────────────────────────────
  const cover = [
    spacer(1600),
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      rows: [new TableRow({ children: [new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'WorkSync', color: C.WHITE, bold: true, size: 120, font: 'Calibri' })],
            alignment: AlignmentType.CENTER, spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'The Production Floor. Finally in Control.', color: C.LIGHT, size: 36, font: 'Calibri', italics: true })],
            alignment: AlignmentType.CENTER, spacing: { after: 120 },
          }),
          new Paragraph({
            border: { bottom: { color: C.AMBER, size: 12, style: BorderStyle.SINGLE } },
            spacing: { after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Real-Time Manufacturing Execution for Garment & Assembly Factories', color: C.LIGHT, size: 24, font: 'Calibri' })],
            alignment: AlignmentType.CENTER,
          }),
        ],
        shading: { type: ShadingType.CLEAR, fill: C.NAVY },
        margins: { top: 600, bottom: 600, left: 600, right: 600 },
      })]})],
    }),
    pgBreak(),
  ];

  // ── Slide 1: The Problem ───────────────────────────────────────────────────
  const s1 = [
    ...slide('The Problem', 'Why factories are flying blind'),
    tbl(
      ['The Old Way', 'The Cost'],
      [
        ['Paper tally sheets per workstation', 'Data collected once at end of shift — hours of lost visibility'],
        ['Manual headcount checks', 'Line Leader leaves the floor to update a whiteboard or spreadsheet'],
        ['Excel files shared by email', 'Plans change, but workers are following yesterday\'s version'],
        ['No real-time back-log awareness', 'Management only finds out the line is behind at the daily meeting'],
        ['Overtime planned on gut feel', 'OT targets set without reference to the actual hourly production rate'],
        ['Worker changes go unrecorded', 'No traceability when output drops mid-shift'],
      ],
      [3500, 5500]
    ),
    spacer(0, 200),
    callout('Factories lose between 10–20% of potential daily output to information delays and untracked floor events.', 'FFF3CD', '92400E'),
    pgBreak(),
  ];

  // ── Slide 2: The Solution ─────────────────────────────────────────────────
  const s2 = [
    ...slide('The Solution', 'WorkSync — built for the factory floor, not the office'),
    p('WorkSync replaces every paper sheet, whiteboard, and reactive phone call with a single live platform. Every role — IE, Line Leader, Management — sees the same data, updated the moment it happens.'),
    spacer(0, 160),
    featureRow('📋', 'Digital Daily Plan', 'IE sets the target once. WorkSync distributes it to every workstation and every screen automatically.'),
    spacer(0, 80),
    featureRow('📷', 'QR Worker Assignment', 'Line Leader scans a badge — worker is assigned in under 3 seconds. No typing, no mistakes.'),
    spacer(0, 80),
    featureRow('⏱', 'Live Hourly Tracking', 'Output entered per workstation each hour. Back-log calculated instantly. Management sees it live.'),
    spacer(0, 80),
    featureRow('🔄', 'Seamless Changeover', 'System locks changeover until the primary target is met — then switches product in one tap.'),
    spacer(0, 80),
    featureRow('🌙', 'OT Management', 'IE plans OT duration. Target auto-calculates. Line Leader manages the OT floor on one screen.'),
    spacer(0, 80),
    featureRow('📊', 'Instant Reports', 'OSM and Efficiency reports always up to date — no end-of-day data entry needed.'),
    pgBreak(),
  ];

  // ── Slide 3: Key Numbers ───────────────────────────────────────────────────
  const s3 = [
    ...slide('By the Numbers', '', C.TEAL),
    statsRow([
      ['4', 'User Roles'],
      ['31', 'Data Tables'],
      ['< 3 s', 'Worker Assignment'],
      ['Live', 'Dashboard Updates'],
    ]),
    spacer(0, 240),
    statsRow([
      ['4 h max', 'OT Duration Options'],
      ['100%', 'Offline Capable'],
      ['1 file', 'Full Plan Upload'],
      ['0', 'Manual Reports'],
    ]),
    pgBreak(),
  ];

  // ── Slide 4: How It Works ─────────────────────────────────────────────────
  const s4 = [
    ...slide('How a Shift Works', 'From plan to report — fully digital'),
    tbl(
      ['Step', 'Who', 'What Happens in WorkSync'],
      [
        ['1. Plan the day', 'IE', 'Sets product, target, and workstation layout. Optionally uploads Excel plan.'],
        ['2. Assign workers', 'Line Leader', 'Scans each worker\'s QR badge at their workstation. Takes 2–3 minutes for a full line.'],
        ['3. Record feed material', 'Line Leader', 'Enters cut piece count for each group. One number per group, one tap to save.'],
        ['4. Enter hourly output', 'Line Leader', 'Each hour: taps workstation → types output count → submits. 30 seconds per line.'],
        ['5. Monitor in real time', 'Management / IE', 'Dashboard shows live cumulative output, back-log, and efficiency for every line.'],
        ['6. Handle exceptions', 'Line Leader', 'Worker adjustment recorded in seconds. OT authorised and managed on-screen.'],
        ['7. Review reports', 'All roles', 'OSM and Efficiency reports available immediately — no preparation needed.'],
      ],
      [1400, 1800, 5800]
    ),
    pgBreak(),
  ];

  // ── Slide 5: Who Benefits ────────────────────────────────────────────────
  const s5 = [
    ...slide('Who Benefits & How', ''),
    tbl(
      ['Role', 'Before WorkSync', 'With WorkSync'],
      [
        ['Industrial Engineer', 'Creates plans in Excel, shares by hand, re-enters data at day end.', 'One upload or a few clicks — plan is live on all screens instantly.'],
        ['Line Leader', 'Fills paper sheets every hour, reports to IE verbally, chases replacements manually.', 'Scans badges, taps output counts, logs adjustments — all from one screen.'],
        ['Management', 'Waits for end-of-day summary. No live visibility.', 'Live dashboard from any device. Back-log status visible at any moment.'],
        ['Factory (overall)', 'Decisions based on hours-old data. OT guessed, not calculated.', 'Decisions based on live data. OT target derived from actual production rate.'],
      ],
      [1800, 3600, 3600]
    ),
    pgBreak(),
  ];

  // ── Slide 6: Features Deep Dive ──────────────────────────────────────────
  const s6 = [
    ...slide('Feature Highlights', ''),

    h2('Line Balancing — Automatic Workstation Layout'),
    p('WorkSync uses the production target and operation standard times (SAH) to automatically group operations into workstations so that each workstation is as close to the takt time as possible. IE can review and adjust the layout before the shift starts. Alternatively, a fully custom layout can be uploaded via Excel.'),
    spacer(0, 160),

    h2('OSM Report — Your Shift at a Glance'),
    p('The Output Stitch Monitoring report shows, for every workstation, the output recorded each hour. A Back-Log column turns red the moment a workstation falls behind the hourly pace — making it immediately clear where to intervene. Management and IE can view or print this report at any time during or after the shift.'),
    spacer(0, 160),

    h2('OT Management — Planned, Not Reactive'),
    p('IE selects an OT duration (1, 2, 3, or 4 hours). WorkSync calculates the OT target automatically using the line\'s proven hourly production rate — no guessing. IE can authorise the Line Leader to manage OT workstations and workers directly from the floor.'),
    spacer(0, 160),

    h2('Changeover — Zero Downtime Product Switch'),
    p('When the primary product target is reached, the Line Leader triggers a changeover in one tap. The system validates that output meets the target before allowing this. The same workstations and workers carry over to the new product — no re-assignment needed.'),
    pgBreak(),
  ];

  // ── Slide 7: Security & Reliability ──────────────────────────────────────
  const s7 = [
    ...slide('Reliability & Access Control', ''),
    tbl(
      ['Concern', 'How WorkSync Addresses It'],
      [
        ['Access control', 'Every user has a role. Each role sees only the screens they need. Tokens expire automatically.'],
        ['Data integrity', 'All inputs validated on the server. Hourly output cannot be submitted without a valid plan and assigned worker.'],
        ['Network outages', 'Progressive Web App with offline queue. No data is lost if Wi-Fi drops on the floor.'],
        ['Multiple users simultaneously', 'Built for concurrent use across all lines. Real-time sync keeps all screens consistent.'],
        ['Audit trail', 'Every action is logged with user, timestamp, and old/new values.'],
        ['Hardware', 'Runs on standard hardware (server + any modern browser). No specialised equipment required beyond QR badge printing.'],
      ],
      [2800, 6200]
    ),
    pgBreak(),
  ];

  // ── Slide 8: Implementation ───────────────────────────────────────────────
  const s8 = [
    ...slide('Getting Started', 'Simple to set up. Immediate value.'),
    tbl(
      ['Phase', 'Activity', 'Outcome'],
      [
        ['Setup', 'Install server. Create user accounts. Add lines, products, and employees.', 'System live on factory network.'],
        ['Plan upload', 'IE uploads first Excel plan or creates plan via the interface.', 'Workstation layout visible. Morning procedure ready.'],
        ['First shift', 'Line Leader runs morning procedure. Enters hourly output.', 'Live dashboard active. Back-log visible to all.'],
        ['Ongoing', 'Daily plans, OT sessions, changeovers managed through normal use.', 'Full historical data and reports accumulate automatically.'],
      ],
      [1400, 4400, 3200]
    ),
    spacer(0, 200),
    callout('No specialist IT team required. WorkSync runs on a single local server. Any device with a modern browser — tablet, laptop, phone — works as a client.'),
    pgBreak(),
  ];

  // ── Closing Slide ─────────────────────────────────────────────────────────
  const closing = [
    spacer(1200),
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      rows: [new TableRow({ children: [new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'WorkSync', color: C.AMBER, bold: true, size: 80, font: 'Calibri' })],
            alignment: AlignmentType.CENTER, spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Every worker. Every hour. Every decision.', color: C.WHITE, size: 32, font: 'Calibri', italics: true })],
            alignment: AlignmentType.CENTER, spacing: { after: 120 },
          }),
          new Paragraph({
            border: { bottom: { color: C.AMBER, size: 8, style: BorderStyle.SINGLE } },
            spacing: { after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Ready to see it live? Let\'s schedule a demo.', color: C.LIGHT, size: 24, font: 'Calibri' })],
            alignment: AlignmentType.CENTER,
          }),
        ],
        shading: { type: ShadingType.CLEAR, fill: C.NAVY },
        margins: { top: 500, bottom: 500, left: 600, right: 600 },
      })]})],
    }),
  ];

  return new Document({
    creator: 'WorkSync',
    title: 'WorkSync — Pitch Deck',
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children: [
        ...cover,
        ...s1, ...s2, ...s3, ...s4,
        ...s5, ...s6, ...s7, ...s8,
        ...closing,
      ],
    }],
  });
}

// ── Write both files ──────────────────────────────────────────────────────────

async function main() {
  const outDir = '/home/worksync/worksync/backend/src/public/';

  const [opBuf, pitchBuf] = await Promise.all([
    Packer.toBuffer(buildOperationalDoc()),
    Packer.toBuffer(buildPitchDeck()),
  ]);

  const opPath    = outDir + 'WorkSync_Operational_Guide.docx';
  const pitchPath = outDir + 'WorkSync_Pitch_Deck.docx';

  fs.writeFileSync(opPath, opBuf);
  fs.writeFileSync(pitchPath, pitchBuf);

  console.log(`✓ Operational Guide  →  ${opPath}  (${(opBuf.length/1024).toFixed(1)} KB)`);
  console.log(`✓ Pitch Deck         →  ${pitchPath}  (${(pitchBuf.length/1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
